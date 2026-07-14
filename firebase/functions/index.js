/**
 * Pick — team leaderboard aggregation.
 *
 * Cleanups are owner-only readable (routes can reveal home locations), so a
 * client can't total up other teams. These functions run with admin rights and
 * roll cleanups into a public, privacy-safe `team_stats/{team}` collection that
 * any signed-in user can read. No raw cleanup data is ever exposed.
 *
 *   - onCleanupWrite  : keeps a team's stats fresh whenever a cleanup changes
 *   - rebuildTeamStats: one-time backfill for cleanups that already exist
 */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Guards the one-time backfill URL. Change this to any random string you like,
// then call the function with ?token=THIS_VALUE.
const REBUILD_TOKEN = 'pick-seed-7f3a9c2e51';

/** Firestore doc IDs can't contain "/", so encode the team name. */
function teamDocId(team) {
  return encodeURIComponent(team);
}

/** Normalise a cleanup timestamp (Firestore Timestamp or seconds) to ms. */
function tsToMillis(ts) {
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  return (Number(ts) || 0) * 1000;
}

/** Recompute one team's aggregate from all its cleanups and write it. */
async function recomputeTeam(team) {
  if (!team) return;
  const ref = db.collection('team_stats').doc(teamDocId(team));
  const snap = await db.collection('cleanups').where('team', '==', team).get();

  if (snap.empty) {
    await ref.delete().catch(() => {});
    return;
  }

  let totalPickups = 0;
  let totalWeight = 0;
  let lastCleanupSec = 0;
  const users = new Set();
  const days = new Set();

  snap.forEach((doc) => {
    const c = doc.data();
    const ms = tsToMillis(c.timestamp);
    totalPickups += Number(c.items_count) || 0;
    totalWeight += Number(c.weight_lb) || 0;
    if (c.userId) users.add(c.userId);
    days.add(new Date(ms).toISOString().slice(0, 10)); // distinct UTC day
    const sec = Math.floor(ms / 1000);
    if (sec > lastCleanupSec) lastCleanupSec = sec;
  });

  const totalCleanups = snap.size;
  await ref.set({
    team,
    total_cleanups: totalCleanups,
    total_pickups: totalPickups,
    total_weight: Math.round(totalWeight * 10) / 10,
    total_days: days.size,
    member_count: users.size,
    last_cleanup: lastCleanupSec,
    avg_pickups_per_session: Math.round(totalPickups / totalCleanups),
    updated_at: Date.now(),
  });
}

/** Keep team_stats fresh on every cleanup create / update / delete. */
exports.onCleanupWrite = onDocumentWritten('cleanups/{cleanupId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;

  const teams = new Set();
  if (before && before.team) teams.add(before.team); // e.g. team changed / deleted
  if (after && after.team) teams.add(after.team);

  await Promise.all([...teams].map((t) => recomputeTeam(t)));
});

/**
 * One-time backfill for existing cleanups.
 * Visit:  https://<region>-<project>.cloudfunctions.net/rebuildTeamStats?token=pick-seed-7f3a9c2e51
 */
exports.rebuildTeamStats = onRequest(async (req, res) => {
  if (req.query.token !== REBUILD_TOKEN) {
    res.status(403).send('Forbidden: bad or missing token.');
    return;
  }
  const snap = await db.collection('cleanups').get();
  const teams = new Set();
  snap.forEach((doc) => {
    const t = doc.data().team;
    if (t) teams.add(t);
  });
  await Promise.all([...teams].map((t) => recomputeTeam(t)));
  res.json({ ok: true, teamsRebuilt: teams.size, cleanupsScanned: snap.size });
});
