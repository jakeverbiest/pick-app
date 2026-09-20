/**
 * Shadow `SessionDeps` — the slice-2 parallel run's inert stand-ins, plus the
 * observer that app/(tabs)/map.tsx feeds through its `[session-shadow]` touch
 * points.
 *
 * Slice 2 (2026-09-20): a real controller is mounted above the tabs
 * (app/_layout.tsx) and observes the live walk alongside map.tsx, which keeps
 * every responsibility it has today. The point is a device-walk comparison
 * (`sessionShadowDiff`, below) before Map gives anything up.
 *
 * Inert by construction, not by discipline: this module imports nothing from
 * src/services, so it cannot attach or detach MotionDetector, start or stop
 * the OS location task, write the real walk draft or the crash sentinel, or
 * start/stop the motion-test recorder. Each port says what it does instead.
 * docs/SESSION_CONTROLLER_EXTRACTION_INVENTORY.md §F lists the three shared
 * singletons this design exists to keep single-writer.
 *
 * Pure: no react / react-native / expo-* imports, so it runs under plain
 * `npx -y tsx` (see __tests__/shadowSessionDeps.test.ts, which also asserts
 * the import rule above by reading this file's source). The app wiring that
 * injects AsyncStorage and the diagnostics recorder is sessionShadow.ts.
 */
import { DEFAULT_OPTIONS, describeSessionMode, type CleanupSessionController } from './cleanupSessionController';
import { planarDistanceKm } from './routeRecorder';
import type {
  BackgroundSessionPort,
  ClockPort,
  DetectorPickupEvent,
  DetectorPort,
  DiagnosticsPort,
  DiagnosticsState,
  EndPreview,
  LocationFix,
  PersistencePort,
  RoutePoint,
  SessionDeps,
  SessionDraft,
  SessionMode,
  SessionResult,
  SessionSnapshot,
  SessionStatus,
  SummaryOutcome,
} from './types';

/** sessionRecovery.ts:25 (`DRAFT_KEY`). Named here only so the shadow key can be derived; never read or written by this module. */
export const REAL_DRAFT_KEY = '@pick_unsaved_walk_v1';
/** The only storage key the shadow persistence port touches. */
export const SHADOW_DRAFT_KEY = `${REAL_DRAFT_KEY}:shadow`;
/** Every row the shadow controller records through its diagnostics port is prefixed, so a reader can never mistake it for Map's. */
export const SHADOW_DIAGNOSTIC_PREFIX = 'shadow:';
/** The one row that is NOT prefixed: the end-of-walk comparison record emitted from map.tsx finishCleanup. */
export const SHADOW_DIFF_EVENT = 'sessionShadowDiff';

// ── Injected I/O ────────────────────────────────────────────────────────────

export interface ShadowStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ShadowIo {
  /** Wall clock + timers. `{ now: Date.now }` in the app; a fake with virtual timers in tests. */
  clock?: ClockPort;
  /** AsyncStorage in the app. Only SHADOW_DRAFT_KEY is ever touched. */
  storage: ShadowStorage;
  /** motionDiagnostics.ts:89 — the recorder's non-throwing tap. Rows arrive already prefixed (except SHADOW_DIFF_EVENT). */
  record?: (type: string, data: Record<string, unknown>) => void;
  /** The real recorder's state when Map started it — a read, for the health mirror. */
  diagnosticsState?: () => DiagnosticsState;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

// ── The ports ───────────────────────────────────────────────────────────────

/**
 * Detector port as a TAP. MotionDetector holds exactly one pickup callback
 * (motionDetection.ts:165) and whoever attaches last silently wins (§F1), so
 * the shadow never attaches: Map's own callback calls `feed()` in addition to
 * everything it already does, and the controller's callback hangs off this
 * object instead of the singleton. The per-attach event list mirrors the
 * detector's `pickupEvents` (reset on every startListening, motionDetection.ts:188;
 * filtered by timestamp at Stop, :790-798) so the controller's stop-trim delta
 * is computed over the same population Map's trim runs on.
 */
export interface ShadowDetectorTap extends DetectorPort {
  /** Map's pickup callback calls this in addition to what it already does. Dropped (and counted) while the controller is not attached. */
  feed(event: DetectorPickupEvent): void;
  /**
   * Count the events the next trimRecentPickups() will drop, and pin that call's
   * cutoff to `nowMs` so it drops exactly those. This is what lets map.tsx record
   * the shadow's end count synchronously (the recorder closes before an awaited
   * confirmEnd() could land) while the asynchronous confirmEnd() still agrees.
   */
  previewTrim(windowMs: number, nowMs: number): number;
  readonly attached: boolean;
  readonly calls: readonly string[];
  readonly droppedWhileDetached: number;
}

function createDetectorTap(now: () => number): ShadowDetectorTap {
  const calls: string[] = [];
  let onPickup: ((event: DetectorPickupEvent) => void) | null = null;
  let events: number[] = []; // timestamps are all the real trim reads (motionDetection.ts:792-793)
  let pinnedCutoff: number | null = null;
  let dropped = 0;
  return {
    get attached() {
      return onPickup !== null;
    },
    get calls() {
      return calls;
    },
    get droppedWhileDetached() {
      return dropped;
    },
    async startListening(onPickupCb) {
      calls.push('startListening');
      onPickup = onPickupCb;
      events = [];
      pinnedCutoff = null;
    },
    stopListening() {
      calls.push('stopListening');
      onPickup = null;
    },
    trimRecentPickups(windowMs) {
      const cutoff = pinnedCutoff ?? now() - windowMs;
      pinnedCutoff = null;
      events = events.filter((t) => t < cutoff); // same comparison as motionDetection.ts:793
      return events.length;
    },
    getPickupCount() {
      return events.length;
    },
    feed(event) {
      if (!onPickup) {
        dropped += 1;
        return;
      }
      events.push(event.timestamp);
      onPickup(event);
    },
    previewTrim(windowMs, nowMs) {
      const cutoff = nowMs - windowMs;
      pinnedCutoff = cutoff;
      return events.filter((t) => t >= cutoff).length;
    },
    // No sensorsAttached(): the real check (motionDetection.ts:699) would read the
    // singleton before Map has attached it and report a false "notAttached".
    // No resetSession(): PickupAggregator.resetSession() is Map's (map.tsx:1857).
  };
}

/**
 * Background-session port as a MIRROR. `startBackgroundSession()` /
 * `stopBackgroundSession()` act on one OS task for everyone (§F2c), so here
 * start() hands back a promise that Map settles with the mode IT resolved,
 * and stop() only records that it was called.
 */
export interface ShadowBackgroundMirror extends BackgroundSessionPort {
  /** Map's own startBackgroundSession() resolved — settle the shadow's pending start() the same way. */
  resolveStart(mode: SessionMode): void;
  /** …or rejected (map.tsx:1892-1905). */
  rejectStart(reason: string): void;
  /** Known OS state with no start() to settle: a resume after Map confirmed the task is registered (map.tsx:420). */
  mirrorMode(mode: SessionMode | null): void;
  readonly mirroredMode: SessionMode | null;
  readonly calls: readonly string[];
}

function createBackgroundMirror(): ShadowBackgroundMirror {
  const calls: string[] = [];
  let pending: { resolve: (mode: SessionMode) => void; reject: (error: Error) => void } | null = null;
  let preSettled: { mode: SessionMode } | { error: string } | null = null;
  let mirroredMode: SessionMode | null = null;
  const settle = (s: { mode: SessionMode } | { error: string }) =>
    'mode' in s ? Promise.resolve(s.mode) : Promise.reject(new Error(s.error));
  return {
    get mirroredMode() {
      return mirroredMode;
    },
    get calls() {
      return calls;
    },
    start() {
      calls.push('start');
      if (preSettled) {
        const s = preSettled;
        preSettled = null;
        return settle(s);
      }
      return new Promise<SessionMode>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
    stop() {
      calls.push('stop');
      preSettled = null;
      mirroredMode = null;
    },
    isRunning: async () => mirroredMode === 'background',
    resolveStart(mode) {
      mirroredMode = mode;
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve(mode);
      } else {
        preSettled = { mode };
      }
    },
    rejectStart(reason) {
      if (pending) {
        const p = pending;
        pending = null;
        p.reject(new Error(reason));
      } else {
        preSettled = { error: reason };
      }
    },
    mirrorMode(mode) {
      mirroredMode = mode;
    },
    // No drainQueued(): drainBackgroundLocations() empties the queue for whoever
    // calls first (§F2a). Map drains and forwards the batch via observeLocation().
  };
}

export interface ShadowPersistenceLog {
  readonly calls: readonly string[];
  readonly heartbeats: number;
  readonly lastHeartbeat: { routePoints: number; pickups: number; motionEvents: number } | null;
}

/** Draft under the shadow key only; the crash sentinel (§F2b) is recorded in memory, never written. */
function createShadowPersistence(storage: ShadowStorage): { port: PersistencePort; log: ShadowPersistenceLog } {
  const calls: string[] = [];
  let heartbeats = 0;
  let lastHeartbeat: ShadowPersistenceLog['lastHeartbeat'] = null;
  const port: PersistencePort = {
    saveDraft(draft) {
      calls.push('saveDraft');
      try {
        storage.setItem(SHADOW_DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
      } catch {
        // sessionRecovery.ts:47-52 — a failed write never interrupts a walk.
      }
    },
    async loadDraft() {
      calls.push('loadDraft');
      try {
        const raw = await storage.getItem(SHADOW_DRAFT_KEY);
        return raw ? (JSON.parse(raw) as SessionDraft) : null;
      } catch {
        return null;
      }
    },
    async clearDraft() {
      calls.push('clearDraft');
      try {
        await storage.removeItem(SHADOW_DRAFT_KEY);
      } catch {
        // ignore
      }
    },
    beginTrace() {
      calls.push('beginTrace');
    },
    heartbeat(patch) {
      heartbeats += 1;
      lastHeartbeat = patch;
    },
    endTrace() {
      calls.push('endTrace');
    },
  };
  return {
    port,
    log: {
      get calls() {
        return calls;
      },
      get heartbeats() {
        return heartbeats;
      },
      get lastHeartbeat() {
        return lastHeartbeat;
      },
    },
  };
}

/** Records only; startMotionDiagnostics() would restart the real recorder and stopMotionDiagnostics() would close it. */
function createShadowDiagnostics(io: ShadowIo): { port: DiagnosticsPort; calls: string[] } {
  const calls: string[] = [];
  const port: DiagnosticsPort = {
    start(sessionId) {
      calls.push(`start:${sessionId}`);
      return io.diagnosticsState?.() ?? 'unknown';
    },
    stop(reason) {
      calls.push(`stop:${reason ?? 'cleanup ended'}`);
    },
    record(type, data) {
      io.record?.(SHADOW_DIAGNOSTIC_PREFIX + type, data);
    },
  };
  return { port, calls };
}

export interface ShadowSessionDeps {
  readonly deps: SessionDeps;
  readonly detector: ShadowDetectorTap;
  readonly background: ShadowBackgroundMirror;
  readonly persistence: ShadowPersistenceLog;
  readonly diagnostics: { readonly calls: readonly string[] };
  readonly clock: ClockPort;
}

export function createShadowSessionDeps(io: ShadowIo): ShadowSessionDeps {
  const clock: ClockPort = io.clock ?? { now: () => Date.now() };
  const now = () => clock.now();
  const detector = createDetectorTap(now);
  const background = createBackgroundMirror();
  const persistence = createShadowPersistence(io.storage);
  const diagnostics = createShadowDiagnostics(io);
  return {
    deps: {
      detector,
      backgroundSession: background,
      persistence: persistence.port,
      clock,
      diagnostics: diagnostics.port,
      // No `location` port: Map keeps GPS ownership and forwards every fix and
      // drained batch through recordLocation(). No `pedometer` port: MotionDetector
      // owns the step counter (same note as appSessionDeps.ts).
    },
    detector,
    background,
    persistence: persistence.log,
    diagnostics: { calls: diagnostics.calls },
    clock,
  };
}

// ── Stop observation and the comparison record ──────────────────────────────

export interface ShadowStopObservation {
  /** getSnapshot() at Stop, before confirmEnd(). */
  readonly snapshot: SessionSnapshot;
  /** requestEnd() at Stop — the shadow's pre-trim numbers. */
  readonly preview: EndPreview;
  /** confirmEnd()'s result, or null when the shadow was in no state to end (a desync, reported through `onDesync`). */
  readonly confirm: Promise<SessionResult | null>;
}

export function observeShadowStop(
  controller: CleanupSessionController,
  onDesync?: (detail: Record<string, unknown>) => void,
): ShadowStopObservation {
  const snapshot = controller.getSnapshot();
  const preview = controller.requestEnd();
  let confirm: Promise<SessionResult | null>;
  if (preview.canEnd) {
    confirm = controller.confirmEnd().catch((e: unknown) => {
      onDesync?.({ at: 'confirmEnd', status: preview.status, error: String(e) });
      return null;
    });
  } else {
    onDesync?.({ at: 'stop', status: preview.status });
    confirm = Promise.resolve(null);
  }
  return { snapshot, preview, confirm };
}

/** What map.tsx finishCleanup hands over — its own numbers, read from its own state at Stop. */
export type ShadowDiffMapSide = {
  /** `pickupCount` React state — what Map records as detectedBeforeTrim (map.tsx:1962). */
  count: number;
  /** `MotionDetector.trimRecentPickups(6000)` — what Map saves as items_detected (map.tsx:1961, :2288). */
  corrected: number;
  /** `MotionDetector.getPickupCount()` read just before the trim — the detector's own count since its last attach. */
  detectorCount: number;
  routePoints: number;
  /** The saved `distance_m` expression verbatim (map.tsx:2308). */
  distanceM: number;
  elapsedS: number;
  /** The saved `session_mode` expression verbatim (map.tsx:2356-2358). */
  mode: string;
  /** `sessionStartRef.current` — Map's elapsed anchor. */
  startedAt: number;
  pickupPins: number;
  /** The module-level `screenRemountsThisWalk` (map.tsx:68). */
  screenRemounts: number;
};

export type ShadowDiff = {
  shadowSessionId: string | null;
  shadowStatus: SessionStatus;
  shadowCanEnd: boolean;
  mapCount: number;
  mapCorrected: number;
  mapDetectorCount: number;
  shadowCount: number;
  /** = confirmEnd().pickupCount, computed synchronously over the same tap events (cutoff pinned). */
  shadowResultCount: number;
  shadowTrimmed: number;
  routePoints: { map: number; shadow: number };
  distanceM: { map: number; shadow: number };
  elapsedS: { map: number; shadow: number };
  mode: { map: string; shadow: string };
  pickupPins: { map: number; shadow: number };
  startedAt: { map: number; shadow: number | null };
  screenRemounts: number;
  agree: { count: boolean; corrected: boolean; route: boolean; distance: boolean; mode: boolean };
};

/**
 * map.tsx:2308 — the saved `distance_m` is `Math.round(parseFloat(km.toFixed(2)) * 1000)`,
 * i.e. 10 m granularity via calculateCoverage()'s toFixed(2). Reproduced so
 * parity means byte-equality; RouteRecorder.distanceMeters() itself keeps
 * full meters (a 1-meter-precision difference slice 3 must decide on).
 */
export function savedStyleDistanceM(route: readonly RoutePoint[]): number {
  return Math.round((parseFloat(planarDistanceKm(route).toFixed(2)) || 0) * 1000);
}

export function buildShadowDiff(
  map: ShadowDiffMapSide,
  stop: ShadowStopObservation,
  tap: ShadowDetectorTap,
  nowMs: number,
  windowMs: number = DEFAULT_OPTIONS.stopTrimWindowMs,
): ShadowDiff {
  const { snapshot, preview } = stop;
  // cleanupSessionController.ts runEnd(): final = max(0, count − (before − after)),
  // and the trim applies only when this process attached the detector — which
  // for the tap is exactly `attached`. previewTrim() pins the cutoff so the
  // asynchronous trim drops precisely what is counted here.
  const trimmed = tap.attached ? tap.previewTrim(windowMs, nowMs) : 0;
  const shadowResultCount = Math.max(0, preview.pickupCount - trimmed);
  const shadowDistanceM = savedStyleDistanceM(snapshot.route);
  const shadowMode = describeSessionMode(snapshot.mode, snapshot.modeFailure);
  return {
    shadowSessionId: snapshot.sessionId,
    shadowStatus: preview.status,
    shadowCanEnd: preview.canEnd,
    mapCount: map.count,
    mapCorrected: map.corrected,
    mapDetectorCount: map.detectorCount,
    shadowCount: preview.pickupCount,
    shadowResultCount,
    shadowTrimmed: trimmed,
    routePoints: { map: map.routePoints, shadow: preview.routePoints },
    distanceM: { map: map.distanceM, shadow: shadowDistanceM },
    elapsedS: { map: map.elapsedS, shadow: preview.elapsedSeconds },
    mode: { map: map.mode, shadow: shadowMode },
    pickupPins: { map: map.pickupPins, shadow: snapshot.pickupLocations.length },
    startedAt: { map: map.startedAt, shadow: snapshot.startedAt },
    screenRemounts: map.screenRemounts,
    agree: {
      count: map.count === preview.pickupCount,
      corrected: map.corrected === shadowResultCount,
      route: map.routePoints === preview.routePoints,
      distance: map.distanceM === shadowDistanceM,
      mode: map.mode === shadowMode,
    },
  };
}

// ── The observer map.tsx talks to ───────────────────────────────────────────

/**
 * One method per `[session-shadow]` touch point. Every method is safe to call
 * from any shadow state: the shadow is driven back to `idle` wherever it has
 * fallen out of step with Map (recorded as `shadow:release` / `shadow:desync`),
 * so it can always observe the next real walk instead of silently sitting in
 * `summary` and no-op'ing the next start().
 */
export interface ShadowObserver {
  readonly controller: CleanupSessionController;
  readonly shadow: ShadowSessionDeps;
  /** map.tsx startCleanup, beside attachWalkListeners(). */
  observeStart(): Promise<void>;
  /** map.tsx startCleanup's catch — Map abandoned the start. */
  observeStartFailed(reason: string): Promise<void>;
  /** Map's startBackgroundSession() settled. */
  observeBackgroundMode(mode: SessionMode): void;
  observeBackgroundFailure(reason: string): void;
  /** Map's pickup callback. */
  observePickup(event: DetectorPickupEvent): void;
  /** trackLocation — the raw foreground fix and drained batch Map gathered this tick, pre-gate. */
  observeLocation(fix: LocationFix | null, drained: readonly LocationFix[]): void;
  /** resumeWalkAfterRemount(draft). A no-op when the shadow survived the remount; restore + resume after a relaunch. */
  observeResume(draft: SessionDraft): Promise<void>;
  /** subscribeToWalkRestore's callback — the launch-time "Restore" opened the summary. */
  observeRestoreToSummary(draft: SessionDraft): Promise<void>;
  /** app/_layout.tsx at launch — a real draft exists (a read; the real draft is never cleared or rewritten here). */
  observeLaunchDraft(draft: SessionDraft): Promise<void>;
  /** finishCleanup, beside MotionDetector.stopListening(). */
  observeStop(): ShadowStopObservation;
  /** finishCleanup, after Map's trim and BEFORE stopMotionDiagnostics(). */
  emitDiff(map: ShadowDiffMapSide, stop: ShadowStopObservation): ShadowDiff;
  /** Every clearWalkDraft() site. */
  observeDraftCleared(outcome: SummaryOutcome): Promise<void>;
}

const ENDABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['active', 'backgroundActive', 'recoverable']);

export function createShadowObserver(
  controller: CleanupSessionController,
  shadow: ShadowSessionDeps,
  io: ShadowIo,
): ShadowObserver {
  const status = () => controller.getSnapshot().status;
  const record = (type: string, data: Record<string, unknown>) => {
    try {
      io.record?.(SHADOW_DIAGNOSTIC_PREFIX + type, data);
    } catch {
      // diagnostics cannot break the shadow either
    }
  };
  const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** Drive the shadow to idle from wherever it is. */
  async function release(outcome: SummaryOutcome, at: string): Promise<void> {
    const from = status();
    if (from === 'idle') return;
    record('release', { at, from, outcome });
    if (from === 'starting' || from === 'finalizing') await nextTick();
    if (ENDABLE.has(status())) {
      try {
        await controller.confirmEnd();
      } catch {
        // the status check below records it
      }
    }
    if (status() === 'summary') await controller.dismissSummary(outcome);
    else if (status() === 'failed') controller.reset();
    if (status() !== 'idle') record('desync', { at, from, stuck: status() });
  }

  return {
    controller,
    shadow,
    async observeStart() {
      const s = status();
      if (s !== 'idle' && s !== 'failed') await release('discarded', 'start');
      // Resolves only once Map settles the mode; nothing waits on it.
      void controller.start();
    },
    async observeStartFailed(reason) {
      record('mapStartFailed', { reason });
      await release('discarded', 'startFailed');
    },
    observeBackgroundMode(mode) {
      shadow.background.resolveStart(mode);
    },
    observeBackgroundFailure(reason) {
      shadow.background.rejectStart(reason);
    },
    observePickup(event) {
      shadow.detector.feed(event);
    },
    observeLocation(fix, drained) {
      controller.recordLocation(fix, drained);
    },
    async observeResume(draft) {
      const before = status();
      if (before === 'idle' || before === 'failed') {
        // Map only gets here after the OS confirmed the task is registered (map.tsx:420).
        shadow.background.mirrorMode('background');
        await controller.restore(draft);
      }
      if (status() === 'recoverable') {
        shadow.background.mirrorMode('background');
        await controller.resume();
      }
      record('mapResume', {
        statusBefore: before,
        statusAfter: status(),
        draftPickupCount: draft.pickupCount,
        shadowPickupCount: controller.getSnapshot().pickupCount,
      });
    },
    async observeRestoreToSummary(draft) {
      const before = status();
      if (before === 'idle' || before === 'failed') await controller.restore(draft);
      if (status() === 'recoverable') {
        try {
          await controller.confirmEnd();
        } catch (e) {
          record('desync', { at: 'restoreToSummary', error: String(e) });
        }
      }
      record('mapRestoreToSummary', { statusBefore: before, statusAfter: status() });
    },
    async observeLaunchDraft(draft) {
      if (status() !== 'idle') return;
      await controller.restore(draft);
      record('launchDraft', { pickupCount: draft.pickupCount, routePoints: draft.route.length });
    },
    observeStop() {
      return observeShadowStop(controller, (detail) => record('desync', detail));
    },
    emitDiff(map, stop) {
      const diff = buildShadowDiff(map, stop, shadow.detector, shadow.clock.now());
      try {
        io.record?.(SHADOW_DIFF_EVENT, diff);
      } catch {
        // never
      }
      (io.log ?? console.log)(`[session-shadow] ${SHADOW_DIFF_EVENT} ${JSON.stringify(diff)}`);
      void stop.confirm.then((result) => {
        if (result && result.pickupCount !== diff.shadowResultCount) {
          (io.warn ?? console.warn)(
            `[session-shadow] confirmEnd() returned ${result.pickupCount}; the recorded prediction was ${diff.shadowResultCount}`,
          );
        }
      });
      return diff;
    },
    async observeDraftCleared(outcome) {
      await release(outcome, 'draftCleared');
    },
  };
}
