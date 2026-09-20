/**
 * Cleanup session — shared types.
 *
 * One active walk, modeled independently of any screen. See
 * docs/CLEANUP_SESSION_ARCHITECTURE.md ("What a cleanup session owns",
 * "Lifecycle contract") and docs/SESSION_CONTROLLER_EXTRACTION_INVENTORY.md
 * for the map.tsx line-by-line origin of every field declared here.
 *
 * This file, routeRecorder.ts, cleanupSessionStore.ts and
 * cleanupSessionController.ts deliberately import nothing from react,
 * react-native or expo-* at module scope, so the whole lifecycle can run
 * under plain `npx -y tsx` (see __tests__/sessionController.test.ts). Only
 * useCleanupSession.ts (the React binding) and the two adapter files
 * (sessionPersistence.ts, appSessionDeps.ts) touch the real app singletons.
 */

/** The eight lifecycle states from the spec's state diagram. */
export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'active'
  | 'backgroundActive'
  | 'finalizing'
  | 'summary'
  | 'recoverable'
  | 'failed';

/**
 * Power path the walk actually took — map.tsx:102-104 (`sessionMode`) and
 * :2356-2358 (`session_mode` on the saved cleanup). `null` means unresolved.
 */
export type SessionMode = 'background' | 'foreground';

/** A GPS point accepted into the walk's route — map.tsx:272 (`sessionRoute`). */
export interface RoutePoint {
  readonly lat: number;
  readonly lon: number;
  readonly timestamp: number;
}

/** Where a pickup happened — map.tsx:277 (`pickupLocations`), :1742. */
export interface PickupLocation {
  readonly lat: number;
  readonly lon: number;
  readonly timestamp: number;
}

/**
 * A raw fix handed to the session, before the route gates. Accuracy is in
 * meters and optional (queued background points carry `undefined` when the
 * OS didn't report one — backgroundSession.ts:26). Speed is m/s, `-1` or
 * undefined when unknown, and only used for the UI "too fast" mirror.
 */
export interface LocationFix {
  readonly lat: number;
  readonly lon: number;
  readonly timestamp: number;
  readonly accuracy?: number;
  readonly speed?: number;
}

/** What MotionDetector hands its pickup callback (motionDetection.ts:40-47). */
export interface DetectorPickupEvent {
  readonly timestamp: number;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly accuracy?: number;
}

// ── Health (rule 5: a failed optional service must not silently invalidate the walk) ──

export type DetectorState =
  | 'unknown'
  | 'attaching'
  | 'attached'
  | 'degraded' // attached, but the detector reported a non-fatal error (e.g. no location for pace gates)
  | 'notAttached' // startListening() resolved but sensorsAttached() is false — map.tsx:1777-1783
  | 'failed'
  | 'stopped';

export type BackgroundLocationState =
  | 'unknown'
  | 'pending'
  | 'background'
  | 'foreground'
  | 'failed'
  | 'stopped';

export type PedometerState = 'unknown' | 'active' | 'unavailable' | 'denied' | 'failed';

export type DiagnosticsState = 'unknown' | 'off' | 'recording' | 'failed' | 'stopped';

export type MapState = 'unknown' | 'mounted' | 'unmounted';

export interface ServiceHealth<S extends string> {
  readonly state: S;
  readonly detail?: string;
}

export interface SessionHealth {
  readonly detector: ServiceHealth<DetectorState>;
  readonly backgroundLocation: ServiceHealth<BackgroundLocationState>;
  readonly pedometer: ServiceHealth<PedometerState>;
  readonly diagnostics: ServiceHealth<DiagnosticsState>;
  /** Reported by the view via `reportMapHealth()`; the controller never infers it. */
  readonly map: ServiceHealth<MapState>;
}

// ── Read model ──

/**
 * The read-only snapshot every screen renders from (spec: "A screen can
 * render snapshot.status, elapsedSeconds, pickupCount, route,
 * pickupLocations, and sensor/mode health. It cannot change them directly.").
 * Deep-frozen by the store; a new object is published on every change so
 * React's useSyncExternalStore can compare by reference.
 */
export interface SessionSnapshot {
  readonly status: SessionStatus;
  readonly sessionId: string | null;
  /** Wall-clock ms when the walk went live (map.tsx:1268 anchor), or the restored draft's start. */
  readonly startedAt: number | null;
  /** Derived from wall clock on every publish, never tick-counted — map.tsx:88-91. */
  readonly elapsedSeconds: number;
  /** The raw detector count for this session — map.tsx:82 (`pickupCount`), saved as `items_detected`. */
  readonly pickupCount: number;
  readonly route: readonly RoutePoint[];
  readonly pickupLocations: readonly PickupLocation[];
  /** map.tsx:2455-2476 (`calculateCoverage().distance`), in meters. */
  readonly distanceMeters: number;
  readonly mode: SessionMode | null;
  /** Why the background session rejected, if it did — map.tsx:297, :1903. */
  readonly modeFailure: string | null;
  /** Latest fix seen this session, noisy or not — map.tsx:298 (`currentLocationRef`). */
  readonly lastFix: LocationFix | null;
  readonly health: SessionHealth;
  /** Populated while `status === 'summary'`. */
  readonly result: SessionResult | null;
  /** Populated while `status === 'failed'`. */
  readonly failure: string | null;
}

/** What `requestEnd()` returns for the "End this cleanup?" confirm — map.tsx:1940-1950. */
export interface EndPreview {
  readonly canEnd: boolean;
  readonly status: SessionStatus;
  readonly pickupCount: number;
  readonly elapsedSeconds: number;
  readonly routePoints: number;
  readonly distanceMeters: number;
  /** map.tsx:2167 — `elapsed < MIN_CLEANUP_SECONDS && pickupCount === 0`. Informational; the save flow enforces it. */
  readonly tooShortToCount: boolean;
}

/**
 * The session data handoff to the Stop → confirm/correct → save flow. The
 * controller does NOT write the cleanup document (that stays with the save
 * flow, map.tsx:2278-2365); it hands over everything that flow reads from
 * session state today.
 */
export interface SessionResult {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationSeconds: number;
  /** Final session count after the stop-trim (map.tsx:1961-1964). Saved as `items_detected`. */
  readonly pickupCount: number;
  readonly detectedBeforeTrim: number;
  readonly trimmedAtStop: number;
  readonly route: readonly RoutePoint[];
  readonly pickupLocations: readonly PickupLocation[];
  readonly distanceMeters: number;
  readonly mode: SessionMode | null;
  readonly modeFailure: string | null;
  /** map.tsx:2356-2358 verbatim: mode, else `unresolved:<reason>`, else `unresolved`. */
  readonly sessionModeLabel: string;
  readonly tooShortToCount: boolean;
  readonly health: SessionHealth;
  /** True when the detector was (re)attached in this JS process; false on the crash-relaunch restore path. */
  readonly attachedInProcess: boolean;
}

/**
 * The persisted draft (rule 3). Structurally a superset of
 * sessionRecovery.ts's `WalkDraft` — the two extra fields ride along in the
 * same JSON and are ignored by today's readers.
 */
export interface SessionDraft {
  readonly sessionId?: string;
  /** ms epoch when the walk began. */
  readonly startedAt: number;
  /** ms epoch when this draft was written. */
  readonly savedAt: number;
  readonly pickupCount: number;
  readonly elapsedSeconds: number;
  readonly route: RoutePoint[];
  readonly pickups: PickupLocation[];
  readonly mode?: SessionMode | null;
}

// ── Ports (every side effect the controller can cause goes through one of these) ──

export interface DetectorPort {
  /** motionDetection.ts:168 — resolves even when sensors fail; see `sensorsAttached`. */
  startListening(
    onPickup: (event: DetectorPickupEvent) => void,
    onError?: (message: string) => void,
  ): Promise<void>;
  /** motionDetection.ts:355 — idempotent when nothing is attached. */
  stopListening(): void;
  /** motionDetection.ts:699 — the loud check for a silent zero-count walk. */
  sensorsAttached?(): boolean;
  /** motionDetection.ts:731 — the detector's own GPS watcher, reused for pickup pins. */
  getLastLocation?(): { latitude: number; longitude: number; accuracy?: number; speed?: number } | null;
  /** motionDetection.ts:790 — pocket-removal guard at Stop; returns the detector's own remaining count. */
  trimRecentPickups?(windowMs: number): number;
  /** motionDetection.ts:802 — the detector's own per-attach count (resets on every startListening). */
  getPickupCount?(): number;
  /** motionDetection.ts:704 — flight-recorder length, for the crash heartbeat. */
  getSessionEventCount?(): number;
  /** map.tsx:1857 — per-session reset of the detector-side accumulator (PickupAggregator.resetSession()). */
  resetSession?(): void;
}

export interface BackgroundSessionPort {
  /** backgroundSession.ts:77 — resolves to the mode; may reject (map.tsx:1892-1905). */
  start(): Promise<SessionMode>;
  /** backgroundSession.ts:129. */
  stop(): Promise<void> | void;
  /** backgroundSession.ts:65 — every OS-delivered fix since the last drain. */
  drainQueued?(): LocationFix[];
  /** backgroundSession.ts:121 — asks the OS whether the task is still registered. */
  isRunning?(): Promise<boolean>;
}

export interface PersistencePort {
  /** sessionRecovery.ts:47 — fire-and-forget; a failed write must never interrupt a walk. */
  saveDraft(draft: SessionDraft): void | Promise<void>;
  /** sessionRecovery.ts:56. */
  loadDraft(): Promise<SessionDraft | null>;
  /** sessionRecovery.ts:79 — only after a durable save or a confirmed discard. */
  clearDraft(): void | Promise<void>;
  /** crashRecorder.ts:53 — the black-box sentinel. */
  beginTrace?(meta: { sessionId: string; startedAt: number }): void | Promise<void>;
  /** crashRecorder.ts:73 — overwrite the sentinel with the latest counters. */
  heartbeat?(patch: { routePoints: number; pickups: number; motionEvents: number }): void;
  /** crashRecorder.ts:85 — clean stop. */
  endTrace?(): void | Promise<void>;
}

export interface ClockPort {
  now(): number;
  /** Defaults to the global setInterval when omitted; injected by tests. */
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
}

export interface DiagnosticsPort {
  /** motionDiagnostics.ts:37 — a NEW cleanup only; never on resume. Return value is the recorder's state if known. */
  start(sessionId: string): Promise<DiagnosticsState | void> | DiagnosticsState | void;
  /** motionDiagnostics.ts:92. */
  stop(reason?: string): Promise<void> | void;
  /** motionDiagnostics.ts:89 — non-throwing tap. */
  record?(type: string, data: Record<string, unknown>): void;
}

export interface PedometerPort {
  start(): Promise<PedometerState> | PedometerState;
  stop?(): void;
}

export interface LocationPort {
  /** One fix, or null if none is available. Errors are swallowed by the controller (map.tsx:1536-1538). */
  poll(): Promise<LocationFix | null>;
}

export interface SessionDeps {
  readonly detector: DetectorPort;
  readonly backgroundSession: BackgroundSessionPort;
  readonly persistence: PersistencePort;
  readonly clock: ClockPort;
  readonly diagnostics?: DiagnosticsPort;
  readonly pedometer?: PedometerPort;
  readonly location?: LocationPort;
}

export interface ControllerOptions {
  /** map.tsx:1269 — the 1 Hz elapsed clock. */
  readonly tickMs?: number;
  /** map.tsx:1032 — the draft autosave throttle. */
  readonly autosaveIntervalMs?: number;
  /** map.tsx:1275 — 10 s with battery saver (the default, :282), 5 s without. */
  readonly locationIntervalMs?: number;
  /** map.tsx:2164. */
  readonly minCleanupSeconds?: number;
  /** map.tsx:1961 — the pocket-removal trim window at Stop. */
  readonly stopTrimWindowMs?: number;
}

/** What the React binding feeds into `reportAppState()` — RN's AppStateStatus values. */
export type AppStateLike = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export type SummaryOutcome = 'saved' | 'discarded';
