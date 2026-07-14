/**
 * Verifies the per-neighborhood scorer (tap-to-focus model):
 *  - polygonStats counts ONLY segments whose midpoint is inside the hood polygon
 *  - fresh = cleaned within 5 days; freshPct / toGo math against that set
 * Run: npx -y tsx src/services/__tests__/polygonStats.test.ts
 */
import { polygonStats } from '../neighborhoods';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`✅ ${name}`); pass++; }
  else { console.log(`❌ ${name} ${detail}`); fail++; }
}

// A square neighborhood around Carroll Gardens (~0.01° box).
const ring: [number, number][] = [
  [40.675, -74.000],
  [40.685, -74.000],
  [40.685, -73.990],
  [40.675, -73.990],
  [40.675, -74.000],
];

function seg(lat: number, lon: number, daysOld: number | null) {
  return { coords: [[lat, lon], [lat, lon]] as [number, number][], daysOld };
}

const segments = [
  seg(40.680, -73.995, 1),   // inside, fresh
  seg(40.681, -73.996, 3),   // inside, fresh
  seg(40.682, -73.994, 30),  // inside, stale
  seg(40.683, -73.997, null),// inside, never
  seg(40.690, -73.995, 0),   // OUTSIDE (north of box), fresh — must not count
  seg(40.680, -73.980, 0),   // OUTSIDE (east of box), fresh — must not count
];

const st = polygonStats(ring, segments);
console.log('=== per-hood polygon scoring ===');
check('counts only in-polygon segments (total=4)', st.total === 4, `(got ${st.total})`);
check('fresh counts in-polygon fresh only (2)', st.fresh === 2, `(got ${st.fresh})`);
check('freshPct = 2/4 = 50', st.freshPct === 50, `(got ${st.freshPct})`);
check('toGo = 2', st.toGo === 2, `(got ${st.toGo})`);

const empty = polygonStats(ring, []);
check('empty → 0% / 0 toGo, no NaN', empty.freshPct === 0 && empty.toGo === 0 && empty.total === 0);

const allFresh = polygonStats(ring, [seg(40.680, -73.995, 1), seg(40.681, -73.996, 2)]);
check('all fresh → 100% / 0 toGo (completed hood)', allFresh.freshPct === 100 && allFresh.toGo === 0);

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILED'} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
