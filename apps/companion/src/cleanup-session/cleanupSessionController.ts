/**
 * Cleanup session controller — the lifecycle coordinator and the one owner
 * of every listener a walk needs (docs/CLEANUP_SESSION_ARCHITECTURE.md).
 *
 * Slice 1 (2026-09-20): this module is complete and tested but wired into
 * nothing. Production behavior is unchanged; app/(tabs)/map.tsx still owns
 * the live walk. Every decision below cites the map.tsx line it preserves,
 * and the handful of places where this controller deliberately does
 * something different are marked DIVERGENCE and listed in
 * docs/SESSION_CONTROLLER_EXTRACTION_INVENTORY.md for the slice-2 parallel
 * run to check against a real walk.
 *
 * The five rules, and where each is enforced:
 *  1. Only the controller starts or stops listeners; a second Start is a
 *     no-op while starting/active/backgroundActive/finalizing → `start()`.
 *  2. The detector has exactly one callback; a UI remount re-subscribes to
 *     the store instead of re-attaching → `attachDetector()` +
 *     `handlePickup()`'s session-id guard.
 *  3. The active session is persisted at bounded intervals, independent of
 *     the view → `autosave()`.
 *  4. The map receives a snapshot, never an imperative responsibility →
 *     the store's deep-frozen snapshot; the only inputs a view has are the
 *     explicit `report*()` methods.
 *  5. A failed optional service does not silently invalidate the walk →
 *     `SessionHealth` flags; only a rejecting detector yields `failed`.
 *
 * Pure: no react / react-native / expo-* imports. Every side effect goes
 * through the injected `SessionDeps` ports (types.ts).
 */
import { CleanupSessionStore, createIdleSnapshot, deepFreeze, freshHealth } from './cleanupSessionStore';
import { RouteRecorder } from './routeRecorder';
import type {
  AppStateLike,
  ControllerOptions,
  DetectorPickupEvent,
  EndPreview,
  LocationFix,
  MapState,
  PickupLocation,
  RoutePoint,
  ServiceHealth,
  SessionDeps,
  SessionDraft,
  SessionHealth,
  SessionMode,
  SessionResult,
  SessionSnapshot,
  SessionStatus,
  SummaryOutcome,
} from './types';
import type { SnapshotListener } from './cleanupSessionStore';

export const DEFAULT_OPTIONS: Required<ControllerOptions> = {
  tickMs: 1000, // map.tsx:1269
  autosaveIntervalMs: 20000, // map.tsx:1032
  locationIntervalMs: 10000, // map.tsx:1275 with batterySaver's default of true (:282)
  minCleanupSeconds: 60, // map.tsx:2164
  stopTrimWindowMs: 6000, // map.tsx:1961
};

/** States in which a walk is live and the clock runs. */
const LIVE: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['active', 'backgroundActive']);
/** Rule 1 — states in which `start()` must be a no-op. */
const START_BLOCKED: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'starting',
  'active',
  'backgroundActive',
  'finalizing',
]);
/** States in which a fix may enter the route (the first fix lands before the walk is live — map.tsx:1717). */
const ROUTE_OPEN: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['starting', 'active', 'backgroundActive']);

/** map.tsx:2356-2358 verbatim. */
export function describeSessionMode(mode: SessionMode | null, failure: string | null): string {
  return mode ?? (failure ? `unresolved:${failure}` : 'unresolved');
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

type MutableHealth = {
  detector: ServiceHealth<SessionHealth['detector']['state']>;
  backgroundLocation: ServiceHealth<SessionHealth['backgroundLocation']['state']>;
  pedometer: ServiceHealth<SessionHealth['pedometer']['state']>;
  diagnostics: ServiceHealth<SessionHealth['diagnostics']['state']>;
};

const EMPTY_ROUTE: readonly RoutePoint[] = Object.freeze([] as RoutePoint[]);
const EMPTY_PICKUPS: readonly PickupLocation[] = Object.freeze([] as PickupLocation[]);

export class CleanupSessionController {
  private readonly deps: SessionDeps;
  private readonly opts: Required<ControllerOptions>;
  private readonly store: CleanupSessionStore;
  private readonly recorder = new RouteRecorder();

  private status: SessionStatus = 'idle';
  private sessionId: string | null = null;
  private startedAt: number | null = null;
  /** map.tsx:91 (`sessionStartRef`) — elapsed is `now - anchor`, never tick-counted. */
  private elapsedAnchor: number | null = null;
  private pickupCount = 0;
  private mode: SessionMode | null = null;
  private modeFailure: string | null = null;
  private lastFix: LocationFix | null = null;
  private health: MutableHealth = freshHealth();
  /** Reported by the view; independent of the session lifecycle, so it survives resets. */
  private mapHealth: ServiceHealth<MapState> = { state: 'unknown' };
  private result: SessionResult | null = null;
  private failure: string | null = null;
  private appActive = true;
  /** True once this process attached the detector for the current session. */
  private detectorAttached = false;
  private lastAutosaveAt = 0;
  private lastLocationPollAt = 0;
  /** Session ids stay unique even if two sessions start inside the same clock millisecond. */
  private lastSessionIdMs = 0;
  private tickHandle: unknown = null;
  private startInFlight: Promise<SessionSnapshot> | null = null;
  private endInFlight: Promise<SessionResult> | null = null;
  // Cached frozen views, refreshed only when the recorder's version moves.
  private viewVersion = -1;
  private routeView: readonly RoutePoint[] = EMPTY_ROUTE;
  private pickupsView: readonly PickupLocation[] = EMPTY_PICKUPS;
  private distanceView = 0;

  constructor(deps: SessionDeps, options: ControllerOptions = {}) {
    this.deps = deps;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.store = new CleanupSessionStore(createIdleSnapshot());
  }

  // ── Read surface ──────────────────────────────────────────────────────────

  getSnapshot = (): SessionSnapshot => this.store.getSnapshot();

  subscribe = (listener: SnapshotListener): (() => void) => this.store.subscribe(listener);

  /** Test/diagnostic aid — how many views are currently subscribed. */
  listenerCount(): number {
    return this.store.listenerCount();
  }

  // ── Lifecycle: idle → starting → active ───────────────────────────────────

  /**
   * Start a cleanup. Rule 1: a no-op (returning the current snapshot) while
   * starting/active/backgroundActive/finalizing. Also a no-op from
   * `recoverable` and `summary` — a stray Start must never wipe a walk that
   * is still restorable or not yet saved (the 2026-09-10 bug class,
   * map.tsx:1821-1830). Allowed from `idle` and `failed`.
   */
  start = async (): Promise<SessionSnapshot> => {
    if (this.status === 'starting' && this.startInFlight) return this.startInFlight;
    if (START_BLOCKED.has(this.status) || this.status === 'recoverable' || this.status === 'summary') {
      return this.getSnapshot();
    }
    this.startInFlight = this.runStart();
    try {
      return await this.startInFlight;
    } finally {
      this.startInFlight = null;
    }
  };

  private async runStart(): Promise<SessionSnapshot> {
    this.resetSessionState();
    const id = this.nextSessionId(); // map.tsx:1836 (`watchSessionRef`) format, strictly increasing
    this.sessionId = id;
    try {
      this.deps.detector.resetSession?.(); // map.tsx:1857 — PickupAggregator.resetSession()
    } catch {
      // A failed per-session reset must not block the walk.
    }
    this.status = 'starting';
    this.health.detector = { state: 'attaching' };
    this.publish();

    // map.tsx:1858 — diagnostics start on a NEW cleanup only, before the detector attaches.
    await this.startDiagnostics(id);

    // map.tsx:1717 — attachWalkListeners() begins with one location fix (this is
    // what triggers the OS location prompt on a first walk), then attaches.
    await this.pollLocationOnce(id);
    if (this.sessionId !== id) return this.getSnapshot();

    const attached = await this.attachDetector(id);
    if (!attached) {
      // map.tsx:1907-1914 — start failed: diagnostics stopped with the reason,
      // no crash trace, no background session, nothing else touched.
      await this.safeCall(() => this.deps.diagnostics?.stop('cleanup start failed'));
      this.status = 'failed';
      this.stopTicker();
      this.publish();
      return this.getSnapshot();
    }

    // Live. The elapsed anchor is set here, when the walk actually goes live,
    // not at the tap — map.tsx:1268 anchors when `isListening` flips true.
    const t = this.deps.clock.now();
    this.startedAt = t;
    this.elapsedAnchor = t;
    this.status = 'active';
    this.startTicker();
    this.publish();
    this.recordDiagnostic('visibleCount', { pickupCount: this.pickupCount }); // map.tsx:289
    this.autosave(true); // map.tsx:1029-1042 — the effect fires immediately on the isListening flip

    // map.tsx:1865 — the black-box sentinel, after the sensors are up.
    await this.safeCall(() => this.deps.persistence.beginTrace?.({ sessionId: id, startedAt: t }));
    if (this.sessionId !== id) return this.getSnapshot();

    await this.startPedometer(id);

    // map.tsx:1872-1905. DIVERGENCE (timing only): awaited here so `start()`
    // resolves with the mode settled; the snapshot already reads `active`
    // above, so nothing the view shows waits on the permission sheet.
    await this.resolveBackgroundSession(id);
    return this.getSnapshot();
  }

  private async startDiagnostics(id: string): Promise<void> {
    const port = this.deps.diagnostics;
    if (!port) {
      this.health.diagnostics = { state: 'off' };
      return;
    }
    try {
      const state = await port.start(id);
      if (this.sessionId !== id) return;
      this.health.diagnostics = { state: state ?? 'unknown' };
    } catch (e) {
      if (this.sessionId !== id) return;
      // motionDiagnostics.ts:85 — "Diagnostics must never prevent a cleanup from starting."
      this.health.diagnostics = { state: 'failed', detail: errorMessage(e) };
    }
  }

  private async startPedometer(id: string): Promise<void> {
    const port = this.deps.pedometer;
    if (!port) return; // MotionDetector owns the pedometer internally today (motionDetection.ts:315-345); health stays 'unknown'.
    try {
      const state = await port.start();
      if (this.sessionId !== id) return;
      this.health.pedometer = { state };
    } catch (e) {
      if (this.sessionId !== id) return;
      this.health.pedometer = { state: 'failed', detail: errorMessage(e) };
    }
    this.publish();
  }

  /**
   * Rule 2's mechanics, from map.tsx:1715-1769 (`attachWalkListeners`):
   * stopListening() first, unconditionally — MotionDetector's own guard
   * silently no-ops a second startListening() (motionDetection.ts:172-175),
   * so without this a re-attach would leave a stale callback as the only
   * one receiving pickups. Then attach the controller's single callback,
   * tagged with the session id so a late event from a previous attach is
   * ignored rather than counted.
   */
  private async attachDetector(id: string): Promise<boolean> {
    const { detector } = this.deps;
    try {
      detector.stopListening();
    } catch {
      // Idempotent by contract; a throw here is not a reason to abandon the walk.
    }
    const onPickup = (event: DetectorPickupEvent) => this.handlePickup(id, event);
    const onError = (message: string) => this.handleDetectorError(id, message);
    try {
      await detector.startListening(onPickup, onError);
    } catch (e) {
      const detail = errorMessage(e);
      this.health.detector = { state: 'failed', detail };
      this.failure = `Motion detector failed to start: ${detail}`;
      return false;
    }
    if (this.sessionId !== id) return false;
    this.detectorAttached = true;
    const sensorsOk = detector.sensorsAttached ? detector.sensorsAttached() : true;
    this.health.detector = sensorsOk
      ? { state: 'attached', detail: this.health.detector.detail }
      : {
          // map.tsx:1777-1783 — the walk continues, but say so loudly.
          state: 'notAttached',
          detail: "Motion sensors did not start — this walk won't count pickups automatically.",
        };
    return true;
  }

  /** map.tsx:1721-1766 — the one pickup callback. */
  private handlePickup(id: string, event: DetectorPickupEvent): void {
    if (id !== this.sessionId || !LIVE.has(this.status)) return; // stale attach or walk over — rule 2
    this.pickupCount += 1;
    // map.tsx:1738-1741 — prefer the detector's own fix, then the session's latest.
    const last = this.deps.detector.getLastLocation?.() ?? null;
    const lat = last?.latitude ?? event.latitude ?? this.lastFix?.lat;
    const lon = last?.longitude ?? event.longitude ?? this.lastFix?.lon;
    if (lat != null && lon != null) {
      this.recorder.addPickup({ lat, lon, timestamp: this.deps.clock.now() });
    }
    this.recordDiagnostic('visibleCount', { pickupCount: this.pickupCount }); // map.tsx:289
    this.publish();
    this.autosave(false);
  }

  private handleDetectorError(id: string, message: string): void {
    if (id !== this.sessionId) return;
    const current = this.health.detector;
    this.health.detector = {
      state: current.state === 'attached' ? 'degraded' : current.state,
      detail: message,
    };
    this.publish();
  }

  private async resolveBackgroundSession(id: string): Promise<void> {
    this.health.backgroundLocation = { state: 'pending' };
    let mode: SessionMode;
    try {
      mode = await this.deps.backgroundSession.start();
    } catch (e) {
      if (this.sessionId !== id) return;
      // map.tsx:1892-1905 — record why, keep walking.
      const why = errorMessage(e).slice(0, 120);
      this.modeFailure = why;
      this.health.backgroundLocation = { state: 'failed', detail: why };
      this.publish();
      return;
    }
    if (this.sessionId !== id || !LIVE.has(this.status)) {
      // The walk ended while the OS session was still starting. map.tsx has no
      // guard here (:1872 vs :1955 — a stop during the permission sheet leaves
      // the task registered); stopping it now is the only safe answer.
      await this.safeCall(() => this.deps.backgroundSession.stop());
      return;
    }
    this.mode = mode;
    this.health.backgroundLocation = { state: mode };
    this.syncBackgroundStatus();
    this.publish();
  }

  // ── Lifecycle: active ⇄ backgroundActive ──────────────────────────────────

  /**
   * Fed by the React binding from AppState. `backgroundActive` means the app
   * is backgrounded AND an OS location session is keeping it alive; a
   * foreground-only walk stays `active` and its health says why.
   */
  reportAppState(state: AppStateLike): void {
    this.appActive = state === 'active'; // map.tsx:445 — only 'active' counts
    if (this.syncBackgroundStatus()) this.publish();
  }

  private syncBackgroundStatus(): boolean {
    if (this.status === 'active' && !this.appActive && this.mode === 'background') {
      this.status = 'backgroundActive';
      return true;
    }
    if (this.status === 'backgroundActive' && this.appActive) {
      this.status = 'active';
      return true;
    }
    return false;
  }

  /** Rule 5 — the map is an optional service; the view tells us whether it is mounted. */
  reportMapHealth(state: MapState, detail?: string): void {
    this.mapHealth = detail ? { state, detail } : { state };
    this.publish();
  }

  // ── Location intake ───────────────────────────────────────────────────────

  /**
   * Explicit intake for the slice-2 parallel run, where Map's own
   * `trackLocation()` keeps GPS ownership and forwards what it gathered each
   * tick: the foreground fix (null when it had none) plus the batch it drained
   * from the OS queue, both raw — same gates, same batching as the polled path
   * (`pollLocationOnce()` → `ingest(fix, queued)`), so the shadow's route is
   * produced by exactly the code that goes live in slice 3.
   */
  recordLocation(fix: LocationFix | null, queued: readonly LocationFix[] = []): void {
    if (!ROUTE_OPEN.has(this.status)) return;
    this.ingest(fix, queued);
  }

  private async pollLocationOnce(id: string): Promise<void> {
    const port = this.deps.location;
    if (!port) return;
    this.lastLocationPollAt = this.deps.clock.now();
    let fix: LocationFix | null = null;
    try {
      fix = (await port.poll()) ?? null;
    } catch {
      // map.tsx:1536-1538 — location errors never interrupt a walk.
    }
    if (this.sessionId !== id || !ROUTE_OPEN.has(this.status)) return;
    // map.tsx:1414-1419 — while backgrounded the OS task keeps queuing fixes
    // that a throttled timer would otherwise never see; drain them here.
    const queued = this.mode === 'background' ? (this.deps.backgroundSession.drainQueued?.() ?? []) : [];
    this.ingest(fix, queued);
  }

  private ingest(fix: LocationFix | null, queued: readonly LocationFix[]): void {
    if (fix) this.lastFix = fix; // map.tsx:1393-1394 — the dot moves even on a noisy fix
    const candidates: LocationFix[] = [...queued];
    if (fix) candidates.push(fix);
    const { accepted } = this.recorder.ingest(candidates);
    if (accepted.length) {
      // map.tsx:1501-1508 — the black-box heartbeat rides accepted route updates.
      this.deps.persistence.heartbeat?.({
        routePoints: this.recorder.getRoute().length,
        pickups: this.pickupCount,
        motionEvents: this.deps.detector.getSessionEventCount?.() ?? 0,
      });
    }
    this.publish();
    this.autosave(false);
  }

  // ── Clock ─────────────────────────────────────────────────────────────────

  private startTicker(): void {
    this.stopTicker();
    const clock = this.deps.clock;
    const fn = () => this.tick();
    this.tickHandle = clock.setInterval ? clock.setInterval(fn, this.opts.tickMs) : setInterval(fn, this.opts.tickMs);
  }

  private stopTicker(): void {
    if (this.tickHandle === null) return;
    const clock = this.deps.clock;
    if (clock.clearInterval) clock.clearInterval(this.tickHandle);
    else clearInterval(this.tickHandle as ReturnType<typeof setInterval>);
    this.tickHandle = null;
  }

  /** The one session clock (spec: "One session clock and bounded UI publication"). */
  private tick(): void {
    if (!LIVE.has(this.status)) return;
    this.publish(); // elapsed moved
    this.autosave(false);
    const now = this.deps.clock.now();
    if (this.deps.location && now - this.lastLocationPollAt >= this.opts.locationIntervalMs) {
      this.lastLocationPollAt = now;
      const id = this.sessionId;
      if (id) void this.pollLocationOnce(id);
    }
  }

  // ── Persistence (rule 3) ──────────────────────────────────────────────────

  private autosave(force: boolean): void {
    if (!LIVE.has(this.status)) return;
    const now = this.deps.clock.now();
    if (!force && now - this.lastAutosaveAt < this.opts.autosaveIntervalMs) return;
    this.lastAutosaveAt = now;
    void this.safeCall(() => this.deps.persistence.saveDraft(this.buildDraft(now, this.pickupCount)));
  }

  private buildDraft(now: number, pickupCount: number): SessionDraft {
    const elapsed = this.elapsedSeconds();
    return {
      sessionId: this.sessionId ?? undefined,
      startedAt: this.startedAt ?? now - elapsed * 1000, // map.tsx:1035
      savedAt: now,
      pickupCount,
      elapsedSeconds: elapsed,
      route: this.recorder.getRoute().slice(),
      pickups: this.recorder.getPickups().slice(),
      mode: this.mode,
    };
  }

  // ── Lifecycle: recoverable ────────────────────────────────────────────────

  /**
   * Load a draft into the controller without touching any sensor. From
   * `idle`/`failed` only. With no argument, reads the draft through the
   * persistence port. Lands in `recoverable`; the caller then decides
   * between `resume()` (a live walk after a UI remount — map.tsx:1800-1819)
   * and `confirmEnd()` (the launch-time "Restore" path — map.tsx:1015-1024,
   * which goes straight to the summary sheet).
   */
  restore = async (draft?: SessionDraft): Promise<SessionSnapshot> => {
    if (this.status !== 'idle' && this.status !== 'failed') return this.getSnapshot();
    let source: SessionDraft | null = draft ?? null;
    if (!source) {
      try {
        source = await this.deps.persistence.loadDraft();
      } catch {
        source = null;
      }
    }
    if (!source || (this.status !== 'idle' && this.status !== 'failed')) return this.getSnapshot();
    this.resetSessionState();
    const now = this.deps.clock.now();
    this.sessionId = this.nextSessionId(); // map.tsx:1803 — a resumed walk gets a fresh watch session id
    this.pickupCount = source.pickupCount || 0;
    this.recorder.restore(source.route || [], source.pickups || []);
    this.mode = source.mode ?? null;
    // map.tsx:1811 — prefer wall-clock-since-start over the (≤ ~20 s stale) saved elapsed.
    const liveElapsed = Math.max(source.elapsedSeconds || 0, Math.round((now - source.startedAt) / 1000));
    this.startedAt = source.startedAt;
    this.elapsedAnchor = now - liveElapsed * 1000;
    this.health.detector = { state: 'stopped', detail: 'not attached in this process' };
    if (this.mode) this.health.backgroundLocation = { state: this.mode, detail: 'from draft; not yet confirmed with the OS' };
    this.status = 'recoverable';
    this.recordDiagnostic('visibleCount', { pickupCount: this.pickupCount });
    this.publish();
    return this.getSnapshot();
  };

  /**
   * Pick a recoverable walk back up as live — map.tsx:1800-1819
   * (`resumeWalkAfterRemount`). Re-attaches the detector only: diagnostics,
   * the crash trace and the OS background session are module/OS-level
   * singletons still running from the original start (map.tsx:1794-1799), so
   * none of them is re-requested here.
   */
  resume = async (): Promise<SessionSnapshot> => {
    if (this.status !== 'recoverable') return this.getSnapshot();
    if (this.startInFlight) return this.startInFlight;
    this.startInFlight = this.runResume();
    try {
      return await this.startInFlight;
    } finally {
      this.startInFlight = null;
    }
  };

  private async runResume(): Promise<SessionSnapshot> {
    const id = this.sessionId as string;
    this.status = 'starting';
    this.health.detector = { state: 'attaching' };
    this.publish();

    await this.pollLocationOnce(id); // map.tsx:1813 → :1717
    if (this.sessionId !== id) return this.getSnapshot();

    const attached = await this.attachDetector(id);
    if (!attached) {
      this.status = 'failed';
      this.publish();
      return this.getSnapshot();
    }

    // Ask the OS whether the background task really is still registered,
    // rather than trusting the draft — the same ground truth map.tsx:420
    // uses before deciding a walk is genuinely live.
    const isRunning = this.deps.backgroundSession.isRunning;
    if (isRunning) {
      try {
        const running = await isRunning();
        if (this.sessionId !== id) return this.getSnapshot();
        if (running) {
          this.mode = 'background';
          this.health.backgroundLocation = { state: 'background' };
        } else if (this.mode) {
          this.health.backgroundLocation = { state: this.mode, detail: 'OS task not registered' };
        } else {
          this.health.backgroundLocation = { state: 'unknown', detail: 'OS task not registered' };
        }
      } catch {
        // Leave whatever the draft said.
      }
    }

    this.status = 'active';
    this.syncBackgroundStatus();
    this.startTicker();
    this.publish();
    this.autosave(true);
    return this.getSnapshot();
  }

  // ── Lifecycle: → finalizing → summary → idle ──────────────────────────────

  /** The "End this cleanup?" preview — map.tsx:1940-1950. Side-effect free. */
  requestEnd = (): EndPreview => {
    const elapsed = this.elapsedSeconds();
    this.refreshViews();
    return deepFreeze({
      canEnd: LIVE.has(this.status) || this.status === 'recoverable',
      status: this.status,
      pickupCount: this.pickupCount,
      elapsedSeconds: elapsed,
      routePoints: this.routeView.length,
      distanceMeters: this.distanceView,
      tooShortToCount: elapsed < this.opts.minCleanupSeconds && this.pickupCount === 0,
    });
  };

  /**
   * End the walk — map.tsx:1952-1998 (`finishCleanup`). Idempotent while
   * finalizing (returns the in-flight promise) and in `summary` (returns the
   * stored result). Throws from any other state: an End with nothing to end
   * is a programming error the caller should see.
   */
  confirmEnd = async (): Promise<SessionResult> => {
    if (this.status === 'summary' && this.result) return this.result;
    if (this.status === 'finalizing' && this.endInFlight) return this.endInFlight;
    if (!(LIVE.has(this.status) || this.status === 'recoverable')) {
      throw new Error(`confirmEnd() called while ${this.status}`);
    }
    this.endInFlight = this.runEnd();
    try {
      return await this.endInFlight;
    } finally {
      this.endInFlight = null;
    }
  };

  private async runEnd(): Promise<SessionResult> {
    const id = this.sessionId as string;
    this.status = 'finalizing';
    this.stopTicker();
    this.publish();

    // map.tsx:1955 — the OS session first.
    const stopped = await this.safeCall(() => this.deps.backgroundSession.stop());
    this.health.backgroundLocation = stopped
      ? { state: 'stopped' }
      : { state: 'failed', detail: 'stopBackgroundSession threw' };

    // map.tsx:1957 — clear the black-box sentinel so launch sees no crash.
    await this.safeCall(() => this.deps.persistence.endTrace?.());

    // map.tsx:1958-1964 — detach, then the pocket-removal trim.
    const detectedBeforeTrim = this.pickupCount;
    let trimmedAtStop = 0;
    if (this.detectorAttached) {
      const { detector } = this.deps;
      try {
        detector.stopListening();
      } catch {
        // Nothing to do; the walk still ends.
      }
      if (detector.trimRecentPickups) {
        // DIVERGENCE (correctness): map.tsx:1961-1964 takes the detector's
        // own post-trim count as the walk's final count. After a mid-walk
        // remount that detector count restarts from zero (startListening
        // resets pickupEvents — motionDetection.ts:188), so today's Stop
        // overwrites a restored count with only the post-remount pickups.
        // Here the walk's count is the controller's, and the trim is applied
        // as a delta — identical to today whenever nothing remounted.
        const before = detector.getPickupCount?.() ?? null;
        let after: number | null = null;
        try {
          after = detector.trimRecentPickups(this.opts.stopTrimWindowMs);
        } catch {
          after = null;
        }
        if (before !== null && after !== null) trimmedAtStop = Math.max(0, before - after);
      }
      this.health.detector = { state: 'stopped' };
    }
    const finalCount = Math.max(0, detectedBeforeTrim - trimmedAtStop);
    this.pickupCount = finalCount;

    // map.tsx:1962-1963 — the diagnostic end row, then the recorder stops.
    this.recordDiagnostic('cleanupEnd', {
      detectedBeforeTrim,
      detectedAfterTrim: finalCount,
      sessionStartedAtMs: this.startedAt ?? 0,
    });
    this.recordDiagnostic('visibleCount', { pickupCount: finalCount });
    if (this.deps.diagnostics) {
      const ok = await this.safeCall(() => this.deps.diagnostics?.stop());
      this.health.diagnostics = ok ? { state: 'stopped' } : { state: 'failed', detail: 'stop threw' };
    }
    try {
      this.deps.pedometer?.stop?.();
    } catch {
      // optional
    }

    const endedAt = this.deps.clock.now();
    const durationSeconds = this.elapsedSeconds();
    this.refreshViews();
    const result: SessionResult = deepFreeze({
      sessionId: id,
      startedAt: this.startedAt ?? endedAt - durationSeconds * 1000,
      endedAt,
      durationSeconds,
      pickupCount: finalCount,
      detectedBeforeTrim,
      trimmedAtStop,
      route: this.routeView,
      pickupLocations: this.pickupsView,
      distanceMeters: this.distanceView,
      mode: this.mode,
      modeFailure: this.modeFailure,
      sessionModeLabel: describeSessionMode(this.mode, this.modeFailure),
      tooShortToCount: durationSeconds < this.opts.minCleanupSeconds && finalCount === 0,
      health: this.snapshotHealth(),
      attachedInProcess: this.detectorAttached,
    });
    this.result = result;

    // map.tsx:1977-1988 — SAVE-FIRST: the whole walk is on disk before any
    // summary UI can discard it. Cleared only by dismissSummary().
    await this.safeCall(() => this.deps.persistence.saveDraft(this.buildDraft(endedAt, finalCount)));

    this.status = 'summary';
    this.publish();
    return result;
  }

  /**
   * summary → idle. Both outcomes clear the draft — map.tsx:2391 (after the
   * cleanup document is durably saved) and :4147 / :2181 (a confirmed
   * discard). The save flow must call this only AFTER its DB write succeeds;
   * if that write throws, leave the controller in `summary` so the draft
   * survives for the next launch's restore prompt (map.tsx:2388-2391).
   */
  dismissSummary = async (outcome: SummaryOutcome): Promise<SessionSnapshot> => {
    if (this.status !== 'summary') return this.getSnapshot();
    await this.safeCall(() => this.deps.persistence.clearDraft());
    this.recordDiagnostic('summaryDismissed', { outcome });
    this.resetSessionState();
    this.status = 'idle';
    this.publish();
    return this.getSnapshot();
  };

  /** failed → idle. A no-op from every other state — it must never kill a live walk. */
  reset = (): SessionSnapshot => {
    if (this.status !== 'failed' && this.status !== 'idle') return this.getSnapshot();
    this.resetSessionState();
    this.status = 'idle';
    this.publish();
    return this.getSnapshot();
  };

  /** Stop the clock without changing state; for tests and hot reloads. */
  dispose(): void {
    this.stopTicker();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private nextSessionId(): string {
    const ms = Math.max(this.deps.clock.now(), this.lastSessionIdMs + 1);
    this.lastSessionIdMs = ms;
    return `w${ms}`;
  }

  private resetSessionState(): void {
    this.stopTicker();
    this.sessionId = null;
    this.startedAt = null;
    this.elapsedAnchor = null;
    this.pickupCount = 0;
    this.recorder.reset();
    this.mode = null;
    this.modeFailure = null;
    this.lastFix = null;
    this.health = freshHealth();
    this.result = null;
    this.failure = null;
    this.detectorAttached = false;
    this.lastAutosaveAt = 0;
    this.lastLocationPollAt = 0;
  }

  private elapsedSeconds(): number {
    if (this.status === 'summary' && this.result) return this.result.durationSeconds;
    if (this.elapsedAnchor === null) return 0;
    return Math.max(0, Math.round((this.deps.clock.now() - this.elapsedAnchor) / 1000));
  }

  private refreshViews(): void {
    if (this.viewVersion === this.recorder.version) return;
    this.viewVersion = this.recorder.version;
    const route = this.recorder.getRoute();
    const pickups = this.recorder.getPickups();
    this.routeView = route.length ? deepFreeze(route.map((p) => ({ ...p }))) : EMPTY_ROUTE;
    this.pickupsView = pickups.length ? deepFreeze(pickups.map((p) => ({ ...p }))) : EMPTY_PICKUPS;
    this.distanceView = this.recorder.distanceMeters();
  }

  private snapshotHealth(): SessionHealth {
    return {
      detector: { ...this.health.detector },
      backgroundLocation: { ...this.health.backgroundLocation },
      pedometer: { ...this.health.pedometer },
      diagnostics: { ...this.health.diagnostics },
      map: { ...this.mapHealth },
    };
  }

  private publish(): void {
    this.refreshViews();
    this.store.publish({
      status: this.status,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      elapsedSeconds: this.elapsedSeconds(),
      pickupCount: this.pickupCount,
      route: this.routeView,
      pickupLocations: this.pickupsView,
      distanceMeters: this.distanceView,
      mode: this.mode,
      modeFailure: this.modeFailure,
      lastFix: this.lastFix ? { ...this.lastFix } : null,
      health: this.snapshotHealth(),
      result: this.result,
      failure: this.failure,
    });
  }

  private recordDiagnostic(type: string, data: Record<string, unknown>): void {
    try {
      this.deps.diagnostics?.record?.(type, data);
    } catch {
      // motionDiagnostics.ts:90 — diagnostics cannot break detection.
    }
  }

  /** Run a port call, swallowing sync throws and async rejections. Returns whether it succeeded. */
  private async safeCall(fn: () => unknown): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  }
}

export function createCleanupSessionController(
  deps: SessionDeps,
  options: ControllerOptions = {},
): CleanupSessionController {
  return new CleanupSessionController(deps, options);
}
