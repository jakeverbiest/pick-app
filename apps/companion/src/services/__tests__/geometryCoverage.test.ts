/**
 * Verifies the 2026-07-19 walk-feedback geometry:
 *  - 80% segment coverage threshold (over-counting fix)
 *  - park point-in-polygon detection
 * Run: npx -y tsx src/services/__tests__/geometryCoverage.test.ts
 */
import {
  routeCoverageFraction, pointInPolygon, offsetCoords, SNAP_DISTANCE_M, ROAD_SIDE_OFFSET_M,
  assignRoutePointsToNearestSegment, COVERAGE_THRESHOLD,
} from '../streetSegments';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`✅ ${name}`);
    pass++;
  } else {
    console.log(`❌ ${name} ${detail}`);
    fail++;
  }
}

// meter→degree at NYC latitude (~40.68)
const M_LAT = 1 / 110540;
const M_LON = 1 / (111320 * Math.cos((40.68 * Math.PI) / 180));

// A 50m east-west street segment at lat 40.6800
const seg: [number, number][] = [
  [40.68, -73.995],
  [40.68, -73.995 + 50 * M_LON],
];

// Build a route parallel to the segment, `offsetM` to the side, covering
// `fracLen` of its length, a point every `stepM` meters.
function routeAlong(offsetM: number, fracLen = 1, stepM = 5) {
  const pts: { lat: number; lon: number }[] = [];
  for (let d = 0; d <= 50 * fracLen; d += stepM) {
    pts.push({ lat: 40.68 + offsetM * M_LAT, lon: -73.995 + d * M_LON });
  }
  return pts;
}

console.log('=== 80% segment coverage threshold ===');
const SNAP = 15;
const full = routeCoverageFraction(seg, routeAlong(3, 1), SNAP);
check('full walk on the same sidewalk (3m off) → ≥0.8 → marked', full >= 0.8, `(got ${full.toFixed(2)})`);

const opp = routeCoverageFraction(seg, routeAlong(18, 1), SNAP);
check('opposite sidewalk (18m off) → <0.8 → NOT marked', opp < 0.8, `(got ${opp.toFixed(2)})`);

const clip = routeCoverageFraction(seg, routeAlong(3, 0.2), SNAP);
check('clip ~20% of the block → <0.8 → NOT marked', clip < 0.8, `(got ${clip.toFixed(2)})`);

const none = routeCoverageFraction(seg, [], SNAP);
check('no route points → 0 coverage', none === 0, `(got ${none})`);

console.log('\n=== parks: point-in-polygon ===');
// ~110m x 84m rectangular park
const park: [number, number][] = [
  [40.679, -73.997],
  [40.68, -73.997],
  [40.68, -73.996],
  [40.679, -73.996],
];
check('point in the middle of the park → inside', pointInPolygon(40.6795, -73.9965, park) === true);
check('point blocks away → outside', pointInPolygon(40.685, -73.99, park) === false);
check('point just north of the park edge → outside', pointInPolygon(40.6805, -73.9965, park) === false);
check('point just west of the park edge → outside', pointInPolygon(40.6795, -73.9975, park) === false);

console.log('\n=== road-centerline fallback: both-sides regression ===');
// A real walk was reported as crediting both sides of the street when it
// should have only credited one — root cause was ROAD_SIDE_OFFSET_M (8m)
// being narrower than SNAP_DISTANCE_M (11m), which geometrically guaranteed
// double-crediting for anyone within a few meters of the road centerline.
// Reconstruct the fallback path exactly: a 50m centerline split into two
// virtual per-side sidewalks via offsetCoords, at the real production offset.
const centerline: [number, number][] = [
  [40.68, -73.995],
  [40.68, -73.995 + 50 * M_LON],
];
const leftSidewalk = offsetCoords(centerline, ROAD_SIDE_OFFSET_M);
const rightSidewalk = offsetCoords(centerline, -ROAD_SIDE_OFFSET_M);

// Someone walking right along the left virtual sidewalk...
const walkedLeft = routeAlong(ROAD_SIDE_OFFSET_M, 1);
const leftCoverageOfLeft = routeCoverageFraction(leftSidewalk, walkedLeft, SNAP_DISTANCE_M);
const leftCoverageOfRight = routeCoverageFraction(rightSidewalk, walkedLeft, SNAP_DISTANCE_M);
check('walking the left sidewalk covers the left virtual segment', leftCoverageOfLeft >= 0.6, `(got ${leftCoverageOfLeft.toFixed(2)})`);
check('walking the left sidewalk does NOT cover the right virtual segment', leftCoverageOfRight < 0.6, `(got ${leftCoverageOfRight.toFixed(2)})`);

// The worst case from the old bug: walking right down the CENTERLINE itself
// (offset 0) — with the old 8m offset this credited both sides at once.
const walkedCenter = routeAlong(0, 1);
const centerCoverageOfLeft = routeCoverageFraction(leftSidewalk, walkedCenter, SNAP_DISTANCE_M);
const centerCoverageOfRight = routeCoverageFraction(rightSidewalk, walkedCenter, SNAP_DISTANCE_M);
check(
  'walking the centerline does NOT cover both virtual sidewalks at once',
  !(centerCoverageOfLeft >= 0.6 && centerCoverageOfRight >= 0.6),
  `(left ${centerCoverageOfLeft.toFixed(2)}, right ${centerCoverageOfRight.toFixed(2)})`
);

console.log('\n=== two independently-mapped real sidewalks: nearest-segment classification ===');
// The gap the offsetCoords()-derived regression test above does NOT cover:
// two real, independently-mapped OSM sidewalk ways (no shared parent
// centerline, no offsetCoords involved) at a narrow real-world separation —
// ~15m, inside the previously-identified intermittent-failure band where
// SNAP_DISTANCE_M (11m) alone lets a route offset from BOTH sidewalks by
// <=11m be "near" both at once (offset x satisfies x<=11 and 15-x<=11 for
// x in [4,11]).
const NARROW_SEP_M = 15;
const sidewalkA: [number, number][] = [
  [40.681, -73.995],
  [40.681, -73.995 + 50 * M_LON],
];
const sidewalkB: [number, number][] = [
  [40.681 + NARROW_SEP_M * M_LAT, -73.995],
  [40.681 + NARROW_SEP_M * M_LAT, -73.995 + 50 * M_LON],
];
const candidates = [{ coords: sidewalkA }, { coords: sidewalkB }];

function routeAlongLat(baseLat: number, offsetM: number, fracLen = 1, stepM = 5) {
  const pts: { lat: number; lon: number }[] = [];
  for (let d = 0; d <= 50 * fracLen; d += stepM) {
    pts.push({ lat: baseLat + offsetM * M_LAT, lon: -73.995 + d * M_LON });
  }
  return pts;
}
// Offset 6m from A (and therefore 9m from B) — inside the [4,11] double-
// credit band, so BOTH are within SNAP_DISTANCE_M of this route.
const walkedA = routeAlongLat(40.681, 6, 1);

// Pre-fix behavior: test each segment against the WHOLE route independently
// (what markRouteCleaned/the live recolor path did before this fix) — this
// is the actual bug: both sides cross COVERAGE_THRESHOLD even though only A
// was walked.
const oldCovA = routeCoverageFraction(sidewalkA, walkedA, SNAP_DISTANCE_M);
const oldCovB = routeCoverageFraction(sidewalkB, walkedA, SNAP_DISTANCE_M);
check(
  'regression check: pre-fix logic (no nearest-neighbor) DID double-credit at 15m separation',
  oldCovA >= COVERAGE_THRESHOLD && oldCovB >= COVERAGE_THRESHOLD,
  `(A ${oldCovA.toFixed(2)}, B ${oldCovB.toFixed(2)})`
);

// Post-fix: assign each route point to its single nearest candidate first.
const buckets = assignRoutePointsToNearestSegment(walkedA, candidates, SNAP_DISTANCE_M);
const covA = routeCoverageFraction(sidewalkA, buckets[0], SNAP_DISTANCE_M);
const covB = routeCoverageFraction(sidewalkB, buckets[1], SNAP_DISTANCE_M);
check('walking sidewalk A (real, independently-mapped) still credits A', covA >= COVERAGE_THRESHOLD, `(got ${covA.toFixed(2)})`);
check('walking sidewalk A no longer also credits independently-mapped B at 15m separation', covB < COVERAGE_THRESHOLD, `(got ${covB.toFixed(2)})`);

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
