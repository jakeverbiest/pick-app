/**
 * Cleanup session controller — lifecycle tests against fakes of every port.
 *
 * Covers the five rules from docs/CLEANUP_SESSION_ARCHITECTURE.md plus the
 * restore/resume paths, the stop-trim arithmetic, the route gates, and the
 * late-background-resolution race. No react, react-native or expo-* is
 * loaded: everything the controller touches is injected.
 *
 * Run: npx -y tsx src/cleanup-session/__tests__/sessionController.test.ts
 */
import { CleanupSessionController, describeSessionMode } from '../cleanupSessionController';
import { ACCURACY_LIMIT_M, MAX_WALK_MPS, REANCHOR_AFTER, RouteRecorder } from '../routeRecorder';
import type {
  BackgroundSessionPort,
  DetectorPickupEvent,
  DetectorPort,
  DiagnosticsPort,
  LocationFix,
  LocationPort,
  PedometerPort,
  PersistencePort,
  SessionDraft,
  SessionMode,
} from '../types';

let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? '✅' : '❌'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
}
function eq(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  ok(name, pass, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  return {
    now: () => t,
    setInterval(fn: () => void, ms: number): unknown {
      const id = ++seq;
      timers.set(id, { fn, ms, next: t + ms });
      return id;
    },
    clearInterval(handle: unknown) {
      timers.delete(handle as number);
    },
    /** Advance wall clock, firing due timers in order (a timer may fire many times). */
    advance(ms: number) {
      const target = t + ms;
      for (;;) {
        let best: { id: number; tm: { fn: () => void; ms: number; next: number } } | null = null;
        for (const [id, tm] of timers) {
          if (tm.next <= target && (!best || tm.next < best.tm.next)) best = { id, tm };
        }
        if (!best) break;
        t = best.tm.next;
        best.tm.next += best.tm.ms;
        best.tm.fn();
      }
      t = target;
    },
    timerCount: () => timers.size,
  };
}

type FakeLoc = { latitude: number; longitude: number; accuracy?: number; speed?: number } | null;

function makeDetector(opts: { rejectStart?: boolean; sensorsAttached?: boolean } = {}) {
  const calls: string[] = [];
  let callback: ((e: DetectorPickupEvent) => void) | null = null;
  let errorCb: ((m: string) => void) | null = null;
  let ownCount = 0; // the detector's own per-attach pickupEvents.length (resets on startListening)
  let trimNext = 0;
  let lastLocation: FakeLoc = null;
  let listening = false;
  const port: DetectorPort = {
    startListening: async (onPickup, onError) => {
      calls.push('start');
      if (opts.rejectStart) throw new Error('sensor init failed');
      callback = onPickup;
      errorCb = onError ?? null;
      listening = true;
      ownCount = 0;
    },
    stopListening: () => {
      calls.push('stop');
      listening = false;
      callback = null;
    },
    sensorsAttached: () => listening && (opts.sensorsAttached ?? true),
    getLastLocation: () => lastLocation,
    trimRecentPickups: () => {
      ownCount = Math.max(0, ownCount - trimNext);
      trimNext = 0;
      return ownCount;
    },
    getPickupCount: () => ownCount,
    getSessionEventCount: () => ownCount,
  };
  return {
    port,
    calls,
    get attachCount() {
      return calls.filter((c) => c === 'start').length;
    },
    get callback() {
      return callback;
    },
    isListening: () => listening,
    firePickup(ts: number) {
      ownCount += 1;
      callback?.({ timestamp: ts });
    },
    fireError(message: string) {
      errorCb?.(message);
    },
    setLastLocation(loc: FakeLoc) {
      lastLocation = loc;
    },
    setTrimNext(n: number) {
      trimNext = n;
    },
  };
}

function makeBackground(opts: { mode?: SessionMode; rejectStart?: boolean; deferStart?: boolean; deferStop?: boolean } = {}) {
  let startCount = 0;
  let stopCount = 0;
  let running = false;
  const queue: LocationFix[] = [];
  let releaseStart: ((m: SessionMode) => void) | null = null;
  let releaseStop: (() => void) | null = null;
  /** A release requested before start() was reached resolves it the moment it is. */
  let preReleasedMode: SessionMode | null = null;
  const port: BackgroundSessionPort = {
    start: () => {
      startCount++;
      if (opts.rejectStart) return Promise.reject(new Error('bg boom'));
      if (opts.deferStart) {
        if (preReleasedMode !== null) {
          const m = preReleasedMode;
          preReleasedMode = null;
          running = m === 'background';
          return Promise.resolve(m);
        }
        return new Promise<SessionMode>((resolve) => {
          releaseStart = (m) => {
            running = m === 'background';
            resolve(m);
          };
        });
      }
      const mode = opts.mode ?? 'background';
      running = mode === 'background';
      return Promise.resolve(mode);
    },
    stop: () => {
      stopCount++;
      running = false;
      if (opts.deferStop) return new Promise<void>((resolve) => { releaseStop = resolve; });
      return Promise.resolve();
    },
    drainQueued: () => queue.splice(0),
    isRunning: async () => running,
  };
  return {
    port,
    get startCount() {
      return startCount;
    },
    get stopCount() {
      return stopCount;
    },
    enqueue: (p: LocationFix) => queue.push(p),
    releaseStart: (m: SessionMode) => {
      if (releaseStart) {
        const release = releaseStart;
        releaseStart = null;
        release(m);
      } else {
        preReleasedMode = m;
      }
    },
    releaseStop: () => releaseStop?.(),
    setRunning: (v: boolean) => {
      running = v;
    },
  };
}

function makePersistence(stored: SessionDraft | null = null) {
  const saves: SessionDraft[] = [];
  const beats: { routePoints: number; pickups: number; motionEvents: number }[] = [];
  let cleared = 0;
  let traces = 0;
  let endTraces = 0;
  const port: PersistencePort = {
    saveDraft: (d) => {
      saves.push(JSON.parse(JSON.stringify(d)));
    },
    loadDraft: async () => stored,
    clearDraft: () => {
      cleared++;
    },
    beginTrace: () => {
      traces++;
    },
    heartbeat: (p) => {
      beats.push(p);
    },
    endTrace: () => {
      endTraces++;
    },
  };
  return {
    port,
    saves,
    beats,
    get cleared() {
      return cleared;
    },
    get traces() {
      return traces;
    },
    get endTraces() {
      return endTraces;
    },
  };
}

function makeDiagnostics(opts: { rejectStart?: boolean } = {}) {
  const starts: string[] = [];
  const stops: string[] = [];
  const records: string[] = [];
  const port: DiagnosticsPort = {
    start: async (id) => {
      if (opts.rejectStart) throw new Error('diag boom');
      starts.push(id);
      return 'recording' as const;
    },
    stop: async (reason) => {
      stops.push(reason ?? 'cleanup ended');
    },
    record: (type) => {
      records.push(type);
    },
  };
  return { port, starts, stops, records };
}

function makePedometer(opts: { reject?: boolean } = {}) {
  const port: PedometerPort = {
    start: async () => {
      if (opts.reject) throw new Error('pedometer boom');
      return 'active' as const;
    },
  };
  return { port };
}

function makeLocation(clock: { now(): number }, fixes: Omit<LocationFix, 'timestamp'>[]) {
  let polls = 0;
  const port: LocationPort = {
    poll: async () => {
      polls++;
      const next = fixes.shift();
      return next ? { ...next, timestamp: clock.now() } : null;
    },
  };
  return {
    port,
    get polls() {
      return polls;
    },
  };
}

function rig(o: {
  clock?: ReturnType<typeof makeClock>;
  detector?: ReturnType<typeof makeDetector>;
  background?: ReturnType<typeof makeBackground>;
  persistence?: ReturnType<typeof makePersistence>;
  diagnostics?: ReturnType<typeof makeDiagnostics>;
  pedometer?: ReturnType<typeof makePedometer>;
  location?: ReturnType<typeof makeLocation>;
} = {}) {
  const clock = o.clock ?? makeClock();
  const detector = o.detector ?? makeDetector();
  const background = o.background ?? makeBackground();
  const persistence = o.persistence ?? makePersistence();
  const diagnostics = o.diagnostics ?? makeDiagnostics();
  const pedometer = o.pedometer ?? makePedometer();
  const location = o.location;
  const controller = new CleanupSessionController({
    detector: detector.port,
    backgroundSession: background.port,
    persistence: persistence.port,
    clock,
    diagnostics: diagnostics.port,
    pedometer: pedometer.port,
    location: location?.port,
  });
  return { controller, clock, detector, background, persistence, diagnostics, pedometer, location };
}

const HERE = { latitude: 40.68, longitude: -73.99, accuracy: 5, speed: 0.3 };

// ── Tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 1. happy path: idle → starting → active → finalizing → summary → idle ===');
  {
    const r = rig();
    const c = r.controller;
    eq('starts idle', c.getSnapshot().status, 'idle');
    const seen: string[] = [];
    const unsub = c.subscribe((s) => seen.push(s.status));
    const snap = await c.start();
    eq('start() resolves active', snap.status, 'active');
    ok('starting was published before active', seen.indexOf('starting') !== -1 && seen.indexOf('starting') < seen.lastIndexOf('active'));
    eq('detector attached once', r.detector.attachCount, 1);
    ok('stopListening precedes startListening (rule 2 mechanics, map.tsx:1719)', r.detector.calls[0] === 'stop' && r.detector.calls[1] === 'start');
    eq('diagnostics started with the session id', r.diagnostics.starts[0], snap.sessionId);
    eq('crash trace begun once', r.persistence.traces, 1);
    eq('background session requested once', r.background.startCount, 1);
    eq('mode resolved', snap.mode, 'background');
    eq('health.detector attached', snap.health.detector.state, 'attached');
    eq('health.backgroundLocation background', snap.health.backgroundLocation.state, 'background');
    eq('health.diagnostics recording', snap.health.diagnostics.state, 'recording');
    eq('health.pedometer active', snap.health.pedometer.state, 'active');
    eq('first draft written on activation', r.persistence.saves.length, 1);
    ok('sessionId has the watch format', /^w\d+$/.test(snap.sessionId ?? ''));

    r.detector.setLastLocation(HERE);
    r.detector.firePickup(r.clock.now());
    r.detector.firePickup(r.clock.now());
    eq('two pickups counted', c.getSnapshot().pickupCount, 2);
    eq('pickup locations recorded from the detector fix', c.getSnapshot().pickupLocations.length, 2);
    c.recordLocation({ lat: 40.68, lon: -73.99, timestamp: r.clock.now(), accuracy: 5 });
    r.clock.advance(5000);
    c.recordLocation({ lat: 40.6801, lon: -73.99, timestamp: r.clock.now(), accuracy: 5 });
    eq('route has 2 points', c.getSnapshot().route.length, 2);
    ok('distance > 0', c.getSnapshot().distanceMeters > 0);
    eq('elapsed follows the clock', c.getSnapshot().elapsedSeconds, 5);
    const lastBeat = r.persistence.beats[r.persistence.beats.length - 1];
    ok('heartbeat carried the counters', !!lastBeat && lastBeat.pickups === 2 && lastBeat.routePoints === 2);

    const preview = c.requestEnd();
    ok('requestEnd preview', preview.canEnd && preview.pickupCount === 2 && preview.elapsedSeconds === 5 && !preview.tooShortToCount);
    eq('requestEnd is side-effect free', c.getSnapshot().status, 'active');

    const result = await c.confirmEnd();
    eq('summary', c.getSnapshot().status, 'summary');
    eq('result count', result.pickupCount, 2);
    eq('result duration', result.durationSeconds, 5);
    eq('result route', result.route.length, 2);
    eq('result pickups', result.pickupLocations.length, 2);
    eq('result sessionModeLabel', result.sessionModeLabel, 'background');
    eq('background stopped once', r.background.stopCount, 1);
    eq('trace ended', r.persistence.endTraces, 1);
    eq('detector stopped at end', r.detector.isListening(), false);
    eq('diagnostics stopped', r.diagnostics.stops.length, 1);
    ok('cleanupEnd diagnostic recorded', r.diagnostics.records.includes('cleanupEnd'));
    eq('save-first draft written at end', r.persistence.saves[r.persistence.saves.length - 1].pickupCount, 2);
    eq('draft not cleared before dismiss', r.persistence.cleared, 0);
    ok('confirmEnd is idempotent in summary', (await c.confirmEnd()) === result);
    eq('elapsed frozen in summary', c.getSnapshot().elapsedSeconds, 5);
    await c.dismissSummary('saved');
    eq('idle after dismiss', c.getSnapshot().status, 'idle');
    eq('draft cleared once', r.persistence.cleared, 1);
    eq('no timers left running', r.clock.timerCount(), 0);
    eq('idle snapshot is clean', c.getSnapshot().pickupCount, 0);
    unsub();
  }

  console.log('=== 2. rule 1: start() is a no-op while starting / active / backgroundActive / finalizing ===');
  {
    const r = rig({ background: makeBackground({ deferStart: true, deferStop: true }) });
    const c = r.controller;
    const p1 = c.start();
    eq('status is starting synchronously', c.getSnapshot().status, 'starting');
    const p2 = c.start();
    r.background.releaseStart('background');
    await Promise.all([p1, p2]);
    eq('detector attached once despite two starts', r.detector.attachCount, 1);
    eq('background requested once', r.background.startCount, 1);
    eq('diagnostics started once', r.diagnostics.starts.length, 1);
    await c.start();
    eq('start() while active is a no-op', r.detector.attachCount, 1);
    c.reportAppState('background');
    eq('backgroundActive when backgrounded with an OS session', c.getSnapshot().status, 'backgroundActive');
    await c.start();
    eq('start() while backgroundActive is a no-op', r.detector.attachCount, 1);
    c.reportAppState('active');
    eq('back to active on foreground', c.getSnapshot().status, 'active');
    const endP = c.confirmEnd();
    eq('finalizing while the OS stop is pending', c.getSnapshot().status, 'finalizing');
    await c.start();
    eq('start() while finalizing is a no-op', r.detector.attachCount, 1);
    const endP2 = c.confirmEnd();
    r.background.releaseStop();
    const [end1, end2] = await Promise.all([endP, endP2]);
    ok('confirmEnd while finalizing joins the in-flight end (same result object)', end1 === end2);
    eq('the OS session was stopped once, not twice', r.background.stopCount, 1);
    eq('summary after end', c.getSnapshot().status, 'summary');
    await c.start();
    eq('start() while summary is a no-op (unsaved walk protected)', c.getSnapshot().status, 'summary');
    await c.dismissSummary('discarded');
    const p3 = c.start();
    r.background.releaseStart('background');
    await p3;
    eq('start() from idle works again', c.getSnapshot().status, 'active');
    eq('second session attached the detector again', r.detector.attachCount, 2);
    c.dispose();
  }

  console.log('=== 3. rule 2: exactly one detector callback across a UI remount ===');
  {
    const r = rig();
    const c = r.controller;
    await c.start();
    const cbBefore = r.detector.callback;
    const unsub1 = c.subscribe(() => {});
    unsub1(); // the old Map instance unmounts…
    const unsub2 = c.subscribe(() => {}); // …and the new one subscribes
    eq('one listener after the remount', c.listenerCount(), 1);
    eq('detector attach count unchanged across the remount', r.detector.attachCount, 1);
    ok('the detector callback is the same single function', typeof cbBefore === 'function' && r.detector.callback === cbBefore);
    r.detector.setLastLocation(HERE);
    r.detector.firePickup(r.clock.now());
    eq('one pickup → count 1 (no double counting)', c.getSnapshot().pickupCount, 1);
    const stale = r.detector.callback as (e: DetectorPickupEvent) => void;
    await c.confirmEnd();
    stale({ timestamp: r.clock.now() });
    eq('a late event after the end is ignored', c.getSnapshot().pickupCount, 1);
    eq('the result is unchanged by the late event', c.getSnapshot().result?.pickupCount, 1);
    unsub2();
    await c.dismissSummary('saved');
    await c.start();
    stale({ timestamp: r.clock.now() });
    eq("session 1's callback cannot count into session 2", c.getSnapshot().pickupCount, 0);
    c.dispose();
  }

  console.log('=== 4. rule 3: draft persisted at bounded intervals with the full session state ===');
  {
    const r = rig();
    const c = r.controller;
    await c.start();
    r.detector.setLastLocation(HERE);
    r.detector.firePickup(r.clock.now());
    c.recordLocation({ lat: 40.68, lon: -73.99, timestamp: r.clock.now(), accuracy: 5 });
    r.clock.advance(61_000);
    const saves = r.persistence.saves;
    eq('four drafts in 61 s (t = 0, 20, 40, 60)', saves.length, 4);
    let minGap = Infinity;
    for (let i = 1; i < saves.length; i++) minGap = Math.min(minGap, saves[i].savedAt - saves[i - 1].savedAt);
    ok('drafts at least 20 s apart', minGap >= 20_000, `min gap ${minGap}`);
    const last = saves[saves.length - 1];
    const snap = c.getSnapshot();
    ok(
      'draft carries count, locations, route, start time, elapsed, mode',
      last.pickupCount === 1 &&
        last.pickups.length === 1 &&
        last.route.length === 1 &&
        last.startedAt === snap.startedAt &&
        last.elapsedSeconds === 60 &&
        last.mode === 'background',
      JSON.stringify(last),
    );
    eq('draft carries the session id', last.sessionId, snap.sessionId);
    r.detector.firePickup(r.clock.now());
    eq('a pickup inside the throttle window does not add a save', saves.length, 4);
    c.dispose();
  }

  console.log('=== 5. rule 4: the snapshot is read-only ===');
  {
    const r = rig();
    const c = r.controller;
    await c.start();
    r.detector.setLastLocation(HERE);
    r.detector.firePickup(r.clock.now());
    c.recordLocation({ lat: 40.68, lon: -73.99, timestamp: r.clock.now(), accuracy: 5 });
    const snap = c.getSnapshot();
    let threw = 0;
    try {
      (snap as { pickupCount: number }).pickupCount = 999;
    } catch {
      threw++;
    }
    try {
      (snap.route as unknown as unknown[]).push({ lat: 0, lon: 0, timestamp: 0 });
    } catch {
      threw++;
    }
    try {
      (snap.health.detector as { state: string }).state = 'failed';
    } catch {
      threw++;
    }
    eq('snapshot writes throw (frozen, strict mode)', threw, 3);
    eq('count unaffected by the mutation attempt', c.getSnapshot().pickupCount, 1);
    eq('route unaffected', c.getSnapshot().route.length, 1);
    eq('health unaffected', c.getSnapshot().health.detector.state, 'attached');
    ok('getSnapshot is referentially stable without a change', c.getSnapshot() === c.getSnapshot());
    const before = c.getSnapshot();
    r.clock.advance(1000);
    ok('a tick publishes a new object', c.getSnapshot() !== before);
    ok('the route array identity is reused when unchanged', c.getSnapshot().route === before.route);
    const preview = c.requestEnd();
    try {
      (preview as { canEnd: boolean }).canEnd = false;
    } catch {
      // expected
    }
    ok('EndPreview is frozen too', preview.canEnd === true);
    c.dispose();
  }

  console.log('=== 6. rule 5: optional services fail into health flags; only the detector fails the walk ===');
  {
    const r = rig({ background: makeBackground({ rejectStart: true }) });
    const s = await r.controller.start();
    eq('background rejection keeps the walk active', s.status, 'active');
    eq('health.backgroundLocation failed', s.health.backgroundLocation.state, 'failed');
    eq('modeFailure recorded (map.tsx:1903)', s.modeFailure, 'bg boom');
    eq('session_mode label carries the reason (map.tsx:2356)', describeSessionMode(s.mode, s.modeFailure), 'unresolved:bg boom');
    eq('plain unresolved when no reason', describeSessionMode(null, null), 'unresolved');
    r.controller.reportAppState('background');
    eq('no backgroundActive without an OS session', r.controller.getSnapshot().status, 'active');
    r.controller.dispose();
  }
  {
    const r = rig({ pedometer: makePedometer({ reject: true }) });
    const s = await r.controller.start();
    eq('pedometer throw keeps the walk active', s.status, 'active');
    eq('health.pedometer failed', s.health.pedometer.state, 'failed');
    r.controller.dispose();
  }
  {
    const r = rig({ diagnostics: makeDiagnostics({ rejectStart: true }) });
    const s = await r.controller.start();
    eq('diagnostics throw keeps the walk active', s.status, 'active');
    eq('health.diagnostics failed', s.health.diagnostics.state, 'failed');
    eq('detector still attached', r.detector.attachCount, 1);
    r.controller.dispose();
  }
  {
    const r = rig({ detector: makeDetector({ rejectStart: true }) });
    const s = await r.controller.start();
    eq('detector rejection → failed', s.status, 'failed');
    eq('health.detector failed', s.health.detector.state, 'failed');
    ok('failure message set', !!s.failure);
    eq('no crash trace on a failed start', r.persistence.traces, 0);
    eq('no background session on a failed start', r.background.startCount, 0);
    eq('diagnostics stopped with the start-failed reason (map.tsx:1911)', r.diagnostics.stops[0], 'cleanup start failed');
    eq('no drafts written', r.persistence.saves.length, 0);
    eq('no timers left', r.clock.timerCount(), 0);
    r.controller.reset();
    eq('reset → idle', r.controller.getSnapshot().status, 'idle');
  }
  {
    const r = rig({ detector: makeDetector({ sensorsAttached: false }) });
    const s = await r.controller.start();
    eq('sensors not attached → still active (walk continues, map.tsx:1777)', s.status, 'active');
    eq('health.detector notAttached', s.health.detector.state, 'notAttached');
    r.controller.dispose();
  }
  {
    const r = rig();
    await r.controller.start();
    r.detector.fireError('Location unavailable — pickup counts may be less accurate');
    eq('a non-fatal detector error downgrades to degraded', r.controller.getSnapshot().health.detector.state, 'degraded');
    ok('detail carried', (r.controller.getSnapshot().health.detector.detail ?? '').includes('Location unavailable'));
    r.controller.dispose();
  }

  console.log('=== 7. restore(draft) → recoverable → resume() → active ===');
  {
    const clock = makeClock();
    const t0 = clock.now();
    const draft: SessionDraft = {
      sessionId: 'w1',
      startedAt: t0 - 300_000,
      savedAt: t0 - 15_000,
      pickupCount: 7,
      elapsedSeconds: 285,
      route: [
        { lat: 40.68, lon: -73.99, timestamp: t0 - 290_000 },
        { lat: 40.6801, lon: -73.99, timestamp: t0 - 200_000 },
        { lat: 40.6802, lon: -73.99, timestamp: t0 - 100_000 },
      ],
      pickups: [
        { lat: 40.68, lon: -73.99, timestamp: t0 - 250_000 },
        { lat: 40.6801, lon: -73.99, timestamp: t0 - 150_000 },
      ],
      mode: 'background',
    };
    const r = rig({ clock, persistence: makePersistence(draft) });
    const c = r.controller;
    const s = await c.restore(); // loads through the persistence port
    eq('restore → recoverable', s.status, 'recoverable');
    eq('restored count', s.pickupCount, 7);
    eq('restored route', s.route.length, 3);
    eq('restored pickups', s.pickupLocations.length, 2);
    eq('elapsed from wall clock since start (300 s), not the stale 285', s.elapsedSeconds, 300);
    eq('restore touched no sensor', r.detector.attachCount, 0);
    await c.start();
    eq('start() from recoverable is a no-op', c.getSnapshot().status, 'recoverable');
    r.background.setRunning(true);
    const s2 = await c.resume();
    eq('resume → active', s2.status, 'active');
    eq('detector attached exactly once on resume', r.detector.attachCount, 1);
    ok('resume attach also stops first', r.detector.calls[0] === 'stop' && r.detector.calls[1] === 'start');
    eq('resume did NOT restart diagnostics (motionDiagnostics.ts:36)', r.diagnostics.starts.length, 0);
    eq('resume did NOT re-begin the crash trace (map.tsx:1794)', r.persistence.traces, 0);
    eq('resume did NOT re-request the background session (map.tsx:1795)', r.background.startCount, 0);
    eq('mode confirmed with the OS', s2.health.backgroundLocation.state, 'background');
    r.detector.setLastLocation(HERE);
    r.detector.firePickup(clock.now());
    eq('count continues from the restored value', c.getSnapshot().pickupCount, 8);
    clock.advance(10_000);
    eq('elapsed keeps counting from the restored anchor', c.getSnapshot().elapsedSeconds, 310);
    const result = await c.confirmEnd();
    eq('result count after resume', result.pickupCount, 8);
    eq('result duration', result.durationSeconds, 310);
    eq('result.attachedInProcess', result.attachedInProcess, true);
    eq('result route keeps the restored points', result.route.length, 3);
    c.dispose();
  }
  {
    const clock = makeClock();
    const t0 = clock.now();
    const r = rig({ clock });
    await r.controller.restore({
      startedAt: t0 - 120_000,
      savedAt: t0 - 60_000,
      pickupCount: 7,
      elapsedSeconds: 60,
      route: [],
      pickups: [],
      mode: 'background',
    });
    const result = await r.controller.confirmEnd(); // the launch-time Restore path: straight to the summary
    eq('summary from recoverable', r.controller.getSnapshot().status, 'summary');
    eq('result uses the restored count untrimmed', result.pickupCount, 7);
    eq('detector never touched on the relaunch path', r.detector.calls.length, 0);
    eq('result.attachedInProcess false', result.attachedInProcess, false);
    eq('draft re-written (save-first) not cleared', r.persistence.cleared, 0);
    await r.controller.dismissSummary('saved');
    eq('cleared after dismiss', r.persistence.cleared, 1);
  }

  console.log('=== 8. stop-trim arithmetic (the one deliberate divergence) ===');
  {
    const r = rig();
    const c = r.controller;
    await c.start();
    r.detector.setLastLocation(HERE);
    r.detector.firePickup(r.clock.now());
    r.detector.firePickup(r.clock.now());
    r.detector.firePickup(r.clock.now());
    r.detector.setTrimNext(1);
    const result = await c.confirmEnd();
    eq("no remount: final = 3 − 1 = 2, same as today's detector count", result.pickupCount, 2);
    eq('trimmedAtStop', result.trimmedAtStop, 1);
    eq('detectedBeforeTrim', result.detectedBeforeTrim, 3);
    c.dispose();
  }
  {
    const clock = makeClock();
    const r = rig({ clock });
    await r.controller.restore({
      startedAt: clock.now() - 60_000,
      savedAt: clock.now(),
      pickupCount: 12,
      elapsedSeconds: 60,
      route: [],
      pickups: [],
      mode: 'background',
    });
    r.background.setRunning(true);
    await r.controller.resume();
    r.detector.setLastLocation(HERE);
    r.detector.firePickup(clock.now());
    r.detector.firePickup(clock.now()); // the detector's own count is 2 here (reset on re-attach)
    r.detector.setTrimNext(1);
    const result = await r.controller.confirmEnd();
    eq('after a remount: final = 12 + 2 − 1 = 13 (map.tsx:1961-1964 would save 1)', result.pickupCount, 13);
    r.controller.dispose();
  }

  console.log('=== 9. late background-session resolution after a fast stop ===');
  {
    const r = rig({ background: makeBackground({ deferStart: true }) });
    const c = r.controller;
    const p = c.start();
    await flush();
    eq('active while the OS session is still starting', c.getSnapshot().status, 'active');
    await c.confirmEnd();
    eq('stop called once at end', r.background.stopCount, 1);
    r.background.releaseStart('background');
    await p;
    eq('late start resolution stops the OS session again (no orphaned task)', r.background.stopCount, 2);
    eq('mode not applied to the ended walk', c.getSnapshot().mode, null);
    eq('still summary', c.getSnapshot().status, 'summary');
    c.dispose();
  }

  console.log('=== 10. route recorder: the map.tsx:1400-1488 gates ===');
  {
    const rec = new RouteRecorder();
    const t0 = 1_000_000;
    let res = rec.ingest([{ lat: 40.68, lon: -73.99, timestamp: t0, accuracy: 40 }]);
    eq('accuracy > 25 m never enters the route', rec.getRoute().length, 0);
    eq('skippedInaccurate', res.skippedInaccurate, 1);
    rec.ingest([{ lat: 40.68, lon: -73.99, timestamp: t0, accuracy: 5 }]);
    res = rec.ingest([{ lat: 40.6845, lon: -73.99, timestamp: t0 + 10_000, accuracy: 5 }]); // ~500 m in 10 s
    eq('a 50 m/s jump is rejected', res.rejectedJumps, 1);
    eq('route still 1', rec.getRoute().length, 1);
    rec.ingest([{ lat: 40.6845, lon: -73.99, timestamp: t0 + 20_000, accuracy: 5 }]);
    rec.ingest([{ lat: 40.6845, lon: -73.99, timestamp: t0 + 30_000, accuracy: 5 }]);
    res = rec.ingest([{ lat: 40.6845, lon: -73.99, timestamp: t0 + 40_000, accuracy: 5 }]);
    eq('the 4th consecutive reject re-anchors (REANCHOR_AFTER)', res.reanchored, true);
    eq('route 2 after the re-anchor', rec.getRoute().length, 2);
    const rec2 = new RouteRecorder();
    rec2.ingest([
      { lat: 40.68, lon: -73.99, timestamp: t0 + 10_000 },
      { lat: 40.68005, lon: -73.99, timestamp: t0 + 5_000 },
      { lat: 40.6801, lon: -73.99, timestamp: t0 },
    ]);
    eq('a batch is sorted oldest first', rec2.getRoute()[0].timestamp, t0);
    eq('all three accepted', rec2.getRoute().length, 3);
    ok('planar distance ≈ 11 m (map.tsx:2455 formula)', Math.abs(rec2.distanceMeters() - 11) <= 1, `${rec2.distanceMeters()}`);
    ok('constants match map.tsx', ACCURACY_LIMIT_M === 25 && MAX_WALK_MPS === 3 && REANCHOR_AFTER === 4);
    rec2.restore(rec2.getRoute(), []);
    eq('restore keeps the points', rec2.getRoute().length, 3);
    res = rec2.ingest([{ lat: 40.69, lon: -73.99, timestamp: t0 + 11_000 }]);
    eq('after restore the first fix re-anchors rather than being judged (lastFix null)', res.rejectedJumps, 0);
  }

  console.log('=== 11. polled location intake and background drain ===');
  {
    const clock = makeClock();
    const loc = makeLocation(clock, [
      { lat: 40.68, lon: -73.99, accuracy: 5 },
      { lat: 40.68005, lon: -73.99, accuracy: 5 },
    ]);
    const r = rig({ clock, location: loc });
    const c = r.controller;
    await c.start();
    eq('one fix polled at start (map.tsx:1717)', loc.polls, 1);
    eq('the first fix entered the route', c.getSnapshot().route.length, 1);
    r.background.enqueue({ lat: 40.68002, lon: -73.99, accuracy: 4, timestamp: clock.now() + 3000 });
    r.background.enqueue({ lat: 40.69, lon: -73.99, accuracy: 60, timestamp: clock.now() + 4000 }); // noisy → skipped
    clock.advance(10_000);
    await flush();
    eq('polled again after the location interval', loc.polls, 2);
    eq('queued background fixes drained into the route (the accurate one only)', c.getSnapshot().route.length, 3);
    eq('lastFix is the newest fix', c.getSnapshot().lastFix?.lat, 40.68005);
    c.dispose();
  }

  console.log('=== 12. app state, map health, foreground-only mode ===');
  {
    const r = rig({ background: makeBackground({ mode: 'foreground' }) });
    const c = r.controller;
    await c.start();
    eq('foreground mode', c.getSnapshot().mode, 'foreground');
    c.reportAppState('background');
    eq('a foreground-only walk stays active when backgrounded (health says why)', c.getSnapshot().status, 'active');
    eq('health.backgroundLocation foreground', c.getSnapshot().health.backgroundLocation.state, 'foreground');
    c.reportMapHealth('unmounted');
    eq('map health is reported by the view', c.getSnapshot().health.map.state, 'unmounted');
    c.reportAppState('active');
    const result = await c.confirmEnd();
    eq('sessionModeLabel foreground', result.sessionModeLabel, 'foreground');
    eq('map health survives into the result', result.health.map.state, 'unmounted');
    c.dispose();
  }

  console.log('=== 13. guards ===');
  {
    const r = rig();
    let threw = false;
    try {
      await r.controller.confirmEnd();
    } catch {
      threw = true;
    }
    ok('confirmEnd() while idle throws', threw);
    await r.controller.dismissSummary('saved');
    eq('dismissSummary while idle is a no-op', r.persistence.cleared, 0);
    r.controller.recordLocation({ lat: 40.68, lon: -73.99, timestamp: r.clock.now(), accuracy: 5 });
    eq('recordLocation while idle is ignored', r.controller.getSnapshot().route.length, 0);
    await r.controller.resume();
    eq('resume while idle is a no-op', r.controller.getSnapshot().status, 'idle');
  }
}

// A real timer so a hung `await` (a fake never released, a promise never
// settled) cannot drain the event loop and exit 0 with half the suite unrun.
const watchdog = setTimeout(() => {
  console.log('❌ test run timed out — an await never settled');
  process.exit(1);
}, 20_000);

main()
  .then(() => {
    clearTimeout(watchdog);
    console.log(`\n${failures === 0 ? '✅ ALL PASSED' : '❌ FAILED'} (${passes}/${passes + failures})`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error('❌ test run crashed:', e);
    process.exit(1);
  });
