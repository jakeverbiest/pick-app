/**
 * Segment-completion haptics.
 *
 * One firm buzz the moment your route finishes covering a whole street segment
 * — the "you just finished a block" confirmation you can feel with the phone in
 * a pocket. On by default; a single Settings toggle turns it off.
 *
 * The preference is mirrored into a module-level cache so the walk hot path
 * (`segmentCompleteHaptic`) is synchronous and never awaits AsyncStorage.
 */
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@pick_haptics_segment';

let cached = true; // default ON
let loaded = false;

/** Read the stored preference (and warm the sync cache). */
export async function isSegmentHapticsEnabled(): Promise<boolean> {
  if (loaded) return cached;
  try {
    const v = await AsyncStorage.getItem(KEY);
    cached = v === null ? true : v === 'true';
  } catch {
    cached = true;
  }
  loaded = true;
  return cached;
}

export async function setSegmentHapticsEnabled(enabled: boolean): Promise<void> {
  cached = enabled;
  loaded = true;
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false');
  } catch {
    // Preference is best-effort; the in-memory value still applies this session.
  }
}

/** Synchronous read of the cached value — call `isSegmentHapticsEnabled()` once first. */
export function segmentHapticsEnabledSync(): boolean {
  return cached;
}

/**
 * Fire the segment-complete buzz. Safe to call unconditionally: it no-ops when
 * the toggle is off, and haptics failures are swallowed (Android/simulator).
 */
export function segmentCompleteHaptic(): void {
  if (!cached) return;
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Never let a haptic touch the walk.
  }
}
