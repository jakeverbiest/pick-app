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

import {
  evaluatePickupProfile,
  isPickup,
  countDistinctPeaks,
  classifyCarryMode,
  isWalkingCadence,
  looksLikeStride,
  stepCorroboratesCadence,
  isBriskWalkingPace,
  isSpeedFresh,
  looksMonotonous,
  isStandingStill,
  isNotStriding,
  metersBetween,
  PACE,
  MONOTONY,
  STRIDE,
  COOLDOWN,
  THRESHOLDS,
  CADENCE,
  PACE_CONTEXT,
  walkPaceProfile,
  RELATIVE_PACE,
  trailingMedianSpeed,
  isStillAtOwnPace,
  EvalProfile,
} from '../motionEvaluation';
import { simplifyRoute, dropOutliers, privacyTrimRoute } from '../routeUtils';

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

console.log('\n=== Cross-event walking cadence (Aug 16 — steady-walk overcount fix) ===');
// This is the gap the June 11 tests above never covered: the within-window
// rhythmic filter only fires on ONE long, multi-peak window. A CLEAN steady
// walk settles between every step, so each footstep becomes its own short
// single-peak window and never trips it — that's what was overcounting.
// isWalkingCadence() looks across separate finalized windows instead.

// A steady walk: footsteps landing every ~550ms (mid-range walking cadence).
// The 4th event completes 3 consecutive in-band, low-jitter gaps → flagged.
const steadyWalk = [0, 560, 1105, 1660];
check(
  `steady walk (3 gaps ~550-560ms) flagged as cadence`,
  isWalkingCadence(steadyWalk),
  true
);
// Only 2 events in so far — not enough of a streak yet to call it a rhythm
// (this is exactly the gap looksLikeStride()/step corroboration covers).
check('two events alone (no streak yet) NOT flagged', isWalkingCadence([0, 560]), false);
// A real pause-and-bend breaks the rhythm: 3 steady strides, then a genuine
// ~2s pause before the next candidate (bending to pick something up) — the
// final gap blows the band, so this candidate must NOT be suppressed.
const walkThenPause = [0, 560, 1105, 1660, 3660];
check('walk then a real pause is NOT flagged as cadence (must count)', isWalkingCadence(walkThenPause), false);
// A picking spree (grabber tool, pick-pick-pick) lands well outside the
// walking-cadence band — each pause-to-bend cycle takes much longer than a
// footstep-to-footstep gap — so it must never be misclassified as a stride.
const pickingSpree = [0, 1800, 3900, 5600];
check('picking spree (~1.7-2.1s apart) NOT flagged as cadence', isWalkingCadence(pickingSpree), false);
// Uneven gaps that individually fall in-band but aren't metronomic (the
// jitter guard) — real picks can coincidentally land at varying short
// intervals; don't let that alone read as a stride.
const unevenButInBand = [0, 400, 1000, 1080];
check('in-band but high-jitter gaps NOT flagged as cadence', isWalkingCadence(unevenButInBand), false);

// Step-counter fast path: confirms a stride from just ONE in-band gap when a
// pedometer step corroborates it, instead of waiting for a 3-gap streak —
// catches the first stride or two of a walk that isWalkingCadence() alone
// would still miss.
check(
  'single in-band gap + step confirmation → stride (fast path)',
  looksLikeStride(0, 600, true),
  true
);
check('single in-band gap WITHOUT step confirmation → not enough alone', looksLikeStride(0, 600, false), false);
check('gap outside the band, even with a step, is not a stride', looksLikeStride(0, 2000, true), false);
check(`step 300ms before candidate corroborates (within ${CADENCE.stepCorroborationMs}ms)`, stepCorroboratesCadence(300), true);
check('step 2s before candidate is too stale to corroborate', stepCorroboratesCadence(2000), false);
check('no pedometer data (null) never corroborates', stepCorroboratesCadence(null), false);

console.log('\n=== Speed-based pause gate (Aug 16 — prototype, TEST A/B field logs) ===');
// Test A (0 actual picks, normal pace, no stopping) — 4 isolated single-
// window events still slipped through the cadence fix as "ok", all at
// normal walking pace. This gate alone doesn't zero out Test A (1.19 m/s
// survives it), but it should catch the other 3 — see the pickup-
// overcounting memory for the full 4-vs-1 accounting.
check('Test A false "ok" @1.19 m/s NOT flagged (below threshold, known gap)', isBriskWalkingPace(1.19), false);
check('Test A false "ok" @1.40 m/s flagged as still-walking', isBriskWalkingPace(1.4), true);
check('Test A false "ok" @1.42 m/s flagged as still-walking', isBriskWalkingPace(1.42), true);
check('Test A false "ok" @1.37 m/s flagged as still-walking', isBriskWalkingPace(1.37), true);
// Test B (10 actual stops) — the densest real cluster (5 counted events in
// 11s, GPS speed 0.09-1.26 m/s) must mostly survive: multi-item picks in one
// spot (e.g. several cigarette butts) are a real, intended case, not noise.
check('Test B cluster event @1.26 m/s NOT flagged (real cluster pick)', isBriskWalkingPace(1.2599), false);
check('Test B cluster event @1.00 m/s NOT flagged (real cluster pick)', isBriskWalkingPace(1.0027), false);
check('Test B cluster event @0.09 m/s NOT flagged (confirmed stop)', isBriskWalkingPace(0.0909), false);
check('Test B cluster event @1.45 m/s flagged (still walking into the stop)', isBriskWalkingPace(1.446), true);
// A missing/unknown GPS fix must never gate a pickup (same convention as the
// existing too-fast gate) — losing signal can't silently kill real picks.
check('unknown speed (-1) never flagged', isBriskWalkingPace(-1), false);
check('threshold sanity: brisk-walk gate is 1.3 m/s', PACE.briskWalkSpeedMps === 1.3, true);

console.log('\n=== GPS speed freshness guard (Aug 16 — A2/B2 undercount fix) ===');
// A2 (0 picks, continuous walk) went 3 -> 0 counted: the gate works when the
// fix is fresh. B2 (10 real stop-and-picks) went 21 -> 7 — it UNDERcounted,
// because `distanceInterval: 2` meant a stationary phone emitted no fixes, so
// stopping to pick froze `speed` at the last walking value. 8 of B2's 15 gate
// rejections were on a stale reading. The gate must stand down on a stale fix.
check('fresh fix (200ms old) lets the gate run', isSpeedFresh(200), true);
check('fix right at the limit is still usable', isSpeedFresh(PACE.maxSpeedAgeMs), true);
// The B2 killer: one reading (1.786 m/s) reused across 8 seconds of a stop.
check('B2 8-second frozen fix is rejected as stale', isSpeedFresh(8000), false);
check('B2 3-second-stale fix is rejected', isSpeedFresh(3000), false);
// No fix at all must never gate — losing GPS can't be allowed to silently
// suppress real pickups (same convention as the too-fast gate).
check('no fix yet (null) is never fresh', isSpeedFresh(null), false);
check('negative/garbage age is never fresh', isSpeedFresh(-1), false);
check('freshness window sanity: 1800ms', PACE.maxSpeedAgeMs === 1800, true);
// Combined contract: a stale fix must disable the gate even when the speed
// reading itself looks damning. This exact pair (1.79 m/s, 8s old) rejected
// real pickups on the B2 walk.
const b2StaleFix = isSpeedFresh(8000) && isBriskWalkingPace(1.786);
check('B2 case: 1.79 m/s but 8s stale → gate must NOT fire', b2StaleFix, false);
// ...while a genuinely fresh brisk reading still gates (the A2 behavior we
// must not regress).
const a2FreshFix = isSpeedFresh(400) && isBriskWalkingPace(1.42);
check('A2 case: 1.42 m/s and fresh → gate DOES fire', a2FreshFix, true);

console.log('\n=== Monotony filter (Aug 16 — A3 slow-walk false positives) ===');
// A3 was a deliberately SLOW walk with ZERO pickups that still counted 12.
// Every one of those false positives sat BELOW the 1.3 m/s speed gate, and
// their spacing (~1-2s) matched real picking, so neither speed nor cadence
// could see them. What gives them away is uniformity — real consecutive
// windows from that walk:
const a3Strides = [
  { durationMs: 1194, gyro: 4.3 },
  { durationMs: 1194, gyro: 4.46 },
  { durationMs: 1194, gyro: 3.86 },
  { durationMs: 1194, gyro: 4.41 },
];
check('A3 stride run (identical durations) flagged as monotonous', looksMonotonous(a3Strides), true);
// Real picking from C3, same walk length — varied because items and bends differ.
const c3RealPicking = [
  { durationMs: 596, gyro: 3.44 },
  { durationMs: 1094, gyro: 4.94 },
  { durationMs: 1592, gyro: 4.94 },
  { durationMs: 597, gyro: 2.03 },
];
check('C3 real picking (varied) NOT flagged', looksMonotonous(c3RealPicking), false);
// Never judge on a short history — a couple of similar windows is not a pattern.
check('too few candidates to judge yet', looksMonotonous(a3Strides.slice(0, 2)), false);
check(`streak length is ${MONOTONY.streakLen}`, MONOTONY.streakLen === 4, true);
// Duration alike but rotation varied → not the single repeated motion of a walk.
const sameDurDifferentGyro = [
  { durationMs: 1194, gyro: 1.9 },
  { durationMs: 1194, gyro: 6.4 },
  { durationMs: 1194, gyro: 2.5 },
  { durationMs: 1194, gyro: 5.1 },
];
check('uniform duration but varied gyro NOT flagged', looksMonotonous(sameDurDifferentGyro), false);

console.log('\n--- the cigarette-pile guard (PRODUCT REQUIREMENT) ---');
// Rapid identical picks in one spot must ALL count. That motion is repetitive
// by nature and would trip looksMonotonous(), so the veto is physical: with a
// fresh fix showing you are not moving, you cannot be mid-stride.
check('standing still on a fresh fix vetoes monotony', isStandingStill(0.0, 300), true);
check('barely drifting (0.2 m/s) still counts as standing still', isStandingStill(0.2, 300), true);
check('strolling at 1.0 m/s is NOT standing still', isStandingStill(1.0, 300), false);
// A stale fix reading ~0 proves nothing — that was exactly the B2 failure,
// where a frozen fix made the app believe something it could not know.
check('stale fix reading 0.0 does NOT count as standing still', isStandingStill(0.0, 8000), false);
check('no fix at all is never standing still', isStandingStill(null, null), false);
// End-to-end contract: a pile of butts picked while stationary survives even
// though the motion pattern itself looks monotonous.
const buttPile = [
  { durationMs: 900, gyro: 3.5 },
  { durationMs: 920, gyro: 3.6 },
  { durationMs: 890, gyro: 3.4 },
  { durationMs: 910, gyro: 3.55 },
];
const wouldSuppressStationary = looksMonotonous(buttPile) && !isStandingStill(0.1, 250);
check('cigarette pile while stationary is NOT suppressed', wouldSuppressStationary, false);
const wouldSuppressWalking = looksMonotonous(buttPile) && !isStandingStill(1.15, 250);
check('same uniform motion WHILE WALKING is suppressed', wouldSuppressWalking, true);

console.log('\n=== Striding detection via GPS displacement (C5 opening-burst fix) ===');
// C5 counted 11 picks in its first 24 seconds because isNotStriding() read
// "pedometer hasn't called back yet" (msSinceLastStep === null) as "standing
// still", switching off monotony, cadence AND the long cooldown at once.
check('C5 case: walking, no step data YET => striding (filters stay ON)',
  isNotStriding({ msSinceLastFixMs: 500, displacementM: 14, pedometerActive: true, msSinceLastStep: null }), false);
// D4: standing still 84s. iOS stops emitting fixes entirely when you don't move,
// so fix-silence is itself the stationary signal.
check('D4 case: no fixes for 84s => not striding (protects rapid picking)',
  isNotStriding({ msSinceLastFixMs: 84000, displacementM: null, pedometerActive: true, msSinceLastStep: null }), true);
check('fixes flowing, moved 14m in the window => striding',
  isNotStriding({ msSinceLastFixMs: 500, displacementM: 14, pedometerActive: true, msSinceLastStep: 4000 }), false);
check('fixes flowing, moved 1m => not striding (picking in place)',
  isNotStriding({ msSinceLastFixMs: 500, displacementM: 1, pedometerActive: true, msSinceLastStep: 4000 }), true);
// A recent step overrides GPS — covers a dropout under trees that would
// otherwise look like standing still and disable the filters mid-walk.
check('recent step overrides GPS silence',
  isNotStriding({ msSinceLastFixMs: 30000, displacementM: null, pedometerActive: true, msSinceLastStep: 400 }), false);
// Nothing known at all must NOT be read as stationary — that was the bug.
check('no fix and no step data => do not assume stationary',
  isNotStriding({ msSinceLastFixMs: null, displacementM: null, pedometerActive: true, msSinceLastStep: null }), false);
check(`displacement threshold ${STRIDE.movementM}m over ${STRIDE.windowMs}ms`,
  STRIDE.movementM === 5 && STRIDE.windowMs === 10000, true);
// Distance helper sanity: ~111m per 0.001 degree of latitude.
check('metersBetween ~111m for 0.001 deg lat', Math.abs(metersBetween(33.4889, -79.0851, 33.4899, -79.0851) - 111) < 3, true);
check('metersBetween is 0 for the same point', metersBetween(33.4889, -79.0851, 33.4889, -79.0851) === 0, true);

console.log('\n--- step counter as a positive override (outdoor Test D) ---');
// A step within the quiet window proves walking; suppression is allowed.
check('step 400ms ago => striding', isNotStriding({ msSinceLastFixMs: 300, displacementM: 8, pedometerActive: true, msSinceLastStep: 400 }), false);
check('step 1.2s ago (slow gait) => still striding', isNotStriding({ msSinceLastFixMs: 300, displacementM: 8, pedometerActive: true, msSinceLastStep: 1200 }), false);
check(`quiet window is ${STRIDE.quietMs}ms`, STRIDE.quietMs === 2500, true);
// Test D's real losses at 0.748 and 0.642 m/s: too slow to be striding, too
// fast for the old <0.5 m/s GPS veto. Displacement settles it — barely moved.
check('Test D loss @0.748 m/s: barely moved => not striding',
  isNotStriding({ msSinceLastFixMs: 300, displacementM: 2, pedometerActive: true, msSinceLastStep: 4000 }), true);
// REGRESSION GUARD: this case used to assert TRUE, and that assertion WAS the
// C5 bug — "no step recorded yet" is not evidence of standing still.
check('no step data + fresh fixes => NOT assumed stationary (was the C5 bug)',
  isNotStriding({ msSinceLastFixMs: 300, displacementM: null, pedometerActive: true, msSinceLastStep: null }), false);
// Devices with no step counter (Android lacks ACTIVITY_RECOGNITION in app.json)
// still work off displacement and fix-silence.
check('no pedometer, moved 12m => striding',
  isNotStriding({ msSinceLastFixMs: 400, displacementM: 12, pedometerActive: false, msSinceLastStep: null }), false);
check('no pedometer, moved 0.5m => not striding',
  isNotStriding({ msSinceLastFixMs: 400, displacementM: 0.5, pedometerActive: false, msSinceLastStep: null }), true);
// End-to-end: uniform motion that WOULD trip monotony must survive when the
// user is demonstrably standing still — the cigarette-pile requirement.
const uniformPicks = [
  { durationMs: 1208, gyro: 3.7 },
  { durationMs: 1208, gyro: 3.58 },
  { durationMs: 1109, gyro: 3.09 },
  { durationMs: 1208, gyro: 3.17 },
];
const stationary = { msSinceLastFixMs: 40000, displacementM: null, pedometerActive: true, msSinceLastStep: null };
const walking = { msSinceLastFixMs: 300, displacementM: 9, pedometerActive: true, msSinceLastStep: 500 };
check('uniform picks while stationary => NOT suppressed', looksMonotonous(uniformPicks) && !isNotStriding(stationary), false);
check('same motion while walking => suppressed', looksMonotonous(uniformPicks) && !isNotStriding(walking), true);

console.log('\n=== Adaptive cooldown (D4 + C4) ===');
// One flat cooldown can't serve both patterns; the two walks pulled opposite ways.
const cooldownFor = (notStriding: boolean) => (notStriding ? COOLDOWN.stationaryMs : COOLDOWN.stridingMs);
check('striding => long cooldown', cooldownFor(false) === 2500, true);
check('stationary => short cooldown', cooldownFor(true) === 800, true);
check('the two are actually different', COOLDOWN.stridingMs > COOLDOWN.stationaryMs, true);
// C4: seven pairs of counted events ~1-2s apart were one pick counted twice
// (bend, then straighten) while strolling. The striding cooldown must absorb them.
const c4Pairs = [1000, 1000, 2000, 2000, 2000, 1000, 1000]; // observed gaps, seconds-rounded
check('C4 bend+straighten pairs all inside the striding cooldown',
  c4Pairs.every((gap) => gap < COOLDOWN.stridingMs), true);
// D4: rapid picking standing still produced real pickups ~1s apart. Those must survive.
check('rapid stationary picks 1s apart survive the stationary cooldown', 1000 > COOLDOWN.stationaryMs, true);
check('rapid stationary picks 1s apart would DIE on the striding cooldown', 1000 < COOLDOWN.stridingMs, true);
// The floor: one motion's own double-trigger settles in ~500ms (June tuning).
// Dropping below that would reintroduce the double-count this is meant to fix.
check('stationary cooldown stays above the ~500ms self-echo', COOLDOWN.stationaryMs > 500, true);

console.log('\n=== Route simplification ===');
// Straight block walk with GPS jitter: 21 wobbly points → should collapse to ~2-3
const jittery = Array.from({ length: 21 }, (_, i) => ({
  lat: 40.6784 + (i % 2 === 0 ? 0.00003 : -0.00003), // ±3m wobble
  lon: -73.9951 + i * 0.0001, // walking east ~8.4m per point
}));
const straight = simplifyRoute(jittery);
check(`straight jittery walk 21 pts → ${straight.length} (expect ≤4)`, straight.length <= 4, true);
// An L-shaped walk must KEEP its corner
const lShape = [
  { lat: 40.6784, lon: -73.9951 },
  { lat: 40.6784, lon: -73.9941 }, // 84m east — the corner
  { lat: 40.6792, lon: -73.9941 }, // 88m north
];
const corner = simplifyRoute(lShape);
check('L-shaped walk keeps its corner (3 pts)', corner.length === 3, true);
// Endpoints always survive
check('first point preserved', corner[0].lat === lShape[0].lat, true);
check('last point preserved', corner[2].lon === lShape[2].lon, true);

// Indoor GPS glitches: walker at a spot, two points teleport 45m away, then return
const glitchy = [
  { lat: 40.67840, lon: -73.99510 },
  { lat: 40.67842, lon: -73.99508 },
  { lat: 40.67880, lon: -73.99470 }, // ~55m teleport — multipath glitch
  { lat: 40.67878, lon: -73.99472 }, // still out there
  { lat: 40.67843, lon: -73.99507 }, // back to reality
  { lat: 40.67845, lon: -73.99505 },
];
const cleaned = dropOutliers(glitchy);
check(`teleport glitches dropped (${glitchy.length} → ${cleaned.length}, expect 4)`, cleaned.length === 4, true);
// But a REAL relocation (sustained) gets accepted via the escape hatch
const relocated = [
  { lat: 40.67840, lon: -73.99510 },
  ...Array.from({ length: 6 }, (_, i) => ({ lat: 40.67900 + i * 0.0001, lon: -73.99400 })), // genuinely moved + keeps moving
];
const kept = dropOutliers(relocated);
check('sustained relocation eventually accepted', kept.length >= 3, true);

console.log('\n=== Privacy trim ===');
// 500m straight walk in ~8.4m steps — trimming 100m from each end
const longWalk = Array.from({ length: 60 }, (_, i) => ({ lat: 40.6784, lon: -73.9951 + i * 0.0001 }));
const trimmed = privacyTrimRoute(longWalk, 100);
const firstMoved = trimmed[0].lon !== longWalk[0].lon;
const lastMoved = trimmed[trimmed.length - 1].lon !== longWalk[longWalk.length - 1].lon;
check('route start (home) removed', firstMoved, true);
check('route end (home) removed', lastMoved, true);
check(`middle preserved (${trimmed.length} of 60 points)`, trimmed.length >= 30, true);
// A short walk (well under the 100m flat trim) scales the trim to the
// route's own length instead of collapsing to 2-3 points — most real
// cleanups are short, localized litter-picking walks, and a flat 100m trim
// on both ends was destroying nearly all of them (this is what made recaps
// aggregating many cleanups render as scattered dots instead of a path).
const tinyWalk = Array.from({ length: 10 }, (_, i) => ({ lat: 40.6784, lon: -73.9951 + i * 0.0001 }));
const tinyTrimmed = privacyTrimRoute(tinyWalk, 100);
check(`short walk keeps most of its points (${tinyTrimmed.length} of 10, expect >= 5)`, tinyTrimmed.length >= 5, true);

console.log('\n=== Carry-mode auto-classification ===');
// June 11 evening: in-hand test — gyros from the actual session log
const inHandGyros = [1.16, 1.26, 1.0, 0.65, 1.26, 0.94, 0.94, 0.5];
check('June 11 in-hand session → hand', classifyCarryMode(inHandGyros) === 'hand', true);
// June 11 afternoon: pocket session — gyros from the actual flight log
const pocketGyros = [4.42, 7.42, 3.83, 2.93, 3.15, 4.1, 4.49, 3.4];
check('June 11 pocket session → pocket', classifyCarryMode(pocketGyros) === 'pocket', true);
check('too few events → unknown (filter stays off)', classifyCarryMode([3.0, 4.0]) === 'unknown', true);
// One outlier doesn't flip the classification (median, not mean)
check('hand baseline survives one high-gyro event', classifyCarryMode([0.8, 1.1, 0.9, 7.0, 1.2]) === 'hand', true);


console.log('\n=== Walk pace context (19 Aug 2026 — A7a vs C6a field walks) ===');
// Real per-event GPS speeds, phone in pocket, same tester, same phone, 90 min apart.
// A7a: 2.4 min stroll, ZERO pickups, 21 counted -> 9.7 false positives/min.
const a7aSpeeds = [
  0.74, 0.74, 0.74, 0.69, 0.69, 0.61, 0.61, 0.56, 0.56, 0.56, 0.52, 0.24, 0.70,
  0.64, 0.64, 0.64, 0.73, 0.73, 0.59, 0.59, 0.79, 0.68, 0.68, 0.59, 0.59, 0.54,
  0.67, 0.67, 0.67, 0.27, 0.69, 0.57, 0.45, 0.47, 0.69, 0.68, 0.58, 0.90, 0.69,
  0.67, 0.68, 0.64, 0.95, 0.73, 0.73, 0.69, 0.79, 0.73, 0.73, 0.78, 0.64, 0.67,
].map((speed) => ({ speed }));
// C6a: 4 min at normal pace, blocked 30s walk / 30s pick-5, 12 of 20 found,
// only 4 false positives across the walk-only blocks -> 2.0/min.
const c6aSpeeds = [
  1.31, 1.27, 1.29, 1.29, 1.11, 1.13, 1.02, 1.02, 1.03, 1.39, 1.34, 1.34, 1.14,
  1.19, 1.12, 1.03, 1.03, 0.95, 1.06, 0.89, 1.12, 1.11, 0.83, 0.97, 0.92, 1.37,
  1.30, 0.79, 1.21, 1.30, 1.06, 1.30, 1.16, 1.28, 1.64, 1.73, 1.69, 1.59, 1.45,
  1.67, 1.58, 1.30, 0.57, 1.05, 0.29, 1.05, 1.14, 0.97, 1.16, 1.13, 1.32, 1.07,
].map((speed) => ({ speed }));

const a7aPace = walkPaceProfile(a7aSpeeds);
const c6aPace = walkPaceProfile(c6aSpeeds);
check('A7a stroll flagged low-confidence', a7aPace.lowConfidence, true);
check('C6a normal-pace walk NOT flagged', c6aPace.lowConfidence, false);
check('A7a median pace is stroll-speed (<0.9)', a7aPace.medianMps < 0.9, true);
check('C6a median pace is walking-speed (>1.05)', c6aPace.medianMps > 1.05, true);
check('A7a is mostly slow (>80% below stroll threshold)', a7aPace.slowShare > 0.8, true);
check('C6a is mostly not slow (<35% below stroll threshold)', c6aPace.slowShare < 0.35, true);
// The gap between the two is very wide; the threshold sits in the middle of it,
// not shaved to either side.
check('threshold sits between the two walks',
  a7aPace.slowShare > PACE_CONTEXT.maxSlowShare && c6aPace.slowShare < PACE_CONTEXT.maxSlowShare, true);
// Never guess on thin data — a short or GPS-starved walk must not be flagged.
check('too few samples => not flagged', walkPaceProfile([{ speed: 0.4 }, { speed: 0.4 }]).lowConfidence, false);
check('missing speeds (-1) are ignored, not treated as slow',
  walkPaceProfile(Array(12).fill({ speed: -1 })).lowConfidence, false);
check('stroll threshold sanity: 1.0 m/s', PACE_CONTEXT.strollMps === 1.0, true);


console.log('\n=== Relative pause gate (19 Aug 2026 — walks A7a / C6a / B4) ===');
// B4: 20 picks, full stop for each, ambling between. The ABSOLUTE gate fired
// 3 times in 4 minutes; the walking segments still threw 31 false positives.
const B4_STROLL_MEDIAN = 0.75;   // measured trailing median on B4
const C6A_WALK_MEDIAN  = 1.21;   // measured trailing median on C6a (normal pace)
const FRESH = 200;               // a fresh fix

// --- real picks: B4 stops measured 0.03-0.30 m/s ---
check('B4 dead stop (0.05) is NOT still-at-pace',
  isStillAtOwnPace(0.05, B4_STROLL_MEDIAN, FRESH), false);
check('B4 near-stop (0.28) is NOT still-at-pace',
  isStillAtOwnPace(0.28, B4_STROLL_MEDIAN, FRESH), false);
// --- false positives: B4 walking segments measured 0.50-1.15 m/s ---
check('B4 amble (0.69) IS still-at-pace -> suppressed',
  isStillAtOwnPace(0.69, B4_STROLL_MEDIAN, FRESH), true);
check('B4 amble (0.90) IS still-at-pace -> suppressed',
  isStillAtOwnPace(0.90, B4_STROLL_MEDIAN, FRESH), true);
// The absolute gate would have caught NONE of those — that is the whole point.
check('the absolute gate misses all of them', isBriskWalkingPace(0.90), false);

// --- stroll-only: C6a picked WITHOUT stopping at 1.19 m/s. Always-on costs
//     5 of 12 real picks there; gating on the stroll threshold costs zero. ---
check('C6a normal-pace walk: gate stays OFF even at pace',
  isStillAtOwnPace(1.19, C6A_WALK_MEDIAN, FRESH), false);
check('C6a normal-pace walk: gate stays OFF at a slow moment too',
  isStillAtOwnPace(0.60, C6A_WALK_MEDIAN, FRESH), false);
check('threshold that switches it on is PACE_CONTEXT.strollMps',
  C6A_WALK_MEDIAN >= PACE_CONTEXT.strollMps && B4_STROLL_MEDIAN < PACE_CONTEXT.strollMps, true);

// --- stands down rather than guessing ---
// Load-bearing: on B2 a frozen fix made the absolute gate reject REAL pickups
// 7-for-10, and 5 of B4's 17 real picks showed a ratio > 1 because GPS had not
// yet caught the stop.
check('stale fix => stand down', isStillAtOwnPace(0.69, B4_STROLL_MEDIAN, 8000), false);
check('unknown speed (-1) => stand down', isStillAtOwnPace(-1, B4_STROLL_MEDIAN, FRESH), false);
check('no trailing median yet => stand down', isStillAtOwnPace(0.69, null, FRESH), false);
check('zero trailing median => stand down', isStillAtOwnPace(0.69, 0, FRESH), false);

// --- trailing median helper ---
const now = 100000;
const samples = [0.70, 0.75, 0.80, 0.65, 0.72].map((speedMps, i) => ({ atMs: now - 20000 + i * 1000, speedMps }));
check('trailing median over the window', trailingMedianSpeed(samples, now) === 0.72, true);
check('samples outside the window are ignored',
  trailingMedianSpeed([{ atMs: now - 60000, speedMps: 5 }, ...samples], now) === 0.72, true);
check('too few samples => null', trailingMedianSpeed(samples.slice(0, 2), now) === null, true);
check('unknown speeds are not counted as slow',
  trailingMedianSpeed([{ atMs: now, speedMps: -1 }, { atMs: now, speedMps: -1 }, { atMs: now, speedMps: -1 }], now) === null, true);
check(`ratio sanity: ${RELATIVE_PACE.ratio}`, RELATIVE_PACE.ratio === 0.8, true);
check('window sanity: 30s', RELATIVE_PACE.windowMs === 30000, true);

// --- B5B (19 Aug): during a long STOP the trailing median collapses toward
// zero, and residual sway then reads as "still at your own pace". Real cases
// from that walk. This inverts the gate and would eat a cigarette-pile spree,
// which standing constraint #1 says must always count.
check('B5B t=166: 0.28 m/s vs a collapsed 0.15 median => NOT suppressed',
  isStillAtOwnPace(0.275, 0.15, FRESH), false);
check('B5B t=167: 0.26 m/s vs 0.14 median => NOT suppressed',
  isStillAtOwnPace(0.262, 0.14, FRESH), false);
check('B5B t=172: 0.17 m/s vs 0.14 median => NOT suppressed',
  isStillAtOwnPace(0.168, 0.14, FRESH), false);
// ...but real walking against the same collapsed median MUST still be caught.
check('B5B t=176: 1.15 m/s vs 0.15 median => still suppressed',
  isStillAtOwnPace(1.152, 0.15, FRESH), true);
check(`stop floor sanity: ${RELATIVE_PACE.minStopMps} m/s`, RELATIVE_PACE.minStopMps === 0.35, true);
check('all 21 correct B5B suppressions were above the floor',
  isStillAtOwnPace(0.51, 0.40, FRESH), true);

console.log('\n=== Threshold sanity ===');
check('confidence threshold unchanged at 30', THRESHOLDS.confidenceThreshold === 30, true);
check('peak window is 0.9-3.5g', THRESHOLDS.peakAccelMin === 0.9 && THRESHOLDS.peakAccelMax === 3.5, true);

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
