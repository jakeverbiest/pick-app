/**
 * Tester-only ground-truth logging.
 *
 * When on, the watch shows a LOG PICK button and every tap is recorded with the
 * WATCH's own capture time. The result rides home in the walk export next to
 * `motion_log`, so a detector count can finally be scored against what actually
 * happened rather than against a bare total.
 *
 * WHY THIS EXISTS (24 Aug 2026). Walk B6 counted 39 for 20 real picks. That
 * number is equally consistent with "every pick counted twice" and "twelve
 * double-counts plus fifteen false positives" — and those call for opposite
 * fixes. Without per-pick times there is no way to tell them apart, and a whole
 * round of analysis dead-ended on exactly that ambiguity.
 *
 * WHY IT IS A SETTING AND NOT A BUILD FLAG. The watch button is native, so its
 * existence needs a build; its *visibility* is driven by this flag, pushed to
 * the watch in the stats payload. That keeps the gate in JS, which means it
 * ships over the air — a tester can be switched on without another TestFlight
 * cycle, and normal users never see the button even though their binary has it.
 *
 * Deliberately NOT wired into the pickup count. These taps are the measuring
 * stick; the moment they also move the number they are measuring, they stop
 * being a measurement.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@pick_ground_truth_mode';

let cached = false;

/** Synchronous read for the in-walk push path, which must not await storage. */
export function groundTruthModeSync(): boolean {
  return cached;
}

export async function isGroundTruthMode(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    cached = v === 'true';
  } catch {
    // Storage unavailable — stay off. Failing closed keeps a stray button off
    // a normal user's watch.
    cached = false;
  }
  return cached;
}

export async function setGroundTruthMode(enabled: boolean): Promise<void> {
  cached = enabled;
  try {
    await AsyncStorage.setItem(KEY, enabled ? 'true' : 'false');
  } catch {
    // Best-effort: the in-memory value still governs this session.
  }
}
