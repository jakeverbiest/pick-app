/**
 * Motion Detection Service for PICK
 *
 * Detects trash pickups using accelerometer + gyroscope
 * Core competitive advantage - tuned through field testing
 */

import { Accelerometer, Gyroscope } from 'react-native-sensors';
import { Platform } from 'react-native';

/**
 * Raw sensor reading at a point in time
 */
interface SensorReading {
  timestamp: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
}

/**
 * A detected pickup event
 */
interface PickupEvent {
  timestamp: number;
  magnitude: number; // g-force magnitude
  confidence: number; // 0-100
  location?: { latitude: number; longitude: number };
}

/**
 * Tuning parameters - adjust based on field test results
 */
interface TuningParams {
  accelThreshold: number; // g-force (1.5 = default)
  gyroThreshold: number; // rad/s (0.5 = default)
  cooldownMs: number; // milliseconds between valid pickups (3000 = default)
  spikeWindowMs: number; // how long spike must last (500 = default)
  gyroConfirmationWindowMs: number; // window to find gyro confirmation (1000 = default)
}

/**
 * Motion Detector - singleton for app-wide motion detection
 */
class MotionDetector {
  private sensorReadings: SensorReading[] = [];
  private pickupEvents: PickupEvent[] = [];
  private lastPickupTime: number = 0;
  private isListening: boolean = false;
  private accelerometerSubscription: any = null;
  private gyroscopeSubscription: any = null;

  // Tuning parameters
  private tuning: TuningParams = {
    accelThreshold: 1.5, // g-force
    gyroThreshold: 0.5, // rad/s
    cooldownMs: 3000,
    spikeWindowMs: 500,
    gyroConfirmationWindowMs: 1000,
  };

  // Callbacks
  private onPickupCallback: ((event: PickupEvent) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;

  /**
   * Start listening to motion sensors
   */
  startListening(
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

      // Set update intervals (100ms = 10Hz, good balance for motion detection)
      Accelerometer.setUpdateInterval(100);
      Gyroscope.setUpdateInterval(100);

      // Subscribe to accelerometer
      this.accelerometerSubscription = Accelerometer.subscribe(
        ({ x, y, z }: { x: number; y: number; z: number }) => {
          this.handleAcceleration(x, y, z);
        },
        (error: any) => {
          console.error('Accelerometer error:', error);
          this.onErrorCallback?.('Accelerometer unavailable');
        }
      );

      // Subscribe to gyroscope
      this.gyroscopeSubscription = Gyroscope.subscribe(
        ({ x, y, z }: { x: number; y: number; z: number }) => {
          this.handleRotation(x, y, z);
        },
        (error: any) => {
          console.error('Gyroscope error:', error);
          this.onErrorCallback?.('Gyroscope unavailable');
        }
      );

      console.log('Motion detection started');
    } catch (error) {
      console.error('Failed to start motion detection:', error);
      this.onErrorCallback?.('Failed to initialize sensors');
      this.isListening = false;
    }
  }

  /**
   * Stop listening to motion sensors
   */
  stopListening() {
    if (!this.isListening) return;

    this.accelerometerSubscription?.unsubscribe?.();
    this.gyroscopeSubscription?.unsubscribe?.();
    this.isListening = false;
    console.log('Motion detection stopped');
  }

  /**
   * Handle accelerometer reading
   * Core logic: detect spike in acceleration (g-force)
   */
  private handleAcceleration(x: number, y: number, z: number) {
    const now = Date.now();

    // Calculate magnitude (total g-force)
    // Include gravity (9.81 m/s²), so readings are ~9.81 at rest
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    // Create sensor reading
    const reading: SensorReading = {
      timestamp: now,
      accelX: x,
      accelY: y,
      accelZ: z,
      gyroX: 0, // Will be filled by gyro handler
      gyroY: 0,
      gyroZ: 0,
    };

    // Keep rolling window of last 100 readings (~10 seconds at 10Hz)
    this.sensorReadings.push(reading);
    if (this.sensorReadings.length > 100) {
      this.sensorReadings.shift();
    }

    // Detect spike: acceleration significantly above 9.81 baseline
    // Subtract gravity (9.81) to get actual motion acceleration
    const motionAccel = magnitude - 9.81;

    // Check if this is a significant spike (e.g., bending down)
    if (motionAccel > this.tuning.accelThreshold) {
      this.detectPickupCandidate(now, magnitude);
    }
  }

  /**
   * Handle gyroscope reading
   * Update the most recent reading with rotation data
   */
  private handleRotation(x: number, y: number, z: number) {
    if (this.sensorReadings.length === 0) return;

    const latestReading = this.sensorReadings[this.sensorReadings.length - 1];
    latestReading.gyroX = x;
    latestReading.gyroY = y;
    latestReading.gyroZ = z;
  }

  /**
   * When we detect an acceleration spike, check if it's a valid pickup
   * Logic: Spike + rotation within confirmation window = pickup
   */
  private detectPickupCandidate(spikeTime: number, magnitude: number) {
    const now = Date.now();

    // Cooldown check: ignore if too soon after last pickup
    if (now - this.lastPickupTime < this.tuning.cooldownMs) {
      return;
    }

    // Look back in sensor history for gyro confirmation
    // We need: spike + rotation within the confirmation window
    const confirmationStart = spikeTime - this.tuning.spikeWindowMs;
    const confirmationEnd = spikeTime + this.tuning.gyroConfirmationWindowMs;

    // Find readings in the confirmation window
    const confirmationReadings = this.sensorReadings.filter(
      (r) => r.timestamp >= confirmationStart && r.timestamp <= confirmationEnd
    );

    if (confirmationReadings.length === 0) {
      return; // Not enough data
    }

    // Check if any reading in window has significant rotation
    const hasRotation = confirmationReadings.some((r) => {
      const rotationMagnitude = Math.sqrt(
        r.gyroX * r.gyroX + r.gyroY * r.gyroY + r.gyroZ * r.gyroZ
      );
      return rotationMagnitude > this.tuning.gyroThreshold;
    });

    if (!hasRotation) {
      return; // No rotation detected, probably not a pickup
    }

    // Valid pickup detected!
    this.recordPickup(spikeTime, magnitude);
  }

  /**
   * Record a valid pickup event
   */
  private recordPickup(timestamp: number, magnitude: number) {
    const now = Date.now();
    this.lastPickupTime = now;

    // Calculate confidence (0-100)
    // Higher magnitude = higher confidence
    const confidence = Math.min(
      100,
      Math.max(0, ((magnitude - 9.81) / 3) * 100)
    );

    const event: PickupEvent = {
      timestamp: now,
      magnitude,
      confidence,
    };

    this.pickupEvents.push(event);

    // Log for debugging
    console.log(
      `✅ PICKUP DETECTED - Magnitude: ${magnitude.toFixed(2)}g, Confidence: ${confidence.toFixed(1)}%`
    );

    // Trigger callback
    this.onPickupCallback?.(event);
  }

  /**
   * Get count of pickups detected in this session
   */
  getPickupCount(): number {
    return this.pickupEvents.length;
  }

  /**
   * Get the last N pickup events
   */
  getLastPickups(count: number): PickupEvent[] {
    return this.pickupEvents.slice(-count);
  }

  /**
   * Get all pickup events (for export/debugging)
   */
  getAllPickups(): PickupEvent[] {
    return [...this.pickupEvents];
  }

  /**
   * Export session data for field testing
   */
  exportSessionData(): {
    pickups: PickupEvent[];
    sensorReadings: SensorReading[];
    tuning: TuningParams;
  } {
    return {
      pickups: this.pickupEvents,
      sensorReadings: this.sensorReadings,
      tuning: this.tuning,
    };
  }

  /**
   * Update tuning parameters (for field testing optimization)
   */
  updateTuning(params: Partial<TuningParams>) {
    this.tuning = { ...this.tuning, ...params };
    console.log('Tuning parameters updated:', this.tuning);
  }

  /**
   * Get current tuning parameters
   */
  getTuning(): TuningParams {
    return { ...this.tuning };
  }

  /**
   * Reset for a new session
   */
  reset() {
    this.pickupEvents = [];
    this.sensorReadings = [];
    this.lastPickupTime = 0;
    console.log('Motion detection reset for new session');
  }

  /**
   * Check if currently listening
   */
  isActive(): boolean {
    return this.isListening;
  }

  /**
   * Get accuracy metrics (for field testing)
   * Note: Requires manual validation of which pickups were real
   */
  getAccuracyMetrics(manualPickupCount: number): {
    detected: number;
    manual: number;
    accuracy: number;
    falsePositives: number;
  } {
    const detected = this.pickupEvents.length;
    const accuracy = manualPickupCount > 0
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

// Export singleton instance
export default new MotionDetector();
export type { PickupEvent, SensorReading, TuningParams };
