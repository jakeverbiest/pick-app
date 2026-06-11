/**
 * Apple Health integration — writes each cleanup as a real walking workout.
 *
 * Why HealthKit and not adidas: adidas shut off third-party API access on
 * June 30, 2025, and adidas Running only WRITES to Apple Health (won't import
 * from it). HealthKit is where iOS fitness credit canonically lives: workouts
 * written here count toward activity rings, exercise minutes, and show in the
 * Fitness app.
 *
 * Requires a dev/standalone build (native module) — in Expo Go this no-ops
 * gracefully. iOS only.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const HEALTH_SYNC_KEY = '@pick_health_sync';

export interface WorkoutSummary {
  startMs: number;
  endMs: number;
  distanceKm: number;
  calories: number;
  itemsCollected: number;
}

export async function isHealthSyncEnabled(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const v = await AsyncStorage.getItem(HEALTH_SYNC_KEY);
    return v === null ? true : v === 'true'; // default ON
  } catch {
    return true;
  }
}

export async function setHealthSyncEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(HEALTH_SYNC_KEY, String(enabled));
}

/**
 * Write the cleanup to Apple Health as a walking workout.
 * Returns true on success, false if unavailable/denied (never throws).
 */
export async function syncWorkoutToHealth(w: WorkoutSummary): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    // Lazy import: the native module only exists in real builds
    const HK = require('@kingstinct/react-native-healthkit');

    const granted = await HK.requestAuthorization({
      toShare: [
        'HKWorkoutTypeIdentifier',
        'HKQuantityTypeIdentifierActiveEnergyBurned',
        'HKQuantityTypeIdentifierDistanceWalkingRunning',
      ] as any,
      toRead: [],
    });
    if (!granted) {
      console.log('🍎 Health access not granted — skipping workout sync');
      return false;
    }

    const start = new Date(w.startMs);
    const end = new Date(w.endMs);
    const distanceMeters = Math.max(0, Math.round(w.distanceKm * 1000));
    const kcal = Math.max(0, Math.round(w.calories));

    await HK.saveWorkoutSample(
      52, // WorkoutActivityType.walking
      [
        ...(distanceMeters > 0
          ? [{
              startDate: start,
              endDate: end,
              quantityType: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
              quantity: distanceMeters,
              unit: 'm',
            }]
          : []),
        ...(kcal > 0
          ? [{
              startDate: start,
              endDate: end,
              quantityType: 'HKQuantityTypeIdentifierActiveEnergyBurned',
              quantity: kcal,
              unit: 'kcal',
            }]
          : []),
      ] as any,
      start,
      end,
      { distance: distanceMeters, energyBurned: kcal },
      { 'PICK items collected': String(w.itemsCollected) } as any
    );

    console.log(`🍎 Workout synced to Apple Health: ${(w.distanceKm).toFixed(2)} km, ${kcal} kcal, ${w.itemsCollected} items`);
    return true;
  } catch (error: any) {
    console.log(`🍎 Health sync unavailable (${error?.message ?? 'unknown'}) — needs a dev build`);
    return false;
  }
}
