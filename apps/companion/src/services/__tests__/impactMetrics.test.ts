/**
 * Locks down the items → weight → bags impact math that drives every headline
 * stat (profile totals, leaderboards, zone reports). A regression here would
 * silently corrupt all displayed impact.
 * Run: npx -y tsx src/services/__tests__/impactMetrics.test.ts
 */
import {
  weightToBags,
  formatBags,
  sessionImpact,
  aggregateImpact,
  STANDARD_BAG_LB,
} from '../impactMetrics';
import { DEFAULT_LB_PER_PICKUP } from '../weightCalibration';

let pass = 0;
let fail = 0;
function eq(name: string, got: any, want: any) {
  const ok = got === want;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
function close(name: string, got: number, want: number, tol = 1e-9) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${got}, want ${want}`}`);
  ok ? pass++ : fail++;
}

console.log('=== weightToBags (÷ standard bag) ===');
close('10 lb = 1 bag', weightToBags(10), 1);
close('25 lb = 2.5 bags', weightToBags(25), 2.5);
close('0 lb = 0 bags', weightToBags(0), 0);
eq('standard bag constant is 10 lb', STANDARD_BAG_LB, 10);

console.log('\n=== formatBags (display tiers) ===');
eq('≥10 rounds to whole', formatBags(12), '12 bags');
eq('≥10 rounds 12.6 → 13', formatBags(12.6), '13 bags');
eq('1–10 shows one decimal', formatBags(2.5), '2.5 bags');
eq('exactly 1', formatBags(1), '1.0 bags');
eq('<1 shows two decimals', formatBags(0.5), '0.50 bags');
eq('tiny value keeps precision', formatBags(0.05), '0.05 bags');

console.log('\n=== sessionImpact ===');
const known = sessionImpact(20, 5);
close('known weight is used as-is', known.estWeightLb, 5);
close('known weight → bags', known.bagsEquivalent, 0.5);
eq('items carried through', known.items, 20);

const estimated = sessionImpact(100); // no known weight → default factor
close('no weight → items × default factor', estimated.estWeightLb, 100 * DEFAULT_LB_PER_PICKUP);
eq('display mentions items', estimated.display.includes('100 items'), true);

const zeroWeight = sessionImpact(20, 0); // 0 is not a real measurement → estimate
close('zero known weight falls back to estimate', zeroWeight.estWeightLb, 20 * DEFAULT_LB_PER_PICKUP);

console.log('\n=== aggregateImpact (totals) ===');
const agg = aggregateImpact([
  { items_count: 10, weight_lb: 2 },
  { items_count: 5, weight_lb: 1 },
  { items_count: 0, weight_lb: 0 },
]);
eq('sums items', agg.items, 15);
close('sums weight', agg.estWeightLb, 3);
close('weight → bags', agg.bagsEquivalent, 0.3);
const emptyAgg = aggregateImpact([]);
eq('empty aggregate → 0 items', emptyAgg.items, 0);
close('empty aggregate → 0 bags', emptyAgg.bagsEquivalent, 0);

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`} (${pass}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
