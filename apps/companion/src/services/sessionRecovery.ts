/**
 * Session Recovery — never lose a walk to a mistap, dismissal, or crash.
 *
 * The crash black-box (crashRecorder.ts) stores only *counts* so it can stay
 * tiny and be written every GPS tick. This module is its companion: it keeps a
 * full, restorable snapshot of the CURRENT walk — the actual route points and
 * pickup locations — so that if a walk is stopped but never saved (the summary
 * sheet is dismissed, the app is force-quit, or it crashes at the summary), the
 * whole thing can be brought back on next launch.
 *
 * Lifecycle:
 *  - saveWalkDraft() — called (throttled) during a walk and, definitively, the
 *    instant Stop is pressed, BEFORE the summary sheet renders. This is the
 *    "save-first" guarantee: the walk is on disk before any UI can discard it.
 *  - clearWalkDraft() — called only after the walk is durably saved to the DB,
 *    or after an explicit, confirmed Discard.
 *  - loadWalkDraft() — called once at launch; if a draft survived, the last
 *    walk was never saved and we offer to restore it.
 *
 * Storage is AsyncStorage only — no native modules.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_KEY = '@pick_unsaved_walk_v1';

export interface WalkDraft {
  /** ms epoch when the walk began (approx: now - elapsed). */
  startedAt: number;
  /** ms epoch when this draft was last written. */
  savedAt: number;
  /** Motion-detected pickup count at the time of the snapshot. */
  pickupCount: number;
  /** Walk length in seconds. */
  elapsedSeconds: number;
  /** Full GPS route: array of { lat, lon, ... } points. */
  route: any[];
  /** Where pickups happened: array of { lat, lon, timestamp, ... }. */
  pickups: any[];
}

/**
 * Persist the current walk to disk. Fire-and-forget: a failed write must never
 * interrupt a walk. Callers throttle this during a session; it is also called
 * unconditionally on Stop.
 */
export function saveWalkDraft(draft: WalkDraft): void {
  try {
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  } catch {
    // Serialization/storage failure shouldn't break the walk.
  }
}

/** Load a surviving unsaved walk, or null if the last walk ended cleanly. */
export async function loadWalkDraft(): Promise<WalkDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as WalkDraft;
    // Ignore an empty/degenerate draft (nothing worth restoring).
    if (!draft || (!draft.pickupCount && (!draft.route || draft.route.length < 2))) return null;
    return draft;
  } catch {
    return null;
  }
}

/** True if an unsaved walk is currently stored. */
export async function hasWalkDraft(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DRAFT_KEY)) !== null;
  } catch {
    return false;
  }
}

/** Drop the draft. Call ONLY after a durable save or a confirmed discard. */
export async function clearWalkDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Hand-off for applying a restored draft to whichever Map screen instance is
 * actually live, regardless of how many times that screen has remounted.
 *
 * Why this exists: the "Recover your last walk?" prompt used to live inside
 * the Map screen's own mount effect, capturing that instance's setState
 * functions in its onPress closures. Reported 2026-09-01: after fixing a
 * separate double-alert bug, tapping "Restore" started silently doing
 * nothing — the app just showed the normal idle map. Root cause: the Map
 * screen mounts more than once during launch (cause not fully chased down),
 * and a native Alert stays on screen independent of the JS tree underneath
 * it — so by the time a human reads the alert and taps a button, the
 * component instance whose closures the alert captured may have already
 * unmounted. Its setState calls silently no-op; the actually-visible,
 * newer instance never hears about it.
 *
 * Fix: the prompt itself now lives in the root layout (mounts exactly once
 * per launch, so there's only ever one Alert.alert() call and it can't go
 * stale before the user answers it). "Restore" hands the draft off through
 * here instead of touching Map-screen state directly. Whichever Map screen
 * instance is actually mounted when the user answers — or the one that
 * mounts next, if the answer arrives before any instance has subscribed —
 * is the one that applies it, via subscribeToWalkRestore() below.
 */
let pendingRestore: WalkDraft | null = null;
let restoreSubscriber: ((draft: WalkDraft) => void) | null = null;

/** Called by the root-layout prompt when the user taps "Restore". */
export function handOffWalkRestore(draft: WalkDraft): void {
  if (restoreSubscriber) {
    restoreSubscriber(draft);
  } else {
    pendingRestore = draft;
  }
}

/**
 * Called once by the Map screen on every mount. Registers as the current
 * "live" instance — replacing any previous (now-stale) subscriber — and
 * immediately consumes a hand-off that arrived before this instance existed.
 * Returns an unsubscribe function for the effect's cleanup.
 */
export function subscribeToWalkRestore(callback: (draft: WalkDraft) => void): () => void {
  restoreSubscriber = callback;
  if (pendingRestore) {
    const draft = pendingRestore;
    pendingRestore = null;
    callback(draft);
  }
  return () => {
    if (restoreSubscriber === callback) restoreSubscriber = null;
  };
}
