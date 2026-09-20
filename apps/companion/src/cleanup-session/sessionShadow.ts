/**
 * App wiring for the slice-2 shadow — the one place the inert
 * `SessionDeps` (shadowSessionDeps.ts) meet real modules, and all of them are
 * reads or taps:
 *
 *  - AsyncStorage, for the shadow draft key only;
 *  - recordMotionDiagnostic() (motionDiagnostics.ts:89), the recorder's
 *    non-throwing tap, so the shadow's rows land in the same export as Map's;
 *  - motionDiagnosticStatus(), a string read, for the health mirror;
 *  - fromWalkDraft(), a pure conversion of Map's WalkDraft shape.
 *
 * Nothing here can start or stop MotionDetector, the OS location task, the
 * motion-test recorder, or write the real draft / crash sentinel —
 * __tests__/shadowSessionDeps.test.ts reads this file and fails if any of
 * those names appear. app/_layout.tsx mounts `getSessionShadow().controller`
 * in the CleanupSessionProvider; app/(tabs)/map.tsx calls the observe*()
 * methods from its `[session-shadow]` touch points.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { motionDiagnosticStatus, recordMotionDiagnostic } from '../services/motionDiagnostics';
import type { WalkDraft } from '../services/sessionRecovery';
import { createCleanupSessionController } from './cleanupSessionController';
import { fromWalkDraft } from './sessionPersistence';
import { createShadowObserver, createShadowSessionDeps, type ShadowObserver } from './shadowSessionDeps';

export interface SessionShadow
  extends Omit<ShadowObserver, 'observeResume' | 'observeRestoreToSummary' | 'observeLaunchDraft'> {
  observeResume(draft: WalkDraft): Promise<void>;
  observeRestoreToSummary(draft: WalkDraft): Promise<void>;
  observeLaunchDraft(draft: WalkDraft): Promise<void>;
}

let instance: SessionShadow | null = null;

/** One shadow per JS process — it must outlive Map screen remounts, which is the whole comparison. */
export function getSessionShadow(): SessionShadow {
  if (instance) return instance;
  const io = {
    storage: AsyncStorage,
    record: (type: string, data: Record<string, unknown>) => recordMotionDiagnostic(type, data),
    diagnosticsState: () => (motionDiagnosticStatus().startsWith('Recording') ? ('recording' as const) : ('off' as const)),
  };
  const shadow = createShadowSessionDeps(io);
  const controller = createCleanupSessionController(shadow.deps);
  const observer = createShadowObserver(controller, shadow, io);
  instance = {
    ...observer,
    observeResume: (draft) => observer.observeResume(fromWalkDraft(draft)),
    observeRestoreToSummary: (draft) => observer.observeRestoreToSummary(fromWalkDraft(draft)),
    observeLaunchDraft: (draft) => observer.observeLaunchDraft(fromWalkDraft(draft)),
  };
  return instance;
}
