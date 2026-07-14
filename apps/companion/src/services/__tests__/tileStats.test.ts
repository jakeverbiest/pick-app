/**
 * Verifies the universal completion-tile denominator:
 *  - a point maps to a stable tile id; neighbors fall in different tiles
 *  - getTileStats counts ONLY segments inside the current tile (fixed
 *    denominator), ignoring fetched segments that belong to other tiles
 *  - freshPct / toGo math against that bounded set
 * Run: npx -y tsx src/services/__tests__/tileStats.test.ts
 */
import { tileId, tileBounds, getTileStats, TILE_SIZE_DEG, RenderSegment } from '../streetSegments';

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

// A point in Carroll Gardens, Brooklyn.
const LAT = 40.6785;
const LON = -73.9955;

console.log('=== tile identity ===');
check('same point → same tile id', tileId(LAT, LON) === tileId(LAT, LON));
check(
  'a point one full tile north is a different tile',
  tileId(LAT, LON) !== tileId(LAT + TILE_SIZE_DEG, LON)
);
check(
  'a nudge of a few meters stays in the same tile',
  tileId(LAT, LON) === tileId(LAT + 0.00002, LON + 0.00002)
);

const [minLat, minLon, maxLat, maxLon] = tileBounds(LAT, LON);
check('tile bounds contain the point', LAT >= minLat && LAT < maxLat && LON >= minLon && LON < maxLon);
check('tile is TILE_SIZE_DEG square', Math.abs(maxLat - minLat - TILE_SIZE_DEG) < 1e-9 && Math.abs(maxLon - minLon - TILE_SIZE_DEG) < 1e-9);

// Build segments: some inside the current tile, some clearly outside it.
function seg(id: string, lat: number, lon: number, daysOld: number | null): RenderSegment {
  // 2-vertex segment; midpoint = vertex[1] (index floor(2/2)=1)
  return { id, coords: [[lat, lon], [lat, lon]], daysOld };
}

const midLat = (minLat + maxLat) / 2;
const midLon = (minLon + maxLon) / 2;
const outsideLat = maxLat + TILE_SIZE_DEG; // a full tile away → different tile
const outsideLon = midLon;

const coverage: RenderSegment[] = [
  seg('in-fresh-1', midLat, midLon, 1),       // inside, fresh
  seg('in-fresh-2', midLat, midLon, 4),       // inside, fresh (<=5d)
  seg('in-stale', midLat, midLon, 20),        // inside, not fresh
  seg('in-never', midLat, midLon, null),      // inside, never cleaned
  seg('out-fresh', outsideLat, outsideLon, 1),// OUTSIDE tile, fresh — must NOT count
  seg('out-never', outsideLat, outsideLon, null),
];

console.log('=== bounded denominator ===');
const stats = getTileStats(LAT, LON, coverage);
check('denominator excludes out-of-tile segments (total=4 not 6)', stats.total === 4, `(got ${stats.total})`);
check('fresh counts only in-tile fresh (2)', stats.fresh === 2, `(got ${stats.fresh})`);
check('freshPct = 2/4 = 50', stats.freshPct === 50, `(got ${stats.freshPct})`);
check('toGo = total - fresh = 2', stats.toGo === 2, `(got ${stats.toGo})`);
check('tileId matches the queried point', stats.tileId === tileId(LAT, LON));

console.log('=== edge cases ===');
const empty = getTileStats(LAT, LON, []);
check('empty coverage → 0% and 0 to go (no divide-by-zero)', empty.freshPct === 0 && empty.toGo === 0 && empty.total === 0);

const allFresh = getTileStats(LAT, LON, [seg('a', midLat, midLon, 0), seg('b', midLat, midLon, 2)]);
check('all fresh → 100% and 0 to go (completed tile)', allFresh.freshPct === 100 && allFresh.toGo === 0);

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILED'} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
