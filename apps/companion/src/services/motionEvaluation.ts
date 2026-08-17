/**
 * Motion Evaluation — pure, testable pickup-profile scoring.
 *
 * Single source of truth for detection thresholds. No React Native imports,
 * so it runs in plain Node for regression tests (see
 * __tests__/detectorRegression.ts) and replays of field logs.
 *
 * History:
 * - May 31: validated 79% apartment / 100% street with 1.6g peak cap
 * - Jun 10: field walk showed real street pickups peak 1.68-3.59g;
 *   cap widened to 3.5g (penalty above 2.5g), timing extended to the
 *   full 2500ms recording window.
 * - Aug 16: diagnosed steady-walk overcounting — the rhythmic filter below
 *   only catches walking spikes bunched into ONE long window. A clean, even
 *   stride settles fully between steps, so each footstep finalizes as its
 *   own short single-peak window and never trips that filter. Added
 *   isWalkingCadence()/looksLikeStride() to catch the pattern ACROSS windows
 *   instead. NOT yet field-validated — see comments below.
 */

export interface EvalProfile {
  duration: number; // ms
  peakAccel: number; // g
  peakAccelTime: number; // ms from recording start
  peakGyro: number;
  lastAccel: number; // final sample, for settling check
  peaks?: number; // distinct accel spikes (from countDistinctPeaks)
}

export interface EvalResult {
  confidence: number; // 0 if any hard check fails
  reason: string; // 'ok' or which hard check failed
}

export const THRESHOLDS = {
  durationMin: 500,
  durationMax: 5000,
  peakAccelMin: 0.9,
  peakAccelMax: 3.5, // Jun 10: was 1.6 — rejected 9/15 real pickups
  peakTimingMin: 0,
  peakTimingMax: 2500, // Jun 10: was 2000 — must cover the force-finalize window
  settlingDropMin: 0.02,
  baseConfidence: 40,
  settlingBonus: 15, // settlingDrop > 0.2
  durationBonus: 10, // within 800ms of target
  targetDuration: 1600,
  sweetSpotBonus: 10, // peak 1.0-1.8g
  sweetSpotMin: 1.0,
  sweetSpotMax: 1.8,
  highPeakPenalty: 10, // peak > 2.5g — plausible but less certain
  highPeakThreshold: 2.5,
  gyroBonus: 5, // peakGyro > 0.6
  gyroThreshold: 0.6,
  confidenceThreshold: 30, // minimum to fire a pickup
} as const;

export function evaluatePickupProfile(p: EvalProfile): EvalResult {
  const T = THRESHOLDS;

  // Rhythmic walking filter (June 11 pocket session): walking strides fill a
  // long window with step-cadence spikes (observed: peaks 4-5 over ~2.6s).
  // Real pickups finalize in <1.5s with 1-2 peaks now that settling works.
  if ((p.peaks ?? 1) >= 3 && p.duration >= 2000) {
    return { confidence: 0, reason: `rhythmic motion: ${p.peaks} peaks over ${p.duration}ms (walking?)` };
  }

  if (p.duration < T.durationMin || p.duration > T.durationMax) {
    return { confidence: 0, reason: `duration ${p.duration}ms (need ${T.durationMin}-${T.durationMax})` };
  }
  if (p.peakAccel < T.peakAccelMin || p.peakAccel > T.peakAccelMax) {
    return { confidence: 0, reason: `peak ${p.peakAccel.toFixed(2)}g (need ${T.peakAccelMin}-${T.peakAccelMax})` };
  }
  if (p.peakAccelTime < T.peakTimingMin || p.peakAccelTime > T.peakTimingMax) {
    return { confidence: 0, reason: `peak timing ${p.peakAccelTime}ms (need ${T.peakTimingMin}-${T.peakTimingMax})` };
  }
  const settlingDrop = p.peakAccel - p.lastAccel;
  if (settlingDrop < T.settlingDropMin) {
    return { confidence: 0, reason: `settling ${settlingDrop.toFixed(3)}g (need >${T.settlingDropMin})` };
  }

  let confidence = T.baseConfidence;
  if (settlingDrop > 0.2) confidence += T.settlingBonus;
  if (Math.abs(p.duration - T.targetDuration) < 800) confidence += T.durationBonus;
  if (p.peakAccel >= T.sweetSpotMin && p.peakAccel <= T.sweetSpotMax) confidence += T.sweetSpotBonus;
  if (p.peakAccel > T.highPeakThreshold) confidence -= T.highPeakPenalty;
  if (p.peakGyro > T.gyroThreshold) confidence += T.gyroBonus;

  return { confidence: Math.max(0, Math.min(100, confidence)), reason: 'ok' };
}

export function isPickup(p: EvalProfile): boolean {
  return evaluatePickupProfile(p).confidence > THRESHOLDS.confidenceThreshold;
}

/**
 * Cross-event walking-cadence detector (Aug 16 tuning).
 *
 * The rhythmic filter in evaluatePickupProfile() only looks INSIDE one
 * recording window (peaks>=3 over >=2000ms) — that catches a sloppy, bunched
 * walking burst but completely misses a clean, steady stride, where each
 * footstep settles back to rest before the next one and finalizes as its own
 * short, single-peak window. Every per-window metric on that window looks
 * exactly like an isolated real pickup. This pair of functions looks ACROSS
 * separate finalized windows instead of within one: a real pickup means
 * pausing to bend, which breaks a regular stride-to-stride spacing, so a run
 * of evenly-spaced candidates is treated as an ongoing walk, not a run of
 * separate pickups.
 *
 * NOT yet field-validated. The interval band is a starting estimate from
 * typical walking cadence (90-130 steps/min = 460-670ms/step), widened for
 * margin — re-tune against a real flight-recorder log before trusting it,
 * same as every other threshold in this file.
 */
export const CADENCE = {
  minGapMs: 350, // faster than this isn't a plausible footstep-to-footstep gap
  maxGapMs: 1100, // slower than this isn't "mid-stride" — could be a real pause
  streakLen: 3, // this many CONSECUTIVE in-band gaps = walking rhythm (mirrors peaks>=3 above)
  maxJitterMs: 200, // gaps must also be close to EACH OTHER, not just each individually
  // in-band — a picking spree (bend/grab/stand per pick) can coincidentally
  // land inside the band but won't be this metronomically even.
  stepCorroborationMs: 700, // a pedometer step landing this close to a candidate corroborates "still walking"
} as const;

/**
 * `times` = timestamps (ms) of recent shape-accepted candidates, oldest
 * first, ending with the event under evaluation right now. True if the
 * newest event looks like part of an ongoing walking stride.
 */
export function isWalkingCadence(times: number[]): boolean {
  const n = CADENCE.streakLen;
  if (!times || times.length < n + 1) return false;
  const recent = times.slice(-(n + 1));
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) gaps.push(recent[i] - recent[i - 1]);
  const inBand = gaps.every((g) => g >= CADENCE.minGapMs && g <= CADENCE.maxGapMs);
  if (!inBand) return false;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return gaps.every((g) => Math.abs(g - mean) <= CADENCE.maxJitterMs);
}

/**
 * Whether a pedometer step landed close enough to a candidate event to
 * corroborate "still actively walking." CMPedometer's live callback timing
 * is batched/coarse, not a precise per-step clock, so this is corroborating
 * evidence, not a standalone veto — see looksLikeStride().
 */
export function stepCorroboratesCadence(msSinceLastStep: number | null): boolean {
  return msSinceLastStep !== null && msSinceLastStep >= 0 && msSinceLastStep <= CADENCE.stepCorroborationMs;
}

/**
 * Fast-path stride check: isWalkingCadence() needs 3 consecutive in-band
 * gaps before it's confident, which lets the first 1-2 strides of a walk (or
 * the strides right after a real pickup, before a new streak rebuilds) leak
 * through. If the phone's step counter confirms a step landed on this exact
 * candidate AND the gap since the previous candidate is in the same walking
 * band, that single data point is corroborated enough to suppress on its own.
 */
export function looksLikeStride(prevTime: number | undefined, curTime: number, stepConfirmed: boolean): boolean {
  if (prevTime === undefined || !stepConfirmed) return false;
  const gap = curTime - prevTime;
  return gap >= CADENCE.minGapMs && gap <= CADENCE.maxGapMs;
}

/**
 * Speed-based pause gate (Aug 16 tuning, prototype — NOT yet field-validated
 * beyond the two logs below).
 *
 * Field tests the same day: Test A (0 actual picks, normal walking pace, no
 * stopping) still produced 4 "ok" false positives after the cadence fix
 * above — isolated single-window spikes that cadence detection structurally
 * can't catch, since it only fires on REPEATED evenly-spaced candidates, not
 * a lone spike. Test B (10 actual stops mixed with walking) produced 21
 * "ok" events; most weren't random noise but real stops, several of which
 * clustered (multiple counted windows a few seconds apart around one
 * location) — that clustering must be PRESERVED, not suppressed: Jake's
 * stated real-world case is picking several items back-to-back in one spot
 * (e.g. a handful of cigarette butts), and each should count.
 *
 * The two logs split cleanly on GPS speed: every confirmed-isolated false
 * positive in Test A sat at 1.19-1.42 m/s (normal walking pace); Test B's
 * likely-real events ranged from a full stop (0.09 m/s) down to a partial
 * slowdown around 0.7-1.0 m/s while still progressing down the block — Jake
 * describes the normal technique as a continuous SLOW WALK down a street,
 * not a full halt per item, so this can't be a near-zero-only gate without
 * killing real picks. 1.3 m/s was the threshold that best balanced both
 * logs (Test A false "ok" events: 4 -> 1; Test B: 21 -> 13 against an actual
 * of 10, while keeping 4 of the 5 events in its densest real cluster).
 *
 * Explicitly does NOT touch cadence or cooldown — clustered/rapid real
 * picks must still each count. Also does NOT resolve every ambiguity: two
 * of Test B's counted events (2s apart, identical near-zero GPS speed) may
 * be one real pickup double-counted, or two real picks at one stop — this
 * gate can't tell the difference and isn't trying to.
 *
 * NEEDED before trusting this in production: a field walk that's a
 * deliberate continuous slow-stroll-and-pick with NO full stops (the
 * "normal Pick technique" case), to confirm the threshold doesn't reject
 * real picks made without breaking stride.
 */
export const PACE = {
  briskWalkSpeedMps: 1.3,
  // Aug 16 (A2/B2): a GPS fix older than this can't be trusted to describe
  // what the body is doing RIGHT NOW, so the pause gate stands down rather
  // than judging a pickup on a stale reading. See isSpeedFresh() below for
  // the field evidence — this is the single most important guard on the gate.
  maxSpeedAgeMs: 1800,
} as const;

/**
 * True if GPS speed indicates still-normal-walking-pace — i.e. probably not
 * paused to pick. Never gates on missing/unknown speed, same convention as
 * the existing too-fast-for-a-pickup gate in motionDetection.ts.
 */
export function isBriskWalkingPace(speedMps: number | null | undefined): boolean {
  return speedMps !== null && speedMps !== undefined && speedMps >= 0 && speedMps > PACE.briskWalkSpeedMps;
}

/**
 * Whether the GPS fix behind `speed` is recent enough to judge a pickup on.
 *
 * WHY THIS EXISTS (field tests A2/B2, 16 Aug 2026 — the pause gate's first
 * real walk). A2 (continuous walking, 0 picks) went 3 -> 0 counted: perfect.
 * But B2 (10 real stop-and-pick) went 21 -> 7, i.e. it flipped from
 * overcounting to UNDERcounting, rejecting real pickups.
 *
 * Root cause was not the 1.3 m/s threshold — it was the input. The detector's
 * `watchPositionAsync` ran with `distanceInterval: 2` (a battery tune), and
 * iOS treats that as a hard distance FILTER: a stationary phone generates no
 * fixes at all. So the instant you stopped to pick something up, GPS stopped
 * updating and `speed` froze at your last WALKING value — the act of stopping
 * prevented the GPS from ever reporting that you'd stopped. Self-defeating.
 * In the B2 log a single reading (1.786 m/s) was reused for 8 straight
 * seconds across a stop, and the gate rejected real pickups on it; 8 of 15
 * gate rejections that walk were on a demonstrably stale value.
 *
 * Two changes came out of it: `distanceInterval` dropped to 0 with a faster
 * `timeInterval` (so standing still still produces fixes, and a stop actually
 * reads as ~0 m/s), and this freshness check, so a stale fix disables the
 * gate instead of guessing with it. Verified against the A2 log that this
 * does NOT reopen A2's false positives: all three stale-gated A2 events had a
 * rhythmic walking window inside the preceding WALKING_CONTEXT_MS, so the
 * older walking-context suppression catches them anyway. That's the real
 * lesson — walking-context is the better pause detector; speed is only a
 * backstop, and only when the reading is actually fresh.
 */
export function isSpeedFresh(ageMs: number | null | undefined): boolean {
  return ageMs !== null && ageMs !== undefined && ageMs >= 0 && ageMs <= PACE.maxSpeedAgeMs;
}

/**
 * Monotony filter (Aug 16, from field tests A3 + C3).
 *
 * WHY: A3 (deliberately SLOW walk, zero pickups) produced 12 counted false
 * positives — worse than the original bug. Cause: the speed gate above only
 * discriminates when there's a speed CONTRAST between walking and picking.
 * B3 has one (walking 1.5-1.86 m/s, stops 0-0.25). A slow stroll does not:
 * A3's pure-walking events sat at 0.48-1.27 m/s and C3's real picks at
 * 0.00-1.28 — total overlap, and every one of A3's false positives fell
 * BELOW the 1.3 threshold, so the gate never even engaged. Since a
 * continuous slow walk is the normal Pick technique, speed cannot be the
 * primary mechanism.
 *
 * Timing can't do it either — a deliberately checked negative result. Gaps
 * between accepted candidates were ~1-2s in BOTH A3 (strides) and C3 (real
 * picks), so widening CADENCE.maxGapMs would not separate them and WOULD
 * endanger rapid back-to-back picking.
 *
 * What does separate them is HOMOGENEITY. Walking is one repeated mechanical
 * motion transmitted through the pocket, so its windows are near-identical;
 * real picking is irregular (different items, bends, reach). Measured over
 * A3's 13 false positives vs C3's 23 credited events:
 *
 *                    A3 strides          C3 real picking
 *   duration      1094-1393ms (sd 89)   596-1592ms (sd 304)  <- 3.4x
 *   gyro          3.37-4.64  (sd 0.40)  1.85-6.37  (sd 1.05) <- 2.7x
 *   exactly 2 pks 12 of 13              10 of 23
 *
 * PRESERVING RAPID IDENTICAL PICKS is an explicit product requirement (a
 * handful of cigarette butts in one spot must all count), and repeated
 * near-identical picking is exactly what this filter could wrongly eat. The
 * guard is physical rather than statistical: `isStandingStill()` — with a
 * FRESH fix showing you're essentially not moving, you cannot be mid-stride,
 * so monotony is never applied. That protects the canonical pile-picking
 * case by construction.
 *
 * Tuned against both logs: kills 11 of A3's 13 false positives while losing
 * 2 of C3's 23 real picks. Both losses were mid-stroll picks at ~0.9-1.0 m/s
 * that are genuinely indistinguishable from a stride on these features —
 * extra gyro/duration escape hatches were tried and rescued neither. Every
 * stationary pick survives. Widening the stationary threshold to 0.9 m/s
 * saves one of them but costs two more false positives; 0.5 was the better
 * balance. NOT yet field-validated — needs a walk that is deliberately rapid
 * identical picks in one spot.
 */
export const MONOTONY = {
  streakLen: 4, // consecutive near-identical candidates before this fires at all
  maxDurationSdMs: 150, // A3 strides sd 89; C3 real picking sd 304
  maxGyroSd: 0.6, // A3 strides sd 0.40; C3 real picking sd 1.05
  stationarySpeedMps: 0.5, // below this on a fresh fix = standing still = cannot be striding
} as const;

function stdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * `recent` = shape of recent accepted candidates, oldest first, ending with
 * the event being evaluated. True if the last MONOTONY.streakLen of them are
 * so alike they look like one repeated mechanical motion (walking) rather
 * than picking. Returns false until the streak has filled — never judges on
 * a short history.
 */
export function looksMonotonous(recent: Array<{ durationMs: number; gyro: number }>): boolean {
  const n = MONOTONY.streakLen;
  if (!recent || recent.length < n) return false;
  const w = recent.slice(-n);
  return (
    stdDev(w.map((e) => e.durationMs)) <= MONOTONY.maxDurationSdMs &&
    stdDev(w.map((e) => e.gyro)) <= MONOTONY.maxGyroSd
  );
}

/**
 * Physically standing still, on evidence we can trust. Requires a FRESH fix —
 * a stale one reading ~0 proves nothing (that was the B2 bug). Used only to
 * veto the monotony filter, never to count a pickup on its own.
 */
export function isStandingStill(speedMps: number | null | undefined, ageMs: number | null | undefined): boolean {
  if (!isSpeedFresh(ageMs)) return false;
  return speedMps !== null && speedMps !== undefined && speedMps >= 0 && speedMps < MONOTONY.stationarySpeedMps;
}

/**
 * "Am I actually striding right now?" — answered with the step counter
 * instead of GPS speed (Aug 16, from the outdoor Test D).
 *
 * WHY THE CHANGE OF INSTRUMENT. Test D was 10 rapid picks standing in one
 * spot, phone in pocket (Jake's normal carry). Two separate gates got it
 * wrong, and both were asking "am I walking?" while measuring GPS speed:
 *
 *  1. The onset gate (`hasStartedWalking`) only armed at speed >= 0.7 m/s.
 *     Standing still and picking never reaches that, so **13 consecutive
 *     real picks over the first 33 seconds were thrown away as "pre-walk
 *     (not walking yet)"** and nothing counted until he deliberately moved
 *     around, at which point speed hit 0.82 and the gate finally armed.
 *  2. The monotony veto (`isStandingStill`, < 0.5 m/s) was too tight: real
 *     picks at 0.748 and 0.642 m/s were suppressed as "repeated
 *     near-identical motion." Shuffling slowly between picks is not
 *     striding, but it is not < 0.5 m/s either.
 *
 * GPS speed simply cannot separate slow-shuffling from striding, and it
 * dies indoors entirely (the indoor Test D ran on a fix 22-46 SECONDS
 * stale). Steps measure walking directly: if the pedometer has recorded no
 * step for a couple of seconds, you are not mid-stride, whatever GPS thinks
 * and whether or not you have a sky view.
 *
 * GPS remains the fallback for devices with no step counter (notably
 * Android, which needs an ACTIVITY_RECOGNITION permission not yet declared
 * in app.json). Deliberately NOT applied to the older walking-context
 * suppression, which keys off an actual observed rhythmic window — that is
 * strong direct evidence of walking, and it is the filter carrying most of
 * the load in the A2/A3 no-pickup walks.
 */
export const STRIDE = {
  // A step within this long => actively striding. Comfortably longer than one
  // stride (350-1100ms per CADENCE) so an ordinary gait can't look quiet.
  quietMs: 2500,
  // Window over which GPS displacement is measured.
  windowMs: 10000,
  // Moved further than this within the window => walking, not picking in place.
  // ~5m is well past GPS jitter while standing, and under 10s of even a slow
  // stroll (0.6 m/s covers 6m).
  movementM: 5,
} as const;

/**
 * "Am I actually striding right now?" — the single question the cadence and
 * monotony suppressions both depend on.
 *
 * HISTORY, because this has been wrong twice in instructive ways:
 *
 *  1. It first used GPS *speed*, which cannot separate slow-shuffling from
 *     striding: A5's pure-walking events sat at 0.32-1.30 m/s and C4's real
 *     picks at 0.00-1.28. Total overlap.
 *  2. It then used the pedometer, treating `msSinceLastStep === null` as
 *     "standing still." That is right for a walk that never starts (Test D4)
 *     but catastrophically wrong at the START of a walk, where it just means
 *     CMPedometer hasn't called back yet. In C5 that switched off monotony,
 *     cadence AND the long cooldown for the first ~24 seconds: **11 counts in
 *     24s, 26% of the walk's total in 14% of its duration.** Absence of
 *     evidence had been coded as evidence of absence.
 *
 * The instrument that actually works is GPS DISPLACEMENT, because of a
 * property confirmed in the field: iOS emits position fixes when you move and
 * stops when you don't, regardless of `distanceInterval`. D4 stood still for
 * 84 seconds and received ZERO fixes; A4/C4 moving got them every 10-1500ms.
 * So "have fixes stopped arriving" is itself the stationary signal, and when
 * they are arriving, how far you've travelled answers the question directly.
 *
 * The pedometer is kept as a positive override: if it reports a step in the
 * last STRIDE.quietMs you are walking, whatever GPS says. That covers a GPS
 * dropout under trees or in an urban canyon, which would otherwise look like
 * standing still and switch the filters off exactly when they're needed.
 *
 * Ordering matters: positive evidence of walking beats everything, then
 * displacement, then fix-silence, and only if nothing is known do we decline
 * to guess — returning false, so suppression stays ENABLED. Failing that way
 * round costs a few missed picks; failing the other way costs 11 phantom ones.
 */
export function isNotStriding(args: {
  msSinceLastFixMs: number | null;
  displacementM: number | null;
  pedometerActive: boolean;
  msSinceLastStep: number | null;
  speedMps?: number | null;
  speedAgeMs?: number | null;
}): boolean {
  const { msSinceLastFixMs, displacementM, pedometerActive, msSinceLastStep } = args;

  // 1. The pedometer saw a step just now — you are walking. Overrides GPS.
  if (pedometerActive && msSinceLastStep !== null && msSinceLastStep <= STRIDE.quietMs) return false;

  // 2. Fixes are flowing, so displacement is meaningful and decisive.
  if (msSinceLastFixMs !== null && msSinceLastFixMs <= STRIDE.windowMs && displacementM !== null) {
    return displacementM < STRIDE.movementM;
  }

  // 3. Fixes have stopped arriving entirely — on iOS that means not moving.
  if (msSinceLastFixMs !== null && msSinceLastFixMs > STRIDE.windowMs) return true;

  // 4. Nothing known yet (session just started, no fix at all). Do NOT assume
  //    stationary — that assumption is what caused the C5 opening burst.
  return false;
}

/** Metres between two lat/lon points — equirectangular, plenty at these scales. */
export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const midLat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = dLon * Math.cos(midLat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

/**
 * Adaptive cooldown (Aug 16, from D4 + C4).
 *
 * A single flat cooldown cannot serve both real usage patterns, and the two
 * walks proved it in opposite directions on the same afternoon:
 *
 *  - **C4** (slow stroll, 15 real picks, 27 counted — +80%): the excess
 *    concentrated in SEVEN pairs of counted events landing ~1-2s apart
 *    (t=19+20, 26+28, 32+34, 37+39, 42+44, 79+80, 99+100). That is one pick
 *    registering twice — bend down, then straighten up — exactly what
 *    countDistinctPeaks()'s comment has warned about since June. Collapsing
 *    each pair gives 20 vs 15, most of the gap. These need a LONGER cooldown.
 *  - **D4** (standing still, 10 rapid picks, 8 counted): a real pick was lost
 *    to the 1500ms cooldown because rapid picking in one spot genuinely
 *    produces pickups a second apart. These need a SHORTER cooldown.
 *
 * The discriminator is the one already built for the monotony veto:
 * isNotStriding(). Bend-and-straighten only happens when you're walking
 * between items; a stationary picking spree is the cigarette-butt case that
 * must keep every count. So: stride => long, stationary => short.
 *
 * The stationary floor stays well above ~500ms because that is how long a
 * single motion's own double-trigger takes to settle (June tuning) — going
 * below it would reintroduce the very double-count this is meant to remove.
 */
export const COOLDOWN = {
  // Used when the step counter says you're mid-walk. Merges the bend and the
  // straighten of one pick into a single count.
  stridingMs: 2500,
  // Used when you're standing still. Long enough to reject one motion's own
  // echo, short enough that grabbing several butts in a row all register.
  stationaryMs: 800,
} as const;

/**
 * Carry-mode classification from gyro baselines.
 *
 * Field data (June 11): phone IN POCKET, every motion event — picks, walking,
 * everything — shows peak gyro 1.7-8.1 because the pocket rides the body.
 * Phone IN HAND, the hand damps rotation: all events 0.5-1.6.
 * The median over a few events separates the two cleanly, which lets the
 * low-rotation "handling" filter switch itself on (pocket) or off (hand)
 * instead of trusting a toggle the user forgot to flip.
 */
export function classifyCarryMode(eventGyros: number[]): 'pocket' | 'hand' | 'unknown' {
  if (!eventGyros || eventGyros.length < 3) return 'unknown';
  const sorted = [...eventGyros].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median >= 2.0 ? 'pocket' : 'hand';
}

/**
 * Count distinct acceleration peaks in a motion window.
 *
 * Purpose: during a "picking spree" (standing still, grabber, pick-pick-pick)
 * several pickups land inside one ~2.5s recording window but only score one
 * detection. Counting separate spikes tells us how many picks the window
 * really contained.
 *
 * CAUTION — measurement only for now: a single pickup can produce two spikes
 * (bend + straighten), so this is recorded by the flight recorder but NOT yet
 * used to multiply the count. Field data decides the multiplier rule.
 *
 * A "distinct peak" = local max ≥ peakMin, separated from the previous peak
 * by ≥ minSeparationMs AND a dip below valleyMax.
 */
export function countDistinctPeaks(
  samples: Array<{ accel: number; timestamp: number }>,
  peakMin = 1.15,
  valleyMax = 1.0,
  minSeparationMs = 400
): number {
  if (!samples || samples.length < 3) return samples?.some((s) => s.accel >= peakMin) ? 1 : 0;

  let peaks = 0;
  let lastPeakTime = -Infinity;
  let dippedSinceLastPeak = true; // window starts "armed"

  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1].accel;
    const cur = samples[i].accel;
    const next = samples[i + 1].accel;

    if (cur < valleyMax) dippedSinceLastPeak = true;

    const isLocalMax = cur >= prev && cur >= next && cur >= peakMin;
    if (isLocalMax && dippedSinceLastPeak && samples[i].timestamp - lastPeakTime >= minSeparationMs) {
      peaks++;
      lastPeakTime = samples[i].timestamp;
      dippedSinceLastPeak = false;
    }
  }
  return Math.max(peaks, 1);
}
