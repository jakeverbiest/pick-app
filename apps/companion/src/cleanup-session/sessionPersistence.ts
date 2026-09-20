/**
 * Session persistence adapter — draft, crash trace, and restore, as a
 * `PersistencePort` over the existing modules. Reuses, does not rewrite:
 * the on-disk key, the degenerate-draft rule and the sentinel semantics all
 * stay in sessionRecovery.ts and crashRecorder.ts.
 *
 * The extra `SessionDraft` fields (`sessionId`, `mode`) ride inside the same
 * `@pick_unsaved_walk_v1` JSON; today's readers (map.tsx:1015-1024,
 * app/_layout.tsx:86-95) ignore them, so drafts written by either side stay
 * mutually readable during the parallel run.
 *
 * Imports the real modules (AsyncStorage-backed), so it is not part of the
 * tsx test suite; the controller is tested against fakes of this port.
 */
import { beginSessionTrace, endSessionTrace, heartbeat } from '../services/crashRecorder';
import { clearWalkDraft, loadWalkDraft, saveWalkDraft, type WalkDraft } from '../services/sessionRecovery';
import type { PersistencePort, SessionDraft, SessionMode } from './types';

export function toWalkDraft(draft: SessionDraft): WalkDraft {
  // A superset of WalkDraft; the extra keys are plain JSON and harmless to old readers.
  const walk: WalkDraft & { sessionId?: string; mode?: SessionMode | null } = {
    startedAt: draft.startedAt,
    savedAt: draft.savedAt,
    pickupCount: draft.pickupCount,
    elapsedSeconds: draft.elapsedSeconds,
    route: draft.route,
    pickups: draft.pickups,
  };
  if (draft.sessionId) walk.sessionId = draft.sessionId;
  if (draft.mode !== undefined) walk.mode = draft.mode;
  return walk;
}

export function fromWalkDraft(walk: WalkDraft): SessionDraft {
  const extra = walk as WalkDraft & { sessionId?: unknown; mode?: unknown };
  const mode = extra.mode === 'background' || extra.mode === 'foreground' ? extra.mode : null;
  return {
    sessionId: typeof extra.sessionId === 'string' ? extra.sessionId : undefined,
    startedAt: walk.startedAt,
    savedAt: walk.savedAt,
    pickupCount: walk.pickupCount || 0,
    elapsedSeconds: walk.elapsedSeconds || 0,
    route: Array.isArray(walk.route) ? walk.route : [],
    pickups: Array.isArray(walk.pickups) ? walk.pickups : [],
    mode,
  };
}

export interface SessionPersistenceMeta {
  /** map.tsx:1866-1867 — `${dev|release}/${executionEnvironment}/v${version}`, computed by the caller. */
  build?: string;
  /** map.tsx:1866. */
  batterySaver?: boolean;
}

export function createSessionPersistence(meta: SessionPersistenceMeta = {}): PersistencePort {
  return {
    saveDraft: (draft) => saveWalkDraft(toWalkDraft(draft)),
    loadDraft: async () => {
      const walk = await loadWalkDraft();
      return walk ? fromWalkDraft(walk) : null;
    },
    clearDraft: () => clearWalkDraft(),
    beginTrace: () => beginSessionTrace({ batterySaver: meta.batterySaver, build: meta.build }),
    heartbeat: (patch) => heartbeat(patch),
    endTrace: () => endSessionTrace(),
  };
}
