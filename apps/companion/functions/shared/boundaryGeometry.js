/**
 * OSM administrative-boundary fetch + stitching pipeline.
 *
 * Extracted 2026-09-03 alongside overpassClient.js / streetGeometry.js (see
 * overpassClient.js's doc comment for why these live under functions/shared/
 * and how the client reaches in). Same reasoning as streetGeometry.js: the
 * scheduled precache refresh job needs to build the exact same
 * `OsmBoundaryFeature[]` shape src/services/neighborhoods.ts's
 * fetchOsmBoundariesInBox() produces (OVERPASS_PRECACHE_SPEC.md §2), and
 * these are pure geometry functions with no client-only dependency, so
 * relocating them (once) beats hand-duplicating the stitch/filter/dedup
 * logic into functions/index.js.
 *
 * Original source/history: src/services/neighborhoods.ts — see that file
 * for the full field-tested reasoning behind OSM_ADMIN_LEVELS,
 * MAX_SHAPE_DIAGONAL_KM, etc. `hasFineSubdivision` classification
 * (MIN_SUBDIVISION_SHAPES / MAX_DOMINANT_AREA_FRACTION) stayed client-only —
 * it's a UI-only judgment call ("draw this as a fallback circle vs. real
 * boundaries") the precache refresh job has no use for; it only needs the
 * raw stitched features to cache.
 */

const { runOverpass } = require('./overpassClient');

// See neighborhoods.ts for the full field-tested reasoning (verified live
// 2026-08-13 against real cities on four continents) — no single admin_level
// means "neighborhood" worldwide, so this widened range plus the size filter
// below (MAX_SHAPE_DIAGONAL_KM) is the pragmatic compromise.
const OSM_ADMIN_LEVELS = '^(6|7|8|9)$';

// ~20km — one Overpass call + cache doc covers a whole metro area. MUST
// match src/services/neighborhoods.ts's OSM_CELL_DEG exactly — it's the
// unit both the client's cache-cell key and this module's precache cellKey
// are computed against.
const OSM_CELL_DEG = 0.2;

// Calibrated live 2026-08-13 against real Paris-area data (see
// neighborhoods.ts) — excludes county/region-scale relations the widened
// admin_level range pulls in, keeps genuinely large single cities.
const MAX_SHAPE_DIAGONAL_KM = 25;

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** Stitch a relation's "outer" member ways (each an ordered lat/lon polyline)
 *  into closed ring(s) by matching shared endpoints — administrative
 *  boundaries are usually assembled from several ways, not one. Returns the
 *  largest closed ring. */
function stitchOuterWays(ways) {
  const remaining = ways.map((w) => w.slice());
  const rings = [];
  while (remaining.length) {
    let chain = remaining.shift();
    let grew = true;
    while (grew && (chain.length < 2 || !samePoint(chain[0], chain[chain.length - 1]))) {
      grew = false;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        const end = chain[chain.length - 1];
        const start = chain[0];
        if (samePoint(w[0], end)) { chain = chain.concat(w.slice(1)); remaining.splice(i, 1); grew = true; break; }
        if (samePoint(w[w.length - 1], end)) { chain = chain.concat(w.slice(0, -1).reverse()); remaining.splice(i, 1); grew = true; break; }
        if (samePoint(w[w.length - 1], start)) { chain = w.slice(0, -1).concat(chain); remaining.splice(i, 1); grew = true; break; }
        if (samePoint(w[0], start)) { chain = w.slice(1).reverse().concat(chain); remaining.splice(i, 1); grew = true; break; }
      }
    }
    rings.push(chain);
  }
  let best = null;
  for (const r of rings) if (!best || r.length > best.length) best = r;
  return best && best.length >= 4 ? best : null;
}

/** Bounding box [minLat, minLon, maxLat, maxLon] of a ring. */
function ringBBox(ring) {
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const [la, lo] of ring) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  return [minLat, minLon, maxLat, maxLon];
}

/** Straight-line bbox diagonal in km — cheap (equirectangular, not true
 *  geodesic) but plenty accurate at city scale. Used to filter out
 *  county/region-scale relations that get swept in by the widened
 *  admin_level range. */
function ringDiagonalKm(ring) {
  const [minLat, minLon, maxLat, maxLon] = ringBBox(ring);
  const latKm = (maxLat - minLat) * 111.32;
  const midLat = (minLat + maxLat) / 2;
  const lonKm = (maxLon - minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  return Math.sqrt(latKm * latKm + lonKm * lonKm);
}

/** Rough (lat/lon-degree, not geodesic) overlap of a ring's bbox against a
 *  reference bbox — cheap enough to run per-shape, good enough to tell "this
 *  shape roughly IS the reference area" from "this is one piece within it." */
function bboxOverlapFraction(ring, minLat, minLon, maxLat, maxLon) {
  const [a, b, c, d] = ringBBox(ring);
  const ixLat = Math.max(0, Math.min(c, maxLat) - Math.max(a, minLat));
  const ixLon = Math.max(0, Math.min(d, maxLon) - Math.max(b, minLon));
  const refArea = Math.max(1e-9, (maxLat - minLat) * (maxLon - minLon));
  return (ixLat * ixLon) / refArea;
}

/** ~20km OSM_CELL_DEG cell id of a point. Doc id for
 *  precache_boundaries/{cellKey} — MUST match
 *  src/services/neighborhoods.ts's osmCellKey() exactly, or a precache
 *  write here would never be found by a client read. */
function osmCellKey(lat, lon) {
  return `${Math.floor(lat / OSM_CELL_DEG)}_${Math.floor(lon / OSM_CELL_DEG)}`;
}

/** Named administrative boundaries inside a bbox, straight from OSM — reuses
 *  runOverpass's mirror-failover/timeout. `out geom` on a relation query
 *  embeds each member way's geometry inline, so one round trip is enough. */
async function fetchOsmBoundariesInBox(minLat, minLon, maxLat, maxLon) {
  const query = `
    [out:json][timeout:25];
    relation["boundary"="administrative"]["admin_level"~"${OSM_ADMIN_LEVELS}"](${minLat},${minLon},${maxLat},${maxLon});
    out geom;
  `;
  const json = await runOverpass(query);
  const elements = json?.elements ?? [];
  const out = [];
  const seenNames = new Set();
  let skippedNoName = 0;
  let skippedNoRing = 0;
  let skippedTooBig = 0;
  let skippedDuplicate = 0;
  for (const rel of elements) {
    if (rel.type !== 'relation') continue;
    const name = rel.tags?.name;
    if (!name) { skippedNoName++; continue; }
    const outerWays = (rel.members || [])
      .filter((m) => m.type === 'way' && Array.isArray(m.geometry) && (m.role === 'outer' || !m.role))
      .map((m) => m.geometry.map((g) => [g.lat, g.lon]));
    if (!outerWays.length) { skippedNoRing++; continue; }
    const ring = stitchOuterWays(outerWays);
    if (!ring) { skippedNoRing++; continue; }
    if (ringDiagonalKm(ring) > MAX_SHAPE_DIAGONAL_KM) { skippedTooBig++; continue; }
    // The same place is sometimes tagged as multiple relations at different
    // admin_levels — keep only the first one seen per name.
    const key = String(name);
    if (seenNames.has(key)) { skippedDuplicate++; continue; }
    seenNames.add(key);
    out.push({ id: rel.id, name: key, ring });
  }
  console.log(
    `🗺️ OSM boundary query: ${elements.length} elements → ${out.length} usable boundaries` +
    (skippedNoName || skippedNoRing || skippedTooBig || skippedDuplicate
      ? ` (skipped ${skippedNoName} unnamed, ${skippedNoRing} unstitchable, ${skippedTooBig} too-big, ${skippedDuplicate} duplicate)`
      : '')
  );
  return out;
}

module.exports = {
  OSM_ADMIN_LEVELS,
  OSM_CELL_DEG,
  MAX_SHAPE_DIAGONAL_KM,
  samePoint,
  stitchOuterWays,
  ringBBox,
  ringDiagonalKm,
  bboxOverlapFraction,
  osmCellKey,
  fetchOsmBoundariesInBox,
};
