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
