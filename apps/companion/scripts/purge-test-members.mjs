/**
 * Purge fake/test MEMBERS from Firestore (admin).
 *
 * purge-test-walks.mjs removes junk *walks*. This one removes whole junk
 * *accounts* — the seeded members that make a team's board look busy with
 * cleanups nobody did. It deletes each target's cleanups, their public stats
 * doc, their profile + handle claim, their settings, and their community posts,
 * then rebuilds the affected team_stats aggregates so the Teams board reflects
 * only real people.
 *
 * DRY-RUN by default — prints exactly what would go. Add --delete to commit.
 *
 * Collections touched (note: a user's settings live at `users/{uid}` — the DOC
 * ID is the uid; there is no `user_settings` collection):
 *   users/{uid}            settings, incl. team_name and display_name
 *   cleanups               where userId == uid
 *   user_stats/{uid}       public leaderboard aggregate
 *   profiles/{uid}         public profile  +  handles/{handleLower} claim
 *   posts / badges / adoptions   queried by uid
 *   team_stats/{team}      rebuilt from surviving cleanups at the end
 *
 * Usage (from apps/companion):
 *   # 0. See everything — teams, members, and orphaned cleanups (no writes)
 *   node scripts/purge-test-members.mjs
 *
 *   # 1. See who is on the team and how real they look
 *   node scripts/purge-test-members.mjs --team "Carroll Gardens Crew"
 *
 *   # 2. Remove specific accounts
 *   node scripts/purge-test-members.mjs --uid abc123,def456 --delete
 *
 *   # 3. Remove every member of a team whose email matches a test pattern
 *   node scripts/purge-test-members.mjs --team "Test Team" --email-like test@ --delete
 *
 *   # 4. Just rebuild the team aggregates from surviving cleanups
 *   node scripts/purge-test-members.mjs --recompute-teams --delete
 *
 * Safety: --keep-uid protects accounts (repeatable, comma-separated), and the
 * script refuses to run a team-wide delete without either --email-like or
 * --confirm-team, so a stray --delete can't wipe a real team.
 *
 * Key: ~/pick-app/serviceAccountKey.json (or GOOGLE_APPLICATION_CREDENTIALS).
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// firebase-admin v14 dropped the old `admin.credential.cert` / `admin.firestore()`
// namespace under ESM — only the modular entry points exist now.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const list = (name) => (opt(name, '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const DELETE = flag('delete');
const TEAM = opt('team', null);
const UIDS = list('uid');
const KEEP = new Set(list('keep-uid'));
const EMAIL_LIKE = opt('email-like', null);
const CONFIRM_TEAM = flag('confirm-team');
const RECOMPUTE_ONLY = flag('recompute-teams') && !TEAM && !UIDS.length;

const keyPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), 'pick-app', 'serviceAccountKey.json');
if (!existsSync(keyPath)) {
  console.error(`No service account key at ${keyPath}`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
const db = getFirestore();
const auth = getAuth();

// A user's settings live at users/{uid} — the DOC ID is the uid, there is no
// separate `user_settings` collection and no `userId` field to query on.
const USERS = 'users';

/**
 * Normalise a cleanup's `timestamp` to epoch milliseconds.
 *
 * addCleanup writes a real Firestore `Timestamp`, but offline/legacy docs can
 * hold a raw number in seconds OR milliseconds.
 *
 * TRAP: never do `Number(timestamp)`. Firestore's Timestamp.valueOf() returns
 * an epoch-SHIFTED string (seconds since year 1, zero-padded) so it sorts
 * lexicographically — coercing it gives ~6.4e10, which renders as the year
 * 3995 instead of throwing. Silent, plausible-looking garbage.
 */
function tsMillis(v) {
  if (v == null) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const n = typeof v === 'number' ? v : NaN;
  if (!isFinite(n) || n <= 0) return 0;
  return n > 1e11 ? n : n * 1000; // past ~1973 in ms means it's already ms
}

const ymd = (ms) => (ms > 0 ? new Date(ms).toISOString().slice(0, 10) : 'never');

/** Everything we know about one candidate account, for the dry-run report. */
async function describe(uid) {
  const [settings, stats, profile, cleanups] = await Promise.all([
    db.collection(USERS).doc(uid).get(),
    db.collection('user_stats').doc(uid).get(),
    db.collection('profiles').doc(uid).get(),
    db.collection('cleanups').where('userId', '==', uid).get(),
  ]);
  const s = settings.exists ? settings.data() : {};
  const st = stats.exists ? stats.data() : {};
  // No auth record is itself a signal — seeded docs often have no real account.
  let authUser = null;
  try {
    authUser = await auth.getUser(uid);
  } catch {}
  return {
    uid,
    hasSettingsDoc: settings.exists,
    name: s.display_name || st.display_name || authUser?.displayName || '(no name)',
    email: authUser?.email || s.email || '',
    hasAuthAccount: !!authUser,
    team: s.team_name || st.team || 'solo',
    handle: profile.exists ? profile.data().handleLower || '' : '',
    cleanupIds: cleanups.docs.map((d) => d.id),
    pickups: cleanups.docs.reduce((n, d) => n + (Number(d.data().items_count) || 0), 0),
    lastSeen: authUser?.metadata?.lastSignInTime || null,
    created: authUser?.metadata?.creationTime || null,
  };
}

async function resolveTargets() {
  let uids = [...UIDS];

  if (TEAM) {
    const snap = await db.collection(USERS).where('team_name', '==', TEAM).get();
    const found = snap.docs.map((d) => d.id);
    console.log(`Team "${TEAM}": ${found.length} member(s).`);
    uids = uids.concat(found);
  }

  uids = [...new Set(uids)].filter((u) => !KEEP.has(u));
  const people = await Promise.all(uids.map(describe));

  if (EMAIL_LIKE) {
    const needle = EMAIL_LIKE.toLowerCase();
    return people.filter((p) => (p.email || '').toLowerCase().includes(needle));
  }
  return people;
}

async function deletePerson(p) {
  // Cleanups (batched — a seeded account can have hundreds).
  for (let i = 0; i < p.cleanupIds.length; i += 400) {
    const batch = db.batch();
    p.cleanupIds.slice(i, i + 400).forEach((id) => batch.delete(db.collection('cleanups').doc(id)));
    await batch.commit();
  }

  const batch = db.batch();
  batch.delete(db.collection('user_stats').doc(p.uid));
  batch.delete(db.collection('profiles').doc(p.uid));
  if (p.hasSettingsDoc) batch.delete(db.collection(USERS).doc(p.uid));
  if (p.handle) batch.delete(db.collection('handles').doc(p.handle));
  await batch.commit();

  // Community posts and badges, which are queried by uid rather than keyed by it.
  for (const [coll, field] of [['posts', 'uid'], ['badges', 'userId'], ['adoptions', 'userId']]) {
    const snap = await db.collection(coll).where(field, '==', p.uid).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }

  // Finally the auth user, so they can't sign back in and re-seed themselves.
  try {
    await auth.deleteUser(p.uid);
  } catch (e) {
    console.warn(`  (auth user ${p.uid} not deleted: ${e.message})`);
  }
}

/**
 * Discovery: every team, its members, and how real each one looks. Run with no
 * arguments — this is the "what am I even looking at" view you want first.
 */
async function listTeams() {
  const [settings, cleanups] = await Promise.all([
    db.collection(USERS).get(),
    db.collection('cleanups').get(),
  ]);

  const cleanupsByUid = new Map();
  cleanups.forEach((d) => {
    const c = d.data();
    const cur = cleanupsByUid.get(c.userId) || { n: 0, pickups: 0, last: 0 };
    cur.n += 1;
    cur.pickups += Number(c.items_count) || 0;
    cur.last = Math.max(cur.last, tsMillis(c.timestamp));
    cleanupsByUid.set(c.userId, cur);
  });

  const teams = new Map();
  settings.forEach((d) => {
    const s = d.data();
    const team = s.team_name || 'solo';
    if (!teams.has(team)) teams.set(team, []);
    teams.get(team).push({ uid: d.id, name: s.display_name || '(no name)' });
  });

  // Cleanups whose author has no users/{uid} doc at all — orphans left behind
  // by deleted or never-initialised accounts. They still feed team_stats.
  const orphans = [...cleanupsByUid.keys()].filter((uid) => !settings.docs.some((d) => d.id === uid));

  console.log(`\n${teams.size} team value(s) across ${settings.size} user doc(s).\n`);
  for (const [team, members] of [...teams.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`── "${team}"  (${members.length} member${members.length === 1 ? '' : 's'})`);
    for (const m of members) {
      const c = cleanupsByUid.get(m.uid) || { n: 0, pickups: 0, last: 0 };
      const last = ymd(c.last);
      console.log(`     ${m.uid}  ${m.name.padEnd(20)} cleanups=${String(c.n).padStart(4)} pickups=${String(c.pickups).padStart(6)}  last=${last}`);
    }
    console.log('');
  }

  if (orphans.length) {
    console.log(`⚠️  ${orphans.length} uid(s) have cleanups but NO users/{uid} doc:`);
    for (const uid of orphans) {
      const c = cleanupsByUid.get(uid);
      const last = ymd(c.last);
      console.log(`     ${uid}  cleanups=${String(c.n).padStart(4)} pickups=${String(c.pickups).padStart(6)}  last=${last}`);
    }
    console.log('   Remove them with --uid <those uids> --delete\n');
  }

  console.log('Next: inspect one team in detail (adds email, auth account, signup date):');
  console.log('  node scripts/purge-test-members.mjs --team "Exact Team Name"');
  console.log('Then remove the fakes:');
  console.log('  node scripts/purge-test-members.mjs --uid uid1,uid2 --delete');
}

/** Rebuild team_stats from the cleanups that actually remain. */
async function recomputeTeams() {
  const [cleanups, settings] = await Promise.all([
    db.collection('cleanups').get(),
    db.collection(USERS).get(),
  ]);

  const teamOf = new Map();
  settings.forEach((d) => teamOf.set(d.id, d.data().team_name || 'solo'));

  const agg = new Map();
  cleanups.forEach((d) => {
    const c = d.data();
    // Each cleanup records the team the user was on AT SAVE TIME, which is what
    // the leaderboard has always reflected; fall back to their current team
    // only for older docs that predate the field.
    const team = c.team || teamOf.get(c.userId) || 'solo';
    if (!team || team.toLowerCase() === 'solo') return;
    const t =
      agg.get(team) ||
      { team, total_cleanups: 0, total_pickups: 0, total_bags: 0, days: new Set(), members: new Set(), last_cleanup: 0 };
    t.total_cleanups += 1;
    t.total_pickups += Number(c.items_count) || 0;
    t.total_bags += Number(c.bags_est) || 0;
    t.days.add(new Date(tsMillis(c.timestamp)).toDateString());
    t.members.add(c.userId);
    t.last_cleanup = Math.max(t.last_cleanup, tsMillis(c.timestamp));
    agg.set(team, t);
  });

  // Any team_stats doc with no surviving cleanups is stale — drop it.
  const existing = await db.collection('team_stats').get();
  const stale = existing.docs.filter((d) => !agg.has(d.id));

  console.log(`\nteam_stats: ${agg.size} team(s) with real cleanups, ${stale.length} stale doc(s).`);
  for (const t of agg.values()) {
    console.log(
      `  ${t.team}: ${t.total_cleanups} cleanups · ${t.total_pickups} pickups · ${t.members.size} member(s)`
    );
  }
  stale.forEach((d) => console.log(`  (stale) ${d.id}`));

  if (!DELETE) {
    console.log('(dry-run — add --delete to write these)');
    return;
  }
  const batch = db.batch();
  for (const t of agg.values()) {
    batch.set(
      db.collection('team_stats').doc(t.team),
      {
        team: t.team,
        total_cleanups: t.total_cleanups,
        total_pickups: t.total_pickups,
        total_bags: Number(t.total_bags.toFixed(2)),
        total_days: t.days.size,
        member_count: t.members.size,
        // team_stats stores seconds, matching what the Cloud Function writes.
        last_cleanup: Math.floor(t.last_cleanup / 1000),
        avg_pickups_per_session: t.total_cleanups ? Math.round(t.total_pickups / t.total_cleanups) : 0,
      },
      { merge: false }
    );
  }
  stale.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log('✅ team_stats rebuilt');
}

// ------------------------------------------------------------------- main

if (RECOMPUTE_ONLY) {
  await recomputeTeams();
  process.exit(0);
}

if (!TEAM && !UIDS.length) {
  // No target given — show what's actually there rather than an error, since
  // you usually don't know the exact team string until you look.
  await listTeams();
  process.exit(0);
}

const targets = await resolveTargets();

console.log(`\n${targets.length} account(s) matched:\n`);
for (const p of targets) {
  console.log(
    `  ${p.uid}  ${p.name}  <${p.email || 'no email'}>${p.hasAuthAccount ? '' : '  ⚠️ NO AUTH ACCOUNT'}\n` +
      `      team=${p.team}  cleanups=${p.cleanupIds.length}  pickups=${p.pickups}` +
      `  created=${p.created || '?'}  lastSeen=${p.lastSeen || 'never'}`
  );
}

if (!targets.length) {
  console.log('Nothing matched — no changes.');
  process.exit(0);
}

if (!DELETE) {
  console.log('\n(dry-run — add --delete to remove these accounts and their cleanups)');
  process.exit(0);
}

if (TEAM && !EMAIL_LIKE && !CONFIRM_TEAM) {
  console.error(
    '\nRefusing to delete every member of a team without a filter.\n' +
      'Add --email-like <pattern> to narrow it, or --confirm-team if you really mean all of them.'
  );
  process.exit(1);
}

for (const p of targets) {
  console.log(`Deleting ${p.uid} (${p.name}) — ${p.cleanupIds.length} cleanups…`);
  await deletePerson(p);
}
console.log(`✅ removed ${targets.length} account(s)`);

await recomputeTeams();
console.log('\nNote: surviving users refresh their own user_stats on next app open.');
process.exit(0);
