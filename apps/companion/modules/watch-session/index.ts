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

export type WatchCommand = 'startWalk' | 'endWalk';

/** Listen for start/end commands tapped on the watch. */
export function addWatchCommandListener(listener: (command: WatchCommand) => void): {
  remove: () => void;
} {
  if (!native?.addListener) return { remove: () => {} };
  const sub = native.addListener('onWatchCommand', (event: { command: string }) => {
    if (event?.command === 'startWalk' || event?.command === 'endWalk') {
      listener(event.command);
    }
  });
  return { remove: () => sub.remove() };
}

export type WatchExtras = {
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
