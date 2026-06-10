/**
 * Weight Calibration Service
 *
 * Learns the real lb-per-pickup factor from scale measurements instead of
 * the hardcoded 0.05 lb/pickup guess.
 *
 * How it works:
 * - Every time Jake weighs a haul on the scale and enters it at the end of
 *   a cleanup, we store a calibration sample: { items detected, measured lb }.
 * - The calibrated factor is a recency-weighted average of per-sample factors
 *   (newer sessions count more — detection thresholds evolve over time).
 * - Until 2+ samples exist, we fall back to the default 0.05 lb/pickup.
 *
 * Storage: AsyncStorage (local-first, survives reloads). Samples are small.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@pick_weight_calibration_v1';
export const DEFAULT_LB_PER_PICKUP = 0.05;
const MIN_SAMPLES_FOR_CALIBRATION = 2;
const MAX_SAMPLES = 50; // keep the most recent 50
const RECENCY_HALF_LIFE = 10; // samples; weight halves every 10 samples back

export interface CalibrationSample {
  id: string;
  timestamp: number;
  items_detected: number;
  measured_weight_lb: number;
  factor: number; // measured_weight_lb / items_detected
  source: 'scale' | 'manual';
}

export interface CalibrationState {
  samples: CalibrationSample[];
  factor: number; // current calibrated lb/pickup
  isCalibrated: boolean; // true once MIN_SAMPLES_FOR_CALIBRATION reached
  sampleCount: number;
  factorRange: { min: number; max: number } | null;
}

class WeightCalibrationService {
  private samples: CalibrationSample[] = [];
  private loaded = false;

  /** Load samples from AsyncStorage (idempotent). */
  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.samples = parsed.filter(
            (s: CalibrationSample) =>
              s &&
              typeof s.items_detected === 'number' &&
              s.items_detected > 0 &&
              typeof s.measured_weight_lb === 'number' &&
              s.measured_weight_lb > 0
          );
        }
      }
      this.loaded = true;
      console.log(`⚖️ Calibration loaded: ${this.samples.length} samples, factor=${this.getFactor().toFixed(4)} lb/pickup`);
    } catch (error) {
      console.error('Failed to load calibration samples:', error);
      this.loaded = true; // don't retry forever; operate with defaults
    }
  }

  /**
   * Record a new scale measurement against the detected pickup count.
   * Returns the updated state, or null if the sample was rejected.
   */
  async addSample(
    itemsDetected: number,
    measuredWeightLb: number,
    source: 'scale' | 'manual' = 'scale'
  ): Promise<CalibrationState | null> {
    await this.init();

    // Sanity checks — reject junk that would poison the factor
    if (!itemsDetected || itemsDetected <= 0) return null;
    if (!measuredWeightLb || measuredWeightLb <= 0) return null;
    const factor = measuredWeightLb / itemsDetected;
    // Plausible range: a cigarette butt ~0.002 lb, a full bottle ~1.5 lb
    if (factor < 0.001 || factor > 2.0) {
      console.warn(`⚖️ Calibration sample rejected: implausible factor ${factor.toFixed(4)} lb/pickup`);
      return null;
    }

    const sample: CalibrationSample = {
      id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      items_detected: itemsDetected,
      measured_weight_lb: measuredWeightLb,
      factor,
      source,
    };

    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples = this.samples.slice(-MAX_SAMPLES);
    }
    await this.persist();

    const state = this.getState();
    console.log(
      `⚖️ Calibration sample added: ${itemsDetected} items @ ${measuredWeightLb} lb → ` +
      `factor ${factor.toFixed(4)} | calibrated factor now ${state.factor.toFixed(4)} (${state.sampleCount} samples)`
    );
    return state;
  }

  /** Current lb/pickup factor (recency-weighted; default until calibrated). */
  getFactor(): number {
    if (this.samples.length < MIN_SAMPLES_FOR_CALIBRATION) {
      return DEFAULT_LB_PER_PICKUP;
    }
    // Recency-weighted average of per-sample factors, weighted by item count
    // (a 200-item walk tells us more than a 5-item walk).
    const n = this.samples.length;
    let weightedSum = 0;
    let weightTotal = 0;
    this.samples.forEach((s, i) => {
      const age = n - 1 - i; // 0 = newest
      const recency = Math.pow(0.5, age / RECENCY_HALF_LIFE);
      const sizeWeight = Math.min(s.items_detected, 300); // cap so one mega-walk doesn't dominate
      const w = recency * sizeWeight;
      weightedSum += s.factor * w;
      weightTotal += w;
    });
    return weightTotal > 0 ? weightedSum / weightTotal : DEFAULT_LB_PER_PICKUP;
  }

  /** Estimated weight for a pickup count using the calibrated factor. */
  estimateWeight(itemsDetected: number): number {
    return itemsDetected * this.getFactor();
  }

  isCalibrated(): boolean {
    return this.samples.length >= MIN_SAMPLES_FOR_CALIBRATION;
  }

  getState(): CalibrationState {
    const factors = this.samples.map((s) => s.factor);
    return {
      samples: [...this.samples],
      factor: this.getFactor(),
      isCalibrated: this.isCalibrated(),
      sampleCount: this.samples.length,
      factorRange:
        factors.length > 0
          ? { min: Math.min(...factors), max: Math.max(...factors) }
          : null,
    };
  }

  /** Remove one sample (e.g., a fat-fingered entry). */
  async removeSample(id: string): Promise<CalibrationState> {
    await this.init();
    this.samples = this.samples.filter((s) => s.id !== id);
    await this.persist();
    return this.getState();
  }

  /** Wipe all calibration data back to the 0.05 default. */
  async reset(): Promise<void> {
    this.samples = [];
    await this.persist();
    console.log('⚖️ Calibration reset to default 0.05 lb/pickup');
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.samples));
    } catch (error) {
      console.error('Failed to persist calibration samples:', error);
    }
  }
}

// Singleton
const weightCalibration = new WeightCalibrationService();
export default weightCalibration;
