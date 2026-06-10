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

import { evaluatePickupProfile, isPickup, THRESHOLDS, EvalProfile } from '../motionEvaluation';

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

console.log('\n=== Threshold sanity ===');
check('confidence threshold unchanged at 30', THRESHOLDS.confidenceThreshold === 30, true);
check('peak window is 0.9-3.5g', THRESHOLDS.peakAccelMin === 0.9 && THRESHOLDS.peakAccelMax === 3.5, true);

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
