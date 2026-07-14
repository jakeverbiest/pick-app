/**
 * impactMetrics tests — bags derived from pickups, user reports win.
 * Locks down the math that drives every headline stat (profile totals,
 * leaderboards, session summaries). A regression here would silently
 * corrupt all displayed impact.
 * Run: npx -y tsx src/services/__tests__/impactMetrics.test.ts
 */
import {
  itemsToBags,
  reportedBags,
  cleanupBags,
  aggregateBags,
  formatBags,
  formatBagsShort,
  sessionImpact,
  PICKUPS_PER_BAG,
  BAG_SIZE_FACTORS,
} from '../impactMetrics';

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}
function close(name: string, actual: number, expected: number, eps = 1e-9) {
  const ok = Math.abs(actual - expected) <= eps;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${actual}, want ${expected}`}`);
}

console.log('=== itemsToBags (÷ pickups per bag) ===');
eq('constant is 200 pickups per bag', PICKUPS_PER_BAG, 200);
close('200 pickups = 1 bag', itemsToBags(200), 1);
close('100 pickups = 0.5 bags', itemsToBags(100), 0.5);
close('0 pickups = 0 bags', itemsToBags(0), 0);

console.log('\n=== reportedBags (size × fullness) ===');
close('small 100% = 1 bag', reportedBags('small', 100), 1);
close('small 50% = 0.5 bags', reportedBags('small', 50), 0.5);
close('medium 100% = 2.3 bags', reportedBags('medium', 100), BAG_SIZE_FACTORS.medium);
close('xl 100% = 5 bags', reportedBags('xl', 100), 5);
close('unknown size falls back to large', reportedBags('mystery', 100), BAG_SIZE_FACTORS.large);
close('fullness clamps at 100', reportedBags('small', 150), 1);
close('fullness clamps at 0', reportedBags('small', -20), 0);

console.log('\n=== cleanupBags (report wins, else derive) ===');
close('report wins', cleanupBags({ items_count: 400, bags_est: 0.5 }), 0.5);
close('no report → derive', cleanupBags({ items_count: 400 }), 2);
close('zero/absent report → derive', cleanupBags({ items_count: 200, bags_est: 0 }), 1);
close('empty cleanup = 0', cleanupBags({}), 0);

console.log('\n=== aggregateBags ===');
close(
  'mixed sessions sum',
  aggregateBags([
    { items_count: 400, bags_est: 0.5 }, // report wins → 0.5
    { items_count: 200 }, // derived → 1
    { items_count: 0 }, // 0
  ]),
  1.5
);
close('empty list = 0', aggregateBags([]), 0);

console.log('\n=== formatBags (fuzzy display) ===');
eq('zero', formatBags(0), '0 bags');
eq('tiny is a handful', formatBags(0.1), 'a handful');
eq('quarter bag', formatBags(0.3), 'about ¼ bag');
eq('half bag', formatBags(0.5), 'about ½ a bag');
eq('one bag', formatBags(1), 'about 1 bag');
eq('2.5 bags', formatBags(2.5), 'about 2½ bags');
eq('2.2 rounds to 2', formatBags(2.2), 'about 2 bags');
eq('big rounds whole', formatBags(12.6), '13 bags');

console.log('\n=== formatBagsShort ===');
eq('zero short', formatBagsShort(0), '0');
eq('tiny short', formatBagsShort(0.1), '<¼');
eq('half short', formatBagsShort(0.5), '½');
eq('1.5 short', formatBagsShort(1.5), '1½');
eq('big short', formatBagsShort(12.4), '12');

console.log('\n=== sessionImpact ===');
const est = sessionImpact(100);
close('estimated bags', est.bags, 0.5);
eq('display', est.display, '100 pickups · about ½ a bag');
const rep = sessionImpact(100, 2);
close('reported bags win', rep.bags, 2);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll impactMetrics tests passed');
