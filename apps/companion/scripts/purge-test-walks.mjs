/**
 * Purge test/fake cleanups from Firestore (admin).
 *
 * DRY-RUN by default — prints what would be deleted. Add --delete to commit.
 *
 * Usage (from apps/companion):
 *   node scripts/purge-test-walks.mjs                        # dry-run, default criteria
 *   node scripts/purge-test-walks.mjs --delete               # actually delete
 *   node scripts/purge-test-walks.mjs --max-seconds 120 --max-items 0
 *   node scripts/purge-test-walks.mjs --uid <uid> --delete   # only one user's walks
 *   node scripts/purge-test-walks.mjs --segments --uid <uid> --since 2026-07-01 --delete
 *
 * Default criteria: duration_seconds < 120 AND items_count == 0 (matches the
 * app's new "counts as a cleanup" threshold).
 *
 * --segments additionally deletes segment_status docs last stamped by --uid
 * since --since (undoes fake "cleaned street" freshness from test walks).
 *
 * Key: ../../../pick-app/serviceAccountKey.json (or set GOOGLE_APPLICATION_CREDENTIALS).
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// firebase-admin v14 removed the `admin.credential.cert` / `admin.firestore()`
// namespace under ESM; only these modular entry points exist.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const DELETE = flag('delete');
const MAX_SECONDS = Number(opt('max-seconds', 120));
const MAX_ITEMS = Number(opt('max-items', 0));
const UID = opt('uid', null);
const SINCE = opt('since', null); // YYYY-MM-DD
const DO_SEGMENTS = flag('segments');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || join(homedir(), 'pick-app', 'serviceAccountKey.json');
if (!existsSync(keyPath)) {
  console.error(`No service account key at ${keyPath}`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
const db = getFirestore();

const sinceTs = SINCE ? new Date(`${SINCE}T00:00:00Z`).getTime() : null;

/**
 * Normalise a cleanup's `timestamp` to epoch milliseconds.
 *
 * TRAP: never do `Number(timestamp)`. Cleanups store a real Firestore
 * `Timestamp`, whose valueOf() returns an epoch-SHIFTED zero-padded string so
 * it sorts lexicographically — coercing it yields ~6.4e10 (the year 3995)
 * rather than throwing. That silently broke the --since filter, which compared
 * that garbage against a real epoch and matched nothing.
 */
function tsMillis(v) {
  if (v == null) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const n = typeof v === 'number' ? v : NaN;
  if (!isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? n : n * 1000; // past ~1973 in ms means it's already ms
}


async function purgeCleanups() {
  let q = db.collection('cleanups');
  if (UID) q = q.where('userId', '==', UID);
  const snap = await q.get();
  const doomed = [];
  snap.forEach((d) => {
    const c = d.data();
    const dur = Number(c.duration_seconds) || 0;
    const items = Number(c.items_count) || 0;
    const ts = tsMillis(c.timestamp);
    if (sinceTs && ts < sinceTs) return;
    // "test walk": too short AND no pickups (matches the app threshold)
    if (dur < MAX_SECONDS && items <= MAX_ITEMS) doomed.push({ id: d.id, dur, items, ts });
  });
  console.log(`cleanups scanned: ${snap.size}; matching test criteria (<${MAX_SECONDS}s & <=${MAX_ITEMS} items): ${doomed.length}`);
  doomed.forEach((c) => console.log(`  ${c.id}  ${c.dur}s  ${c.items} items  ${c.ts ? new Date(c.ts).toISOString() : '?'}`));
  if (DELETE && doomed.length) {
    for (let i = 0; i < doomed.length; i += 400) {
      const batch = db.batch();
      doomed.slice(i, i + 400).forEach((c) => batch.delete(db.collection('cleanups').doc(c.id)));
      await batch.commit();
    }
    console.log(`✅ deleted ${doomed.length} cleanups`);
  } else if (doomed.length) {
    console.log('(dry-run — add --delete to remove them)');
  }
}

async function purgeSegments() {
  if (!UID) { console.error('--segments requires --uid'); return; }
  let q = db.collection('segment_status').where('last_user', '==', UID);
  const snap = await q.get();
  const doomed = [];
  snap.forEach((d) => {
    const s = d.data();
    if (sinceTs && (Number(s.last_cleaned) || 0) < sinceTs) return;
    doomed.push(d.id);
  });
  console.log(`segment_status stamped by ${UID}${SINCE ? ` since ${SINCE}` : ''}: ${doomed.length}`);
  if (DELETE && doomed.length) {
    for (let i = 0; i < doomed.length; i += 400) {
      const batch = db.batch();
      doomed.slice(i, i + 400).forEach((id) => batch.delete(db.collection('segment_status').doc(id)));
      await batch.commit();
    }
    console.log(`✅ deleted ${doomed.length} segment statuses (streets revert to prior/never-cleaned)`);
  } else if (doomed.length) {
    console.log('(dry-run — add --delete to remove them)');
  }
}

await purgeCleanups();
if (DO_SEGMENTS) await purgeSegments();
console.log('\nNote: user_stats recompute on each user\'s next app use; public hotspots rebuild on the hourly rebuildPublicStats run.');
process.exit(0);
