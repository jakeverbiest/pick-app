/**
 * Verifies the 2026-07-19 walk-feedback geometry:
 *  - 80% segment coverage threshold (over-counting fix)
 *  - park point-in-polygon detection
 * Run: npx -y tsx src/services/__tests__/geometryCoverage.test.ts
 */
import {
  routeCoverageFraction, pointInPolygon, offsetCoords, SNAP_DISTANCE_M, ROAD_SIDE_OFFSET_M,
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

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
