/**
 * Real `SessionDeps` wired to the app's existing singletons — the adapter
 * layer the spec's Step 2 describes ("Use the existing motionDetection.ts,
 * backgroundSession.ts, motionDiagnostics.ts, session recovery, and
 * persistence functions as dependencies at first").
 *
 * Slice 1: imported nowhere. It exists now so `tsc` proves the ports in
 * types.ts fit the real modules' signatures before slice 2 mounts a
 * provider above the tabs with `createAppSessionDeps()`.
 */
import * as Location from 'expo-location';
import MotionDetector from '../services/motionDetection';
import PickupAggregator from '../services/pickupAggregator';
import {
  drainBackgroundLocations,
  isBackgroundLocationTaskRunning,
  startBackgroundSession,
  stopBackgroundSession,
} from '../services/backgroundSession';
import {
  isMotionDiagnosticsEnabled,
  recordMotionDiagnostic,
  startMotionDiagnostics,
  stopMotionDiagnostics,
} from '../services/motionDiagnostics';
import { createSessionPersistence, type SessionPersistenceMeta } from './sessionPersistence';
import type { LocationFix, SessionDeps } from './types';

export interface AppSessionDepsOptions extends SessionPersistenceMeta {
  /** map.tsx:282 — default true; picks the idle-fix accuracy (:1387). */
  batterySaver?: boolean;
}

/**
 * map.tsx:1365-1392 — during a session reuse the detector's own GPS watcher
 * (one radio stream, not three); before it has a fix, take a one-off
 * position at the battery-saver-dependent accuracy.
 */
async function pollFix(batterySaver: boolean): Promise<LocationFix | null> {
  if (MotionDetector.isActive()) {
    const last = MotionDetector.getLastLocation();
    if (last) {
      return {
        lat: last.latitude,
        lon: last.longitude,
        accuracy: last.accuracy,
        speed: last.speed,
        timestamp: Date.now(), // map.tsx:1424 stamps the foreground fix at receipt, not measurement
      };
    }
  }
  const accuracy = batterySaver ? Location.Accuracy.Balanced : Location.Accuracy.High;
  const location = await Location.getCurrentPositionAsync({ accuracy });
  return {
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    speed: location.coords.speed ?? undefined,
    timestamp: Date.now(),
  };
}

export function createAppSessionDeps(options: AppSessionDepsOptions = {}): SessionDeps {
  const batterySaver = options.batterySaver ?? true;
  return {
    detector: {
      startListening: (onPickup, onError) => MotionDetector.startListening(onPickup, onError),
      stopListening: () => MotionDetector.stopListening(),
      sensorsAttached: () => MotionDetector.sensorsAttached(),
      getLastLocation: () => MotionDetector.getLastLocation(),
      trimRecentPickups: (windowMs) => MotionDetector.trimRecentPickups(windowMs),
      getPickupCount: () => MotionDetector.getPickupCount(),
      getSessionEventCount: () => MotionDetector.getSessionEvents().length,
      resetSession: () => PickupAggregator.resetSession(),
    },
    backgroundSession: {
      start: () => startBackgroundSession(),
      stop: () => stopBackgroundSession(),
      drainQueued: () => drainBackgroundLocations(),
      isRunning: () => isBackgroundLocationTaskRunning(),
    },
    persistence: createSessionPersistence({ build: options.build, batterySaver }),
    clock: { now: () => Date.now() }, // setInterval/clearInterval default to the globals
    diagnostics: {
      start: async (sessionId) => {
        await startMotionDiagnostics(sessionId);
        return (await isMotionDiagnosticsEnabled()) ? 'recording' : 'off';
      },
      stop: (reason) => stopMotionDiagnostics(reason),
      record: (type, data) => recordMotionDiagnostic(type, data),
    },
    // No pedometer port: MotionDetector starts and owns the step counter
    // internally (motionDetection.ts:315-345) and exposes no getter, so the
    // health flag stays 'unknown' until that module grows a one-line accessor.
    location: { poll: () => pollFix(batterySaver) },
  };
}
