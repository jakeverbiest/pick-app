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

/** Run an Overpass QL query against the mirror pool, hedge-failover style.
 *  Shared by the client (street geometry, OSM boundary fallback) and the
 *  Cloud Functions precache refresh job — see the module doc comment. */
function runOverpass(query) {
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
        // said so directly).
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PICK-cleanup-app/1.0 (street + boundary geometry)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Overpass error ${res.status}`);
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
};
