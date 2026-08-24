/**
 * JS wrapper for the phone-side WatchConnectivity bridge.
 *
 * Safe everywhere: on Android, Expo Go, or any build without the native
 * module, every call is a silent no-op so map.tsx can call unconditionally.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

type WalkState = 'idle' | 'active';

// SDK 52+ native modules are event emitters themselves (addListener built in).
const native = requireOptionalNativeModule<any>('WatchSession');

export type WatchCommand = 'startWalk' | 'endWalk' | 'logPick';

/** Listen for start/end commands tapped on the watch. */
/**
 * @param listener receives the command and, for 'logPick', the WATCH's own
 *   capture time in epoch ms. That timestamp is taken on the wrist at the
 *   moment of the tap, not on arrival here: WatchConnectivity delivery is
 *   delayed and interleaved, and stamping on receipt would turn a two-second
 *   delivery delay into a two-second alignment error — the same size as the
 *   effect ground truth exists to measure.
 */
export function addWatchCommandListener(
  listener: (command: WatchCommand, atMs: number) => void
): {
  remove: () => void;
} {
  if (!native?.addListener) return { remove: () => {} };
  const sub = native.addListener('onWatchCommand', (event: { command: string; atMs?: number }) => {
    if (
      event?.command === 'startWalk' ||
      event?.command === 'endWalk' ||
      event?.command === 'logPick'
    ) {
      listener(event.command, typeof event.atMs === 'number' ? event.atMs : 0);
    }
  });
  return { remove: () => sub.remove() };
}

export type WatchExtras = {
  /** '1' | '0' — tester-only ground-truth logging. Off unless explicitly
   *  enabled, so the watch's LOG PICK button stays invisible to normal users.
   *  Living here rather than in the watch binary is what keeps the gate
   *  OTA-controllable after the build ships. */
  groundTruth?: string;
  /** Id of the current walk. A change tells the watch to reset its counters;
   *  empty means "no walk", so a cached snapshot can't resurrect an old count. */
  sessionId?: string;
  /** Street segments finished this walk, as a string. The watch buzzes when it
   *  increments (subject to `haptics`). */
  segments?: string;
  /** '1' | '0' — mirrors the user's segment-haptics setting to the watch. */
  haptics?: string;
  distance?: string; // preformatted, e.g. "1.24 mi"
  bags?: string; // preformatted, e.g. "½ bag"
  progress?: string; // preformatted, e.g. "64% · 5 to go"
  eventName?: string; // active competition/event name (top-right on the watch)
  eventPct?: string; // that event area's % cleaned, preformatted
};

/** Mirror current walk stats to the watch. No-op without the native module. */
export function sendStatsToWatch(
  pickups: number,
  elapsedSeconds: number,
  state: WalkState,
  extras: WatchExtras = {}
): void {
  try {
    native?.sendStats(pickups, elapsedSeconds, state, extras);
  } catch {
    // Watch bridge is best-effort; never let it touch the walk itself.
  }
}

export function isWatchPaired(): boolean {
  try {
    return native?.isPaired() ?? false;
  } catch {
    return false;
  }
}
