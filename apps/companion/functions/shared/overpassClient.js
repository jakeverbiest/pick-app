/**
 * Overpass mirror hedge/failover client.
 *
 * Extracted 2026-09-03 per docs/OVERPASS_PRECACHE_SPEC.md §5 decision 5.
 * Originally lived only in src/services/streetSegments.ts (client-only);
 * the scheduled pre-cache refresh job (functions/index.js) needs the exact
 * same hedge/mirror-failover behavior — already proven in production — not
 * a second copy that can drift from it.
 *
 * Lives under functions/shared/, not src/shared/ or a repo-root shared/,
 * because `firebase deploy` only packages the directory named in
 * firebase.json's `functions.source` ("functions") — a file has to
 * physically live inside that tree to ship with the deployed function. The
 * CLIENT reaches IN to this file with a relative import from
 * src/services/streetSegments.ts; Metro's project root is apps/companion,
 * so functions/ is inside the same dependency graph and this resolves like
 * any other sibling module. This file has zero dependencies (fetch,
 * AbortController, setTimeout, console only — no firebase-admin, no RN
 * APIs), so it's safe to import from either the RN/Hermes client runtime or
 * the Node 22 Cloud Functions runtime.
 *
 * `preferredOverpass` is process/instance-local, not shared across
 * runtimes: in the client it persists for the app session; in Cloud
 * Functions it persists only for the lifetime of a warm instance. Both are
 * fine — it's a soft optimization (skip straight to the mirror that
 * answered last), never a correctness requirement.
 */

// Multiple public Overpass mirrors — the primary is frequently slow/rate-
// limited, which is the main reason a fresh neighborhood "fails to load on
// start". Try them in order so a single flaky endpoint doesn't leave the
// map (or a precache refresh) empty.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Per-endpoint timeout: without it, one hung mirror stalls the whole load
// indefinitely — the next mirror is usually fine, so fail over fast instead.
const OVERPASS_TIMEOUT_MS = 15000;

// HEDGE instead of pure sequential fallback (field data 2026-08-31, Fort
// Greene cold-cache load: pure sequential fallback cost up to 3 mirrors x
// 15s = 45s for one query). Start with one mirror; if it hasn't answered
// within HEDGE_DELAY_MS, start the NEXT mirror concurrently (without
// killing the first) rather than aborting and restarting from zero. First
// response wins; the rest are aborted.
const HEDGE_DELAY_MS = 6000;

// The primary mirror is dead/rate-limited more often than not, and every
// fresh query was burning a full timeout on it before failing over. Remember
// which mirror answered last and lead with it for the rest of the
// session/instance.
let preferredOverpass = null;

// Real fair-use gap fixed 2026-09-05, found reconciling the NYC precache
// drip design against the OSM wiki's actual Overpass API fair-use text
// (previously only inferred from one incident, not checked against the
// published policy): "On a 429 [Too Many Requests] or 406 [Not Acceptable]
// ... please pause for 30 seconds before making a new request." Before this
// fix, a 429/406 from one mirror just triggered the pre-scheduled hedge
// fallback to the next mirror (or, at the caller level — a batch loop
// moving to its next tile — an immediate brand-new runOverpass() call) with
// NO delay at all. `cooldownUntil` is shared, instance-local state (same
// lifetime semantics as `preferredOverpass` above): set whenever ANY mirror
// returns 429/406, checked by any NEW `runOverpass()` call that opts in via
// `{ enforceCooldown: true }`.
//
// Deliberately opt-in, not global-default: this file is imported by BOTH
// the live client (map loads, ring-precache activation — interactive, human
// paced, already field-tuned via HEDGE_DELAY_MS) and the Cloud Functions
// precache drip (automated, unattended, the thing that actually racks up
// day-long call volume this policy targets). Forcing every client call to
// block up to 30s after any 429 would silently regress already-tuned,
// already-shipped map-load UX as a side effect of a server-side compliance
// fix — out of scope here. Only the Cloud Functions precache paths
// (`refreshStreetTile`, `refreshBoundaryCell` in functions/index.js) opt in.
const RATE_LIMIT_COOLDOWN_MS = 30000;
let cooldownUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run an Overpass QL query against the mirror pool, hedge-failover style.
 *  Shared by the client (street geometry, OSM boundary fallback) and the
 *  Cloud Functions precache refresh job — see the module doc comment.
 *  `opts.enforceCooldown` (default false): if true, and a prior call from
 *  this instance got a 429/406 within the last 30s, wait out the remainder
 *  of that 30s before firing any request at all — see RATE_LIMIT_COOLDOWN_MS
 *  above for why this is opt-in rather than always-on. */
async function runOverpass(query, opts = {}) {
  const { enforceCooldown = false } = opts;
  if (enforceCooldown) {
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleep(wait);
  }

  const endpoints = preferredOverpass
    ? [preferredOverpass, ...OVERPASS_ENDPOINTS.filter((u) => u !== preferredOverpass)]
    : OVERPASS_ENDPOINTS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = endpoints.length;
    let lastErr;
    const hedgeTimers = [];
    const controllers = [];

    const attempt = (url) => {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
      fetch(url, {
        method: 'POST',
        // Overpass mirrors explicitly rate-limit harder without a real
        // User-Agent (confirmed live 2026-08-13 — a 429 response's own body
        // said so directly). Contact reference added 2026-09-05, reconciling
        // against the OSM wiki's fair-use text, which asks for a "meaningful"
        // UA — the original string names the app but had no way for an OSM
        // operator to reach us if they wanted to flag a problem before
        // blocking. Not changed elsewhere (e.g. neighborhoods.ts's Nominatim
        // calls use their own copy of this convention) — out of scope for
        // this Overpass-specific reconciliation pass.
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PICK-cleanup-app/1.0 (+https://pickglobal.org; street + boundary geometry)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            if (res.status === 429 || res.status === 406) {
              // Per OSM wiki fair-use text — see RATE_LIMIT_COOLDOWN_MS above.
              cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            }
            throw new Error(`Overpass error ${res.status}`);
          }
          const json = await res.json();
          if (!settled) {
            settled = true;
            preferredOverpass = url;
            hedgeTimers.forEach(clearTimeout);
            controllers.forEach((c) => c.abort());
            resolve(json);
          }
        })
        .catch((e) => {
          lastErr = e;
          console.warn(`🛣️ Overpass endpoint failed (${url}): ${(e && e.message) || e}`);
          pending--;
          if (!settled && pending === 0) {
            settled = true;
            hedgeTimers.forEach(clearTimeout);
            reject(lastErr || new Error('All Overpass endpoints failed'));
          }
        })
        .finally(() => clearTimeout(timer));
    };

    attempt(endpoints[0]);
    for (let i = 1; i < endpoints.length; i++) {
      hedgeTimers.push(setTimeout(() => attempt(endpoints[i]), HEDGE_DELAY_MS * i));
    }
  });
}

module.exports = {
  runOverpass,
  OVERPASS_ENDPOINTS,
  OVERPASS_TIMEOUT_MS,
  HEDGE_DELAY_MS,
  RATE_LIMIT_COOLDOWN_MS,
};
