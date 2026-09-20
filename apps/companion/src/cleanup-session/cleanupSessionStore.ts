/**
 * Cleanup session store — the subscription and read-only snapshot half of
 * the spec's module list.
 *
 * Kept as its own small module rather than folded into the controller for
 * three reasons: (1) it is the only thing the React binding needs to know
 * about (`subscribe` + `getSnapshot` are exactly useSyncExternalStore's
 * contract); (2) the read-only guarantee of rule 4 ("the map receives a
 * snapshot, never an imperative responsibility") lives in one place —
 * `deepFreeze` here; (3) it is trivially testable on its own. The controller
 * composes it and re-exposes `subscribe`/`getSnapshot` so the spec's
 * six-method surface still holds.
 *
 * Pure: no imports beyond types.
 */
import type { SessionHealth, SessionSnapshot } from './types';

export type SnapshotListener = (snapshot: SessionSnapshot) => void;

/**
 * Recursively freeze a plain object/array graph. Functions and non-plain
 * objects (Dates, Maps) are left alone — nothing in a snapshot is one today,
 * and freezing a class instance would be a surprise for its owner.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

export function freshHealth(): SessionHealth {
  return {
    detector: { state: 'unknown' },
    backgroundLocation: { state: 'unknown' },
    pedometer: { state: 'unknown' },
    diagnostics: { state: 'unknown' },
    map: { state: 'unknown' },
  };
}

export function createIdleSnapshot(): SessionSnapshot {
  return {
    status: 'idle',
    sessionId: null,
    startedAt: null,
    elapsedSeconds: 0,
    pickupCount: 0,
    route: [],
    pickupLocations: [],
    distanceMeters: 0,
    mode: null,
    modeFailure: null,
    lastFix: null,
    health: freshHealth(),
    result: null,
    failure: null,
  };
}

export class CleanupSessionStore {
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<SnapshotListener>();

  constructor(initial: SessionSnapshot = createIdleSnapshot()) {
    this.snapshot = deepFreeze(initial);
  }

  /** Stable identity between publishes, so React can bail out on unchanged state. */
  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Replace the snapshot and notify. Each listener runs in its own try/catch:
   * a throwing renderer must never take the walk down with it (rule 5, in
   * spirit — the view is an optional service too).
   */
  publish(next: SessionSnapshot): SessionSnapshot {
    this.snapshot = deepFreeze(next);
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(this.snapshot);
      } catch {
        // A view error is the view's problem; the session keeps running.
      }
    }
    return this.snapshot;
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
