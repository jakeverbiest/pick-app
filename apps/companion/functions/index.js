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

const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();

// Owner alerts (new signups, etc.) go here.
const OWNER_EMAIL = 'jlverbie@gmail.com';

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
      html: `<p>Nice — you just adopted <strong>${esc(label)}</strong> on PICK.</p><p>We'll keep an eye on it. If it goes more than ${thresh} days without a cleanup nearby, we'll send you a friendly nudge to swing by and give it a pick.</p><p>Thanks for looking after your streets.</p><p>— PICK</p>`,
    },
  });
  console.log(`📬 Adoption confirmation queued: ${a.email} (${label})`);
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
      html: `<p>A new Picker just joined.</p><ul><li><strong>Name:</strong> ${esc(name || '(none)')}</li><li><strong>Email:</strong> ${esc(email)}</li><li><strong>Neighborhood:</strong> ${esc(data.neighborhood || '(none)')}</li><li><strong>UID:</strong> ${esc(uid)}</li><li><strong>When:</strong> ${when} ET</li></ul>`,
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
