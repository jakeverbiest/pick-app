/**
 * Motion Detection Service for PICK
 * Using expo-sensors for Expo compatibility + expo-location for GPS tracking
 * Feeds into PickupAggregator for privacy-safe data handling
 */

import { Accelerometer, Gyroscope } from 'expo-sensors';
import * as Location from 'expo-location';
import PickupAggregator from './pickupAggregator';
import GroundTruthCapture from './groundTruthCapture';
import MotionShapeDetector from './motionShapeDetector';
import { evaluatePickupProfile } from './motionEvaluation';

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

class MotionDetector {
  private pickupEvents: PickupEvent[] = [];
  private lastPickupTime: number = 0;
  private isListening: boolean = false;
  private accelSubscription: any = null;
  private gyroSubscription: any = null;
  private locationSubscription: any = null;
  private lastAccel = { x: 0, y: 0, z: 0 };
  private lastGyro = { x: 0, y: 0, z: 0 };
  private lastLocation: { latitude: number; longitude: number; accuracy: number } | null = null;

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

      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('Location permission denied');
      } else {
        // Start location tracking
        this.locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 0,
          },
          (location) => {
            this.lastLocation = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy || 0,
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
          const confidence = MotionShapeDetector.analyzeProfile();
          // analyzeProfile was already called, so get the finalized one
          const finalConfidence = this.evaluateProfile(profile);

          console.log(`⏸️ Motion stopped. Duration: ${profile.duration}ms, Peak: ${profile.peakAccel.toFixed(2)}g, Confidence: ${finalConfidence}%`);

          if (finalConfidence > 30) {
            // Confidence threshold: lowered from 40 to 30 to catch more pickups
            this.detectPickupFromShape(now, profile, finalConfidence);
          } else {
            console.log(`⛔ Failed confidence check (${finalConfidence}% < 30%)`);
          }
        }
      }
    }
  }

  private evaluateProfile(profile: any): number {
    // Pure scoring lives in motionEvaluation.ts (single source of truth for
    // thresholds; regression-tested against the June 10 field log).
    const result = evaluatePickupProfile({
      duration: profile.duration,
      peakAccel: profile.peakAccel,
      peakAccelTime: profile.peakAccelTime,
      peakGyro: profile.peakGyro,
      lastAccel: profile.samples[profile.samples.length - 1].accel,
    });
    if (result.confidence === 0) {
      console.log(`❌ ${result.reason}`);
    }
    return result.confidence;
  }

  private detectPickupFromShape(timestamp: number, profile: any, confidence: number) {
    const now = Date.now();

    if (now - this.lastPickupTime < this.tuning.cooldownMs) {
      return;
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
