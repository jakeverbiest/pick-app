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
const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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

// ==========================================================================
// PUBLIC STATS — city + global aggregates for the public dashboard site.
//
// Recompute-from-source on a schedule. Writes only two PUBLIC-READ collections
// (`global_stats`, `city_stats`) that hold ONLY aggregates: counts, totals, a
// coarse ~1km "recently cleaned" tile grid, and an opt-in top-picker board
// (display names only for users who left themselves visible on the leaderboard,
// i.e. user_stats.hidden === false). No routes, no exact locations, no PII.
// ==========================================================================

const PICKUPS_PER_BAG = 200; // mirrors src/services/impactMetrics.ts
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Firestore-safe, readable id per city name. */
function citySlug(city) {
  return (
    String(city).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
  );
}

/** Bags for a cleanup: the user's end-of-session report wins, else derive. */
function bagsFor(d) {
  const est = num(d.bags_est);
  return est > 0 ? est : num(d.items_count) / PICKUPS_PER_BAG;
}

function newAgg() {
  return {
    pickersAll: new Set(), pickersWeek: new Set(),
    pickupsAll: 0, pickupsWeek: 0,
    bagsAll: 0, bagsWeek: 0,
    secondsAll: 0, secondsWeek: 0,
    cleanupsAll: 0, cleanupsWeek: 0,
    pickers: new Map(), // uid -> { pickups, bags } (for the top-picker board)
  };
}

function addToAgg(a, d, inWeek, pickups, bags, seconds, uid) {
  a.pickupsAll += pickups; a.bagsAll += bags; a.secondsAll += seconds; a.cleanupsAll += 1;
  if (uid) {
    a.pickersAll.add(uid);
    const p = a.pickers.get(uid) || { pickups: 0, bags: 0 };
    p.pickups += pickups; p.bags += bags; a.pickers.set(uid, p);
  }
  if (inWeek) {
    a.pickupsWeek += pickups; a.bagsWeek += bags; a.secondsWeek += seconds; a.cleanupsWeek += 1;
    if (uid) a.pickersWeek.add(uid);
  }
}

const shapeAll = (a) => ({
  pickers: a.pickersAll.size, pickups: a.pickupsAll,
  bags: Math.round(a.bagsAll), hours: round1(a.secondsAll / 3600), cleanups: a.cleanupsAll,
});
const shapeWeek = (a) => ({
  pickers: a.pickersWeek.size, pickups: a.pickupsWeek,
  bags: Math.round(a.bagsWeek), hours: round1(a.secondsWeek / 3600), cleanups: a.cleanupsWeek,
});

/** Top pickers from an agg, limited to opted-in display names. */
function topPickers(a, namesById, limit) {
  return [...a.pickers.entries()]
    .filter(([uid]) => namesById.has(uid))
    .map(([uid, p]) => ({ name: namesById.get(uid), pickups: p.pickups, bags: Math.round(p.bags) }))
    .sort((x, y) => y.pickups - x.pickups)
    .slice(0, limit);
}

/** Recompute the public dashboard aggregates from all cleanups. */
async function rebuildPublicStats() {
  const now = Date.now();
  const weekAgo = now - WEEK_MS;

  // Opt-in names for the public top-picker board: user_stats.hidden === false.
  const namesById = new Map();
  const usnap = await db.collection('user_stats').get();
  usnap.forEach((doc) => {
    const d = doc.data();
    if (d && d.hidden === false && d.display_name) namesById.set(doc.id, String(d.display_name));
  });

  const global = newAgg();
  const cities = new Map(); // slug -> { name, agg }
  const tiles = new Map();   // "lat,lon" (2dp ≈ 1km) -> count, last 7 days

  const snap = await db.collection('cleanups').get();
  snap.forEach((doc) => {
    const d = doc.data();
    const ms = toMillis(d.timestamp);
    const inWeek = ms >= weekAgo;
    const pickups = num(d.items_count);
    const bags = bagsFor(d);
    const seconds = num(d.duration_seconds);
    const uid = d.userId || '';

    addToAgg(global, d, inWeek, pickups, bags, seconds, uid);

    const cityName = (d.city || '').trim();
    if (cityName) {
      const slug = citySlug(cityName);
      let c = cities.get(slug);
      if (!c) { c = { name: cityName, agg: newAgg() }; cities.set(slug, c); }
      addToAgg(c.agg, d, inWeek, pickups, bags, seconds, uid);
    }

    if (inWeek && Number.isFinite(d.location_lat) && Number.isFinite(d.location_lon)) {
      const key = `${d.location_lat.toFixed(2)},${d.location_lon.toFixed(2)}`;
      tiles.set(key, (tiles.get(key) || 0) + 1);
    }
  });

  const recentTiles = [...tiles.entries()]
    .map(([k, n]) => { const [lat, lon] = k.split(',').map(Number); return { lat, lon, n }; })
    .sort((a, b) => b.n - a.n)
    .slice(0, 600);

  const topCities = [...cities.entries()]
    .map(([slug, c]) => ({ slug, city: c.name, week: shapeWeek(c.agg), allTime: shapeAll(c.agg) }))
    .sort((x, y) => y.week.pickups - x.week.pickups || y.allTime.pickups - x.allTime.pickups)
    .slice(0, 40);

  await db.collection('global_stats').doc('summary').set({
    updated_at: now,
    week_start: weekAgo,
    allTime: shapeAll(global),
    week: shapeWeek(global),
    topCities,
    topPickers: topPickers(global, namesById, 25),
    recentTiles,
  });

  // Per-city docs (write in parallel).
  await Promise.all([...cities.entries()].map(([slug, c]) =>
    db.collection('city_stats').doc(slug).set({
      city: c.name,
      slug,
      updated_at: now,
      allTime: shapeAll(c.agg),
      week: shapeWeek(c.agg),
      topPickers: topPickers(c.agg, namesById, 10),
    })
  ));

  return { cities: cities.size, cleanups: snap.size, updated_at: now };
}

/** Scheduled rebuild — hourly keeps the public dashboard reasonably fresh. */
exports.scheduledPublicStats = onSchedule('every 60 minutes', async () => {
  await rebuildPublicStats();
});

/** Manual rebuild (callable) — for the first backfill or an on-demand resync. */
exports.rebuildPublicStats = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to rebuild public stats.');
  }
  return rebuildPublicStats();
});

// ==========================================================================
// LOAD-TEST SEEDING — create/delete a batch of SIMULATED pickers to see how a
// busy app looks (full leaderboard, populated dashboard + map). Everything is
// tagged `sim: true` so it can be wiped in one call. TEMPORARY — delete these
// two functions after testing.
//
// Trigger from a browser (gate with the secret):
//   seed:   https://us-central1-pick-app-74c2e.cloudfunctions.net/seedTesters?key=SECRET&count=150
//   delete: https://us-central1-pick-app-74c2e.cloudfunctions.net/clearTesters?key=SECRET
// ==========================================================================

const SEED_SECRET = 'pick-sim-8f3k2z9q'; // change me; required as ?key= on both endpoints
const SIM_CITIES = [
  { city: 'New York', lat: 40.6782, lon: -73.9442 },
  { city: 'Atlanta', lat: 33.749, lon: -84.388 },
  { city: 'Beacon', lat: 41.5048, lon: -73.9696 },
  { city: 'Hickory', lat: 35.7332, lon: -81.3412 },
];
const SIM_NAMES = ['Alex', 'Sam', 'Jordan', 'Casey', 'Riley', 'Taylor', 'Morgan', 'Jamie', 'Avery', 'Quinn', 'Drew', 'Reese', 'Skyler', 'Parker', 'Rowan', 'Emerson', 'Charlie', 'Finley', 'Sage', 'Harper'];
const SIM_TEAMS = ['Test Crew A', 'Test Crew B', 'solo', 'solo']; // ~half solo

async function seedTesters(count) {
  const now = Date.now();
  let batch = db.batch();
  let ops = 0;
  let cleanups = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };

  for (let i = 0; i < count; i++) {
    const uid = `sim_${now}_${i}`;
    const c = SIM_CITIES[i % SIM_CITIES.length];
    const name = `${SIM_NAMES[i % SIM_NAMES.length]} ${String(i + 1).padStart(3, '0')}`;
    const team = SIM_TEAMS[i % SIM_TEAMS.length];
    const nC = 1 + Math.floor(Math.random() * 4);
    let tp = 0, tb = 0;
    const days = new Set();
    for (let j = 0; j < nC; j++) {
      const ts = now - Math.floor(Math.random() * 7 * 86400 * 1000); // within last 7 days
      const pk = 20 + Math.floor(Math.random() * 280);
      const bg = pk / PICKUPS_PER_BAG;
      tp += pk; tb += bg;
      days.add(new Date(ts).toISOString().slice(0, 10));
      batch.set(db.collection('cleanups').doc(), {
        userId: uid, timestamp: ts,
        location_lat: c.lat + (Math.random() - 0.5) * 0.05,
        location_lon: c.lon + (Math.random() - 0.5) * 0.05,
        items_count: pk, bags_est: Math.round(bg * 1000) / 1000,
        duration_seconds: 300 + Math.floor(Math.random() * 1500),
        team, city: c.city, neighborhood: '', sim: true,
      });
      ops++; cleanups++;
      if (ops >= 450) await flush();
    }
    batch.set(db.collection('user_stats').doc(uid), {
      uid, display_name: name, team,
      total_pickups: tp, total_bags: Math.round(tb * 100) / 100,
      total_cleanups: nC, active_days: days.size,
      hidden: false, sim: true, updated_at: now,
    });
    ops++;
    if (ops >= 450) await flush();
  }
  await flush();
  await rebuildPublicStats();
  return { seeded: count, cleanups };
}

async function deleteWhereSim(collName) {
  const col = db.collection(collName);
  let removed = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await col.where('sim', '==', true).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < 400) break;
  }
  return removed;
}

async function clearTesters() {
  const deletedCleanups = await deleteWhereSim('cleanups');
  const deletedUsers = await deleteWhereSim('user_stats');
  // Remove the sim teams' aggregate rows too (they won't self-clean if never re-touched).
  await Promise.all(['Test Crew A', 'Test Crew B'].map((t) =>
    db.collection('team_stats').doc(teamDocId(t)).delete().catch(() => {})
  ));
  await rebuildPublicStats();
  return { deletedCleanups, deletedUsers };
}

exports.seedTesters = onRequest(async (req, res) => {
  if (req.query.key !== SEED_SECRET) { res.status(403).send('forbidden'); return; }
  const count = Math.min(500, Math.max(1, parseInt(req.query.count, 10) || 150));
  try {
    res.json({ ok: true, ...(await seedTesters(count)) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

exports.clearTesters = onRequest(async (req, res) => {
  if (req.query.key !== SEED_SECRET) { res.status(403).send('forbidden'); return; }
  try {
    res.json({ ok: true, ...(await clearTesters()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

// ==========================================================================
// ADOPT A STREET — daily check: if an adopted spot has had no cleanup within
// `radiusM` in the last `thresholdDays`, email the picker a nudge. Emails are
// sent by the Firebase "Trigger Email" extension, which watches the `mail`
// collection — we just write the message there. (Install + configure that
// extension with an SMTP/SendGrid sender for emails to actually go out.)
// ==========================================================================

const ADOPT_SCAN_WINDOW_DAYS = 60; // ignore cleanups older than this when scanning

function distMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function checkAdoptions() {
  const now = Date.now();
  const adSnap = await db.collection('adoptions').get();
  if (adSnap.empty) return { checked: 0, emailed: 0 };

  const cutoff = now - ADOPT_SCAN_WINDOW_DAYS * 86400 * 1000;
  const clSnap = await db.collection('cleanups').where('timestamp', '>=', cutoff).get();
  const recent = [];
  clSnap.forEach((d) => {
    const c = d.data();
    recent.push({ lat: c.location_lat, lon: c.location_lon, ts: toMillis(c.timestamp) });
  });

  let emailed = 0;
  for (const docSnap of adSnap.docs) {
    const a = docSnap.data();
    if (!a.email || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
    const thresh = num(a.thresholdDays) || 7;
    const radius = num(a.radiusM) || 150;
    const windowStart = now - thresh * 86400 * 1000;

    let fresh = false;
    let lastNearTs = 0;
    for (const c of recent) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      if (distMeters(a.lat, a.lon, c.lat, c.lon) <= radius) {
        if (c.ts > lastNearTs) lastNearTs = c.ts;
        if (c.ts >= windowStart) { fresh = true; break; }
      }
    }
    if (fresh) continue; // cleaned recently — no nudge

    // Don't spam: at most one email per threshold window.
    const lastNotified = num(a.lastNotified);
    if (lastNotified && now - lastNotified < thresh * 86400 * 1000) continue;

    const daysSince = lastNearTs ? Math.floor((now - lastNearTs) / 86400000) : null;
    const sinceText = daysSince != null ? `${daysSince} days ago` : `a while ago`;

    await db.collection('mail').add({
      to: [a.email],
      message: {
        subject: `${a.label} could use a pick`,
        text: `Hi! ${a.label} hasn't had a cleanup nearby in over ${thresh} days (last one was ${sinceText}). If you're passing by, pop your phone in your pocket and give it a quick pick. — PICK`,
        html: `<p>Hi!</p><p><strong>${esc(a.label)}</strong> hasn't had a cleanup nearby in over ${thresh} days (last one was ${sinceText}).</p><p>If you're passing by, pop your phone in your pocket and give it a quick pick.</p><p>— PICK</p>`,
      },
    });
    await docSnap.ref.update({ lastNotified: now, lastNearTs });
    emailed++;
  }
  return { checked: adSnap.size, emailed };
}

/** Daily scan for stale adopted streets. */
exports.scheduledAdoptionCheck = onSchedule('every 24 hours', async () => {
  await checkAdoptions();
});

/** Manual trigger for testing the adoption check (gated by the same secret). */
exports.runAdoptionCheck = onRequest(async (req, res) => {
  if (req.query.key !== SEED_SECRET) { res.status(403).send('forbidden'); return; }
  try {
    res.json({ ok: true, ...(await checkAdoptions()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});
