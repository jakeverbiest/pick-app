#!/usr/bin/env node
/**
 * fetch-detector-export.js — run the detector telemetry export and download it,
 * in one command.
 *
 * WHY THIS EXISTS. exportDetectorTelemetry writes NDJSON to Cloud Storage and
 * hands back an object path. It tries to return a signed download URL too, but
 * signing needs `iam.serviceAccounts.signBlob` on the runtime service account,
 * which the default compute account does not have — so in practice the
 * response carries a `gcloud storage cp` command instead, and `gcloud` is not
 * installed on this machine. That left the export technically working and
 * practically unreachable. This closes the gap using the admin SDK that is
 * already here.
 *
 * THE STANDING SCOPE DECISION (2026-09-07): export Jake's own account only.
 * See detectorExport.js's header for the full reasoning. That is why --user is
 * REQUIRED here rather than optional — an all-accounts export is a deliberate
 * reversal of that decision, and this tool will not let it happen by omission.
 * Pass --all-accounts to override, which exists mainly so the override is
 * visible in shell history.
 *
 * Usage:
 *   node fetch-detector-export.js --user <uid>
 *   node fetch-detector-export.js --user <uid> --since 2026-08-01 --out walks.ndjson
 *   node fetch-detector-export.js --all-accounts --since 2026-09-06   # deliberate
 *
 * Requires ~/.secrets/pick-app/serviceAccountKey.json and a logged-in firebase
 * CLI (used only to read DETECTOR_EXPORT_KEY out of Secret Manager — the key
 * is never written to disk or printed).
 */

const { execFileSync } = require('child_process');
const admin = require('firebase-admin');

const PROJECT = 'pick-app-74c2e';
const BUCKET = 'pick-app-74c2e.firebasestorage.app';
const ENDPOINT = `https://us-central1-${PROJECT}.cloudfunctions.net/exportDetectorTelemetry`;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const user = arg('user');
const since = arg('since');
const until = arg('until');
const out = arg('out') || `detector-export-${new Date().toISOString().slice(0, 10)}.ndjson`;

if (!user && !has('all-accounts')) {
  console.error('Refusing to run without --user.\n');
  console.error('  The standing decision (2026-09-07) is to export Jake\'s own account only —');
  console.error('  the other testers\' walks predate the 2026-09-06 disclosure. See');
  console.error('  detectorExport.js\'s header. Pass --all-accounts to deliberately override.');
  process.exit(2);
}

(async () => {
  // Read the operator key straight out of Secret Manager into memory. Never
  // logged, never written to disk, never placed in a file the repo could commit.
  let key;
  try {
    key = execFileSync('firebase', ['functions:secrets:access', 'DETECTOR_EXPORT_KEY', '--project', PROJECT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    console.error('Could not read DETECTOR_EXPORT_KEY. Is the firebase CLI logged in?');
    process.exit(1);
  }
  if (!key) {
    console.error('DETECTOR_EXPORT_KEY came back empty.');
    process.exit(1);
  }

  const params = new URLSearchParams({ key });
  if (user) params.set('user', user);
  if (since) params.set('since', since);
  if (until) params.set('until', until);

  console.log(`Running export${user ? ` for account ${user.slice(0, 8)}…` : ' for ALL ACCOUNTS'}${since ? ` since ${since}` : ''}…`);
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.ok) {
    console.error(`Export failed (HTTP ${res.status}):`, (body && body.error) || '(no body)');
    process.exit(1);
  }
  console.log(`  ${body.row_count} rows -> ${body.object_path}`);

  admin.initializeApp({
    credential: admin.credential.cert(require(`${process.env.HOME}/.secrets/pick-app/serviceAccountKey.json`)),
    storageBucket: BUCKET,
  });
  await admin.storage().bucket().file(body.object_path).download({ destination: out });

  const fs = require('fs');
  const lines = fs.readFileSync(out, 'utf8').trim();
  const rows = lines ? lines.split('\n').map((l) => JSON.parse(l)) : [];
  const withLog = rows.filter((r) => Array.isArray(r.motion_log) && r.motion_log.length > 0).length;
  // LENGTH, not just Array.isArray. `ground_truth` is written on EVERY walk as
  // "[]" when there were no watch taps, so an isArray check counts walks that
  // recorded nothing. That exact mistake produced a "11 walks with
  // ground_truth" report on 2026-09-07 when the true count was zero — and then
  // this script repeated it, reporting 13 when 2 were real. Same bug twice in
  // one day; hence the comment rather than a silent fix.
  const withTruth = rows.filter((r) => Array.isArray(r.ground_truth) && r.ground_truth.length > 0).length;
  // -1 is the "pace unknown" SENTINEL from motionEvaluation.ts (too few GPS
  // samples), not a speed. 23% of paced walks carry it, and averaging without
  // excluding it lands 47% low. Counted here so the number is visible at pull
  // time rather than discovered inside an analysis.
  const paceUnknown = rows.filter((r) => r.pace_median_mps === -1).length;
  const events = rows.reduce((n, r) => n + (Array.isArray(r.motion_log) ? r.motion_log.length : 0), 0);

  console.log(`\nSaved ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  console.log(`  ${rows.length} walks · ${withLog} with a motion_log · ${withTruth} with REAL ground_truth (non-empty)`);
  console.log(`  ${events} motion events · ${paceUnknown} walks have pace_median_mps = -1 (unknown, not a speed)`);
  if (rows.length) console.log(`  ${rows[0].date} -> ${rows[rows.length - 1].date}`);
  // ground_truth is the only field that makes a walk a VALIDATION case rather
  // than just telemetry — surfacing the count here because it is the number
  // that actually gates getting past n=1, and it is easy to miss in a 5MB file.
  if (withTruth === 0) console.log('\n  NOTE: no ground_truth walks — this corpus can measure behavior, not accuracy.');
  process.exit(0);
})().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
