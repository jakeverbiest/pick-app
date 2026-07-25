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
