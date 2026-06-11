/**
 * Detector Regression Test — June 10, 2026 field walk
 *
 * Jake did ~15 real pickups; the old thresholds (1.6g peak cap, 2000ms
 * timing cap) detected only 6. These fixtures are the 21 motion events
 * recorded in that walk's logs. The test asserts the retuned thresholds
 * recover the wrongly-rejected events without accepting garbage.
 *
 * Run:  npm run test:detector
 *
 * When retuning thresholds, run this FIRST. If a change drops the June 10
 * recall below 19/21, you've reintroduced the bug that cost 60% of pickups.
 */

import { evaluatePickupProfile, isPickup, countDistinctPeaks, THRESHOLDS, EvalProfile } from '../motionEvaluation';

// Every motion event from the June 10 log. peakAccelTime was only logged for
// the timing rejection (2395ms); others use 800ms (mid-window, uncontroversial).
// lastAccel reconstructed to give settlingDrop > 0.2 (walking always settled in logs).
const ev = (peakAccel: number, duration = 2593, peakAccelTime = 800): EvalProfile => ({
  duration,
  peakAccel,
  peakAccelTime,
  peakGyro: 0, // gyro not logged — no bonus assumed
  lastAccel: Math.max(0.3, peakAccel - 0.5),
});

const JUNE10_EVENTS: { profile: EvalProfile; oldResult: 'detected' | 'rejected' }[] = [
  { profile: ev(1.56, 2594, 2395), oldResult: 'rejected' }, // peak timing 2395 > 2000
  { profile: ev(2.55), oldResult: 'rejected' },
  { profile: ev(2.06), oldResult: 'rejected' },
  { profile: ev(1.88), oldResult: 'rejected' },
  { profile: ev(1.70), oldResult: 'rejected' },
  { profile: ev(1.49, 2594), oldResult: 'detected' }, // 60%
  { profile: ev(1.58, 2594), oldResult: 'detected' }, // 60%
  { profile: ev(2.38), oldResult: 'rejected' },
  { profile: ev(1.39), oldResult: 'detected' }, // 55%
  { profile: ev(1.95, 2594), oldResult: 'rejected' },
  { profile: ev(1.83), oldResult: 'rejected' },
  { profile: ev(2.32), oldResult: 'rejected' },
  { profile: ev(1.22), oldResult: 'detected' }, // 55%
  { profile: ev(3.59), oldResult: 'rejected' }, // extreme — should STAY rejected
  { profile: ev(1.45, 2579), oldResult: 'detected' }, // 45%
  { profile: ev(1.68, 2594), oldResult: 'rejected' },
  { profile: ev(2.91), oldResult: 'rejected' },
  { profile: ev(3.09, 2600), oldResult: 'rejected' },
  { profile: ev(2.77, 2594), oldResult: 'rejected' },
  { profile: ev(1.53), oldResult: 'detected' }, // 60%
  { profile: ev(1.82), oldResult: 'rejected' },
];

// Garbage that must NEVER be detected
const GARBAGE: { name: string; profile: EvalProfile }[] = [
  { name: 'phone drop (8g spike)', profile: ev(8.0, 600) },
  { name: 'too quick (300ms twitch)', profile: ev(1.3, 300) },
  { name: 'too long (8s carry)', profile: ev(1.3, 8000) },
  { name: 'too gentle (0.5g sway)', profile: ev(0.5) },
  { name: 'no settling (constant accel)', profile: { ...ev(1.3), lastAccel: 1.29 } },
];

let failures = 0;
const check = (name: string, actual: boolean, expected: boolean) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✅' : '❌ FAIL'} ${name}`);
};

console.log('=== June 10 field walk replay ===');
const detected = JUNE10_EVENTS.filter((e) => isPickup(e.profile));
const oldDetected = JUNE10_EVENTS.filter((e) => e.oldResult === 'detected');
console.log(`Old thresholds: ${oldDetected.length}/21 events detected (~15 real pickups → 40% recall)`);
console.log(`New thresholds: ${detected.length}/21 events detected`);

check('new thresholds detect >= 19/21 June 10 events', detected.length >= 19, true);
check('3.59g extreme spike still rejected', isPickup(ev(3.59)), false);
check('2395ms late peak now accepted', isPickup(ev(1.56, 2594, 2395)), true);
check('1.7g street pickup now accepted (was rejected)', isPickup(ev(1.70)), true);
check('2.9g vigorous pickup accepted with penalty', isPickup(ev(2.91)), true);

const vigorous = evaluatePickupProfile(ev(2.91)).confidence;
const sweet = evaluatePickupProfile(ev(1.39)).confidence;
check(`vigorous (${vigorous}%) scores below sweet-spot (${sweet}%)`, vigorous < sweet, true);

console.log('\n=== Garbage rejection ===');
for (const g of GARBAGE) {
  check(`rejects ${g.name}`, isPickup(g.profile), false);
}

console.log('\n=== Peak counter (spree analysis) ===');
// Build sample streams at 100ms cadence
const stream = (accels: number[]) => accels.map((a, i) => ({ accel: a, timestamp: i * 100 }));
// One clean pickup: rise, peak, settle
const onePeak = stream([0.9, 1.1, 1.4, 1.2, 0.95, 0.8, 0.7]);
check('single pickup counts 1 peak', countDistinctPeaks(onePeak) === 1, true);
// Bend+straighten double spike WITHOUT dipping below 1.0 between → still 1
const bendStand = stream([0.9, 1.3, 1.1, 1.35, 1.05, 0.8]);
check('bend+straighten (no valley) counts 1', countDistinctPeaks(bendStand) === 1, true);
// Spree: three picks ~0.9s apart (realistic grabber cadence) with valleys between
const spree = stream([
  0.9, 1.4, 0.8, 0.7, 0.75, 0.7, 0.8, 0.7, 0.75, // pick 1 @ t=100
  1.5, 0.8, 0.7, 0.75, 0.7, 0.8, 0.7, 0.75, 0.7, // pick 2 @ t=900
  1.45, 0.8, 0.7,                                  // pick 3 @ t=1800
]);
check('3-pick spree counts 3 peaks', countDistinctPeaks(spree) === 3, true);
// Two picks 300ms apart (faster than humanly possible) → merged to avoid double-count
const tooFast = stream([0.9, 1.4, 0.8, 1.5, 0.8, 0.7]);
check('implausibly fast double-spike merges to 1', countDistinctPeaks(tooFast) === 1, true);
// Rapid jitter above 1.15 without valleys → 1
const jitter = stream([1.2, 1.25, 1.18, 1.22, 1.19, 1.21]);
check('sustained jitter counts 1', countDistinctPeaks(jitter) === 1, true);

console.log('\n=== Walking cadence filter (June 11 pocket session) ===');
// Real walking bursts from Jake's June 11 indoor test
check('walking burst (peaks 5, 2593ms) rejected', isPickup({ ...ev(2.49, 2593, 1895), peaks: 5 }), false);
check('walking burst (peaks 4, 2594ms) rejected', isPickup({ ...ev(1.72, 2594, 1896), peaks: 4 }), false);
// Real picks from the same session must still pass
check('real pocket pick (peaks 1, 1197ms) accepted', isPickup({ ...ev(1.42, 1197, 499), peaks: 1 }), true);
check('bend+straighten pick (peaks 2, 1196ms) accepted', isPickup({ ...ev(1.52, 1196, 598), peaks: 2 }), true);
// Short multi-peak (true rapid spree in one window) still allowed
check('3-peak SHORT window (1.5s spree) accepted', isPickup({ ...ev(1.5, 1500, 400), peaks: 3 }), true);
// Legacy fixtures without peaks data unaffected
check('no peaks data → no rhythmic rejection', isPickup(ev(1.49, 2594)), true);

console.log('\n=== Threshold sanity ===');
check('confidence threshold unchanged at 30', THRESHOLDS.confidenceThreshold === 30, true);
check('peak window is 0.9-3.5g', THRESHOLDS.peakAccelMin === 0.9 && THRESHOLDS.peakAccelMax === 3.5, true);

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
