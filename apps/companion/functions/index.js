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

const { onDocumentWritten, onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket();

// Owner alerts (new signups, etc.) go here.
const OWNER_EMAIL = 'hello@pickglobal.org';

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
  let totalBags = 0;
  let lastCleanup = 0;
  const days = new Set();
  const members = new Set();

  snap.forEach((doc) => {
    const d = doc.data();
    totalCleanups += 1;
    totalPickups += num(d.items_count);
    totalWeight += num(d.weight_lb);
    totalBags += bagsFor(d);
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
    total_bags: Math.round(totalBags),
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
  const cities = new Map(); // slug -> { name, agg, hot }
  const tiles = new Map();   // "lat,lon" (2dp ≈ 1km) -> count, last 7 days
  const hot = new Map();     // "lat,lon" (3dp ≈ 100m) -> pickup count, all-time

  // Bin a cleanup's sampled pickup coords into fine ~100m hotspot cells.
  const addHot = (map, d) => {
    let pts = null;
    try { pts = d.pickups ? (typeof d.pickups === 'string' ? JSON.parse(d.pickups) : d.pickups) : null; } catch {}
    if (!Array.isArray(pts)) return;
    for (const pr of pts) {
      const la = Array.isArray(pr) ? pr[0] : (pr && pr.lat);
      const lo = Array.isArray(pr) ? pr[1] : (pr && pr.lon);
      if (typeof la !== 'number' || typeof lo !== 'number') continue;
      const key = `${la.toFixed(3)},${lo.toFixed(3)}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
  };
  const shapeHot = (map, limit) => [...map.entries()]
    .map(([k, n]) => { const [lat, lon] = k.split(',').map(Number); return { lat, lon, n }; })
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);

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
    addHot(hot, d);

    const cityName = (d.city || '').trim();
    if (cityName) {
      const slug = citySlug(cityName);
      let c = cities.get(slug);
      if (!c) { c = { name: cityName, agg: newAgg(), hot: new Map() }; cities.set(slug, c); }
      addToAgg(c.agg, d, inWeek, pickups, bags, seconds, uid);
      addHot(c.hot, d);
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

  const hotspots = shapeHot(hot, 800);

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
    hotspots,
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
      hotspots: shapeHot(c.hot, 400),
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
// CIVIC-ORG / SPONSOR IMPACT DASHBOARD — per CIVIC_ORG_DASHBOARD_SPEC.md,
// decisions resolved 2026-08-31 (§6). District-scoped, not members'-total: a
// pure geographic filter over ALL cleanups within a sponsor team's area,
// regardless of who did them or what team they're on. Access is a per-team,
// unguessable token (not team membership, not a new admin-role system),
// consumed by a new public page on pickglobal.org (web/org.html) — not an
// in-app screen. Time-series is periodic snapshots via a scheduled function,
// mirroring the onSchedule pattern already used elsewhere in this file.
//
// `TeamDir.area` reuses ChallengeArea's shape/flat-ring encoding verbatim
// (challenges.ts) rather than inventing new geometry, and `TeamDir.goal`
// mirrors Challenge's goal_type/goal_value as { type, value }. Both are only
// ever set at team-creation time via createSponsorTeam below — existing
// teams stay unmodified and the immutable `allow update, delete: if false`
// rule on teams/{teamId} is untouched (spec decision #5). Plain casual teams
// still go through the client-side joinOrCreateTeam() path in
// firebaseDatabase.ts, which this doesn't change.
// ==========================================================================

const crypto = require('crypto');

const TEAM_AREA_TYPES = new Set(['anywhere', 'neighborhood', 'custom']);
const TEAM_GOAL_TYPES = new Set(['pickups', 'bags', 'cleanups']);

/**
 * Geometry — ported from src/services/challenges.ts's ChallengeArea helpers
 * (unflattenRing/ringBbox/pointInRing/cleanupInArea). Duplicated rather than
 * imported: this is a separate CommonJS/Node runtime with no build step for
 * the app's TypeScript, the same reason bagsFor() above duplicates
 * PICKUPS_PER_BAG from impactMetrics.ts instead of importing it. Keep in
 * sync by hand if the geometry in challenges.ts ever changes.
 */
function unflattenRing(flat) {
  if (!Array.isArray(flat) || flat.length < 6) return []; // a ring needs 3+ points
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const lat = Number(flat[i]);
    const lon = Number(flat[i + 1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
  }
  return out;
}

function ringBbox(ring) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  for (const [lat, lon] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [minLat, minLon, maxLat, maxLon];
}

function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersects = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Does this cleanup fall inside the team's sponsored area? Mirrors
 *  challenges.ts's cleanupInArea() exactly. */
function cleanupInArea(c, area) {
  if (!area || area.type === 'anywhere') return true;

  if (area.type === 'neighborhood') {
    const want = String(area.label || '').trim().toLowerCase();
    const got = String(c.neighborhood || '').trim().toLowerCase();
    return !!want && want === got;
  }

  const lat = Number(c.location_lat);
  const lon = Number(c.location_lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  const bb = area.bbox;
  if (Array.isArray(bb) && bb.length === 4 && (lat < bb[0] || lat > bb[2] || lon < bb[1] || lon > bb[3])) return false;

  const ring = unflattenRing(area.ring);
  if (ring.length < 3) return false;
  return pointInRing(lat, lon, ring);
}

/** Same slugging rule as firebaseDatabase.ts's private teamSlug() — kept in
 *  sync by hand for the same reason as the geometry helpers above. */
function teamSlug(name) {
  return (
    String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team'
  );
}

/** Unguessable per-team dashboard token. crypto.randomBytes rather than
 *  Math.random: this stands in for auth on a page anyone with the link can
 *  open, so it needs to be cryptographically hard to guess, not just unique. */
function randomToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 hex chars
}

/** Validate + normalize a submitted ChallengeArea-shaped area. Throws
 *  HttpsError on anything malformed — this is the only path that can ever
 *  attach an area to a team, so it's the one place that needs to be strict. */
function normalizeSponsorArea(input) {
  if (!input || typeof input !== 'object') {
    throw new HttpsError('invalid-argument', 'area is required.');
  }
  const type = input.type;
  if (!TEAM_AREA_TYPES.has(type)) {
    throw new HttpsError('invalid-argument', 'area.type must be "anywhere", "neighborhood", or "custom".');
  }
  const label = String(input.label || '').trim().slice(0, 80);
  const area = { type, label: label || 'Anywhere' };

  if (type === 'neighborhood') {
    if (!label) throw new HttpsError('invalid-argument', 'area.label is required for a neighborhood area.');
  }
  if (type === 'custom') {
    const ring = Array.isArray(input.ring) ? input.ring.map(Number) : [];
    if (ring.length < 6 || ring.some((n) => !Number.isFinite(n))) {
      throw new HttpsError('invalid-argument', 'area.ring needs at least 3 points, flat as [lat, lon, lat, lon, …].');
    }
    area.ring = ring;
    area.bbox = ringBbox(unflattenRing(ring));
  }
  return area;
}

/** Validate + normalize an optional { type, value } goal, Challenge-shaped. */
function normalizeSponsorGoal(input) {
  if (input == null) return null;
  if (typeof input !== 'object') throw new HttpsError('invalid-argument', 'goal must be an object.');
  const type = input.type;
  const value = Number(input.value);
  if (!TEAM_GOAL_TYPES.has(type)) {
    throw new HttpsError('invalid-argument', 'goal.type must be "pickups", "bags", or "cleanups".');
  }
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    throw new HttpsError('invalid-argument', 'goal.value must be a positive number (up to 1,000,000).');
  }
  return { type, value: Math.round(value) };
}

/**
 * Create an area-scoped ("sponsor" / civic-org) team. A callable rather than
 * the plain client-side joinOrCreateTeam() write for one reason: the access
 * token has to be generated server-side (crypto.randomBytes) and must never
 * round-trip through a client-writable field. Fails if a team with the same
 * slug already exists — teams/{teamId} is immutable post-create (spec
 * decision #5), so a sponsor area can only ever be attached at creation.
 */
exports.createSponsorTeam = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to create a sponsor team.');
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const name = String(data.name || '').trim();
  if (!name || name.length > 60) {
    throw new HttpsError('invalid-argument', 'Give the team a name (1–60 characters).');
  }
  const area = normalizeSponsorArea(data.area);
  const goal = normalizeSponsorGoal(data.goal);

  const id = teamSlug(name);
  const teamRef = db.collection('teams').doc(id);
  const existing = await teamRef.get();
  if (existing.exists) {
    throw new HttpsError(
      'already-exists',
      `A team named "${name}" already exists — sponsor teams need a name not already in the directory.`
    );
  }

  const now = Date.now();
  const token = randomToken();

  // Forward map (team -> token) and reverse index (token -> team), mirroring
  // the email_index pattern already used elsewhere in these rules/functions
  // for "someone who already knows X can look up Y, nobody else can browse
  // the collection." Both are admin-only; see firestore.rules.
  await db.runTransaction(async (tx) => {
    tx.set(teamRef, {
      name,
      created_by: uid,
      created_at: now,
      area,
      ...(goal ? { goal } : {}),
    });
    tx.set(db.collection('team_tokens').doc(id), { token, created_at: now });
    tx.set(db.collection('team_token_index').doc(token), { teamId: id, created_at: now });
  });

  return { id, name, token };
});

/**
 * Retrieve an existing sponsor team's dashboard token (e.g. if the creator
 * lost the link). Creator-only, checked against teams/{teamId}.created_by —
 * the same ownership signal used everywhere else in this codebase, since no
 * admin-role system exists here (spec §4 deliberately doesn't build one).
 */
exports.getTeamToken = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to retrieve a team token.');
  }
  const teamId = String((request.data && request.data.teamId) || '').trim();
  if (!teamId) throw new HttpsError('invalid-argument', 'teamId is required.');

  const teamSnap = await db.collection('teams').doc(teamId).get();
  if (!teamSnap.exists) throw new HttpsError('not-found', 'No such team.');
  if (teamSnap.data().created_by !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the team creator can retrieve its dashboard token.');
  }

  const tokenSnap = await db.collection('team_tokens').doc(teamId).get();
  if (!tokenSnap.exists) {
    throw new HttpsError('not-found', 'This team has no dashboard token (it isn\'t an area-scoped sponsor team).');
  }
  return { token: tokenSnap.data().token };
});

/**
 * District-scoped totals for one team's area — a pure geographic filter over
 * ALL cleanups, independent of who did them or what team they're on (spec
 * decision #2: out-of-district cleanups don't count, but any in-district
 * cleanup does, regardless of team). `cleanupsSnap` is passed in so a caller
 * touching many teams (the scheduled snapshot job) reads the cleanups
 * collection once, not once per team.
 */
function districtStatsFromSnapshot(area, cleanupsSnap) {
  let cleanupsN = 0, pickups = 0, bagsTotal = 0, seconds = 0, lastCleanup = 0;
  cleanupsSnap.forEach((doc) => {
    const d = doc.data();
    if (!cleanupInArea(d, area)) return;
    cleanupsN += 1;
    pickups += num(d.items_count);
    bagsTotal += bagsFor(d);
    seconds += num(d.duration_seconds);
    const ms = toMillis(d.timestamp);
    if (ms > lastCleanup) lastCleanup = ms;
  });
  return {
    cleanups: cleanupsN,
    pickups,
    bags: Math.round(bagsTotal),
    hours: round1(seconds / 3600),
    last_cleanup: lastCleanup,
  };
}

/** Every team that carries an `area` — i.e. every sponsor/civic-org team. */
async function areaScopedTeams() {
  const snap = await db.collection('teams').get();
  const teams = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d && d.area && typeof d.area === 'object') teams.push({ id: doc.id, ...d });
  });
  return teams;
}

/** Snapshot every sponsor team's district totals, timestamped, for the
 *  dashboard's time-series view. Periodic snapshots (not read-time
 *  aggregation) per the spec's resolved decision on §3.3. */
async function buildOrgSnapshots() {
  const [teams, cleanupsSnap] = await Promise.all([areaScopedTeams(), db.collection('cleanups').get()]);
  const now = Date.now();
  await Promise.all(
    teams.map((team) => {
      const stats = districtStatsFromSnapshot(team.area, cleanupsSnap);
      return db.collection('team_snapshots').doc(team.id).collection('history').add({ timestamp: now, ...stats });
    })
  );
  return { teams: teams.length, timestamp: now };
}

/** Weekly snapshot — matches the cadence of the city-requests digest below;
 *  a reasonable default per the spec, nothing about this data needs to be
 *  fresher than that. */
exports.scheduledOrgSnapshots = onSchedule('every monday 08:00', async () => {
  await buildOrgSnapshots();
});

/**
 * Public, token-gated JSON endpoint for the sponsor/civic-org dashboard page
 * (pickglobal.org/org — web/org.html fetches this client-side). A per-team
 * token, not a shared secret like CITY_REQUESTS_DIGEST_KEY below — looked up
 * via the team_token_index reverse map, so an invalid or missing token
 * fails closed without ever touching a real team's data.
 */
exports.orgDashboard = onRequest(async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) { res.status(403).json({ ok: false, error: 'missing token' }); return; }

  try {
    const indexSnap = await db.collection('team_token_index').doc(token).get();
    if (!indexSnap.exists) { res.status(403).json({ ok: false, error: 'invalid token' }); return; }
    const teamId = indexSnap.data().teamId;

    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (!teamSnap.exists || !teamSnap.data().area) {
      res.status(404).json({ ok: false, error: 'team not found' });
      return;
    }
    const team = teamSnap.data();

    const cleanupsSnap = await db.collection('cleanups').get();
    const stats = districtStatsFromSnapshot(team.area, cleanupsSnap);

    const historySnap = await db
      .collection('team_snapshots').doc(teamId).collection('history')
      .orderBy('timestamp', 'asc')
      .get();
    const timeSeries = historySnap.docs.map((d) => {
      const s = d.data();
      return { timestamp: s.timestamp, cleanups: s.cleanups, pickups: s.pickups, bags: s.bags, hours: s.hours };
    });

    // Includes the full area (ring/bbox for a custom-drawn district, if any)
    // — the token holder is the sponsor this district belongs to, not the
    // general public, so showing them exactly what geographic area their
    // report covers (e.g. drawn on a map) is expected, not a privacy leak
    // the way exposing a city's or another team's boundary would be.
    res.json({
      ok: true,
      name: team.name,
      area: team.area,
      goal: team.goal || null,
      stats,
      timeSeries,
      updated_at: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

// ==========================================================================
// CITY REQUESTS — "prioritize my city". Fires from the map's fallback-city
// card (src/services/neighborhoods.ts's OSM fallback + isFallbackCityWithNoSubdivision
// gate in app/(tabs)/map.tsx): OSM gave us only the city's own outline, no
// real neighborhood subdivision, and the user tapped "Yes, prioritize my
// city." Dedups per user via a marker doc at
// city_requests/{slug}/requesters/{uid} so re-opening the app (or the map
// re-offering the card in a later session before this ships) doesn't
// double-count the same person. The aggregate itself, city_requests/{slug},
// is public-read/admin-write only — same shape as city_stats/global_stats.
// ==========================================================================

exports.requestCity = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to request a city.');
  }
  const uid = request.auth.uid;
  const city = String((request.data && request.data.city) || '').trim();
  if (!city) {
    throw new HttpsError('invalid-argument', 'city is required.');
  }
  // The client's `citySlug` is accepted per the callable's contract but not
  // trusted as-is: the slug is always recomputed here from `city` with the
  // same citySlug() used everywhere else, so a mismatched/garbled client
  // value can never fork the aggregate away from the canonical slug for
  // this city name — it can only ever land on city_requests/{citySlug(city)}.
  const slug = citySlug(city);

  const docRef = db.collection('city_requests').doc(slug);
  const requesterRef = docRef.collection('requesters').doc(uid);

  // Single transaction: read both docs, then decide. Keeps "does this uid
  // already have a marker" and "increment the count" atomic, so two rapid
  // calls from the same uid (e.g. a double-tap) can't both pass the dedup
  // check and double-increment.
  const alreadyRequested = await db.runTransaction(async (tx) => {
    const [docSnap, requesterSnap] = await Promise.all([tx.get(docRef), tx.get(requesterRef)]);
    if (requesterSnap.exists) return true;

    const now = Date.now();
    tx.set(requesterRef, { uid, requestedAt: now });
    if (!docSnap.exists) {
      tx.set(docRef, { city, slug, count: 1, firstRequestedAt: now, lastRequestedAt: now });
    } else {
      tx.update(docRef, { city, slug, count: FieldValue.increment(1), lastRequestedAt: now });
    }
    return false;
  });

  return { ok: true, alreadyRequested };
});

/** Rank every city_requests doc by count desc and write a rollup doc — the
 *  weekly "which cities are asking for real neighborhoods" summary. */
async function buildCityRequestsDigest() {
  const snap = await db.collection('city_requests').get();
  const cities = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    cities.push({
      slug: doc.id,
      city: d.city || doc.id,
      count: num(d.count),
      firstRequestedAt: num(d.firstRequestedAt) || null,
      lastRequestedAt: num(d.lastRequestedAt) || null,
    });
  });
  cities.sort((a, b) => b.count - a.count);

  const digest = {
    generatedAt: Date.now(),
    totalCities: cities.length,
    totalRequests: cities.reduce((s, c) => s + c.count, 0),
    cities,
  };
  await db.collection('admin_rollups').doc('city_requests_digest').set(digest);
  return digest;
}

/** Weekly rollup — cadence matches the ask ("weekly digest"), not the hourly/
 *  daily jobs above. */
exports.scheduledCityRequestsDigest = onSchedule('every monday 09:00', async () => {
  await buildCityRequestsDigest();
});

// Secret gate for the manual/external digest trigger, same convention as
// ADOPTION_TRIGGER_KEY above (a hardcoded shared secret checked as a query
// param — not an actual process.env var; nothing in this file reads from
// process.env for its gates, so this follows the existing pattern rather
// than inventing a differently-shaped one). Change this value if it's ever
// shared. Read-only — it only reports the current tally, never writes.
const CITY_REQUESTS_DIGEST_KEY = 'pick-city-digest-9k3p';

/** External weekly job hits this (e.g. `curl`) to pull the ranked digest as
 *  JSON, gated by CITY_REQUESTS_DIGEST_KEY exactly like runAdoptionCheck. */
exports.runCityRequestsDigest = onRequest(async (req, res) => {
  if (req.query.key !== CITY_REQUESTS_DIGEST_KEY) { res.status(403).send('forbidden'); return; }
  try {
    res.json({ ok: true, ...(await buildCityRequestsDigest()) });
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

// Min distance (m) from a point to a block's polyline — for blocks adopted by
// tapping the map (they carry `coords`).
function pointToSegM(plat, plon, alat, alon, blat, blon) {
  const cosLat = Math.cos((plat * Math.PI) / 180);
  const ax = alon * cosLat, ay = alat, bx = blon * cosLat, by = blat, px = plon * cosLat, py = plat;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return distMeters(py, px / cosLat, cy, cx / cosLat);
}
function pointToPolyM(plat, plon, coords) {
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const d = pointToSegM(plat, plon, coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    if (d < best) best = d;
  }
  return best;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Wraps an email body in PICK's branded shell — navy header band with the
 * wordmark, white content card, muted footer. Matches the app's "Civic
 * Blueprint" design system (apps/companion/src/pick/theme.ts: navy #0F2F66,
 * cream text #FEFCDD) so mail reads as the same product as the app instead
 * of a bare unstyled fallback. Table layout + inline styles only — the
 * safest baseline across Gmail/Apple Mail/Outlook, none of which reliably
 * load embedded <style> blocks or modern CSS.
 */
function emailShell(bodyHtml) {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#E8ECF5;font-family:-apple-system,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E8ECF5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0F2F66;padding:20px 28px;">
          <span style="color:#FEFCDD;font-size:20px;font-weight:700;letter-spacing:0.5px;">PICK</span>
        </td></tr>
        <tr><td style="padding:28px;color:#0F2F66;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:0 28px 24px;color:rgba(15,47,102,0.55);font-size:12px;">
          — PICK · pickglobal.org
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

    const line = Array.isArray(a.coords) && a.coords.length >= 2 ? a.coords : null;
    let fresh = false;
    let lastNearTs = 0;
    for (const c of recent) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      const dist = line ? pointToPolyM(c.lat, c.lon, line) : distMeters(a.lat, a.lon, c.lat, c.lon);
      if (dist <= radius) {
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
        html: emailShell(
          `<p style="margin:0 0 12px;">Hi!</p>` +
          `<p style="margin:0 0 12px;"><strong>${esc(a.label)}</strong> hasn't had a cleanup nearby in over ${thresh} days <span style="color:rgba(15,47,102,0.55);">(last one was ${esc(sinceText)})</span>.</p>` +
          `<p style="margin:0;">If you're passing by, pop your phone in your pocket and give it a quick pick.</p>`
        ),
      },
    });
    // Push too — lands on the phone and mirrors to the Apple Watch when the
    // phone is locked. Same anti-spam window as the email.
    if (a.userId) {
      const token = await pushTokenFor(a.userId);
      await sendExpoPush(
        token,
        `${a.label} could use a pick`,
        `No cleanup nearby in over ${thresh} days. Passing by? Give it a quick pick.`,
        { type: 'adoption_stale', label: a.label || '' }
      );
    }
    await docSnap.ref.update({ lastNotified: now, lastNearTs });
    emailed++;
  }
  return { checked: adSnap.size, emailed };
}

/** Daily scan for stale adopted streets. */
exports.scheduledAdoptionCheck = onSchedule('every 24 hours', async () => {
  await checkAdoptions();
});

/**
 * Instant confirmation: the moment a picker adopts a spot, email them so they
 * get something immediately (the nudge job only fires once it's gone stale).
 * Fires on adoptions/{id} create; the email address is stored on the adoption
 * doc, so no Auth lookup is needed. Writes to the `mail` collection like every
 * other email here — the Trigger Email extension delivers it.
 */
exports.onAdoptionCreated = onDocumentCreated('adoptions/{adoptionId}', async (event) => {
  const a = (event.data && event.data.data()) || {};
  if (!a.email) return; // nothing to send to
  const label = a.label || 'your spot';
  const thresh = num(a.thresholdDays) || 7;
  await db.collection('mail').add({
    to: [a.email],
    message: {
      subject: `You adopted ${label}`,
      text: `Nice — you just adopted ${label} on PICK.\n\nWe'll keep an eye on it. If it goes more than ${thresh} days without a cleanup nearby, we'll send you a friendly nudge to swing by and give it a pick.\n\nThanks for looking after your streets. — PICK`,
      html: emailShell(
        `<p style="margin:0 0 12px;">Nice — you just adopted <strong style="color:#C1502E;">${esc(label)}</strong> on PICK.</p>` +
        `<p style="margin:0 0 12px;">We'll keep an eye on it. If it goes more than ${thresh} days without a cleanup nearby, we'll send you a friendly nudge to swing by and give it a pick.</p>` +
        `<p style="margin:0;">Thanks for looking after your streets.</p>`
      ),
    },
  });
  console.log(`📬 Adoption confirmation queued: ${a.email} (${label})`);
  // Instant push too (mirrors to Apple Watch when the phone is locked).
  if (a.userId) {
    const token = await pushTokenFor(a.userId);
    await sendExpoPush(
      token,
      `You adopted ${label}`,
      `We'll nudge you if it goes ${thresh}+ days without a cleanup.`,
      { type: 'adoption_created', label }
    );
  }
});

/**
 * Notify the owner whenever a new user signs up. Fires when a user's profile
 * doc is first created (which happens right after account creation). Pulls the
 * email from the Auth record and drops a message in the `mail` collection so
 * the Trigger Email extension sends it.
 */
exports.notifyNewSignup = onDocumentCreated('users/{uid}', async (event) => {
  const uid = event.params.uid;
  const data = (event.data && event.data.data()) || {};
  let email = '(unknown)';
  let name = data.display_name || data.name || '';
  try {
    const u = await getAuth().getUser(uid);
    email = u.email || email;
    if (!name) name = u.displayName || '';
  } catch (e) {
    // Auth record may be unreadable; send with whatever the profile has.
  }
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  await db.collection('mail').add({
    to: [OWNER_EMAIL],
    message: {
      subject: `New Pick signup${name ? `: ${name}` : ''}`,
      text: `A new Picker just joined.\n\nName: ${name || '(none)'}\nEmail: ${email}\nNeighborhood: ${data.neighborhood || '(none)'}\nUID: ${uid}\nWhen: ${when} ET`,
      html: emailShell(
        `<p style="margin:0 0 12px;">A new Picker just joined.</p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">` +
        `<tr><td style="padding:4px 0;color:rgba(15,47,102,0.55);">Name</td><td style="padding:4px 0;"><strong>${esc(name || '(none)')}</strong></td></tr>` +
        `<tr><td style="padding:4px 0;color:rgba(15,47,102,0.55);">Email</td><td style="padding:4px 0;">${esc(email)}</td></tr>` +
        `<tr><td style="padding:4px 0;color:rgba(15,47,102,0.55);">Neighborhood</td><td style="padding:4px 0;">${esc(data.neighborhood || '(none)')}</td></tr>` +
        `<tr><td style="padding:4px 0;color:rgba(15,47,102,0.55);">UID</td><td style="padding:4px 0;">${esc(uid)}</td></tr>` +
        `<tr><td style="padding:4px 0;color:rgba(15,47,102,0.55);">When</td><td style="padding:4px 0;">${esc(when)} ET</td></tr>` +
        `</table>`
      ),
    },
  });
  console.log(`📬 New signup notified to owner: ${email} (${uid})`);
});

// Secret gate for the manual adoption-check trigger below. Change this value if
// it's ever shared. (This endpoint only sends the same nudge emails the daily
// job sends — it never creates or deletes data.)
const ADOPTION_TRIGGER_KEY = 'pick-adopt-check-2f7b';

/** Manual trigger for testing the adoption check (gated by its own secret). */
exports.runAdoptionCheck = onRequest(async (req, res) => {
  if (req.query.key !== ADOPTION_TRIGGER_KEY) { res.status(403).send('forbidden'); return; }
  try {
    res.json({ ok: true, ...(await checkAdoptions()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

// ==========================================================================
// PUSH NOTIFICATIONS — the friendly nudges. Tokens are stored on the user doc
// (users/{uid}.pushToken) by the app; we POST to Expo's push service. Kept to
// follow + like + adoption (no comments/DMs in the product).
// ==========================================================================

/** Send one Expo push. Best-effort — never throws into the trigger. */
async function sendExpoPush(token, title, body, data) {
  if (!token || typeof token !== 'string' || !token.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data: data || {} }),
    });
  } catch (e) {
    console.warn('sendExpoPush failed:', e && e.message);
  }
}

async function pushTokenFor(uid) {
  try {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? (snap.data() || {}).pushToken : null;
  } catch { return null; }
}
async function nameFor(uid) {
  try {
    const p = await db.collection('profiles').doc(uid).get();
    if (p.exists && (p.data() || {}).display_name) return p.data().display_name;
  } catch {}
  return 'Someone';
}

// ==========================================================================
// ACCOUNT DELETION — server-side cleanup for what client rules forbid.
//
// `feedback` and `reports` are intentionally write-only from the client
// (see firestore.rules) so users can't read back moderation/feedback
// contents — which also means the client can't delete its own docs there on
// account deletion. `follows` edges where this uid is the one being
// FOLLOWED (not the follower) hit the same wall: the rule only lets the
// follower side delete an edge, so a user closing their account can't clean
// up the incoming half of their follow graph themselves either.
//
// Called by src/services/firebaseDatabase.ts's deleteAccountData() as the
// last step of account deletion, while the caller's auth token is still
// valid — request.auth.uid is checked against the uid being deleted so this
// can't be used to wipe someone else's data.
// ==========================================================================

exports.deleteMyPrivateData = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to delete your account.');
  }
  const uid = request.data && request.data.uid;
  if (!uid || uid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only delete your own data.');
  }

  const steps = {};
  const deleteAllDocs = (snap) => Promise.all(snap.docs.map((d) => d.ref.delete()));

  try {
    const feedbackSnap = await db.collection('feedback').where('uid', '==', uid).get();
    await deleteAllDocs(feedbackSnap);
    steps.feedback = true;
  } catch (error) {
    console.error('deleteMyPrivateData: feedback cleanup failed', error);
    steps.feedback = false;
  }

  try {
    const reportsSnap = await db.collection('reports').where('reporterUid', '==', uid).get();
    await deleteAllDocs(reportsSnap);
    steps.reports = true;
  } catch (error) {
    console.error('deleteMyPrivateData: reports cleanup failed', error);
    steps.reports = false;
  }

  try {
    // Edges where this uid is followed BY someone else (the incoming half —
    // the outgoing half is already deleted client-side, see firebaseDatabase.ts).
    const followedBySnap = await db.collection('follows').where('followingId', '==', uid).get();
    await deleteAllDocs(followedBySnap);
    steps.follows_incoming = true;
  } catch (error) {
    console.error('deleteMyPrivateData: follows cleanup failed', error);
    steps.follows_incoming = false;
  }

  // Storage-hosted files (cleanup photos, avatar) — the privacy policy
  // promises deletion "removes your account and all associated data
  // permanently," but this function used to only touch Firestore, leaving
  // uploaded images in Storage forever. Deletes each user's own-folder
  // prefix (storage.rules already scopes cleanup_photos/{uid}/ and
  // avatars/{uid}/ to owner-only writes, so this mirrors that same
  // per-user boundary).
  try {
    await bucket.deleteFiles({ prefix: `cleanup_photos/${uid}/` });
    steps.cleanup_photos = true;
  } catch (error) {
    console.error('deleteMyPrivateData: cleanup_photos deletion failed', error);
    steps.cleanup_photos = false;
  }

  try {
    await bucket.deleteFiles({ prefix: `avatars/${uid}/` });
    steps.avatars = true;
  } catch (error) {
    console.error('deleteMyPrivateData: avatars deletion failed', error);
    steps.avatars = false;
  }

  return { steps };
});

// ==========================================================================
// BLOCKING — mirror blocks/{blockerUid_blockedUid} onto the BLOCKED user's
// own users/{uid} doc as `blocked_by`, using the admin SDK (bypasses the
// `allow read: if false` client rule on the blocks collection itself). The
// blocked user's client already reads its own doc, so it can filter the
// blocker's posts out of its feed without ever querying (or being able to
// query) who blocked them or why.
// ==========================================================================

exports.onBlockCreated = onDocumentCreated('blocks/{blockId}', async (event) => {
  const b = (event.data && event.data.data()) || {};
  if (!b.blockerUid || !b.blockedUid) return;
  await db.collection('users').doc(b.blockedUid).set(
    { blocked_by: FieldValue.arrayUnion(b.blockerUid) },
    { merge: true }
  );
});

exports.onBlockDeleted = onDocumentDeleted('blocks/{blockId}', async (event) => {
  const b = (event.data && event.data.data()) || {};
  if (!b.blockerUid || !b.blockedUid) return;
  await db.collection('users').doc(b.blockedUid).set(
    { blocked_by: FieldValue.arrayRemove(b.blockerUid) },
    { merge: true }
  );
});

/** New follower → notify the followed user. follows/{follower_following}. */
exports.onFollowCreated = onDocumentCreated('follows/{edgeId}', async (event) => {
  const f = (event.data && event.data.data()) || {};
  if (!f.followerId || !f.followingId || f.followerId === f.followingId) return;
  const token = await pushTokenFor(f.followingId);
  if (!token) return;
  const who = await nameFor(f.followerId);
  await sendExpoPush(token, 'New follower', `${who} started following you on Pick.`, {
    type: 'follow', actorUid: f.followerId,
  });
});

/** Post liked → notify the author when a NEW uid appears in liked_by. */
exports.onPostLiked = onDocumentWritten('posts/{postId}', async (event) => {
  const before = (event.data && event.data.before && event.data.before.data()) || null;
  const after = (event.data && event.data.after && event.data.after.data()) || null;
  if (!before || !after) return; // create/delete — not a like change
  const prev = new Set(before.liked_by || []);
  const now = after.liked_by || [];
  const authorUid = after.uid;
  const newLikers = now.filter((u) => !prev.has(u) && u !== authorUid);
  if (newLikers.length === 0 || !authorUid) return;
  const token = await pushTokenFor(authorUid);
  if (!token) return;
  const who = await nameFor(newLikers[newLikers.length - 1]);
  const extra = newLikers.length > 1 ? ` and ${newLikers.length - 1} other${newLikers.length > 2 ? 's' : ''}` : '';
  await sendExpoPush(token, 'Nice work!', `${who}${extra} liked your post.`, { type: 'like', postId: event.params.postId });
});
