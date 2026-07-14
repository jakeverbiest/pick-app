/**
 * Pick — Cloud Functions
 *
 * Maintains the `team_stats` leaderboard aggregate. The Firestore security
 * rules make team_stats read-only for clients (`allow write: if false`), so it
 * can only be written here, by the Admin SDK (which bypasses rules). That's what
 * lets leaderboards work cross-user without exposing anyone's raw cleanups.
 *
 * Two entry points (the names referenced in firestore.rules):
 *   - onCleanupWrite:   recomputes a team's stats whenever one of its cleanups
 *                       is created, edited, or deleted.
 *   - rebuildTeamStats: callable backfill that recomputes every team from
 *                       scratch (run once after first deploy, or any time you
 *                       want to resync).
 *
 * Aggregation strategy: on each change we re-query the affected team's cleanups
 * and recompute its totals. Recompute-from-source (rather than incremental
 * deltas) can't drift, and at Pick's scale the read cost is negligible.
 *
 * Deploy:  firebase deploy --only functions      (from apps/companion)
 */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Solo walks aren't a "team" — don't lump every solo user into one row.
const NON_TEAM = new Set(['', 'solo', 'Solo', 'SOLO']);

// ---------- helpers ----------

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Normalize a cleanup timestamp (Firestore Timestamp, ms, or seconds) to ms. */
function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis(); // Firestore Timestamp
  const n = num(ts);
  if (!n) return 0;
  // < 1e12 ≈ seconds (pre-2001 in ms); treat as seconds and scale up.
  return n < 1e12 ? n * 1000 : n;
}

/** Firestore doc ids can't contain '/'. Keep a stable, readable id per team. */
function teamDocId(team) {
  return String(team).replace(/\//g, '__');
}

/**
 * Recompute and write team_stats for one team. Deletes the doc if the team has
 * no cleanups left.
 */
async function rebuildTeam(team) {
  if (team == null || NON_TEAM.has(String(team))) return;

  const docRef = db.collection('team_stats').doc(teamDocId(team));
  const snap = await db.collection('cleanups').where('team', '==', team).get();

  if (snap.empty) {
    await docRef.delete().catch(() => {});
    return;
  }

  let totalCleanups = 0;
  let totalPickups = 0;
  let totalWeight = 0;
  let lastCleanup = 0;
  const days = new Set();
  const members = new Set();

  snap.forEach((doc) => {
    const d = doc.data();
    totalCleanups += 1;
    totalPickups += num(d.items_count);
    totalWeight += num(d.weight_lb);
    if (d.userId) members.add(d.userId);
    const ms = toMillis(d.timestamp);
    if (ms) {
      if (ms > lastCleanup) lastCleanup = ms;
      days.add(new Date(ms).toISOString().slice(0, 10)); // UTC calendar day
    }
  });

  await docRef.set({
    team: String(team),
    total_cleanups: totalCleanups,
    total_pickups: totalPickups,
    total_weight: round1(totalWeight),
    total_days: days.size,
    member_count: members.size,
    last_cleanup: lastCleanup,
    avg_pickups_per_session: totalCleanups ? round1(totalPickups / totalCleanups) : 0,
    updated_at: Date.now(),
  });
}

// ---------- triggers ----------

/**
 * Fires on every create/update/delete of a cleanup. Rebuilds the team(s) the
 * cleanup belonged to (handles a cleanup moving between teams: both the old and
 * new team are recomputed).
 */
exports.onCleanupWrite = onDocumentWritten('cleanups/{cleanupId}', async (event) => {
  const before = event.data && event.data.before && event.data.before.data();
  const after = event.data && event.data.after && event.data.after.data();

  const teams = new Set();
  if (before && before.team) teams.add(before.team);
  if (after && after.team) teams.add(after.team);

  await Promise.all([...teams].map((t) => rebuildTeam(t)));
});

/** Recompute team_stats for every team found across all cleanups. */
async function rebuildAllTeams() {
  const snap = await db.collection('cleanups').get();
  const teams = new Set();
  snap.forEach((doc) => {
    const t = doc.data().team;
    if (t != null && !NON_TEAM.has(String(t))) teams.add(t);
  });
  await Promise.all([...teams].map((t) => rebuildTeam(t)));
  return { rebuilt: teams.size, teams: [...teams] };
}

/**
 * One-shot backfill (callable): recompute every team. Requires a signed-in
 * caller — intended for an in-app "resync" admin action.
 */
exports.rebuildTeamStats = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to rebuild team stats.');
  }
  return rebuildAllTeams();
});
