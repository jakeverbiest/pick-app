/**
 * Pick — Cloud Functions
 *
 * Maintains the `team_stats` leaderboard aggregate. The Firestore security
 * rules make team_stats read-only for clients (`allow write: if false`), so it
 * can only be written here, by the Admin SDK (which bypasses rules). That's what
 * lets leaderboards work cross-user without exposing anyone's raw cleanups.
 *
 * Two entry points (the names referenced in firestore.rules):
 *   - onCleanupWrite:   applies an INCREMENTAL delta to a team's stats whenever
 *                       one of its cleanups is created, edited, or deleted.
 *   - rebuildTeamStats: callable backfill that recomputes every team FROM
 *                       SCRATCH (full scan) — run once after first deploy, any
 *                       time you want to resync, or if drift is ever suspected.
 *                       This is the correctness backstop for the incremental
 *                       path below.
 *
 * Aggregation strategy (changed 2026-09-01, see LEDGER_INBOX.md): this used to
 * re-query and recompute the WHOLE team's cleanup history on every single
 * write, in a scheduled hourly cron, AND on every dashboard pageview — three
 * full collection scans whose cost scaled with CUMULATIVE cleanups ever
 * logged, not with active usage. That's fine at low volume but doesn't stay
 * "negligible" as history accumulates; a finance/cost review flagged it before
 * web/org.html sponsor traffic made the dashboard-pageview case much worse.
 *
 * Now: onCleanupWrite applies a small delta (the one cleanup that changed) to
 * a running rollup doc, inside a Firestore transaction so concurrent writes to
 * the same team can't lose an update. Firestore doesn't support subtracting
 * from a Set, so exact distinct-member and distinct-day counts are tracked via
 * per-member / per-day counter subcollections (team_stats/{id}/members/{uid},
 * team_stats/{id}/days/{day}) rather than trying to recompute Set cardinality
 * from a diff. `rebuildTeamFromScratch` (full scan) remains as the manual
 * resync path — the correctness backstop if delta application ever drifts
 * (a failed write, a bug, whatever). See the function-level comments below for
 * the exact idempotency/concurrency reasoning, and for what's still a full
 * scan (scheduledPublicStats, the org_stats weekly self-heal) and why.
 *
 * Deploy:  firebase deploy --only functions      (from apps/companion)
 *          firebase deploy --only firestore:indexes   (new composite index for
 *                                                       the team_stats last_cleanup
 *                                                       lookback query, see below)
 */

const { onDocumentWritten, onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
// Overpass hedge/mirror-failover client + the exact street/boundary fetch
// pipelines the app's own map screen uses client-side — shared so the
// scheduled precache refresh below (OVERPASS_PRECACHE_SPEC.md) writes the
// identical shape a live client fetch would have produced, not a second,
// possibly-drifting implementation. See functions/shared/overpassClient.js's
// doc comment for why these live under functions/ instead of src/.
const { fetchStreetGeometry, gridKey } = require('./shared/streetGeometry');
const { fetchOsmBoundariesInBox, osmCellKey, OSM_CELL_DEG } = require('./shared/boundaryGeometry');

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
 * Recompute and write team_stats for one team FROM SCRATCH (full scan of that
 * team's cleanups). This is the correctness backstop, not the hot path — used
 * by the manual `rebuildTeamStats` resync callable, and by anything that
 * suspects the incremental rollup (applyTeamDelta, below) has drifted. Also
 * rebuilds the members/days counter subcollections so a resync is a true
 * "erase and recompute" of everything the incremental path maintains, not
 * just the top-level fields.
 */
async function rebuildTeamFromScratch(team) {
  if (team == null || NON_TEAM.has(String(team))) return;

  const docRef = db.collection('team_stats').doc(teamDocId(team));
  const snap = await db.collection('cleanups').where('team', '==', team).get();

  // Clear existing counter subcollections first so stale per-member/per-day
  // docs from cleanups that moved teams or were deleted don't linger.
  const [oldMembers, oldDays] = await Promise.all([
    docRef.collection('members').get(),
    docRef.collection('days').get(),
  ]);
  const clearBatch = db.batch();
  oldMembers.forEach((d) => clearBatch.delete(d.ref));
  oldDays.forEach((d) => clearBatch.delete(d.ref));
  await clearBatch.commit();

  if (snap.empty) {
    await docRef.delete().catch(() => {});
    return;
  }

  let totalCleanups = 0;
  let totalPickups = 0;
  let totalWeightRaw = 0;
  let totalBagsRaw = 0;
  let lastCleanup = 0;
  const dayCounts = new Map(); // day -> count
  const memberCounts = new Map(); // uid -> count

  snap.forEach((doc) => {
    const d = doc.data();
    totalCleanups += 1;
    totalPickups += num(d.items_count);
    totalWeightRaw += num(d.weight_lb);
    totalBagsRaw += bagsFor(d);
    if (d.userId) memberCounts.set(d.userId, (memberCounts.get(d.userId) || 0) + 1);
    const ms = toMillis(d.timestamp);
    if (ms) {
      if (ms > lastCleanup) lastCleanup = ms;
      const day = new Date(ms).toISOString().slice(0, 10); // UTC calendar day
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
  });

  const writeBatch = db.batch();
  memberCounts.forEach((count, uid) => writeBatch.set(docRef.collection('members').doc(uid), { count }));
  dayCounts.forEach((count, day) => writeBatch.set(docRef.collection('days').doc(day), { count }));
  writeBatch.set(docRef, {
    team: String(team),
    total_cleanups: totalCleanups,
    total_pickups: totalPickups,
    total_weight_raw: totalWeightRaw,
    total_weight: round1(totalWeightRaw),
    total_bags_raw: totalBagsRaw,
    total_bags: Math.round(totalBagsRaw),
    total_days: dayCounts.size,
    member_count: memberCounts.size,
    last_cleanup: lastCleanup,
    avg_pickups_per_session: totalCleanups ? round1(totalPickups / totalCleanups) : 0,
    updated_at: Date.now(),
  });
  await writeBatch.commit();
}

/**
 * Apply ONE cleanup's contribution to a team's rollup, incrementally.
 * `sign` is +1 (the cleanup now counts towards this team) or -1 (it no longer
 * does — deleted, or moved to a different team). Runs inside a transaction so
 * concurrent writes to the same team's rollup can't lose an update (Firestore
 * transactions retry automatically on contention).
 *
 * Distinct member/day counts can't be maintained by incrementing a number
 * alone (you can't "subtract from a Set" without knowing if anyone else still
 * has an entry there) — so member_count and total_days are backed by counter
 * subcollections (one tiny doc per member/day, refcounted): the top-level
 * count only changes when a subcollection doc is newly created (0 -> 1) or
 * fully removed (1 -> 0).
 *
 * last_cleanup (a max) is similarly awkward to decrement on removal — handled
 * by only ever moving it forward on add, and on removal, re-deriving it with a
 * single indexed query (`team == X order by timestamp desc limit 1`) ONLY in
 * the rare case the removed cleanup WAS the current last_cleanup. That query
 * reads the live `cleanups` collection directly, so it's always correct
 * (self-corrects even mid-update, since Firestore triggers fire after the
 * write that changed the doc has already committed) and cheap (one indexed
 * doc read, not a scan) — needs the composite index in firestore.indexes.json.
 *
 * Idempotency note: this is NOT guarded against duplicate delta application
 * from a retried trigger invocation. firebase-functions v2 onDocumentWritten
 * does not retry by default (no `retry: true` here), so in normal operation
 * this only runs once per write. If retries are ever enabled for this
 * trigger, this function would need an idempotency ledger (e.g. a
 * processed-event-id marker) to stay safe — deliberately not built now since
 * it isn't needed under the current (non-retrying) trigger config. Flagging
 * this explicitly rather than silently assuming it away.
 */
async function applyTeamDelta(team, cleanup, sign) {
  if (team == null || NON_TEAM.has(String(team))) return;

  const docRef = db.collection('team_stats').doc(teamDocId(team));
  const pickups = num(cleanup.items_count);
  const weight = num(cleanup.weight_lb);
  const bags = bagsFor(cleanup);
  const ms = toMillis(cleanup.timestamp);
  const uid = cleanup.userId || null;
  const day = ms ? new Date(ms).toISOString().slice(0, 10) : null;
  const memberRef = uid ? docRef.collection('members').doc(uid) : null;
  const dayRef = day ? docRef.collection('days').doc(day) : null;

  await db.runTransaction(async (tx) => {
    // --- ALL reads first (Firestore transactions require every get() before
    //     any set()/delete()) — including the conditional last_cleanup
    //     lookback query, which can only be decided once teamSnap is read,
    //     but must still happen before any write below. ---
    const teamSnap = await tx.get(docRef);
    const memberSnap = memberRef ? await tx.get(memberRef) : null;
    const daySnap = dayRef ? await tx.get(dayRef) : null;

    const cur = teamSnap.exists ? teamSnap.data() : {};
    const curLastCleanup = num(cur.last_cleanup);
    const needsLookback = sign < 0 && ms > 0 && ms === curLastCleanup;
    const nextMaxSnap = needsLookback
      ? await tx.get(
          db.collection('cleanups').where('team', '==', team).orderBy('timestamp', 'desc').limit(1)
        )
      : null;

    // --- now compute + write ---
    let totalCleanups = num(cur.total_cleanups);
    let totalPickups = num(cur.total_pickups);
    let totalWeightRaw = num(cur.total_weight_raw ?? cur.total_weight);
    let totalBagsRaw = num(cur.total_bags_raw ?? cur.total_bags);
    let memberCount = num(cur.member_count);
    let totalDays = num(cur.total_days);
    let lastCleanup = curLastCleanup;

    totalCleanups += sign;
    totalPickups += sign * pickups;
    totalWeightRaw += sign * weight;
    totalBagsRaw += sign * bags;

    // Member refcount.
    if (memberRef) {
      const prevCount = memberSnap.exists ? num(memberSnap.data().count) : 0;
      const nextCount = prevCount + sign;
      if (nextCount <= 0) {
        tx.delete(memberRef);
        if (prevCount > 0) memberCount -= 1;
      } else {
        tx.set(memberRef, { count: nextCount });
        if (prevCount <= 0) memberCount += 1;
      }
    }

    // Day refcount.
    if (dayRef) {
      const prevCount = daySnap.exists ? num(daySnap.data().count) : 0;
      const nextCount = prevCount + sign;
      if (nextCount <= 0) {
        tx.delete(dayRef);
        if (prevCount > 0) totalDays -= 1;
      } else {
        tx.set(dayRef, { count: nextCount });
        if (prevCount <= 0) totalDays += 1;
      }
    }

    // last_cleanup: move forward freely; only re-derive on the rare case a
    // removal takes away the current max (see doc comment above).
    if (sign > 0 && ms > lastCleanup) {
      lastCleanup = ms;
    } else if (needsLookback) {
      lastCleanup = nextMaxSnap.empty ? 0 : toMillis(nextMaxSnap.docs[0].data().timestamp);
    }

    if (totalCleanups <= 0) {
      // Team has no cleanups left — mirror the old "delete if empty" behavior.
      tx.delete(docRef);
      return;
    }

    tx.set(docRef, {
      team: String(team),
      total_cleanups: totalCleanups,
      total_pickups: totalPickups,
      total_weight_raw: totalWeightRaw,
      total_weight: round1(totalWeightRaw),
      total_bags_raw: totalBagsRaw,
      total_bags: Math.round(totalBagsRaw),
      total_days: totalDays,
      member_count: memberCount,
      last_cleanup: lastCleanup,
      avg_pickups_per_session: totalCleanups ? round1(totalPickups / totalCleanups) : 0,
      updated_at: Date.now(),
    });
  });
}

// ---------- triggers ----------

/**
 * Fires on every create/update/delete of a cleanup. Applies an incremental
 * delta to the team(s) the cleanup belongs to (a plain edit removes-then-
 * re-adds within the same team; a team change removes from the old team and
 * adds to the new one) — see applyTeamDelta for the full correctness story.
 * Also updates org_stats for any sponsor/civic-org team whose district the
 * cleanup enters or leaves (see applyOrgDelta near the org-dashboard code).
 */
exports.onCleanupWrite = onDocumentWritten('cleanups/{cleanupId}', async (event) => {
  const before = event.data && event.data.before && event.data.before.data();
  const after = event.data && event.data.after && event.data.after.data();

  const ops = [];
  if (before && before.team) ops.push(applyTeamDelta(before.team, before, -1));
  if (after && after.team) ops.push(applyTeamDelta(after.team, after, +1));
  ops.push(applyOrgDeltaForCleanup(before, after));

  await Promise.all(ops);
});

/** Recompute team_stats for every team found across all cleanups (full scan —
 *  see rebuildTeamFromScratch doc comment; this is the manual resync path). */
async function rebuildAllTeams() {
  const snap = await db.collection('cleanups').get();
  const teams = new Set();
  snap.forEach((doc) => {
    const t = doc.data().team;
    if (t != null && !NON_TEAM.has(String(t))) teams.add(t);
  });
  await Promise.all([...teams].map((t) => rebuildTeamFromScratch(t)));
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

/**
 * Scheduled rebuild — full recompute-from-source, same as before. Deliberately
 * NOT made incremental (unlike team_stats above): this aggregate needs a
 * rolling "last 7 days" window, a sorted top-25 pickers board, and decaying
 * hotspot/tile counts, none of which can be derived from a single cleanup's
 * delta the way a running total can — entries need to fall back OUT of the
 * week window and off the leaderboard as time passes, which a pure add/
 * subtract delta doesn't express. Building that correctly (bucketed daily
 * rollups, an expiry sweep, etc.) is real new infrastructure, not a quick
 * change, so per the cost-review tradeoff call: keep this exact, and instead
 * cut the frequency 6x (60min -> 4h) since a public dashboard doesn't need
 * sub-hourly freshness. That alone cuts this function's contribution to the
 * free-tier ceiling by 6x without any drift risk. If cost pressure returns,
 * the next real lever is a `modified_at` cursor field on cleanups so this can
 * read only what changed since the last run, rather than a further frequency
 * cut.
 */
exports.scheduledPublicStats = onSchedule('every 4 hours', async () => {
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
  // "anywhere" is a valid Challenge area (no geographic restriction on a
  // participant), but it has no meaning for a district-scoped sponsor
  // dashboard - it would silently expose the platform's ENTIRE total
  // activity as if it were one sponsor's district. Caught during manual
  // testing 2026-08-31 (an "anywhere" test team returned ~all-time platform
  // totals). Sponsor teams require an actual boundary.
  if (type === 'anywhere') {
    throw new HttpsError(
      'invalid-argument',
      'A sponsor dashboard needs an actual area — "anywhere" would show the whole platform\'s activity, not a district. Use "neighborhood" or "custom".'
    );
  }
  if (!TEAM_AREA_TYPES.has(type)) {
    throw new HttpsError('invalid-argument', 'area.type must be "neighborhood" or "custom" for a sponsor team.');
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

  // Seed org_stats with this district's ALL-TIME totals (a sponsor's district
  // totals include cleanups logged before the sponsor team existed, per spec
  // decision #2 — it's a pure geographic filter, not scoped to team age). This
  // is the one place a full `cleanups` scan for this team is still paid for
  // live, but it happens once, at team-creation time (a rare, human-driven
  // event), not on every pageview or every write — after this, org_stats for
  // this team stays current via the incremental applyOrgDeltaForCleanup path.
  const cleanupsSnap = await db.collection('cleanups').get();
  const stats = districtStatsFromSnapshot(area, cleanupsSnap);
  await db.collection('org_stats').doc(id).set({
    cleanups: stats.cleanups,
    pickups: stats.pickups,
    bags_raw: stats.bags,
    bags: stats.bags,
    seconds_raw: stats.hours * 3600,
    hours: stats.hours,
    last_cleanup: stats.last_cleanup,
    updated_at: now,
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

/** Every team that carries an `area` — i.e. every sponsor/civic-org team.
 *  Cached briefly in memory: sponsor teams are created rarely (a manual,
 *  human-driven flow via createSponsorTeam), so re-reading the `teams`
 *  collection on every single cleanup write (this is called from
 *  applyOrgDeltaForCleanup, which onCleanupWrite runs on every write) is
 *  wasted cost on a warm instance. A short TTL bounds staleness: a
 *  brand-new sponsor team might miss incremental credit for cleanups logged
 *  in the ~60s after it's created on an already-warm instance, but
 *  createSponsorTeam seeds org_stats with a full historical backfill at
 *  creation time anyway (see below), and the weekly buildOrgSnapshots
 *  self-heal (see below) closes any gap within a week regardless. */
let _areaScopedTeamsCache = null;
let _areaScopedTeamsCacheAt = 0;
const AREA_SCOPED_TEAMS_TTL_MS = 60 * 1000;

async function areaScopedTeams() {
  const now = Date.now();
  if (_areaScopedTeamsCache && now - _areaScopedTeamsCacheAt < AREA_SCOPED_TEAMS_TTL_MS) {
    return _areaScopedTeamsCache;
  }
  const snap = await db.collection('teams').get();
  const teams = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d && d.area && typeof d.area === 'object') teams.push({ id: doc.id, ...d });
  });
  _areaScopedTeamsCache = teams;
  _areaScopedTeamsCacheAt = now;
  return teams;
}

/**
 * Apply one cleanup's contribution to org_stats for whichever sponsor
 * team(s)' district it falls inside — geographically scoped, so unlike
 * team_stats this has nothing to do with which `team` field the cleanup
 * carries (per spec decision #2: district totals are a pure geographic
 * filter over ALL cleanups, regardless of team). `sign` is +1/-1 exactly
 * like applyTeamDelta.
 *
 * Same last_cleanup caveat as applyTeamDelta EXCEPT the cheap re-derivation
 * query isn't available here: there's no indexed "which cleanups are in this
 * polygon" query (point-in-polygon isn't a Firestore-native filter — that's
 * exactly why districtStatsFromSnapshot has to scan+filter in application
 * code). So on removal, if the removed cleanup WAS the district's
 * last_cleanup, this leaves it as-is rather than paying for a full scan on
 * every such write — a deliberate, explicitly-flagged correctness
 * compromise, bounded to at most 7 days of staleness on this ONE field
 * (never the counts/totals, which stay exact via the transaction) because
 * buildOrgSnapshots overwrites org_stats from a full recompute weekly.
 */
async function applyOrgDeltaFor(team, cleanup, sign) {
  const docRef = db.collection('org_stats').doc(team.id);
  const pickups = num(cleanup.items_count);
  const bags = bagsFor(cleanup);
  const seconds = num(cleanup.duration_seconds);
  const ms = toMillis(cleanup.timestamp);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const cur = snap.exists ? snap.data() : {};
    let cleanups = num(cur.cleanups) + sign;
    const pickupsTotal = num(cur.pickups) + sign * pickups;
    const bagsRaw = num(cur.bags_raw ?? cur.bags) + sign * bags;
    const secondsRaw = num(cur.seconds_raw) + sign * seconds;
    let lastCleanup = num(cur.last_cleanup);
    if (sign > 0 && ms > lastCleanup) lastCleanup = ms;
    // sign < 0 and ms === lastCleanup: deliberately left as-is, see doc comment.

    if (cleanups <= 0) {
      tx.delete(docRef);
      return;
    }
    tx.set(docRef, {
      cleanups,
      pickups: pickupsTotal,
      bags_raw: bagsRaw,
      bags: Math.round(bagsRaw),
      seconds_raw: secondsRaw,
      hours: round1(secondsRaw / 3600),
      last_cleanup: lastCleanup,
      updated_at: Date.now(),
    });
  });
}

/** Called from onCleanupWrite for every cleanup write. Checks the (small,
 *  cached) list of sponsor teams and applies a delta to each whose district
 *  the before-state and/or after-state cleanup falls inside. */
async function applyOrgDeltaForCleanup(before, after) {
  const teams = await areaScopedTeams();
  if (teams.length === 0) return;
  const ops = [];
  for (const team of teams) {
    if (before && cleanupInArea(before, team.area)) ops.push(applyOrgDeltaFor(team, before, -1));
    if (after && cleanupInArea(after, team.area)) ops.push(applyOrgDeltaFor(team, after, +1));
  }
  await Promise.all(ops);
}

/**
 * Snapshot every sponsor team's district totals, timestamped, for the
 * dashboard's time-series view. Periodic snapshots (not read-time
 * aggregation) per the spec's resolved decision on §3.3.
 *
 * Deliberately still a full `cleanups` scan (unlike orgDashboard reads, which
 * now serve from the org_stats rollup) — this doubles as the weekly
 * correctness backstop for org_stats: applyOrgDeltaForCleanup's incremental
 * path skips the (rare, expensive) last_cleanup re-derivation on removal, so
 * this full recompute overwrites org_stats with ground truth every run,
 * bounding any drift on that field to at most a week. Cost-wise this is fine
 * to keep exact: it's one scan a week (not per write, not per pageview), and
 * sponsor-team count — the other dimension it fans out over — is small and
 * grows slowly (a human-driven signup flow), unlike cleanup or pageview
 * volume.
 */
async function buildOrgSnapshots() {
  const [teams, cleanupsSnap] = await Promise.all([areaScopedTeams(), db.collection('cleanups').get()]);
  const now = Date.now();
  await Promise.all(
    teams.map(async (team) => {
      const stats = districtStatsFromSnapshot(team.area, cleanupsSnap);
      await db.collection('team_snapshots').doc(team.id).collection('history').add({ timestamp: now, ...stats });
      // Self-heal: overwrite org_stats with this week's ground truth so any
      // drift accumulated by the incremental path never lasts more than a
      // week (see applyOrgDeltaFor's last_cleanup comment).
      await db.collection('org_stats').doc(team.id).set({
        cleanups: stats.cleanups,
        pickups: stats.pickups,
        bags_raw: stats.bags,
        bags: stats.bags,
        seconds_raw: stats.hours * 3600,
        hours: stats.hours,
        last_cleanup: stats.last_cleanup,
        updated_at: now,
      });
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
 *
 * Reads the org_stats rollup instead of scanning `cleanups` live — this
 * endpoint is hit on every pageview (unauthenticated, so traffic isn't even
 * bounded by signed-in user count), so a full collection scan per request was
 * the worst offender the cost review flagged: cost scaling with all-time
 * cleanup volume AND multiplying with sponsor-driven pageviews. org_stats is
 * kept current by applyOrgDeltaForCleanup (incremental, per cleanup write)
 * and self-healed weekly by buildOrgSnapshots (full recompute) — see those
 * for the correctness story. Falls back to a live scan only if org_stats is
 * somehow missing (shouldn't happen: createSponsorTeam seeds it at team
 * creation) so a broken rollup degrades to "slow" rather than "wrong."
 */
exports.orgDashboard = onRequest(async (req, res) => {
  // Public, token-gated JSON hit via client-side fetch() from pickglobal.org —
  // the only onRequest export in this file actually called from a browser, so
  // it's the only one that needs CORS. Missing this header silently broke
  // every real dashboard load (blocked before the response body was ever
  // read), caught 2026-09-03 testing the first real sponsor team end-to-end.
  res.set('Access-Control-Allow-Origin', '*');
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

    const rollupSnap = await db.collection('org_stats').doc(teamId).get();
    let stats;
    if (rollupSnap.exists) {
      const r = rollupSnap.data();
      stats = {
        cleanups: num(r.cleanups),
        pickups: num(r.pickups),
        bags: num(r.bags),
        hours: num(r.hours),
        last_cleanup: num(r.last_cleanup),
      };
    } else {
      // Cold-start fallback (rollup missing — shouldn't happen post-deploy,
      // see doc comment above). Also repairs it for next time.
      console.warn(`orgDashboard: org_stats/${teamId} missing, falling back to a live scan`);
      const cleanupsSnap = await db.collection('cleanups').get();
      stats = districtStatsFromSnapshot(team.area, cleanupsSnap);
      await db.collection('org_stats').doc(teamId).set({
        cleanups: stats.cleanups,
        pickups: stats.pickups,
        bags_raw: stats.bags,
        bags: stats.bags,
        seconds_raw: stats.hours * 3600,
        hours: stats.hours,
        last_cleanup: stats.last_cleanup,
        updated_at: Date.now(),
      });
    }

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
// OVERPASS PRE-CACHE — server-side pre-fetch of street geometry + admin
// boundary polygons for popular areas, so a user's first map load there
// reads a Firestore doc instead of making a live Overpass call. See
// docs/OVERPASS_PRECACHE_SPEC.md — this implements the six decisions
// recorded in its §5 (seed list, weekly cadence, the street-geometry growth
// signal, the 14-day staleness ceiling, the shared fetch/hedge modules, and
// building now rather than waiting on unrelated blockers).
//
// Client-side cache-first reads live in src/services/streetSegments.ts
// (precache_streets/{gridKey}) and src/services/neighborhoods.ts
// (precache_boundaries/{cellKey}) — both fail OPEN to today's exact live-
// Overpass path on any miss or read error (spec §3). This job only ever
// WRITES those two collections; it never reads them.
// ==========================================================================

const PRECACHE_STREETS_COLLECTION = 'precache_streets';
const PRECACHE_BOUNDARIES_COLLECTION = 'precache_boundaries';

// Decision 1 (spec §5): Fort Greene + Sunset Park, Brooklyn — the only
// neighborhoods with any tester field-data on record (LEDGER_INBOX.md,
// 2026-09-02). Checked before picking this: docs/fielddata/*.csv have NO
// lat/lon columns (motion-classifier logs only — peak/dur/gyro/conf/
// accepted/counted/reason/speed), so they can't further confirm or refine
// this list. That's the ceiling of available evidence, not a gap left
// uninvestigated. These are approximate public-knowledge neighborhood
// centroids (not pulled from the CSVs, which don't have coordinates at
// all); Sunset Park is long and narrow along the Brooklyn waterfront, so it
// gets two seed points (north/south) instead of one.
// Kensington and Downtown Brooklyn added 2026-09-03: not from field-data (same
// ceiling as the original three — docs/fielddata/*.csv still has no lat/lon),
// but from firsthand evidence stronger than prose — Jake tested both live
// during this session specifically because they were NOT cached, and both
// took the ~20-24s live-Overpass path. Real demonstrated interest in exactly
// this list, not a guess.
// Broadened again same day (2026-09-03), Jake's explicit direction: rather
// than keep growing this one neighborhood at a time as he happens to test
// somewhere new (which is what just happened with Williamsburg and Prospect
// Park — both live-tested this session, both genuine misses, confirmed via
// direct Firestore lookups before adding them here), seed the contiguous
// north/central "brownstone Brooklyn" area he's actually walking in: Park
// Slope, Prospect Heights, and Clinton Hill fill the geographic gaps between
// the points already seeded (Fort Greene, Kensington, Downtown Brooklyn) so
// the combined footprint reads as one covered area rather than a scatter of
// disconnected points. Approximate public-knowledge centroids, same caveat
// as above — no coordinate data exists to refine these further.
const STREET_SEED_POINTS = [
  { label: 'Fort Greene, Brooklyn', lat: 40.6896, lon: -73.9745 },
  { label: 'Sunset Park (north), Brooklyn', lat: 40.658, lon: -74.005 },
  { label: 'Sunset Park (south), Brooklyn', lat: 40.639, lon: -74.014 },
  { label: 'Kensington, Brooklyn', lat: 40.6415, lon: -73.9743 },
  { label: 'Downtown Brooklyn', lat: 40.6926, lon: -73.9857 },
  { label: 'Williamsburg, Brooklyn', lat: 40.7081, lon: -73.9571 },
  { label: 'Prospect Park, Brooklyn', lat: 40.6602, lon: -73.969 },
  { label: 'Park Slope, Brooklyn', lat: 40.671, lon: -73.9814 },
  { label: 'Prospect Heights, Brooklyn', lat: 40.6772, lon: -73.9675 },
  { label: 'Clinton Hill, Brooklyn', lat: 40.6896, lon: -73.9646 },
];
// 3x3 block of 0.01° gridKey cells (~1km) per seed point — a small, bounded
// per-neighborhood footprint (tens of tiles total across the whole seed
// list), not an attempt to cover a neighborhood's full extent in one shot.
const SEED_GRID_RADIUS_CELLS = 1;

/** The (2*radius+1)^2 block of 0.01° gridKey cells around a point — mirrors
 *  the shape of src/services/streetSegments.ts's private gridNeighborhood()
 *  (radius 1 there), generalized to a configurable radius. Returns a Map so
 *  a repeated key (seed points whose blocks overlap) only fetches once. */
function gridKeysAround(lat, lon, radiusCells) {
  const cells = new Map(); // gridKey -> representative {lat, lon} to fetch from
  for (let dLat = -radiusCells; dLat <= radiusCells; dLat++) {
    for (let dLon = -radiusCells; dLon <= radiusCells; dLon++) {
      const cLat = lat + dLat * 0.01;
      const cLon = lon + dLon * 0.01;
      cells.set(gridKey(cLat, cLon), { lat: cLat, lon: cLon });
    }
  }
  return cells;
}

// ==========================================================================
// NYC-WIDE EXPANSION (staged 2026-09-05, NOT deployed) — Jake hit real
// slowness on the Upper East Side, expected since STREET_SEED_POINTS above
// is a hand-picked Brooklyn-only list of 10 points. This section replaces
// "hand-add a neighborhood every time someone hits a cold tile" with
// deriving tiles from the SAME curated GeoJSON src/services/neighborhoods.ts's
// `nyc` CITY_SOURCES entry already uses — 312 real neighborhood polygons,
// confirmed live via a direct fetch 2026-09-05 (not assumed from the "~310"
// figure in prior docs).
//
// IMPORTANT correction made while grounding this, not assumed up front:
// the FIRST version of this derived one gridKey tile per neighborhood
// CENTROID (a fixed radius block around one point). That would have been
// wrong. `src/services/streetSegments.ts` grew a SECOND precache consumer
// on 2026-09-04 — `getPrecachedSegmentsForRing()`, which is what the actual
// "tap a neighborhood, see its full coverage" flow (`activateHood()` →
// `getSegmentsForRing()`) calls, and it requires EVERY 0.01° grid cell
// covering that neighborhood's real bounding box (`gridCellsForRingBbox()`)
// to already be a precache hit, or the whole ring falls through to a live
// ~20s Overpass fetch — a single centroid tile, or even a fixed 3x3 block,
// would satisfy that for almost no real (non-square, non-tiny) neighborhood.
// This section instead computes each neighborhood's REAL bbox-covering cell
// set, mirroring gridCellsForRingBbox() exactly (see that duplication note
// below) — the only shape that actually produces a full ring-cache hit for
// the exact feature Jake described being slow.
//
// Real numbers, measured against the live GeoJSON (2026-09-05): 312
// neighborhoods need 4-63 cells each (median 12, mean ~14) to cover their
// real bbox. 291 of 312 (93%) fall at or under
// streetSegments.ts's own `MAX_RING_PRECACHE_CELLS = 25` — the ring path can
// structurally never hit-cache the other 21 (Flushing, JFK, Jamaica, Long
// Island City, Canarsie, Bayside, East New York and 15 more — real
// neighborhoods, not just parks/airports, so a genuine coverage gap, not an
// edge case) no matter what's precached for them, because that 25-cell cap
// is a client constant this task didn't touch. They're still included below
// (92 of the 1,225 total tiles) since they still help the point-radius
// pan/route-crediting path even without the ring-activation win. Merged with
// the existing 55-tile Brooklyn list: **1,225 unique tiles, 2,450 Overpass
// calls** (sidewalk+road fired concurrently per tile) for full coverage —
// about 22x the 55-tile/110-call run that ALREADY produced real 429s and
// aborted requests on 2026-09-03 (LEDGER_INBOX.md). That's why the refresh
// mechanism itself changes below (a persisted roster + a small batch
// drained every few hours) instead of just growing the input list and
// reusing the old synchronous refreshOverpassPrecache(). Full reasoning and
// the rollout-timeline/cost math are in
// `~/Desktop/pick-app/docs/LEDGER_INBOX.md`'s 2026-09-05 entry — read that
// before approving a deploy, not just this comment.
// ==========================================================================

// Same GeoJSON source src/services/neighborhoods.ts's `nyc` CITY_SOURCES
// entry uses — duplicated as a plain URL string rather than imported,
// because that file's CITY_SOURCES array calls `FileSystem.documentDirectory`
// (an Expo/RN-only API) at module-load time, so requiring the whole module
// from the Node Cloud Functions runtime would throw. If that URL ever
// changes in neighborhoods.ts, this constant needs a manual re-sync — a
// real drift risk, flagged here rather than hidden.
const NYC_HOODS_GEOJSON_URL =
  'https://raw.githubusercontent.com/HodgesWardElliott/custom-nyc-neighborhoods/master/custom-pedia-cities-nyc-Mar2018.geojson';

// 0.01° grid step — matches gridKey()'s own cell size. Named here (rather
// than a bare literal) because gridCellsForRingBbox below needs it twice.
const NEIGHBORHOOD_GRID_DEG = 0.01;

// NOTE (reference only, not enforced as a skip here): the client's own
// MAX_RING_PRECACHE_CELLS (src/services/streetSegments.ts) is 25 — see the
// design-decision comment above for why the ~21 NYC neighborhoods over that
// size are still included in the roster below despite the ring path never
// being able to use them for those. If that client constant ever changes,
// the "291 of 312" figure in the comment above drifts from real behavior.

/** Every 0.01° gridKey cell whose cell rectangle overlaps a ring's bounding
 *  box. MUST exactly mirror src/services/streetSegments.ts's
 *  gridCellsForRingBbox() — that function's all-or-nothing precache check
 *  is what actually decides whether a real neighborhood activation gets a
 *  cache hit, so this has to produce the identical key set for the same
 *  ring or precaching the "wrong" cells would satisfy nothing. Duplicated
 *  rather than imported for the same FileSystem/RN-only-module reason as
 *  NYC_HOODS_GEOJSON_URL above. Takes [lat, lon] pairs (GeoJSON itself is
 *  [lon, lat] — callers must convert first, same as the client does). */
function gridCellsForRingBbox(ring) {
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const [la, lo] of ring) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  if (minLat > maxLat || minLon > maxLon) return [];
  const latSteps = Math.floor((maxLat - minLat) / NEIGHBORHOOD_GRID_DEG) + 1;
  const lonSteps = Math.floor((maxLon - minLon) / NEIGHBORHOOD_GRID_DEG) + 1;
  const keys = new Set();
  for (let i = 0; i <= latSteps; i++) {
    for (let j = 0; j <= lonSteps; j++) {
      keys.add(gridKey(minLat + i * NEIGHBORHOOD_GRID_DEG, minLon + j * NEIGHBORHOOD_GRID_DEG));
    }
  }
  return [...keys];
}

/** Every gridKey cell covering every real NYC neighborhood's actual
 *  bounding box, fetched live from the exact GeoJSON
 *  src/services/neighborhoods.ts already downloads client-side (312
 *  features confirmed live 2026-09-05) — not a hand-maintained list, so
 *  Staten Island/Queens/the Bronx/Manhattan are covered the same way
 *  Brooklyn already is, without anyone hand-adding points city by city.
 *  Uses the LARGEST ring per feature (mirrors neighborhoods.ts's
 *  geojsonToRing(), the same "pick one ring" convention that actually feeds
 *  getSegmentsForRing() at real activation time — matching it here means
 *  this generates exactly the cell set that path will check, not an
 *  approximation of it). Makes NO Overpass calls itself; it only reads a
 *  public GitHub-hosted file to compute cell keys. Fails open (returns an
 *  empty Map) on any fetch/parse error, so a bad week here just means "no
 *  new neighborhood tiles added this cycle," not a crashed roster rebuild. */
async function deriveNycNeighborhoodTiles() {
  const tiles = new Map(); // gridKey -> { lat, lon, label }
  try {
    const res = await fetch(NYC_HOODS_GEOJSON_URL);
    if (!res.ok) {
      console.warn(`precache: NYC hoods GeoJSON fetch failed (${res.status})`);
      return tiles;
    }
    const fc = await res.json();
    const features = (fc && fc.features) || [];
    for (const f of features) {
      const geometry = f && f.geometry;
      if (!geometry) continue;
      let rings;
      if (geometry.type === 'Polygon') rings = [geometry.coordinates[0]];
      else if (geometry.type === 'MultiPolygon') rings = geometry.coordinates.map((p) => p[0]);
      else continue;
      let best = null;
      for (const r of rings) {
        if (Array.isArray(r) && (!best || r.length > best.length)) best = r;
      }
      if (!best || best.length < 3) continue;
      const ringLatLon = best.map(([lon, lat]) => [lat, lon]);
      const props = (f && f.properties) || {};
      const label = props.neighborhood || props.name || props.ntaname || props.NTAName || undefined;
      for (const key of gridCellsForRingBbox(ringLatLon)) {
        if (tiles.has(key)) continue;
        // Representative fetch point = THIS CELL's own center, not the
        // neighborhood's centroid — refreshStreetTile fetches a 600m radius
        // around whatever point it's given, so a cell far from the
        // neighborhood's centroid still needs its own nearby fetch point,
        // or that cell's stored geometry would actually describe a
        // different (wrong) 600m circle. gridKey()'s format is the cell's
        // floored SW corner, so splitting it back out and adding half a
        // grid step gives the cell's center.
        const [cLat, cLon] = key.split('_').map(Number);
        tiles.set(key, { lat: cLat + NEIGHBORHOOD_GRID_DEG / 2, lon: cLon + NEIGHBORHOOD_GRID_DEG / 2, label });
      }
    }
  } catch (e) {
    console.warn(`precache: deriveNycNeighborhoodTiles failed: ${(e && e.message) || e}`);
  }
  return tiles;
}

// Decision 3 (spec §5), hybrid (a)+(c): grow the street-geometry list past
// the static seed once real `cleanups` documents cluster in a tile — real
// usage, no new instrumentation, no unconditional whole-city caching
// (option (b) was explicitly rejected: that reintroduces the unbounded-scan
// cost pattern the 2026-09-01 Firestore fix eliminated). Threshold: 3+
// cleanups in the same gridKey tile within a rolling 30-day window.
const CLEANUP_PROMOTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_PROMOTION_THRESHOLD = 3;

/** Tiles to add to the street-geometry cache because real cleanups
 *  clustered there recently. Reads the same `cleanups` collection
 *  scheduledPublicStats already scans on its own schedule — a second
 *  consumer of an existing weekly-cadence read, not a new standing cost. */
async function promotedStreetTilesFromCleanups() {
  const since = Date.now() - CLEANUP_PROMOTION_WINDOW_MS;
  const snap = await db.collection('cleanups').get();
  const counts = new Map(); // gridKey -> { count, lat, lon }
  snap.forEach((doc) => {
    const d = doc.data();
    const ms = toMillis(d.timestamp);
    if (ms < since) return;
    const lat = d.location_lat;
    const lon = d.location_lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = gridKey(lat, lon);
    const c = counts.get(key) || { count: 0, lat, lon };
    c.count++;
    counts.set(key, c);
  });
  const promoted = new Map();
  for (const [key, c] of counts) {
    if (c.count >= CLEANUP_PROMOTION_THRESHOLD) promoted.set(key, { lat: c.lat, lon: c.lon });
  }
  return promoted;
}

// Boundary-cache growth: reuse city_requests, don't invent a second signal
// (spec §1 — additive to the requestCity/city_requests feature that shipped
// 2026-08-31). Any city crossing this request-count threshold gets its
// boundary cell added to the refresh list. `count` on a city_requests doc is
// already a unique-requester count (requestCity's transaction dedups via
// the requesters/{uid} marker subcollection before incrementing), so this
// reads directly off it rather than re-deriving uniqueness. Threshold
// mirrors the spec's own "3-5 unique requesters, tunable" language. Note:
// city_requests is empty at the time this shipped (spec §1) — this makes
// the mechanism real, not a guarantee there's anything to promote yet.
const CITY_REQUEST_PROMOTION_THRESHOLD = 3;

/** Forward-geocode a city name to a representative point via Nominatim —
 *  same client convention (User-Agent, endpoint) already used by the app's
 *  own osmBoundaryByName()/osmNeighborhood() in neighborhoods.ts. */
async function geocodeCityCentroid(city) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=jsonv2&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PICK-cleanup-app/1.0 (precache refresh)', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = arr && arr[0];
    if (!hit) return null;
    const lat = parseFloat(hit.lat);
    const lon = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch (e) {
    console.warn(`precache: geocode failed for city "${city}": ${(e && e.message) || e}`);
    return null;
  }
}

/** Boundary cells to precache because real users asked for that city via
 *  the existing "prioritize my city" flow. One Nominatim lookup per
 *  qualifying city (a handful at most, weekly) — well within usage-policy
 *  norms for a job at this cadence. */
async function promotedBoundaryCellsFromCityRequests() {
  const snap = await db.collection('city_requests').get();
  const cells = new Map(); // cellKey -> { lat, lon, city }
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (num(d.count) < CITY_REQUEST_PROMOTION_THRESHOLD) continue;
    const city = d.city || doc.id;
    const point = await geocodeCityCentroid(city);
    if (!point) continue;
    const key = osmCellKey(point.lat, point.lon);
    cells.set(key, { lat: point.lat, lon: point.lon, city });
  }
  return cells;
}

// Firestore rejects nested arrays (an array whose elements are themselves
// arrays) — confirmed live 2026-09-03 when the first real refresh run threw
// "Property array contains an invalid nested entity" on every street tile.
// StreetSegment.coords and OsmBoundaryFeature.ring are both [number,number][],
// which is exactly that shape once embedded in the segments/features array.
// Flatten to [lat,lon,lat,lon,...] for storage, same convention already used
// by src/services/challenges.ts's flattenRing/unflattenRing for ring storage.
function flattenCoordPairs(pairs) {
  const out = [];
  for (const p of pairs || []) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    out.push(p[0], p[1]);
  }
  return out;
}

/** One street-geometry tile: fetch + chop via the exact client pipeline,
 *  write the resulting StreetSegment[] + refreshedAt (coords flattened for
 *  Firestore — see flattenCoordPairs). */
async function refreshStreetTile(key, lat, lon) {
  // enforceCooldown: true — this is the automated background job the OSM
  // wiki's 429/406 "pause 30s" fair-use text targets, unlike the live
  // client's own fetchStreetGeometry() calls (see overpassClient.js's
  // enforceCooldown doc comment; 2026-09-05 reconciliation).
  const segments = await fetchStreetGeometry(lat, lon, { enforceCooldown: true });
  const stored = segments.map((s) => ({ ...s, coords: flattenCoordPairs(s.coords) }));
  await db.collection(PRECACHE_STREETS_COLLECTION).doc(key).set({
    segments: stored,
    refreshedAt: Date.now(),
    seedLat: lat,
    seedLon: lon,
  });
  return segments.length;
}

/** One ~20km boundary cell: fetch + stitch via the exact client pipeline,
 *  write the resulting OsmBoundaryFeature[] + refreshedAt (ring flattened for
 *  Firestore — see flattenCoordPairs). */
async function refreshBoundaryCell(key, lat, lon, cityLabel) {
  const cellLat0 = Math.floor(lat / OSM_CELL_DEG) * OSM_CELL_DEG;
  const cellLon0 = Math.floor(lon / OSM_CELL_DEG) * OSM_CELL_DEG;
  // enforceCooldown: true — same reasoning as refreshStreetTile above.
  const features = await fetchOsmBoundariesInBox(
    cellLat0, cellLon0, cellLat0 + OSM_CELL_DEG, cellLon0 + OSM_CELL_DEG, { enforceCooldown: true }
  );
  const stored = features.map((f) => ({ ...f, ring: flattenCoordPairs(f.ring) }));
  await db.collection(PRECACHE_BOUNDARIES_COLLECTION).doc(key).set({
    features: stored,
    refreshedAt: Date.now(),
    seedLat: lat,
    seedLon: lon,
    ...(cityLabel ? { cityLabel } : {}),
  });
  return features.length;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cooldown before the retry pass — confirmed live 2026-09-03 that a tile
// failing mid-run (429/aborted mirror request under real load) often
// succeeds on a later attempt once the burst of prior calls has had a
// moment to clear; a fixed pause is simpler than parsing Overpass's
// Retry-After and good enough at this call volume (tens of tiles/week).
const RETRY_COOLDOWN_MS = 15000;

// Both precache functions need a much longer timeout than the 60s default —
// confirmed live 2026-09-03: the default cut the manual trigger off after
// only 3 of the seed list's ~9+ street tiles wrote successfully (Sunset
// Park's tiles never ran), because the old refreshOverpassPrecache() did two
// full collection scans (cleanups, city_requests) up front, then fetched
// each tile sequentially against Overpass mirrors that are still measurably
// unstable (429s and aborted requests observed in the same run — see
// LEDGER_INBOX.md). 1800s (30 min) gives real headroom; kept for both the
// (now much cheaper) weekly roster-rebuild function and the drip batches
// below, since a generous ceiling on a low-frequency background job with no
// user waiting on it costs nothing.
const PRECACHE_TIMEOUT_SECONDS = 1800;

// Persisted street-tile roster: precache_meta/nyc_street_roster holds the
// full deduped tile list (Brooklyn hand-picks + all 312 NYC neighborhoods +
// cleanup-promoted tiles) plus a rolling `cursor`. No Firestore rules entry
// needed — this collection has no client reader, and the default-deny
// catch-all at the bottom of firestore.rules already blocks it; only the
// Admin SDK (this file) ever touches it.
const PRECACHE_ROSTER_DOC = db.collection('precache_meta').doc('nyc_street_roster');

// RECONCILED 2026-09-05 (follow-up pass, same day as the design above)
// against the OSM wiki's actual published Overpass fair-use text — the
// previous value (15 tiles/batch) was picked from a single field
// observation (110 calls in one run produced real 429s), not checked
// against any real documented policy. The real text draws TWO tiers:
//   - general/shared-instance guidance: "less than 10,000 queries per day
//     and less than 1GB/day" — 15 tiles/batch x 2 calls/tile x 6 runs/day
//     (every 4 hours) = 180 calls/day comfortably clears this (1.8% of the
//     query ceiling; response payloads here are tens of KB, nowhere near
//     the 1GB/day data ceiling either).
//   - STRICTER guidance the wiki specifically scopes to "regular
//     applications": "less than 100 queries ... fetching less than 10MB of
//     data per day." This drip job — a shipped app's unattended, recurring,
//     indefinite background sync — is exactly what "regular application"
//     describes, not the occasional/interactive shared-instance case the
//     looser 10k/day number is really aimed at. 180/day clears the general
//     ceiling but MISSES the tier that actually applies to us.
// Brought down to 8 tiles/batch = 16 calls/run x 6 runs/day = 96 calls/day
// — under the 100/day bar with a small margin, at the same every-4-hours
// cadence (kept rather than changed, since batch size was already the
// documented pacing lever — see runPrecacheDripBatch's comment). Real cost:
// full-roster coverage (1,225 tiles) goes from ~82 runs/~13.6 days to
// ceil(1,225/8)=154 runs / 6 runs/day ≈ 25.7 days (~26 days) — for both
// first rollout and the ongoing refresh cycle (PRECACHE_STALENESS_MS bumped
// again below to match).
//
// Two things flagged for Jake rather than resolved silently:
//   1. `refreshBoundariesOnce` (weekly, unchanged, "a handful of cells at
//      most") also spends Overpass calls through this same shared client,
//      on top of the drip's 96/day, on whichever one day/week it runs — a
//      single-digit call count added to that one day only. It could push
//      that specific day slightly over 100 (e.g. 96+9=105). Judged
//      acceptable: it's guidance from a wiki, not an enforced hard cap,
//      the mechanism is small, pre-existing, and unchanged by this pass —
//      not re-architected here. A more conservative 7 tiles/batch (84
//      calls/day, ~29.2 days full coverage) would clear 100/day even
//      including that spillover, if Jake would rather have the bigger
//      margin than the faster cycle.
//   2. This is a genuine speed/compliance tradeoff, not a free win — nearly
//      DOUBLING the full-coverage timeline (13.6 -> 25.7 days) to fit
//      guidance explicitly scoped to apps like this one, rather than
//      leaning on the general ceiling this app also technically clears.
//      The rate-limit backoff fix (overpassClient.js's `enforceCooldown`,
//      also 2026-09-05) is a separate, independent improvement — it closes
//      a real gap in the ALREADY-DEPLOYED 429/406 handling (no pause
//      before failover/next call existed at all), not a substitute for
//      picking a compliant batch size.
const PRECACHE_DRIP_BATCH_SIZE = 8;

/** Street-tile roster: append-only on rebuild. A brand-new tile is added at
 *  the END of the existing order, never by re-sorting the whole list, so a
 *  weekly rebuild never shifts an already-scheduled tile's position — the
 *  cursor's "position N" has to mean the same tile across rebuilds, or the
 *  even-coverage design this enables silently breaks (a sort-by-key rebuild
 *  would scramble which tiles are "next" every Monday). Makes NO Overpass
 *  calls itself: it only merges tile lists computed elsewhere
 *  (STREET_SEED_POINTS, deriveNycNeighborhoodTiles, cleanup-promoted).
 *
 *  The candidate tiles are computed OUTSIDE a transaction (real network
 *  calls — a GeoJSON fetch, a `cleanups` scan — have no place inside one),
 *  then merged into the roster INSIDE a short transaction that only reads
 *  and writes precache_meta/nyc_street_roster. That matters because this
 *  function can take several seconds (the GeoJSON fetch alone), and
 *  scheduledOverpassPrecacheDrip can tick concurrently and advance
 *  `cursor` mid-run — reading `cursor` once up front and writing it back
 *  unchanged later would silently clobber the drip's progress. The
 *  transaction re-reads the roster at write time and Firestore retries it
 *  automatically if the doc changed since the read, so the cursor a
 *  concurrent drip run wrote is preserved either way. */
async function rebuildStreetTileRoster() {
  const candidates = new Map(); // key -> { lat, lon, label }
  const addAll = (entries) => {
    for (const [key, point] of entries) {
      if (!candidates.has(key)) candidates.set(key, point);
    }
  };

  // Original hand-picked Brooklyn list (unchanged, radius 1 — see STREET_SEED_POINTS).
  const brooklynTiles = new Map();
  for (const seed of STREET_SEED_POINTS) {
    for (const [key, point] of gridKeysAround(seed.lat, seed.lon, SEED_GRID_RADIUS_CELLS)) {
      brooklynTiles.set(key, { ...point, label: seed.label });
    }
  }
  addAll(brooklynTiles);

  // All 312 real NYC neighborhoods, derived live — this task's actual ask.
  addAll(await deriveNycNeighborhoodTiles());

  // Real-usage growth signal, unchanged from the 2026-09-03 design (decision 3, spec §5).
  addAll(await promotedStreetTilesFromCleanups());

  let added = 0;
  let total = 0;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(PRECACHE_ROSTER_DOC);
    const existing = snap.exists ? snap.data() : null;
    const tiles = Array.isArray(existing && existing.tiles) ? existing.tiles.slice() : [];
    const seen = new Set(tiles.map((t) => t.key));
    added = 0;
    for (const [key, point] of candidates) {
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ key, lat: point.lat, lon: point.lon, ...(point.label ? { label: point.label } : {}) });
      added++;
    }
    const cursor = existing && Number.isFinite(existing.cursor) ? existing.cursor : 0;
    total = tiles.length;
    tx.set(PRECACHE_ROSTER_DOC, { tiles, cursor, updatedAt: Date.now() });
  });

  const summary = { total, added, generatedAt: Date.now() };
  await db.collection('precache_status').doc('roster').set(summary);
  console.log(`precache: roster rebuilt — ${total} total tiles (${added} new this run)`);
  return summary;
}

/** Refresh a small, fixed-size batch of the roster per run instead of the
 *  whole thing at once — the actual throttling mechanism this section
 *  exists to add. Runs every 4 hours (scheduledOverpassPrecacheDrip below),
 *  reusing scheduledPublicStats's existing cadence rather than inventing a
 *  new one. The cursor wraps: once it reaches the end of the roster it
 *  starts back at 0, so this doubles as the ongoing "keep tiles fresh"
 *  refresh once the initial rollout finishes — at PRECACHE_DRIP_BATCH_SIZE
 *  8 (RECONCILED 2026-09-05 against the OSM wiki's real fair-use text — see
 *  that constant's own comment for the 100-calls/day "regular application"
 *  reasoning; was 15 in the first design pass) and the current merged
 *  roster (1,225 tiles total, measured 2026-09-05 — the 312 real
 *  neighborhoods' bbox cells alone are already 1,225; the existing 55-tile
 *  Brooklyn hand-pick turns out to be a strict subset of that, contributing
 *  0 net-new tiles, since it sits entirely inside real Brooklyn
 *  neighborhoods the new derivation already covers — see the
 *  design-decision comment above), that's ceil(1225/8)=154 runs, ~25.7
 *  days, for one full cycle — both the first full rollout AND every refresh
 *  after that. streetSegments.ts's PRECACHE_STALENESS_MS was bumped again
 *  to match (2x this cycle time, same ratio the original value used) — see
 *  that file's own comment. A failure
 *  on one tile never blocks the rest of its batch or advancing the cursor —
 *  a permanently-failing tile (e.g. one that's mostly open water) would
 *  otherwise stall the whole roster behind it forever. */
async function runPrecacheDripBatch() {
  const snap = await PRECACHE_ROSTER_DOC.get();
  const roster = snap.exists ? snap.data() : null;
  const tiles = Array.isArray(roster && roster.tiles) ? roster.tiles : [];
  if (!tiles.length) {
    console.log('precache: drip run skipped — roster is empty (rebuild has not run yet?)');
    return { attempted: 0, ok: 0, failed: 0, rosterSize: 0 };
  }

  const rawCursor = Number.isFinite(roster.cursor) ? roster.cursor : 0;
  const cursor = ((rawCursor % tiles.length) + tiles.length) % tiles.length;
  const batchSize = Math.min(PRECACHE_DRIP_BATCH_SIZE, tiles.length);
  const batch = [];
  for (let i = 0; i < batchSize; i++) batch.push(tiles[(cursor + i) % tiles.length]);

  async function attemptBatch(entries) {
    const failed = [];
    for (const t of entries) {
      try {
        await refreshStreetTile(t.key, t.lat, t.lon);
      } catch (e) {
        failed.push(t);
        console.warn(`precache: drip tile ${t.key} failed: ${(e && e.message) || e}`);
      }
    }
    return failed;
  }

  let failed = await attemptBatch(batch);
  if (failed.length) {
    // Same cooldown-then-retry convention as the boundary refresh below —
    // confirmed live 2026-09-03 that a tile failing mid-run often succeeds
    // on a later attempt once the burst of prior calls has had a moment to
    // clear.
    await sleep(RETRY_COOLDOWN_MS);
    failed = await attemptBatch(failed);
  }

  // Advance the cursor inside a transaction, re-reading the roster's
  // current length at write time rather than trusting the `tiles.length`
  // read at the top of this function — a concurrent weekly rebuild could
  // have appended tiles mid-batch, and computing `% tiles.length` against a
  // stale length could land the cursor on a since-shifted index. Firestore
  // retries this transaction automatically if the doc changed since the
  // read (the same guarantee rebuildStreetTileRoster's transaction relies
  // on), so this and a concurrent rebuild can't silently clobber each
  // other's write.
  let nextCursor = cursor;
  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(PRECACHE_ROSTER_DOC);
    const freshData = freshSnap.exists ? freshSnap.data() : null;
    const freshLen = Array.isArray(freshData && freshData.tiles) ? freshData.tiles.length : tiles.length;
    nextCursor = freshLen ? (cursor + batch.length) % freshLen : 0;
    tx.update(PRECACHE_ROSTER_DOC, { cursor: nextCursor });
  });

  const result = {
    attempted: batch.length,
    ok: batch.length - failed.length,
    failed: failed.length,
    failedKeys: failed.map((t) => t.key),
    rosterSize: tiles.length,
    cursorBefore: cursor,
    cursorAfter: nextCursor,
    generatedAt: Date.now(),
  };
  await db.collection('precache_status').doc('drip').set(result);
  console.log(
    `precache drip: refreshed ${result.ok}/${result.attempted} tiles ` +
    `(roster ${tiles.length}, cursor ${cursor} -> ${nextCursor})`
  );
  return result;
}

/** Boundary-cell refresh — unchanged in behavior from the 2026-09-03
 *  design, kept synchronous on the weekly cadence. NOT part of what this
 *  section scales: city_requests-driven boundary cells are a handful at
 *  most (order of single digits), nothing like the 312 NYC neighborhoods,
 *  so the burst risk that motivated the roster/drip split above doesn't
 *  apply here. */
async function refreshBoundariesOnce() {
  const boundaryCells = await promotedBoundaryCellsFromCityRequests();
  const results = { attempted: boundaryCells.size, ok: 0, failed: 0, failedKeys: [] };

  async function runBoundaryPass(entries) {
    const failed = [];
    for (const [key, cell] of entries) {
      try {
        await refreshBoundaryCell(key, cell.lat, cell.lon, cell.city);
        results.ok++;
      } catch (e) {
        failed.push([key, cell]);
        console.warn(`precache: boundary cell ${key} failed: ${(e && e.message) || e}`);
      }
    }
    return failed;
  }

  let failedBoundaries = await runBoundaryPass([...boundaryCells]);
  if (failedBoundaries.length) {
    await sleep(RETRY_COOLDOWN_MS);
    failedBoundaries = await runBoundaryPass(failedBoundaries);
  }
  results.failed = failedBoundaries.length;
  results.failedKeys = failedBoundaries.map(([key]) => key);

  const summary = { generatedAt: Date.now(), ...results };
  await db.collection('precache_status').doc('boundaries').set(summary);
  console.log(`precache: refreshed ${results.ok}/${results.attempted} boundary cells`);
  return summary;
}

/** Weekly — matches the city_requests digest cadence (decision 2, spec §5).
 *  Rebuilds the street-tile roster (no Overpass calls — see
 *  rebuildStreetTileRoster) and refreshes boundary cells (small, unchanged
 *  volume — see refreshBoundariesOnce). The NYC-wide Overpass load itself is
 *  spread across scheduledOverpassPrecacheDrip's 4-hourly batches below, not
 *  done here — this function no longer touches Overpass for streets at all. */
exports.scheduledOverpassPrecacheRefresh = onSchedule(
  { schedule: 'every monday 07:00', timeoutSeconds: PRECACHE_TIMEOUT_SECONDS },
  async () => {
    await rebuildStreetTileRoster();
    await refreshBoundariesOnce();
  }
);

/** Every 4 hours, matching scheduledPublicStats's existing cadence — refreshes
 *  one small, fixed batch off the street-tile roster. This is the actual
 *  pacing mechanism for NYC-wide coverage; see PRECACHE_DRIP_BATCH_SIZE and
 *  the design-decision comment above (and LEDGER_INBOX.md's 2026-09-05
 *  entry) for the full reasoning and cost math. */
exports.scheduledOverpassPrecacheDrip = onSchedule(
  { schedule: 'every 4 hours', timeoutSeconds: PRECACHE_TIMEOUT_SECONDS },
  async () => {
    await runPrecacheDripBatch();
  }
);

// Secret gate for the manual/external trigger, same convention as
// CITY_REQUESTS_DIGEST_KEY/ADOPTION_TRIGGER_KEY above (a hardcoded shared
// secret checked as a query param, following this file's existing pattern
// rather than inventing a differently-shaped one). Change this value if
// it's ever shared.
const PRECACHE_REFRESH_KEY = 'pick-precache-9k3p';

// Default behavior changed 2026-09-05: this used to force the FULL
// synchronous refresh (every seed tile, one HTTP request) — exactly the
// burst pattern the roster/drip split above exists to avoid, and now much
// more dangerous to invoke by habit at NYC-wide scale. It now runs ONE
// bounded drip batch by default, same as a normal scheduled tick. Pass
// ?rebuildRoster=1 to force a roster rebuild (+ boundary refresh) on demand
// instead of waiting for Monday — still no street-side Overpass calls of
// its own, only the boundary refresh's small, pre-existing volume.
exports.runOverpassPrecacheRefresh = onRequest(
  { timeoutSeconds: PRECACHE_TIMEOUT_SECONDS },
  async (req, res) => {
    if (req.query.key !== PRECACHE_REFRESH_KEY) { res.status(403).send('forbidden'); return; }
    try {
      if (req.query.rebuildRoster === '1') {
        const roster = await rebuildStreetTileRoster();
        const boundaries = await refreshBoundariesOnce();
        res.json({ ok: true, roster, boundaries });
        return;
      }
      res.json({ ok: true, drip: await runPrecacheDripBatch() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  }
);

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
