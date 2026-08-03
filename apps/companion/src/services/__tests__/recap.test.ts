/**
 * recap tests — period-window math + stat/path aggregation for "My Path"
 * weekly/monthly and year-end (Wrapped) recaps.
 * Run: npx -y tsx src/services/__tests__/recap.test.ts
 */
import { previousPeriodRange, listRecentRanges, buildRecap, buildRecapCaption, type RecapPeriod } from '../recap';
import type { Cleanup } from '../firebaseDatabase';

let failures = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? '✅' : '❌'} ${name}`);
}

function cleanup(overrides: Partial<Cleanup>): Cleanup {
  return {
    id: 'c1',
    userId: 'u1',
    timestamp: 0,
    location_lat: 40.7,
    location_lon: -73.9,
    items_count: 0,
    bag_qty: 0,
    bag_size: 'small',
    duration_seconds: 0,
    team: '',
    fitness_tracked: false,
    ...overrides,
  };
}

console.log('=== previousPeriodRange ===');
{
  // Wed Jul 22 2026 — startOfWeek is Monday-based per streaks.ts
  const now = new Date(2026, 6, 22, 15, 0, 0).getTime();
  const week = previousPeriodRange('week', now);
  ok('previous week starts before now', week.startMs < now);
  ok('previous week is 7 days long', week.endMs - week.startMs === 7 * 86400000);
  eq('previous week key format', week.key.startsWith('W'), true);

  const month = previousPeriodRange('month', now);
  eq('previous month key is June 2026', month.key, '2026-06');
  eq('previous month label', month.label, 'June 2026');

  const year = previousPeriodRange('year', now);
  eq('previous year key is 2025', year.key, '2025');
  eq('previous year label', year.label, '2025');
}

console.log('\n=== previousPeriodRange (year boundary) ===');
{
  // Jan 15 2026 — previous month should be Dec 2025, previous year 2025
  const now = new Date(2026, 0, 15).getTime();
  const month = previousPeriodRange('month', now);
  eq('Dec rollover key', month.key, '2025-12');
  const year = previousPeriodRange('year', now);
  eq('previous year across boundary', year.key, '2025');
}

console.log('\n=== listRecentRanges ===');
{
  const now = new Date(2026, 6, 22).getTime(); // Wed Jul 22 2026

  const weeks = listRecentRanges('week', 3, now);
  eq('offset 0 matches previousPeriodRange', weeks[0].key, previousPeriodRange('week', now).key);
  ok('weeks are contiguous, most recent first', weeks[0].startMs > weeks[1].startMs && weeks[1].startMs > weeks[2].startMs);
  eq('adjacent weeks touch with no gap', weeks[1].endMs, weeks[0].startMs);

  const months = listRecentRanges('month', 4, now);
  eq('4 months back to back', months.map((m) => m.key).join(','), '2026-06,2026-05,2026-04,2026-03');

  const years = listRecentRanges('year', 3, now);
  eq('3 years back to back', years.map((y) => y.key).join(','), '2025,2024,2023');
}

console.log('\n=== buildRecap (stats) ===');
{
  const range = previousPeriodRange('month', new Date(2026, 6, 1).getTime()); // previous = June 2026
  const juneTs = Math.floor(new Date(2026, 5, 10, 9, 0, 0).getTime() / 1000);
  const juneTs2 = Math.floor(new Date(2026, 5, 10, 18, 0, 0).getTime() / 1000); // same day
  const juneTs3 = Math.floor(new Date(2026, 5, 20).getTime() / 1000);
  const julyTs = Math.floor(new Date(2026, 6, 1, 1, 0, 0).getTime() / 1000); // outside range

  const cleanups: Cleanup[] = [
    cleanup({ id: 'a', timestamp: juneTs, items_count: 100, neighborhood: 'Prospect Heights' }),
    cleanup({ id: 'b', timestamp: juneTs2, items_count: 50, neighborhood: 'Prospect Heights' }),
    cleanup({ id: 'c', timestamp: juneTs3, items_count: 300, bags_est: 2, neighborhood: 'Fort Greene' }),
    cleanup({ id: 'd', timestamp: julyTs, items_count: 9999 }), // must be excluded
  ];

  const recap = buildRecap(cleanups, range);
  eq('3 cleanups counted, July excluded', recap.stats.cleanups, 3);
  eq('pickups summed', recap.stats.pickups, 450);
  eq('active days = 2 distinct days', recap.stats.activeDays, 2);
  eq('neighborhoods = 2 distinct', recap.stats.neighborhoods, 2);
  ok('bags > 0', recap.stats.bags > 0);
  eq('best day is June 20 (300 pickups)', recap.stats.bestDay?.pickups, 300);
}

console.log('\n=== buildRecap (path from route_points) ===');
{
  const range = previousPeriodRange('week', new Date(2026, 6, 22).getTime());
  const ts = Math.floor((range.startMs + 3600_000) / 1000);
  const route = JSON.stringify([[40.70, -73.99], [40.71, -73.98], [40.72, -73.97]]);
  const cleanups: Cleanup[] = [
    cleanup({ id: 'a', timestamp: ts, route_points: route, items_count: 10 }),
    cleanup({ id: 'b', timestamp: ts, route_points: 'not json', items_count: 5 }), // malformed — ignored, not thrown
  ];
  const recap = buildRecap(cleanups, range);
  ok('hasPath true when route_points present', recap.hasPath);
  eq('one polyline block', recap.coverage.blocks.length, 1);
  eq('bbox min lat', recap.coverage.bbox[0], 40.70);
  eq('bbox max lat', recap.coverage.bbox[2], 40.72);
}

console.log('\n=== buildRecap (empty period) ===');
{
  const range = previousPeriodRange('year', new Date(2026, 6, 22).getTime());
  const recap = buildRecap([], range);
  eq('zero cleanups', recap.stats.cleanups, 0);
  eq('no best day', recap.stats.bestDay, null);
  ok('hasPath false with no data', !recap.hasPath);
  ok('bbox is a valid degenerate box, not NaN', recap.coverage.bbox.every((n) => Number.isFinite(n)));
}

console.log('\n=== buildRecapCaption ===');
{
  const range = previousPeriodRange('year', new Date(2026, 6, 22).getTime());
  const cleanups: Cleanup[] = [
    cleanup({ id: 'a', timestamp: Math.floor(new Date(2025, 5, 1).getTime() / 1000), items_count: 500, bags_est: 3 }),
  ];
  const recap = buildRecap(cleanups, range);
  const caption = buildRecapCaption(recap, 'Jake');
  ok('year caption mentions the year', caption.includes('2025'));
  ok('year caption includes pickup count', caption.includes('500'));
  ok('year caption includes join link', caption.includes('testflight.apple.com'));
  ok('year caption does not use displayName possessive (year uses "My")', caption.startsWith('My 2025'));

  const monthRange = previousPeriodRange('month', new Date(2026, 6, 1).getTime());
  const monthRecap = buildRecap(cleanups, monthRange);
  const monthCaption = buildRecapCaption(monthRecap, 'Jake');
  ok('month caption uses possessive name', monthCaption.startsWith("Jake's month"));
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll recap tests passed');
