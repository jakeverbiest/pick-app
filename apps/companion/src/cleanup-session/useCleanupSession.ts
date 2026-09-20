/**
 * React binding for the cleanup session — the spec's `useCleanupSession.ts`.
 *
 * Slice 2 mounts `CleanupSessionProvider` in app/_layout.tsx above the
 * `(tabs)` Stack screen (spec Step 3: "the controller must outlive Map screen
 * remounts and tab changes") with the inert shadow controller from
 * sessionShadow.ts — Map still owns the walk. It mounts after
 * `useAppInitialization` has finished — its launch-time
 * `recoverCrashedSession()` + `stopBackgroundSession()` pass
 * (src/hooks/useAppInitialization.ts:42-53) must run before any recovery
 * decision the controller makes, and it does by construction because the
 * root layout renders LoadingView until `isInitialized`.
 *
 * A screen reads the snapshot and calls controller actions; it never
 * re-attaches a sensor. That is the whole of rule 2 from the view's side.
 */
import { createContext, createElement, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { CleanupSessionController } from './cleanupSessionController';
import type { SessionSnapshot } from './types';

const CleanupSessionContext = createContext<CleanupSessionController | null>(null);

export interface CleanupSessionProviderProps {
  controller: CleanupSessionController;
  children?: ReactNode;
}

/**
 * Hosts one controller for the whole app and feeds it AppState so it can
 * move between `active` and `backgroundActive` (map.tsx:443-449 is the
 * same subscription, currently per Map instance).
 */
export function CleanupSessionProvider(props: CleanupSessionProviderProps) {
  const { controller, children } = props;
  useEffect(() => {
    controller.reportAppState(AppState.currentState as AppStateStatus);
    const sub = AppState.addEventListener('change', (state) => controller.reportAppState(state));
    return () => sub.remove();
  }, [controller]);
  return createElement(CleanupSessionContext.Provider, { value: controller }, children);
}

export function useCleanupSessionController(): CleanupSessionController {
  const controller = useContext(CleanupSessionContext);
  if (!controller) {
    throw new Error('useCleanupSession must be used inside <CleanupSessionProvider>');
  }
  return controller;
}

/**
 * The read-only snapshot, re-rendering on every publish (1 Hz while a walk
 * is live — the same cadence map.tsx:1269's elapsed timer drives today).
 */
export function useCleanupSession(): SessionSnapshot {
  const controller = useCleanupSessionController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/**
 * Tell the controller whether a map is on screen (rule 5). Call from the
 * screen that owns the WebView, keyed on its `mapReady` state — never from
 * the controller side.
 */
export function useReportMapHealth(mounted: boolean): void {
  const controller = useCleanupSessionController();
  useEffect(() => {
    controller.reportMapHealth(mounted ? 'mounted' : 'unmounted');
    return () => controller.reportMapHealth('unmounted');
  }, [controller, mounted]);
}
