/**
 * Motion Detection Service for PICK
 * Using expo-sensors for Expo compatibility + expo-location for GPS tracking
 * Feeds into PickupAggregator for privacy-safe data handling
 */

import { Accelerometer, Gyroscope, Pedometer } from 'expo-sensors';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PickupAggregator from './pickupAggregator';
import GroundTruthCapture from './groundTruthCapture';
import MotionShapeDetector from './motionShapeDetector';
import {
  evaluatePickupProfile,
  countDistinctPeaks,
  classifyCarryMode,
  isWalkingCadence,
  looksLikeStride,
  stepCorroboratesCadence,
  isBriskWalkingPace,
  isSpeedFresh,
  isStillAtOwnPace,
  trailingMedianSpeed,
  RELATIVE_PACE,
  looksMonotonous,
  isStandingStill,
  isNotStriding,
  metersBetween,
  PACE,
  COOLDOWN,
  STRIDE,
} from './motionEvaluation';

/** Trailing GPS speed samples, for the relative pause gate. Capped so a
 *  multi-hour walk can't grow it without bound. */
interface SpeedSample { atMs: number; speedMps: number }

interface PickupEvent {
  timestamp: number;
  magnitude: number;
  confidence: number;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

interface TuningParams {
  accelThreshold: number;
  gyroThreshold: number;
  cooldownMs: number;
}

/**
 * Flight-recorder entry: every finalized motion event, accepted or not.
 * Survives off-WiFi walks (kept in memory, included in session export)
 * so threshold tuning never depends on a live Metro console again.
 */
export interface MotionEventRecord {
  t: number; // seconds since session start
  peak: number; // g
  duration: number; // ms
  peakTime: number; // ms from motion start
  gyro: number; // peak gyro during motion
  confidence: number;
  accepted: boolean;
  counted: boolean; // accepted AND survived the cooldown (what the user sees)
  reason: string; // 'ok', rejection reason, or 'cooldown'
  peaks: number; // distinct accel spikes in the window (spree analysis — measurement only)
  speed: number; // GPS speed (m/s) at event time, -1 if unknown — walking-filter data
  // Aug 16: age of the GPS fix that produced `speed`, -1 if there's never been
  // a fix. Added because A2/B2 staleness could only be INFERRED from repeated
  // speed values in the export; now it's measured. If the pause gate ever
  // misbehaves again, check this column before touching the threshold.
  speedAgeMs: number;
}

export const CARRY_MODE_KEY = '@pick_carry_mode_v2'; // 'auto' | 'pocket' | 'hand'
export type CarryMode = 'auto' | 'pocket' | 'hand';
const POCKET_MIN_GYRO = 1.5; // pocket picks observed at 2.9-7.4; handling/insertion at 0.48
// If a walking-rhythm window happened within this long, an isolated 1-2 peak
// "pickup" is almost certainly a stride bounce — real picking pauses to bend,
// which breaks the rhythm. Tunable; raise to be stricter, lower to be looser.
const WALKING_CONTEXT_MS = 2500;
// A real pickup means pausing to bend down, so instantaneous speed is low. Above
// this, you're moving too fast to have stopped-and-picked — biking, running hard,
// or in a vehicle — so the event is rejected. ~3.3 m/s ≈ 12 km/h ≈ 7.4 mph, well
// past a brisk walk (~1.4) or light jog (~2.5). GPS speed of -1 (unknown) is
// never gated, so a missing fix can't nuke a legitimate pickup.
const MAX_PICKUP_SPEED_MPS = 3.3;
const GYRO_BASELINE_WINDOW = 8; // recent events used for auto carry classification
// Backstop for the onset gate: after this long into a session, count pickups
// even if neither GPS pace nor a walking rhythm has ever been seen. Protects
// the stationary-picking case (outdoor Test D) from being stranded forever.
const ONSET_FALLBACK_MS = 10000;

class MotionDetector {
  private pickupEvents: PickupEvent[] = [];
  private sessionEvents: MotionEventRecord[] = [];
  private sessionStartTime: number = 0;
  private lastPickupTime: number = 0;
  private lastRhythmicTime: number = 0; // last walking-rhythm window, for context suppression
  // Onset gate: pickups don't count until the user has actually started walking
  // (a walking-rhythm window, or GPS showing a walking pace). Kills the false
  // pickups from handling the phone / moving around indoors before the walk.
  private hasStartedWalking = false;
  private isListening: boolean = false;
  private accelSubscription: any = null;
  private gyroSubscription: any = null;
  private locationSubscription: any = null;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private lastGyro = { x: 0, y: 0, z: 0 };
  private lastLocation: { latitude: number; longitude: number; accuracy: number; speed: number } | null = null;
  // When the fix in lastLocation arrived. The pause gate is only allowed to
  // judge a pickup on a FRESH fix — see isSpeedFresh() in motionEvaluation.ts.
  private lastLocationAt: number | null = null;
  // Recent fixes, for the displacement-based "am I walking?" test. Trimmed to
  // STRIDE.windowMs. This replaced GPS *speed* as the movement signal because
  // speed cannot separate slow-shuffling from striding — see isNotStriding().
  private recentFixes: Array<{ at: number; lat: number; lon: number }> = [];
  // Trailing GPS speeds for the RELATIVE pause gate — "are you moving at your
  // own ongoing pace, or did you actually pause?". Separate from recentFixes
  // because it needs a longer window (RELATIVE_PACE.windowMs) than the
  // displacement test. See isStillAtOwnPace().
  private speedHistory: SpeedSample[] = [];
  private carryMode: CarryMode = 'auto';
  private recentGyros: number[] = []; // rolling gyro baseline for auto carry detection
  private lastAutoCarry: 'pocket' | 'hand' | 'unknown' = 'unknown';
  // Aug 16 (steady-walk overcount fix): timestamps of recent shape-accepted
  // candidates, across separate finalized windows — see isWalkingCadence()
  // in motionEvaluation.ts for why this is needed on top of the existing
  // within-one-window rhythmic filter.
  private recentCandidateTimes: number[] = [];
  // Aug 16 (A3/C3): shape of the same candidates — a slow walk's strides are
  // near-identical in duration and rotation, real picking is irregular. See
  // looksMonotonous() in motionEvaluation.ts.
  private recentCandidateShapes: Array<{ durationMs: number; gyro: number }> = [];
  private pedometerSubscription: any = null;
  private lastStepAt: number | null = null; // last time the step counter incremented (coarse, corroborating only)
  // Whether the step counter is actually running. Distinguishes "no steps
  // taken" (meaningful — you're standing still) from "no step data at all"
  // (meaningless — fall back to GPS). See isNotStriding().
  private pedometerActive = false;

  private tuning: TuningParams = {
    accelThreshold: 0.85,
    gyroThreshold: 0.25,
    // The WALKING cooldown. History: 2500ms swallowed clustered pickups (Jul:
    // 100 real picks registered 48-62), so it dropped to 1500ms — but that let
    // one pick's bend and straighten both count while strolling (C4: 27 counted
    // for 15 real, 7 of the excess being ~2s-apart pairs). Back to 2500ms, which
    // is now safe because standing still uses COOLDOWN.stationaryMs instead —
    // see COOLDOWN in motionEvaluation.ts. Still the knob the dev tuning UI
    // adjusts; the stationary value is deliberately not user-tunable.
    cooldownMs: COOLDOWN.stridingMs,
  };

  private onPickupCallback: ((event: PickupEvent) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  async startListening(
    onPickup?: (event: PickupEvent) => void,
    onError?: (error: string) => void
  ) {
    if (this.isListening) {
      console.warn('Motion detection already listening');
      return;
    }

    try {
      this.onPickupCallback = onPickup || null;
      this.onErrorCallback = onError || null;
      this.isListening = true;
      this.accelSubscription = null;
      this.gyroSubscription = null;
      this.sessionEvents = [];
      // Reset per-session pickup state. These were NOT cleared before, so
      // pickupEvents accumulated across every walk in an app session — and the
      // saved count (pickupEvents.length at Stop) was the running TOTAL, not the
      // walk's count. This was the real "severe overcount."
      this.pickupEvents = [];
      this.lastPickupTime = 0;
      this.lastRhythmicTime = 0;
      this.hasStartedWalking = false; // arm counting only once real walking begins
      this.sessionStartTime = Date.now();
      this.recentCandidateTimes = [];
      this.recentCandidateShapes = [];
      this.lastStepAt = null;
      this.pedometerActive = false;
      this.lastLocationAt = null;
      this.recentFixes = [];
      this.speedHistory = [];
      // The shape detector is a module singleton, so an in-progress recording
      // window survives across sessions. Found 19 Aug 2026: walks opened with
      // a phantom first event of 40s (B5B) and 602s (indoor run) — a window
      // opened before the session started and finalized inside it. Harmlessly
      // rejected by the 500-5000ms duration bound, but it is real state
      // carryover and the first genuine event of a walk can be mis-measured.
      MotionShapeDetector.resetRecording();

      // Carry mode is always 'auto' as of build 16 — the classifier reads
      // pocket-vs-hand from the gyro baseline as the session runs. The manual
      // Settings override was removed (people picked wrong and got worse
      // detection); the stored key is cleared so old choices can't linger.
      this.carryMode = 'auto';
      try { await AsyncStorage.removeItem(CARRY_MODE_KEY); } catch {}
      this.recentGyros = [];
      this.lastAutoCarry = 'unknown';
      console.log('👖 Carry mode: auto (classifying from gyro baseline)');

      // Sensors FIRST, before anything that can throw (24 Aug 2026, walk 1b).
      // 1b saved as a normal-looking 6-minute walk with a COMPLETELY EMPTY
      // motion_log: zero events, zero counted, pace -1. The route drew fine
      // because map.tsx runs its own location watch, so nothing looked wrong.
      // Cause: the location setup below used to sit between the sessionEvents
      // reset and this subscribe, inside the same try. Location.watchPositionAsync
      // can reject, and when it did the catch swallowed it and the accelerometer
      // was never attached at all — a silent, total detection failure for the
      // whole walk. Detection must not be downstream of a location call.
      Accelerometer.setUpdateInterval(100);
      Gyroscope.setUpdateInterval(100);

      this.accelSubscription = Accelerometer.addListener(({ x, y, z }) => {
        this.lastAccel = { x, y, z };
        this.handleAcceleration(x, y, z);
      });

      this.gyroSubscription = Gyroscope.addListener(({ x, y, z }) => {
        this.lastGyro = { x, y, z };
      });

      // Location is best-effort: without it the pace gates go inert and
      // detection gets less selective, but it still runs. A failure here must
      // never take the accelerometer down with it — see the note above.
      try {
        // Request location permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Location permission denied');
        } else {
          // Start location tracking
          // High/3s: Balanced (~100m) scattered route points across the street,
          // which broke sidewalk-level segment snapping (11m snap + 80% coverage)
          // — cleaned blocks never registered as fresh. High (~5-10m) keeps the
          // route on the correct side. 3s cadence (vs 1s) keeps most of the
          // battery win from the old Balanced/5s config.
          this.locationSubscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.High,
              // Aug 16 (A2/B2 field tests): both of these changed together, and
              // the reason matters more than the numbers. `distanceInterval: 2`
              // was a battery tune, but iOS applies it as a hard distance FILTER
              // — a phone standing still emits NO fixes, whatever timeInterval
              // says. So the moment you stopped to pick something up, `speed`
              // froze at your last walking value and the pause gate below
              // rejected the real pickup. B2 held one reading for 8 seconds
              // straight across a stop. 0 = no distance filter, so fixes keep
              // arriving while stationary and a stop reads as ~0 m/s.
              // timeInterval 3000 -> 1000 for the same reason: a pick takes
              // ~2s, so a 3s fix cadence can't resolve one. Battery cost is
              // modest here because Accuracy.High already keeps the GPS warm —
              // callback rate is the cheap part. Dial back to 2000 if a long
              // walk shows real drain.
              timeInterval: 1000,
              distanceInterval: 0,
            },
            (location) => {
              this.lastLocation = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                accuracy: location.coords.accuracy || 0,
                speed: location.coords.speed ?? -1,
              };
              this.lastLocationAt = Date.now();
              this.recentFixes.push({
                at: this.lastLocationAt,
                lat: location.coords.latitude,
                lon: location.coords.longitude,
              });
              if (typeof location.coords.speed === 'number' && location.coords.speed > 0) {
                this.speedHistory.push({ atMs: this.lastLocationAt, speedMps: location.coords.speed });
                const sCut = this.lastLocationAt - RELATIVE_PACE.windowMs;
                this.speedHistory = this.speedHistory.filter((x) => x.atMs >= sCut);
              }
              const cutoff = this.lastLocationAt - STRIDE.windowMs;
              while (this.recentFixes.length && this.recentFixes[0].at < cutoff) this.recentFixes.shift();
            }
          );
        }
      } catch (locErr) {
        console.warn('Location setup failed — detection continues without pace context:', locErr);
        this.onErrorCallback?.('Location unavailable — pickup counts may be less accurate');
      }

      // Step-counter corroboration (Aug 16): a step landing on top of a
      // pickup candidate is strong evidence it's a stride bounce, not a
      // pause-and-bend pickup — see stepCorroboratesCadence() in
      // motionEvaluation.ts. CMPedometer's live callback timing is
      // batched/coarse, so this only corroborates the motion-based cadence
      // check; it never runs alone. No-ops safely if unavailable (Android needs
      // the ACTIVITY_RECOGNITION permission for step counting, not currently
      // declared in app.json — cadence suppression falls back to motion-only there).
      try {
        const pedometerAvailable = await Pedometer.isAvailableAsync();
        if (pedometerAvailable) {
          this.pedometerSubscription = Pedometer.watchStepCount(() => {
            this.lastStepAt = Date.now();
            // A step means the session is genuinely under way — this is one of
            // the ways the onset gate arms now, so standing-still picking is
            // no longer stranded behind a GPS speed threshold it can't reach.
            this.hasStartedWalking = true;
          });
          this.pedometerActive = true;
          console.log('👣 Pedometer available — step corroboration on');
        } else {
          console.log('👣 Pedometer unavailable on this device — cadence check runs motion-only');
        }
      } catch (e) {
        console.warn('Pedometer setup failed (continuing without step corroboration):', e);
      }

      console.log('Motion detection started with location tracking');
    } catch (error) {
      console.error('Failed to start motion detection:', error);
      this.onErrorCallback?.('Failed to initialize sensors');
      this.isListening = false;
    }
  }

  stopListening() {
    if (!this.isListening) return;

    this.accelSubscription?.remove?.();
    this.gyroSubscription?.remove?.();
    this.locationSubscription?.remove?.();
    this.pedometerSubscription?.remove?.();
    // Null every handle, not just the pedometer's. sensorsAttached() reads
    // accelSubscription to answer "is detection actually live?", and a stale
    // non-null handle from a previous walk would make a dead session look
    // healthy — the exact failure that check exists to catch.
    this.accelSubscription = null;
    this.gyroSubscription = null;
    this.locationSubscription = null;
    this.pedometerSubscription = null;
    this.isListening = false;
    console.log('Motion detection stopped');
  }

  private handleAcceleration(x: number, y: number, z: number) {
    const now = Date.now();
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const gyroMagnitude = Math.sqrt(
      this.lastGyro.x * this.lastGyro.x +
      this.lastGyro.y * this.lastGyro.y +
      this.lastGyro.z * this.lastGyro.z
    );

    // Feed into ground truth capture if active
    GroundTruthCapture.addSample(x, y, z, this.lastGyro.x, this.lastGyro.y, this.lastGyro.z);

    // Arm delay: ignore the first seconds of a session — putting the phone
    // in a pocket reads exactly like a pickup.
    if (Date.now() - this.sessionStartTime < 5000) {
      return;
    }

    // Shape detector: feed samples
    // Start recording at 1.1g: ground truth shows pickups peak at 1.09-1.35g, so
    // the old 1.2g gate silently dropped the gentle end of real pickups. The
    // shape + gyro checks downstream still reject street noise. (Jul tuning.)
    if (!MotionShapeDetector.isCurrentlyRecording() && magnitude > 1.1) {
      // Start recording when acceleration spikes above baseline
      MotionShapeDetector.startRecording(now);
      console.log(`🔴 Recording started (${magnitude.toFixed(2)}g spike)`);
    }

    if (MotionShapeDetector.isCurrentlyRecording()) {
      MotionShapeDetector.addSample(magnitude, gyroMagnitude, now);

      // Check if motion has settled enough to evaluate
      if (MotionShapeDetector.shouldFinalize(magnitude, now)) {
        const profile = MotionShapeDetector.finalizeProfile();
        if (profile) {
          const peaks = countDistinctPeaks(profile.samples);
          let result = evaluatePickupProfile({
            duration: profile.duration,
            peakAccel: profile.peakAccel,
            peakAccelTime: profile.peakAccelTime,
            peakGyro: profile.peakGyro,
            lastAccel: profile.samples[profile.samples.length - 1].accel,
            peaks,
          });

          // Update the gyro baseline + auto carry classification
          this.recentGyros.push(profile.peakGyro);
          if (this.recentGyros.length > GYRO_BASELINE_WINDOW) this.recentGyros.shift();
          if (this.carryMode === 'auto') {
            const detected = classifyCarryMode(this.recentGyros);
            if (detected !== this.lastAutoCarry && detected !== 'unknown') {
              console.log(`👖 Auto-detected carry: ${detected} (median gyro baseline)`);
              this.lastAutoCarry = detected;
            }
          }

          // Low-rotation "handling" filter only applies when the phone rides
          // in a pocket (a pocket pickup = bending = big rotation; in-hand
          // pickups are legitimately low-rotation — June 11 in-hand test lost
          // 26/27 real picks to this filter before auto mode existed)
          const pocketActive =
            this.carryMode === 'pocket' ||
            (this.carryMode === 'auto' && this.lastAutoCarry === 'pocket');
          if (result.confidence > 0 && pocketActive && profile.peakGyro < POCKET_MIN_GYRO) {
            result = { confidence: 0, reason: `low rotation: gyro ${profile.peakGyro.toFixed(2)} < ${POCKET_MIN_GYRO} (handling?)` };
          }

          // Speed gate: too fast to have stopped-and-picked → not a real pickup.
          const evSpeed = this.lastLocation?.speed ?? -1;
          if (result.confidence > 0 && evSpeed >= 0 && evSpeed > MAX_PICKUP_SPEED_MPS) {
            result = { confidence: 0, reason: `too fast: ${evSpeed.toFixed(1)} m/s > ${MAX_PICKUP_SPEED_MPS} (biking/driving?)` };
          }

          // Pause gate (Aug 16 — see isBriskWalkingPace()/isSpeedFresh()/PACE
          // in motionEvaluation.ts for the field evidence). Targets isolated
          // single-window false positives that fire while still at normal
          // walking pace — the cadence fix above only catches REPEATED
          // evenly-spaced candidates, not a lone spike. Deliberately does not
          // touch cadence/cooldown, so rapid back-to-back real picks (e.g.
          // several cigarette butts in one spot) still all count.
          //
          // The freshness check is load-bearing, not defensive: on the B2
          // walk a stale frozen fix made this gate reject REAL pickups and
          // undercount 7-for-10. If the fix is old, stand down and let the
          // walking-context/cadence checks below decide instead.
          const speedAgeMs = this.lastLocationAt !== null ? now - this.lastLocationAt : null;
          // RELATIVE pause gate (19 Aug 2026, walks A7a/C6a/B4). The absolute
          // gate below only sees speeds above 1.3 m/s, so on a stroll it never
          // engages — it fired 3 times in the whole of B4 while the walking
          // segments threw 31 false positives. This compares the event against
          // the walker's OWN trailing median instead, and is deliberately
          // inert unless that median says they're strolling. See
          // isStillAtOwnPace() for the field evidence and the C6a trade-off.
          const trailingMps = trailingMedianSpeed(this.speedHistory, now);
          if (result.confidence > 0 && isStillAtOwnPace(evSpeed, trailingMps, speedAgeMs)) {
            result = {
              confidence: 0,
              reason: `still at own pace: ${evSpeed.toFixed(2)} m/s vs ${(trailingMps as number).toFixed(2)} median (not paused to pick?)`,
            };
          }
          if (result.confidence > 0 && isSpeedFresh(speedAgeMs) && isBriskWalkingPace(evSpeed)) {
            result = {
              confidence: 0,
              reason: `still at pace: ${evSpeed.toFixed(2)} m/s > ${PACE.briskWalkSpeedMps} (not paused to pick?)`,
            };
          }

          // Arm the onset gate once GPS shows a walking pace (they're outside and
          // moving), even if the motion rhythm was too subtle to register.
          if (evSpeed >= 0.7 && evSpeed <= MAX_PICKUP_SPEED_MPS) this.hasStartedWalking = true;
          // Time fallback (Aug 16, outdoor Test D). GPS pace and a rhythmic
          // window were the ONLY two ways to arm this gate, and standing in one
          // spot picking litter produces neither — 13 consecutive real picks
          // across the first 33 seconds were discarded as "pre-walk" until the
          // user gave up and walked around to wake the app. The 5s arm delay in
          // handleAcceleration already covers the phone-into-pocket motion this
          // gate was guarding against, so after this long the session is simply
          // under way. Steps arm it sooner (see the Pedometer listener).
          if (now - this.sessionStartTime > ONSET_FALLBACK_MS) this.hasStartedWalking = true;

          const finalConfidence = result.confidence;
          const accepted = finalConfidence > 30;

          // Track when we last saw a walking-rhythm window. The rhythmic filter
          // catches the obvious 3-5 peak walking windows; the leftover false
          // positives are isolated 1-2 peak stride bounces that fire DURING
          // continuous walking and look identical to a real pickup by every
          // per-event metric (force/rotation/peaks/confidence). The only thing
          // that separates them is context: real litter picking pauses to bend,
          // which breaks the rhythm.
          if (!accepted && typeof result.reason === 'string' && result.reason.startsWith('rhythmic')) {
            this.lastRhythmicTime = now;
            this.hasStartedWalking = true; // a walking-rhythm window = they're walking
          }

          let counted = false;
          let suppressed = false;
          let preWalk = false;
          let cadenceSuppressed = false;
          let monotonySuppressed = false;
          // Which cooldown actually applied, so the flight recorder can say so
          // instead of just "cooldown" — the striding/stationary split is the
          // first thing to check if clustered picks go missing again.
          let appliedCooldownMs = 0;
          if (accepted) {
            // Cross-event cadence tracking (Aug 16): record this candidate's
            // timestamp regardless of what happens next, so the gap chain
            // stays intact even across events we go on to suppress.
            this.recentCandidateTimes.push(now);
            if (this.recentCandidateTimes.length > 8) this.recentCandidateTimes.shift();
            // Same idea, but on SHAPE rather than timing — see looksMonotonous()
            // in motionEvaluation.ts for why shape is what separates a slow
            // walk's strides from real picking when speed and timing can't.
            this.recentCandidateShapes.push({ durationMs: profile.duration, gyro: profile.peakGyro });
            if (this.recentCandidateShapes.length > 8) this.recentCandidateShapes.shift();

            const stepGap = this.lastStepAt !== null ? now - this.lastStepAt : null;
            const stepConfirmed = stepCorroboratesCadence(stepGap);
            const prevCandidateTime =
              this.recentCandidateTimes.length >= 2
                ? this.recentCandidateTimes[this.recentCandidateTimes.length - 2]
                : undefined;
            // Two ways to flag a stride: (a) 3+ consecutive evenly-spaced
            // candidates (motion-only, no pedometer needed), or (b) just one
            // in-band gap PLUS a corroborating step — catches the first 1-2
            // strides of a walk that (a) alone would still miss.
            const strideSuspect =
              isWalkingCadence(this.recentCandidateTimes) ||
              looksLikeStride(prevCandidateTime, now, stepConfirmed);

            // The single "am I actually striding?" answer, from the step
            // counter rather than GPS speed — see isNotStriding(). Both the
            // cadence and monotony suppressions conclude "that was a walking
            // stride," so neither may fire when the phone says no steps are
            // being taken. Outdoor Test D lost real picks to both at 0.51-0.75
            // m/s: too slow to be striding, too fast for the old < 0.5 m/s
            // GPS veto. This is what protects rapid picking in one spot.
            // How far we've physically travelled across the fix window. Null
            // when there aren't two fixes to compare, which isNotStriding()
            // treats as "unknown" rather than "stationary".
            const displacementM =
              this.recentFixes.length >= 2
                ? metersBetween(
                    this.recentFixes[0].lat,
                    this.recentFixes[0].lon,
                    this.recentFixes[this.recentFixes.length - 1].lat,
                    this.recentFixes[this.recentFixes.length - 1].lon
                  )
                : null;
            const notStriding = isNotStriding({
              msSinceLastFixMs: speedAgeMs,
              displacementM,
              pedometerActive: this.pedometerActive,
              msSinceLastStep: stepGap,
              speedMps: evSpeed,
              speedAgeMs,
            });

            if (!this.hasStartedWalking) {
              // Not walking yet — pre-walk handling (phone out of pocket, the walk
              // to your starting spot). Don't count until real walking has begun.
              preWalk = true;
              suppressed = true;
            } else if (now - this.lastRhythmicTime < WALKING_CONTEXT_MS) {
              // Still mid-stride — almost certainly a walking bounce, not a
              // pause-and-bend pickup. Suppress (logged, not counted).
              suppressed = true;
              // NOT refreshed here, deliberately (reverted 25 Aug 2026).
              // A refresh was added 24 Aug to close a false-positive leak seen on
              // walk 2b, where the 2.5s window expired between rhythmic windows and
              // whatever stride landed in the gap was counted. It was guarded on
              // !notStriding — but isNotStriding was blind to a pick-pause at the
              // time, so the guard never fired and the window chained straight
              // through real picks. B7 counted 2 of 10, with 8 picks suppressed
              // here as "stride bounce", three of them at a dead stop.
              //
              // Not reinstated even now that isNotStriding works, because the leak
              // it was aimed at is gone: A9 (25 Aug, 1.26 m/s, zero picks) produced
              // 0.00 false positives per minute with no candidate events at all.
              // There is no longer a cost on the other side of the scale to weigh
              // against the recall this took.
            } else if (strideSuspect && !notStriding) {
              // Separate short windows landing at a metronomic stride interval —
              // the steady-walk case the old within-window filter couldn't see.
              cadenceSuppressed = true;
              suppressed = true;
              this.lastRhythmicTime = now; // also feeds the existing context window above
            } else if (looksMonotonous(this.recentCandidateShapes) && !notStriding) {
              // A run of near-identical windows = one repeated mechanical
              // motion, i.e. a SLOW walk whose strides each finalize as their
              // own clean pickup-shaped window. This is what neither speed
              // (no contrast at a stroll) nor cadence (same 1-2s spacing as
              // real picking) can catch — see looksMonotonous().
              //
              // The isStandingStill() veto is the guard that keeps rapid
              // back-to-back picking counted: if a fresh fix says you're not
              // moving, you cannot be mid-stride, so a pile of cigarette
              // butts in one spot is never suppressed here.
              monotonySuppressed = true;
              suppressed = true;
            } else {
              // Adaptive cooldown: long while striding (merges one pick's bend
              // and straighten), short while stationary (keeps every item of a
              // rapid picking spree). Same isNotStriding() signal as above.
              appliedCooldownMs = notStriding ? COOLDOWN.stationaryMs : this.tuning.cooldownMs;
              counted = this.detectPickupFromShape(now, profile, finalConfidence, appliedCooldownMs);
            }
          }

          // Flight recorder: every event — rejected, cooldown-suppressed, or counted
          // (capped so a multi-hour walk can't grow unbounded)
          if (this.sessionEvents.length >= 3000) this.sessionEvents.shift();
          this.sessionEvents.push({
            t: Math.round((Date.now() - this.sessionStartTime) / 1000),
            peak: Math.round(profile.peakAccel * 100) / 100,
            duration: profile.duration,
            peakTime: profile.peakAccelTime,
            gyro: Math.round(profile.peakGyro * 100) / 100,
            confidence: finalConfidence,
            accepted,
            counted,
            reason: !accepted
              ? result.reason
              : preWalk
              ? 'pre-walk (not walking yet)'
              : cadenceSuppressed
              ? 'cadence: regular-interval stride (steady walk?)'
              : monotonySuppressed
              ? 'monotony: repeated near-identical motion (slow walk?)'
              : suppressed
              ? 'walking context (stride bounce?)'
              : counted
              ? 'ok'
              : `cooldown (${appliedCooldownMs}ms, ${appliedCooldownMs === COOLDOWN.stationaryMs ? 'stationary' : 'striding'})`,
            peaks,
            speed: this.lastLocation?.speed ?? -1,
            speedAgeMs: speedAgeMs === null ? -1 : speedAgeMs,
          });

          console.log(`⏸️ Motion stopped. Duration: ${profile.duration}ms, Peak: ${profile.peakAccel.toFixed(2)}g, Gyro: ${profile.peakGyro.toFixed(2)}, Confidence: ${finalConfidence}%${accepted && !counted ? ' (cooldown — not counted)' : ''}`);

          if (!accepted) {
            console.log(`⛔ Rejected: ${result.reason} (confidence ${finalConfidence}%)`);
          }
        }
      }
    }
  }

  /**
   * Did the accelerometer actually attach? (24 Aug 2026, walk 1b.)
   *
   * startListening() can fail partway and leave a session running with no
   * motion subscription at all — the timer counts, the route draws from
   * map.tsx's own watch, and the walk saves looking clean with an empty
   * motion_log and a count of zero. There is no way for the user to tell.
   * The caller checks this right after starting so the failure is loud.
   */
  sensorsAttached(): boolean {
    return this.isListening && this.accelSubscription !== null;
  }

  /** Flight recorder: all motion events from the current/last session. */
  getSessionEvents(): MotionEventRecord[] {
    return [...this.sessionEvents];
  }

  /**
   * Where the phone was actually riding this walk, as the detector decided it.
   *
   * This is the value the run itself used — `lastAutoCarry` is what gates the
   * pocket-only low-rotation filter above (`pocketActive`), so persisting
   * anything else would record a different number from the one that shaped the
   * count. It is the last CONFIDENT classification: `classifyCarryMode()`
   * returns 'unknown' under 3 events and the assignment above ignores that, so
   * a short walk that never got a verdict stays 'unknown' rather than
   * defaulting to a guess.
   *
   * Lifecycle matches `getSessionEvents()` — reset in `startListening()`, NOT
   * in `stopListening()` — so the save path can still read it after Stop, from
   * the summary sheet. (See the `session_mode` bug fixed in `ae3f028`: a field
   * cleared on finish read 'unresolved' on every walk for weeks.)
   */
  getCarryMode(): 'pocket' | 'hand' | 'unknown' {
    if (this.carryMode !== 'auto') return this.carryMode;
    return this.lastAutoCarry;
  }

  /** Latest GPS fix from this service's watcher — lets the map screen reuse
   *  it instead of requesting its own fixes (one GPS stream, not three). */
  getLastLocation() {
    return this.lastLocation;
  }

  /** Returns true if the pickup was counted (false = cooldown-suppressed). */
  private detectPickupFromShape(
    timestamp: number,
    profile: any,
    confidence: number,
    cooldownMs: number = this.tuning.cooldownMs
  ): boolean {
    const now = Date.now();

    if (now - this.lastPickupTime < cooldownMs) {
      return false;
    }

    this.lastPickupTime = now;

    const event: PickupEvent = {
      timestamp: now,
      magnitude: profile.peakAccel,
      confidence: confidence,
      latitude: this.lastLocation?.latitude,
      longitude: this.lastLocation?.longitude,
      accuracy: this.lastLocation?.accuracy,
    };

    this.pickupEvents.push(event);

    if (event.latitude && event.longitude) {
      PickupAggregator.addPickup({
        timestamp: event.timestamp,
        latitude: event.latitude,
        longitude: event.longitude,
        magnitude: event.magnitude,
        confidence: event.confidence,
      });

      const locStr = ` at (${event.latitude.toFixed(6)}, ${event.longitude.toFixed(6)})`;
      console.log(
        `✅ PICKUP${locStr} - Peak: ${profile.peakAccel.toFixed(2)}g, Duration: ${profile.duration}ms, Confidence: ${confidence.toFixed(1)}%`
      );
    } else {
      console.log(
        `✅ PICKUP (location pending) - Peak: ${profile.peakAccel.toFixed(2)}g, Duration: ${profile.duration}ms, Confidence: ${confidence.toFixed(1)}%`
      );
    }

    this.onPickupCallback?.(event);
    return true;
  }

  /**
   * Drop pickups detected in the final moments of a session (pulling the
   * phone out of a pocket to tap Stop reads exactly like a pickup).
   * Returns the corrected count.
   */
  trimRecentPickups(windowMs: number = 3500): number {
    const cutoff = Date.now() - windowMs;
    const before = this.pickupEvents.length;
    this.pickupEvents = this.pickupEvents.filter((e) => e.timestamp < cutoff);
    const trimmed = before - this.pickupEvents.length;
    if (trimmed > 0) {
      console.log(`✂️ Trimmed ${trimmed} pickup(s) from the last ${windowMs / 1000}s (pocket-removal guard)`);
    }
    return this.pickupEvents.length;
  }


  getPickupCount(): number {
    return this.pickupEvents.length;
  }

  getLastPickups(count: number): PickupEvent[] {
    return this.pickupEvents.slice(-count);
  }

  getAllPickups(): PickupEvent[] {
    return [...this.pickupEvents];
  }

  reset() {
    this.pickupEvents = [];
    this.lastPickupTime = 0;
    console.log('Motion detection reset');
  }

  isActive(): boolean {
    return this.isListening;
  }

  getTuning(): TuningParams {
    return { ...this.tuning };
  }

  updateTuning(params: Partial<TuningParams>) {
    this.tuning = { ...this.tuning, ...params };
    console.log('Tuning updated:', this.tuning);
  }

  getAccuracyMetrics(manualPickupCount: number) {
    const detected = this.pickupEvents.length;
    const accuracy =
      manualPickupCount > 0
        ? Math.min(100, (detected / manualPickupCount) * 100)
        : 0;
    const falsePositives = Math.max(0, detected - manualPickupCount);

    return {
      detected,
      manual: manualPickupCount,
      accuracy,
      falsePositives,
    };
  }
}

export default new MotionDetector();
export type { PickupEvent, TuningParams };
