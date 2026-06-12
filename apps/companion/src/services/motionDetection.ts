/**
 * Motion Detection Service for PICK
 * Using expo-sensors for Expo compatibility + expo-location for GPS tracking
 * Feeds into PickupAggregator for privacy-safe data handling
 */

import { Accelerometer, Gyroscope } from 'expo-sensors';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PickupAggregator from './pickupAggregator';
import GroundTruthCapture from './groundTruthCapture';
import MotionShapeDetector from './motionShapeDetector';
import { evaluatePickupProfile, countDistinctPeaks, classifyCarryMode } from './motionEvaluation';

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
}

export const CARRY_MODE_KEY = '@pick_carry_mode_v2'; // 'auto' | 'pocket' | 'hand'
export type CarryMode = 'auto' | 'pocket' | 'hand';
const POCKET_MIN_GYRO = 1.5; // pocket picks observed at 2.9-7.4; handling/insertion at 0.48
const GYRO_BASELINE_WINDOW = 8; // recent events used for auto carry classification

class MotionDetector {
  private pickupEvents: PickupEvent[] = [];
  private sessionEvents: MotionEventRecord[] = [];
  private sessionStartTime: number = 0;
  private lastPickupTime: number = 0;
  private isListening: boolean = false;
  private accelSubscription: any = null;
  private gyroSubscription: any = null;
  private locationSubscription: any = null;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private lastGyro = { x: 0, y: 0, z: 0 };
  private lastLocation: { latitude: number; longitude: number; accuracy: number; speed: number } | null = null;
  private carryMode: CarryMode = 'auto';
  private recentGyros: number[] = []; // rolling gyro baseline for auto carry detection
  private lastAutoCarry: 'pocket' | 'hand' | 'unknown' = 'unknown';

  private tuning: TuningParams = {
    accelThreshold: 0.85,
    gyroThreshold: 0.25,
    cooldownMs: 2500,
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
      this.sessionEvents = [];
      this.sessionStartTime = Date.now();

      // Carry mode: auto (default) classifies pocket-vs-hand from the gyro
      // baseline as the session runs; manual override available in Settings
      try {
        const stored = await AsyncStorage.getItem(CARRY_MODE_KEY);
        this.carryMode = stored === 'pocket' || stored === 'hand' ? stored : 'auto';
      } catch {
        this.carryMode = 'auto';
      }
      this.recentGyros = [];
      this.lastAutoCarry = 'unknown';
      console.log(`👖 Carry mode: ${this.carryMode}${this.carryMode === 'auto' ? ' (classifying from gyro baseline)' : ''}`);

      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
      } else {
        // Start location tracking
        // Balanced/5s: High@1s was the app's single biggest battery cost.
        // Segment snapping tolerates 25m; pickup pins don't need sub-meter.
        this.locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 3,
          },
          (location) => {
            this.lastLocation = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy || 0,
              speed: location.coords.speed ?? -1,
            };
          }
        );
      }

      Accelerometer.setUpdateInterval(100);
      Gyroscope.setUpdateInterval(100);

      this.accelSubscription = Accelerometer.addListener(({ x, y, z }) => {
        this.lastAccel = { x, y, z };
        this.handleAcceleration(x, y, z);
      });

      this.gyroSubscription = Gyroscope.addListener(({ x, y, z }) => {
        this.lastGyro = { x, y, z };
      });

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
    // Start recording at 1.2g to filter street noise (ground truth shows pickups peak at 1.09-1.35g)
    if (!MotionShapeDetector.isCurrentlyRecording() && magnitude > 1.2) {
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

          const finalConfidence = result.confidence;
          const accepted = finalConfidence > 30;

          let counted = false;
          if (accepted) {
            // Confidence threshold: lowered from 40 to 30 to catch more pickups
            counted = this.detectPickupFromShape(now, profile, finalConfidence);
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
            reason: !accepted ? result.reason : counted ? 'ok' : 'cooldown',
            peaks,
            speed: this.lastLocation?.speed ?? -1,
          });

          console.log(`⏸️ Motion stopped. Duration: ${profile.duration}ms, Peak: ${profile.peakAccel.toFixed(2)}g, Gyro: ${profile.peakGyro.toFixed(2)}, Confidence: ${finalConfidence}%${accepted && !counted ? ' (cooldown — not counted)' : ''}`);

          if (!accepted) {
            console.log(`⛔ Rejected: ${result.reason} (confidence ${finalConfidence}%)`);
          }
        }
      }
    }
  }

  /** Flight recorder: all motion events from the current/last session. */
  getSessionEvents(): MotionEventRecord[] {
    return [...this.sessionEvents];
  }

  /** Latest GPS fix from this service's watcher — lets the map screen reuse
   *  it instead of requesting its own fixes (one GPS stream, not three). */
  getLastLocation() {
    return this.lastLocation;
  }

  /** Returns true if the pickup was counted (false = cooldown-suppressed). */
  private detectPickupFromShape(timestamp: number, profile: any, confidence: number): boolean {
    const now = Date.now();

    if (now - this.lastPickupTime < this.tuning.cooldownMs) {
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
