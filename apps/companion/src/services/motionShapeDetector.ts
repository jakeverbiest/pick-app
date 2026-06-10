/**
 * Motion Shape Detector
 * Analyzes acceleration/gyro patterns to detect pickup motions
 * without relying on strict timing windows
 */

export interface MotionProfile {
  startTime: number;
  samples: Array<{ accel: number; gyro: number; timestamp: number }>;
  peakAccel: number;
  peakAccelTime: number;
  peakGyro: number;
  peakGyroTime: number;
  confidence: number;
  duration: number;
}

class MotionShapeDetector {
  private recordingProfile: MotionProfile | null = null;
  private isRecording = false;
  private minMotionDuration = 500; // ms - lowered from 800 to catch quicker pickups
  private maxMotionDuration = 2500; // ms - ground truth shows actual pickups 1.2-2.2s, force-eval at 2.5s to avoid post-motion noise
  private readonly ACCEL_THRESHOLD = 0.8; // g - lowered from 1.1 to catch gentler picks
  private readonly ACCEL_SETTLE_THRESHOLD = 0.7; // g - lowered from 0.9
  private readonly SETTLING_TIME = 300; // ms - must stay settled this long

  startRecording(timestamp: number) {
    this.isRecording = true;
    this.recordingProfile = {
      startTime: timestamp,
      samples: [],
      peakAccel: 0,
      peakAccelTime: 0,
      peakGyro: 0,
      peakGyroTime: 0,
      confidence: 0,
      duration: 0,
    };
    // console.log(`🎬 New recording session started`);
  }

  addSample(accel: number, gyro: number, timestamp: number) {
    if (!this.isRecording || !this.recordingProfile) return;

    this.recordingProfile.samples.push({ accel, gyro, timestamp });

    // Track peaks
    if (accel > this.recordingProfile.peakAccel) {
      this.recordingProfile.peakAccel = accel;
      this.recordingProfile.peakAccelTime = timestamp - this.recordingProfile.startTime;
    }
    if (gyro > this.recordingProfile.peakGyro) {
      this.recordingProfile.peakGyro = gyro;
      this.recordingProfile.peakGyroTime = timestamp - this.recordingProfile.startTime;
    }

    // Don't reset here - let shouldFinalize() handle force-finalization
  }

  /**
   * Analyze current profile to determine if it's a real pickup
   * Returns null if no valid pattern, or a confidence score (0-100)
   */
  analyzeProfile(): number | null {
    if (!this.recordingProfile || this.recordingProfile.samples.length < 3) {
      return null;
    }

    const profile = this.recordingProfile;
    const duration = profile.samples[profile.samples.length - 1].timestamp - profile.startTime;

    // Duration check: lowered from 800-4000ms to 500-5000ms to catch quicker/longer pickups
    if (duration < 500 || duration > 5000) {
      return null;
    }

    // Peak acceleration: widened to 0.9-3.5g (June 10: real street pickups peak 1.7-3.1g)
    if (profile.peakAccel < 0.9 || profile.peakAccel > 3.5) {
      return null;
    }

    // Peak timing: allow the full recording window (force-finalize is ~2500ms)
    if (profile.peakAccelTime < 0 || profile.peakAccelTime > 2500) {
      return null;
    }

    // Check for settling behavior: accel drops after peak
    const lastAccel = profile.samples[profile.samples.length - 1].accel;
    const settlingDrop = profile.peakAccel - lastAccel;

    if (settlingDrop < 0.1) {
      // Not settling down
      return null;
    }

    // Calculate confidence based on how well it matches the pattern
    let confidence = 50; // Base confidence

    // Bonus for clean peak (high peak to final ratio)
    if (settlingDrop > 0.3) {
      confidence += 15;
    }

    // Bonus for appropriate duration (closer to 1800-2000ms is better)
    const targetDuration = 1900;
    const durationDeviation = Math.abs(duration - targetDuration);
    if (durationDeviation < 500) {
      confidence += 10;
    }

    // Bonus for appropriate peak magnitude
    if (profile.peakAccel >= 1.15 && profile.peakAccel <= 1.25) {
      confidence += 10;
    }

    // Slight bonus for gyro activity (indicates rotation/handling)
    if (profile.peakGyro > 0.8) {
      confidence += 5;
    }

    return Math.min(100, confidence);
  }

  /**
   * Check if we should stop recording and evaluate
   * Call this periodically to decide when motion has settled
   */
  shouldFinalize(currentAccel: number, currentTimestamp: number): boolean {
    if (!this.isRecording || !this.recordingProfile) return false;

    const duration = currentTimestamp - this.recordingProfile.startTime;

    // Must have minimum motion duration
    if (duration < this.minMotionDuration) {
      // Uncomment to debug: console.log(`⏱️ Too short: ${duration}ms (need ${this.minMotionDuration}ms)`);
      return false;
    }

    // If accel has settled below threshold, we can finalize
    if (currentAccel < this.ACCEL_SETTLE_THRESHOLD) {
      // Check if last few samples show sustained settling
      const recentSamples = this.recordingProfile.samples.slice(-3);
      const allSettled = recentSamples.every((s) => s.accel < this.ACCEL_SETTLE_THRESHOLD);
      if (allSettled) {
        return true;
      }
    }

    // Force finalize if motion is too long
    if (duration > this.maxMotionDuration) {
      console.log(`⏸️ Force finalized (duration ${duration}ms > max ${this.maxMotionDuration}ms)`);
      return true;
    }

    return false;
  }

  /**
   * Get the current profile and reset for next motion
   */
  finalizeProfile(): MotionProfile | null {
    if (!this.isRecording || !this.recordingProfile) return null;

    const finalProfile = {
      ...this.recordingProfile,
      duration:
        this.recordingProfile.samples[this.recordingProfile.samples.length - 1].timestamp -
        this.recordingProfile.startTime,
    };

    this.resetRecording();
    return finalProfile;
  }

  resetRecording() {
    this.isRecording = false;
    this.recordingProfile = null;
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  getProfile(): MotionProfile | null {
    return this.recordingProfile;
  }
}

export default new MotionShapeDetector();
