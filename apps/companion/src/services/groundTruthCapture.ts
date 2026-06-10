/**
 * Ground Truth Capture Service
 * Records full accelerometer + gyroscope signatures during actual pickups
 * for motion shape analysis and detector training
 */

export interface MotionSample {
  timestamp: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  accelMag: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  gyroMag: number;
}

export interface PickupSignature {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  samples: MotionSample[];
  peakAccel: number;
  peakGyro: number;
  peakAccelTime: number;
  peakGyroTime: number;
  confidence: number; // 0-1: how "clean" the signature is
}

class GroundTruthCapture {
  private isCapturing = false;
  private currentSamples: MotionSample[] = [];
  private startTime: number = 0;
  private signatures: PickupSignature[] = [];
  private captureStartedAt: number = 0;

  startCapture() {
    if (this.isCapturing) return; // Prevent double-start
    this.isCapturing = true;
    this.currentSamples = [];
    this.startTime = Date.now();
    this.captureStartedAt = Date.now();
    console.log('🎯 GROUND TRUTH CAPTURE STARTED');
  }

  addSample(x: number, y: number, z: number, gx: number, gy: number, gz: number) {
    if (!this.isCapturing) return;

    const accelMag = Math.sqrt(x * x + y * y + z * z);
    const gyroMag = Math.sqrt(gx * gx + gy * gy + gz * gz);

    this.currentSamples.push({
      timestamp: Date.now() - this.startTime,
      accelX: x,
      accelY: y,
      accelZ: z,
      accelMag,
      gyroX: gx,
      gyroY: gy,
      gyroZ: gz,
      gyroMag,
    });
  }

  stopCapture(): PickupSignature | null {
    if (!this.isCapturing || this.currentSamples.length === 0) {
      console.log('🎯 CAPTURE ABANDONED - No samples recorded');
      this.isCapturing = false;
      return null;
    }

    const now = Date.now();
    const duration = now - this.startTime;
    const peakAccel = Math.max(...this.currentSamples.map(s => s.accelMag));
    const peakGyro = Math.max(...this.currentSamples.map(s => s.gyroMag));
    const peakAccelTime =
      this.currentSamples.find(s => s.accelMag === peakAccel)?.timestamp || 0;
    const peakGyroTime =
      this.currentSamples.find(s => s.gyroMag === peakGyro)?.timestamp || 0;

    // Confidence: clean signatures have clear peak + settle (not noisy throughout)
    const peakWindow = this.currentSamples.filter(
      s => s.timestamp > peakAccelTime - 100 && s.timestamp < peakAccelTime + 100
    );
    const settleWindow = this.currentSamples.filter(
      s => s.timestamp > peakAccelTime + 300
    );

    const avgPeakAccel =
      peakWindow.reduce((sum, s) => sum + s.accelMag, 0) / peakWindow.length;
    const avgSettleAccel =
      settleWindow.length > 0
        ? settleWindow.reduce((sum, s) => sum + s.accelMag, 0) / settleWindow.length
        : 0;

    const confidence = avgSettleAccel > 0 ? avgPeakAccel / (avgPeakAccel + avgSettleAccel) : 0.5;

    const signature: PickupSignature = {
      id: `pickup_${now}`,
      startTime: this.startTime,
      endTime: now,
      duration,
      samples: this.currentSamples,
      peakAccel,
      peakGyro,
      peakAccelTime,
      peakGyroTime,
      confidence,
    };

    this.signatures.push(signature);
    this.isCapturing = false;

    console.log(
      `🎯 GROUND TRUTH CAPTURED - ${duration}ms | Peak: ${peakAccel.toFixed(2)}g accel, ${peakGyro.toFixed(2)} gyro | Confidence: ${(confidence * 100).toFixed(1)}%`
    );
    console.log(`   Peak times: accel at ${peakAccelTime}ms, gyro at ${peakGyroTime}ms`);
    console.log(`   Samples: ${this.currentSamples.length}`);

    return signature;
  }

  isCurrentlyCapturing(): boolean {
    return this.isCapturing;
  }

  getSignatures(): PickupSignature[] {
    return [...this.signatures];
  }

  getSignaturesSummary() {
    if (this.signatures.length === 0) {
      return 'No signatures captured yet';
    }

    const avgDuration =
      this.signatures.reduce((sum, s) => sum + s.duration, 0) / this.signatures.length;
    const avgPeakAccel =
      this.signatures.reduce((sum, s) => sum + s.peakAccel, 0) / this.signatures.length;
    const avgPeakGyro =
      this.signatures.reduce((sum, s) => sum + s.peakGyro, 0) / this.signatures.length;
    const avgConfidence =
      this.signatures.reduce((sum, s) => sum + s.confidence, 0) / this.signatures.length;

    return (
      `Captured ${this.signatures.length} signatures | ` +
      `Avg duration: ${avgDuration.toFixed(0)}ms | ` +
      `Avg peak: ${avgPeakAccel.toFixed(2)}g accel, ${avgPeakGyro.toFixed(2)} gyro | ` +
      `Avg confidence: ${(avgConfidence * 100).toFixed(1)}%`
    );
  }

  reset() {
    this.signatures = [];
    console.log('🎯 Ground truth signatures cleared');
  }

  exportSignaturesAsJSON(): string {
    return JSON.stringify(this.signatures, null, 2);
  }
}

export default new GroundTruthCapture();
