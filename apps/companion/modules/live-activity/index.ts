/**
 * JS wrapper for the iOS Live Activity ("cleanup in progress" card on the lock
 * screen + Dynamic Island).
 *
 * Safe everywhere: on Android, in Expo Go, or any build without the native
 * module / widget extension, every call is a silent no-op — so map.tsx can call
 * these unconditionally in the walk lifecycle.
 *
 * Requires: iOS 16.1+, the LiveActivity native module, and the Widget Extension
 * target (see modules/live-activity/README.md). Live Activities also need
 * `NSSupportsLiveActivities: true` in Info.plist (set via app.json).
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const native = requireOptionalNativeModule<any>('LiveActivity');

export type CleanupActivityState = {
  /** Preformatted elapsed time, e.g. "12:34". */
  timeText: string;
  /** Pickup count so far. */
  pickups: number;
  /** Preformatted distance, e.g. "0.42 mi". */
  distanceText: string;
  /** Optional neighborhood + progress, e.g. "Carroll Gardens · 18%". */
  progressText?: string;
};

/** True when Live Activities can actually run (iOS 16.1+, module present, and
 *  the user hasn't disabled them in Settings). */
export function areLiveActivitiesSupported(): boolean {
  try {
    return !!native?.isSupported?.();
  } catch {
    return false;
  }
}

/** Start the "cleanup in progress" card. No-op if unsupported. */
export function startCleanupActivity(state: CleanupActivityState): void {
  try {
    native?.start?.(state);
  } catch {}
}

/** Update the live fields (call on each heartbeat). No-op if unsupported. */
export function updateCleanupActivity(state: CleanupActivityState): void {
  try {
    native?.update?.(state);
  } catch {}
}

/** End and dismiss the card when the walk stops. No-op if unsupported. */
export function endCleanupActivity(): void {
  try {
    native?.end?.();
  } catch {}
}
