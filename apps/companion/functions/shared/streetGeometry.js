/**
 * Street geometry fetch + segmentation pipeline.
 *
 * Extracted 2026-09-03 alongside overpassClient.js (see that file's doc
 * comment for why this lives under functions/shared/ and how the client
 * reaches in). This isn't one of the six OVERPASS_PRECACHE_SPEC.md §5
 * decisions by name, but it's required by decision 5's actual goal: the
 * scheduled precache refresh job has to build the EXACT SAME `StreetSegment[]`
 * shape (spec §2: "cache the same shape the client already builds
 * client-side today") the client does. These are pure geometry functions
 * (no AsyncStorage, no Firestore, no RN APIs) that were already free of any
 * client-only dependency, so moving them here (once) and having
 * src/services/streetSegments.ts import them back is strictly safer than
 * hand-duplicating ~100 lines of chopping/segmentation math into
 * functions/index.js and hoping it never drifts from the original.
 *
 * Original source/history: src/services/streetSegments.ts. See that file
 * for the full field-data reasoning behind each tuned constant
 * (SNAP_DISTANCE_M, ROAD_SIDE_OFFSET_M, etc. — those stay client-only, they
 * govern route-matching, not geometry fetch/chop, so they didn't move).
 */

const { runOverpass } = require('./overpassClient');

const SEGMENT_LENGTH_M = 50;

// This MUST be >= the client's SNAP_DISTANCE_M (11m) — see streetSegments.ts
// for the full both-sides-credited regression story. Kept here unchanged
// since chopWaysIntoSegments (below) is what actually applies the offset.
const ROAD_SIDE_OFFSET_M = 15;

const MIN_SIDEWALK_SEGMENTS = 30; // below this, area has unmapped sidewalks → fall back to roads
const FETCH_RADIUS_M = 600;

/** Meters between two lat/lon points (equirectangular — fine at city scale). */
function distM(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = (lat2 - lat1) * 110540;
  return Math.sqrt(x * x + y * y);
}

/** Shift a whole segment sideways by `meters` (perpendicular to its overall
 *  heading). Positive = left of the a→b direction, negative = right. Used to
 *  turn a road centerline into two virtual per-side sidewalks. */
function offsetCoords(coords, meters) {
  if (coords.length < 2) return coords;
  const a = coords[0];
  const b = coords[coords.length - 1];
  const cosLat = Math.cos((a[0] * Math.PI) / 180);
  const dxE = (b[1] - a[1]) * 111320 * cosLat; // east component (m)
  const dyN = (b[0] - a[0]) * 110540; // north component (m)
  const len = Math.hypot(dxE, dyN) || 1;
  // left normal = rotate heading +90°: (-north, east)
  const nE = -dyN / len;
  const nN = dxE / len;
  const dLon = (nE * meters) / (111320 * cosLat);
  const dLat = (nN * meters) / 110540;
  return coords.map(([la, lo]) => [la + dLat, lo + dLon]);
}

/** 0.01° grid cell of a point (≈1km). Doc id for precache_streets/{gridKey}
 *  — MUST match src/services/streetSegments.ts's gridKey() exactly, or a
 *  precache write here would never be found by a client read. */
function gridKey(lat, lon) {
  return `${(Math.floor(lat * 100) / 100).toFixed(2)}_${(Math.floor(lon * 100) / 100).toFixed(2)}`;
}

// `split` = this geometry is road CENTERLINES (the no-sidewalk fallback), so
// emit two offset per-side segments (…_L / …_R) instead of one centerline. In
// true-sidewalk data each side is already its own way, so we leave it alone.
function chopWaysIntoSegments(json, split = false) {
  const segments = [];
  const emit = (baseId, segCoords) => {
    if (segCoords.length < 2) return;
    const mid = segCoords[Math.floor(segCoords.length / 2)];
    const grid = gridKey(mid[0], mid[1]);
    if (split) {
      segments.push({ id: `${baseId}_L`, coords: offsetCoords(segCoords, ROAD_SIDE_OFFSET_M), grid, side: 'L' });
      segments.push({ id: `${baseId}_R`, coords: offsetCoords(segCoords, -ROAD_SIDE_OFFSET_M), grid, side: 'R' });
    } else {
      segments.push({ id: baseId, coords: segCoords, grid });
    }
  };
  for (const way of json.elements || []) {
    if (way.type !== 'way' || !way.geometry || way.geometry.length < 2) continue;
    const pts = way.geometry.map((g) => [g.lat, g.lon]);

    // Chop the way into ~SEGMENT_LENGTH_M pieces with stable indices
    let segCoords = [pts[0]];
    let segLen = 0;
    let segIndex = 0;
    for (let i = 1; i < pts.length; i++) {
      segCoords.push(pts[i]);
      segLen += distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      const isLast = i === pts.length - 1;
      if (segLen >= SEGMENT_LENGTH_M || isLast) {
        emit(`${way.id}_${segIndex}`, segCoords);
        segIndex++;
        segCoords = [pts[i]];
        segLen = 0;
      }
    }
  }
  return segments;
}

/** Fetch + chop street geometry (sidewalks, falling back to road
 *  centerlines) around a point — the exact pipeline
 *  src/services/streetSegments.ts's getSegmentsAround() uses on a live
 *  fetch, reused here so the scheduled precache refresh writes the identical
 *  shape a client fetch would have produced.
 *  `opts` is forwarded to both `runOverpass()` calls unchanged — see
 *  overpassClient.js's `enforceCooldown` doc comment. Default `{}` (no
 *  cooldown enforcement) preserves today's exact client behavior for the
 *  many client call sites that don't pass a third argument. */
async function fetchStreetGeometry(lat, lon, opts = {}) {
  // SIDEWALKS, not road centerlines — pickers walk the sidewalk, and NYC OSM
  // maps each side of the street as its own footway=sidewalk way.
  const sidewalkQuery = `
    [out:json][timeout:25];
    (
      way["highway"="footway"]["footway"="sidewalk"](around:${FETCH_RADIUS_M},${lat},${lon});
      way["highway"~"^(pedestrian|path|living_street)$"](around:${FETCH_RADIUS_M},${lat},${lon});
    );
    out geom;
  `;
  const roadQuery = `
    [out:json][timeout:25];
    way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street|pedestrian|footway|path)$"]
      (around:${FETCH_RADIUS_M},${lat},${lon});
    out geom;
  `;
  // Fired together, not sequentially — see streetSegments.ts for the full
  // reasoning (the road query doesn't depend on the sidewalk result).
  //
  // Judgment call, checked against the OSM wiki's "no parallel running of
  // multiple scripts" fair-use line (2026-09-05 reconciliation): read as
  // "don't run multiple independent copies/instances of your scraper
  // concurrently" (e.g. two people each running a full-sweep script at
  // once), not "never issue more than one HTTP request at a time from your
  // one script." This is one logical fetch for one tile, done by ONE
  // running job (the drip's single scheduled invocation, or one live client
  // screen), asking two complementary questions (sidewalks vs. roads) it
  // needs together before it can proceed — not two independent scripts. The
  // project runs exactly one drip job on a fixed non-overlapping schedule,
  // not several concurrent instances of it, which is what that guidance
  // most plausibly targets. (The one real, if narrow, way this project
  // COULD violate the literal "parallel scripts" reading is the manual HTTP
  // trigger `runOverpassPrecacheRefresh` being hit while the scheduled drip
  // is also mid-run — a rare, human-triggered edge case, not fixed here,
  // worth knowing about rather than silently ignoring.)
  const [sidewalkJson, roadJson] = await Promise.all([
    runOverpass(sidewalkQuery, opts),
    runOverpass(roadQuery, opts),
  ]);
  let segments = chopWaysIntoSegments(sidewalkJson);

  if (segments.length < MIN_SIDEWALK_SEGMENTS) {
    segments = chopWaysIntoSegments(roadJson, true); // centerlines → split into per-side sidewalks
  }
  return segments;
}

module.exports = {
  SEGMENT_LENGTH_M,
  ROAD_SIDE_OFFSET_M,
  MIN_SIDEWALK_SEGMENTS,
  FETCH_RADIUS_M,
  distM,
  offsetCoords,
  gridKey,
  chopWaysIntoSegments,
  fetchStreetGeometry,
};
