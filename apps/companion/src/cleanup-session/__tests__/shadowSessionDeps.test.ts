/**
 * Shadow session deps — the slice-2 inert guarantee, tested.
 *
 * Drives a full walk (start → mode → fixes → pickups → remount → stop → diff →
 * dismiss) through the shadow deps exactly as map.tsx's `[session-shadow]`
 * touch points do, against a storage fake seeded with the REAL draft and the
 * crash sentinel, and asserts that nothing on the real side was touched. The
 * first section is a source-level lint: the pure module imports nothing from
 * src/services, and the app wiring never names a mutator.
 *
 * Run: npx -y tsx src/cleanup-session/__tests__/shadowSessionDeps.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { CleanupSessionController } from '../cleanupSessionController';
import { RouteRecorder } from '../routeRecorder';
import {
  REAL_DRAFT_KEY,
  SHADOW_DIAGNOSTIC_PREFIX,
  SHADOW_DIFF_EVENT,
  SHADOW_DRAFT_KEY,
  buildShadowDiff,
  createShadowObserver,
  createShadowSessionDeps,
  observeShadowStop,
  savedStyleDistanceM,
  type ShadowDiffMapSide,
} from '../shadowSessionDeps';
import type { ClockPort, LocationFix, SessionDraft } from '../types';

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
async function settle(n = 3) {
  for (let i = 0; i < n; i++) await flush();
}

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  let seq = 0;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  const clock: ClockPort & { advance(ms: number): void; timerCount(): number } = {
    now: () => t,
    setInterval(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, ms, next: t + ms });
      return id;
    },
    clearInterval(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
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
  return clock;
}

const REAL_SENTINEL_KEY = '@pick_session_sentinel_v1'; // crashRecorder.ts:26
const REAL_DRAFT_VALUE = '{"startedAt":1,"savedAt":2,"pickupCount":3,"elapsedSeconds":4,"route":[],"pickups":[]}';
const REAL_SENTINEL_VALUE = '{"startedAt":1,"lastBeatAt":2}';

/** A device mid-walk: the real draft and the crash sentinel are on disk. Every key touched is logged. */
function makeStorage() {
  const items = new Map<string, string>([
    [REAL_DRAFT_KEY, REAL_DRAFT_VALUE],
    [REAL_SENTINEL_KEY, REAL_SENTINEL_VALUE],
  ]);
  const touched: string[] = [];
  return {
    items,
    touched,
    storage: {
      getItem: async (k: string) => {
        touched.push(`get:${k}`);
        return items.get(k) ?? null;
      },
      setItem: async (k: string, v: string) => {
        touched.push(`set:${k}`);
        items.set(k, v);
      },
      removeItem: async (k: string) => {
        touched.push(`remove:${k}`);
        items.delete(k);
      },
    },
  };
}

function rig() {
  const clock = makeClock();
  const store = makeStorage();
  const rows: { type: string; data: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const warns: string[] = [];
  const io = {
    clock,
    storage: store.storage,
    record: (type: string, data: Record<string, unknown>) => {
      rows.push({ type, data });
    },
    diagnosticsState: () => 'recording' as const,
    log: (line: string) => {
      logs.push(line);
    },
    warn: (line: string) => {
      warns.push(line);
    },
  };
  const shadow = createShadowSessionDeps(io);
  const controller = new CleanupSessionController(shadow.deps);
  const observer = createShadowObserver(controller, shadow, io);
  return { clock, store, rows, logs, warns, shadow, controller, observer };
}

const HERE = { lat: 40.68, lon: -73.99 };

/** Map's side of the diff, simulated from the shadow's own numbers (what a parity walk looks like). */
function mapSideFromShadow(r: ReturnType<typeof rig>, overrides: Partial<ShadowDiffMapSide> = {}): ShadowDiffMapSide {
  const snap = r.controller.getSnapshot();
  const preview = r.controller.requestEnd();
  return {
    count: snap.pickupCount,
    corrected: snap.pickupCount,
    detectorCount: r.shadow.detector.getPickupCount?.() ?? 0,
    routePoints: snap.route.length,
    distanceM: savedStyleDistanceM(snap.route),
    elapsedS: preview.elapsedSeconds,
    mode: snap.mode ?? 'unresolved',
    startedAt: snap.startedAt ?? 0,
    pickupPins: snap.pickupLocations.length,
    screenRemounts: 0,
    ...overrides,
  };
}

function findSourceDir(): string {
  const candidates = [
    typeof __dirname === 'string' ? path.resolve(__dirname, '..') : '',
    path.resolve(process.cwd(), 'src/cleanup-session'),
    path.resolve(process.cwd(), 'apps/companion/src/cleanup-session'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(path.join(c, 'shadowSessionDeps.ts'))) return c;
  throw new Error('cannot locate src/cleanup-session');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 1. inert by construction: what the shadow modules may not even name ===');
  {
    const dir = findSourceDir();
    const pure = stripComments(fs.readFileSync(path.join(dir, 'shadowSessionDeps.ts'), 'utf8'));
    ok('shadowSessionDeps.ts imports nothing from src/services', !/from\s+['"]\.\.\/services\//.test(pure));
    ok(
      'shadowSessionDeps.ts imports nothing from react / react-native / expo / async-storage',
      !/from\s+['"](react|react-native|expo|@react-native|@expo)/.test(pure),
    );
    const wiring = stripComments(fs.readFileSync(path.join(dir, 'sessionShadow.ts'), 'utf8'));
    const forbidden = [
      'MotionDetector',
      'PickupAggregator',
      'startListening(',
      'stopListening(',
      'trimRecentPickups(',
      'startBackgroundSession',
      'stopBackgroundSession',
      'drainBackgroundLocations',
      'isBackgroundLocationTaskRunning',
      'beginSessionTrace',
      'endSessionTrace',
      'heartbeat(',
      'saveWalkDraft',
      'clearWalkDraft',
      'loadWalkDraft',
      'handOffWalkRestore',
      'startMotionDiagnostics',
      'stopMotionDiagnostics',
      'setMotionDiagnosticsEnabled',
      `'${REAL_DRAFT_KEY}'`,
      REAL_SENTINEL_KEY,
      'appSessionDeps',
    ];
    for (const name of forbidden) ok(`sessionShadow.ts never names ${name}`, !wiring.includes(name));
    ok('sessionShadow.ts does name the recorder tap (its rows must land in the same export)', wiring.includes('recordMotionDiagnostic'));
  }

  console.log('\n=== 2. a walk through the touch points: start → mode → fixes → pickups → remount → stop → diff → dismiss ===');
  const r = rig();
  const c = r.controller;
  const o = r.observer;
  {
    await o.observeStart();
    await settle();
    eq('shadow live after observeStart()', c.getSnapshot().status, 'active');
    eq('detector: the tap was attached, never the singleton', r.shadow.detector.calls, ['stopListening', 'startListening']);
    eq('background: start() recorded, not performed', r.shadow.background.calls, ['start']);
    eq('mode unresolved until Map settles it', c.getSnapshot().mode, null);
    eq('diagnostics: start recorded, real recorder untouched', r.shadow.diagnostics.calls.length, 1);
    eq('health mirrors the real recorder state', c.getSnapshot().health.diagnostics.state, 'recording');
    eq('trace begun in memory only', r.shadow.persistence.calls.includes('beginTrace'), true);

    o.observeBackgroundMode('background');
    await settle();
    eq('mode mirrored from Map', c.getSnapshot().mode, 'background');
    eq('health.backgroundLocation follows', c.getSnapshot().health.backgroundLocation.state, 'background');

    // One trackLocation() tick: a foreground fix plus a drained batch that is
    // out of order, contains a 2 km jump and one noisy point, with the good
    // steps at walking pace (~14 m / 20 s, ~28 m / 40 s). The shadow must
    // produce exactly what a RouteRecorder fed the same raw batch produces.
    const t0 = r.clock.now();
    const drained: LocationFix[] = [
      { lat: 40.6801, lon: -73.9901, timestamp: t0 - 40_000, accuracy: 10 },
      { lat: 40.68, lon: -73.99, timestamp: t0 - 60_000, accuracy: 8 },
      { lat: 40.7, lon: -73.99, timestamp: t0 - 30_000, accuracy: 5 },
      { lat: 40.6802, lon: -73.9902, timestamp: t0 - 20_000, accuracy: 40 },
    ];
    const fg: LocationFix = { lat: 40.6803, lon: -73.9903, timestamp: t0, accuracy: 6, speed: 1.1 };
    const reference = new RouteRecorder();
    reference.ingest([...drained, fg]);
    o.observeLocation(fg, drained);
    eq('route == a reference recorder fed the same raw batch', c.getSnapshot().route, reference.getRoute());
    eq('3 of 5 accepted (one jump, one inaccurate)', c.getSnapshot().route.length, 3);
    eq('lastFix is the foreground fix', c.getSnapshot().lastFix?.lat, fg.lat);
    eq('one heartbeat per accepted batch, in memory', r.shadow.persistence.heartbeats, 1);
    eq('heartbeat carried the route length', r.shadow.persistence.lastHeartbeat?.routePoints, 3);

    // Pickups, 30 s apart, through the tap.
    r.clock.advance(30_000);
    o.observePickup({ timestamp: r.clock.now(), latitude: HERE.lat, longitude: HERE.lon });
    r.clock.advance(30_000);
    o.observePickup({ timestamp: r.clock.now() });
    eq('two pickups counted', c.getSnapshot().pickupCount, 2);
    eq('two pins (event coords, then lastFix fallback)', c.getSnapshot().pickupLocations.length, 2);
    eq('tap count mirrors the detector\'s own per-attach count', r.shadow.detector.getPickupCount?.(), 2);
    eq(
      'visibleCount rows are prefixed',
      r.rows.filter((x) => x.type === `${SHADOW_DIAGNOSTIC_PREFIX}visibleCount`).length >= 3,
      true,
    );

    // Map remounts mid-walk and calls resumeWalkAfterRemount(draft). The shadow
    // is above the tabs, so this must be a no-op that says so.
    const before = r.rows.length;
    await o.observeResume({ startedAt: t0, savedAt: t0, pickupCount: 1, elapsedSeconds: 30, route: [], pickups: [] });
    eq('shadow stays active through the remount', c.getSnapshot().status, 'active');
    eq('count untouched by the (stale) draft', c.getSnapshot().pickupCount, 2);
    const resumeRow = r.rows.slice(before).find((x) => x.type === `${SHADOW_DIAGNOSTIC_PREFIX}mapResume`);
    eq('mapResume row says the shadow survived', resumeRow?.data.statusBefore, 'active');
    eq('mapResume row shows the autosave-gap loss Map would take', resumeRow?.data, {
      statusBefore: 'active',
      statusAfter: 'active',
      draftPickupCount: 1,
      shadowPickupCount: 2,
    });
    eq('no second attach on resume', r.shadow.detector.calls.length, 2);

    // Stop with one pickup inside the 6 s trim window.
    r.clock.advance(20_000);
    o.observePickup({ timestamp: r.clock.now() - 1000 });
    eq('three counted before the trim', c.getSnapshot().pickupCount, 3);
    const stop = o.observeStop();
    eq('preview taken pre-trim', stop.preview.pickupCount, 3);
    eq('preview can end', stop.preview.canEnd, true);
    const mapSide = mapSideFromShadow(r, { count: 3, corrected: 2, detectorCount: 3 });
    const diff = o.emitDiff(mapSide, stop);
    eq('diff: shadowCount is the pre-trim count', diff.shadowCount, 3);
    eq('diff: one trimmed', diff.shadowTrimmed, 1);
    eq('diff: predicted end count', diff.shadowResultCount, 2);
    eq('diff: all five agreements hold on a parity walk', diff.agree, {
      count: true,
      corrected: true,
      route: true,
      distance: true,
      mode: true,
    });
    eq('diff: mode strings use the saved session_mode rule', diff.mode, { map: 'background', shadow: 'background' });
    eq('diff: the sessionShadowDiff row is recorded unprefixed, once', r.rows.filter((x) => x.type === SHADOW_DIFF_EVENT).length, 1);
    eq('diff: one console line', r.logs.length, 1);
    ok('diff: the console line is the JSON record', r.logs[0].startsWith(`[session-shadow] ${SHADOW_DIFF_EVENT} {`));
    const result = await stop.confirm;
    eq('confirmEnd() result == the recorded prediction (pinned cutoff)', result?.pickupCount, diff.shadowResultCount);
    eq('confirmEnd() trimmedAtStop == diff.shadowTrimmed', result?.trimmedAtStop, diff.shadowTrimmed);
    eq('no prediction warning', r.warns, []);
    eq('shadow in summary', c.getSnapshot().status, 'summary');
    eq('background: stop recorded only', r.shadow.background.calls, ['start', 'stop']);
    eq('detector: detached through the tap only', r.shadow.detector.calls, ['stopListening', 'startListening', 'stopListening']);
    eq('trace ended in memory only', r.shadow.persistence.calls.includes('endTrace'), true);
    eq('diagnostics: stop recorded, real recorder untouched', r.shadow.diagnostics.calls.filter((x) => x.startsWith('stop:')).length, 1);

    // Map saved the cleanup and cleared the real draft.
    await o.observeDraftCleared('saved');
    eq('idle after the draft-cleared touch', c.getSnapshot().status, 'idle');
    eq('no timers left running', r.clock.timerCount(), 0);
  }

  console.log('\n=== 3. storage: shadow key only; the real draft and the crash sentinel are untouched ===');
  {
    const writes = r.store.touched.filter((k) => k.startsWith('set:') || k.startsWith('remove:'));
    ok('at least one shadow draft write happened', writes.length > 0);
    ok('every write went to the shadow key', writes.every((k) => k.endsWith(SHADOW_DRAFT_KEY)), writes.join(','));
    ok('the shadow key is the real key plus a suffix', SHADOW_DRAFT_KEY.startsWith(REAL_DRAFT_KEY) && SHADOW_DRAFT_KEY.length > REAL_DRAFT_KEY.length);
    eq('real draft byte-identical', r.store.items.get(REAL_DRAFT_KEY), REAL_DRAFT_VALUE);
    eq('crash sentinel byte-identical', r.store.items.get(REAL_SENTINEL_KEY), REAL_SENTINEL_VALUE);
    ok('the real keys were never even read', !r.store.touched.some((k) => k.endsWith(`:${REAL_DRAFT_KEY}`) || k.includes(REAL_SENTINEL_KEY)));
    eq('shadow draft cleared by dismiss', r.store.items.has(SHADOW_DRAFT_KEY), false);
  }

  console.log('\n=== 4. relaunch: restore(real draft, read-only) → resume → pickups → stop keeps the restored count (inventory D1) ===');
  {
    const r2 = rig();
    const now = r2.clock.now();
    const realDraft: SessionDraft = {
      startedAt: now - 600_000,
      savedAt: now - 10_000,
      pickupCount: 7,
      elapsedSeconds: 590,
      route: [
        { lat: 40.68, lon: -73.99, timestamp: now - 500_000 },
        { lat: 40.6801, lon: -73.9901, timestamp: now - 400_000 },
      ],
      pickups: [{ lat: 40.68, lon: -73.99, timestamp: now - 450_000 }],
      mode: null,
    };
    await r2.observer.observeLaunchDraft(realDraft);
    eq('recoverable with the restored count', [r2.controller.getSnapshot().status, r2.controller.getSnapshot().pickupCount], ['recoverable', 7]);
    eq('the launch restore read nothing from storage', r2.store.touched, []);
    eq('a second launch restore is a no-op', (await r2.observer.observeLaunchDraft(realDraft), r2.controller.getSnapshot().pickupCount), 7);

    // Map's recovery effect confirms the OS task and resumes.
    await r2.observer.observeResume(realDraft);
    await settle();
    eq('active after resume', r2.controller.getSnapshot().status, 'active');
    eq('mode from the mirrored OS state', r2.controller.getSnapshot().mode, 'background');
    eq('elapsed prefers wall-clock-since-start (map.tsx:1811)', r2.controller.getSnapshot().elapsedSeconds, 600);
    eq('tap attached on resume', r2.shadow.detector.attached, true);
    eq('tap count restarted at zero, like the real detector\'s per-attach count', r2.shadow.detector.getPickupCount?.(), 0);

    r2.clock.advance(30_000);
    r2.observer.observePickup({ timestamp: r2.clock.now() });
    r2.clock.advance(30_000);
    r2.observer.observePickup({ timestamp: r2.clock.now() });
    r2.clock.advance(30_000);
    r2.observer.observePickup({ timestamp: r2.clock.now() - 500 }); // inside the trim window
    eq('10 counted: 7 restored + 3', r2.controller.getSnapshot().pickupCount, 10);

    // What Map itself would report on this walk (D1): its detector holds only
    // the 3 post-attach events, so its corrected count is 3 − 1 = 2.
    const stop = r2.observer.observeStop();
    const diff = r2.observer.emitDiff(mapSideFromShadow(r2, { count: 10, detectorCount: 3, corrected: 2, mode: 'unresolved', screenRemounts: 1 }), stop);
    eq('shadow keeps the restored pickups through Stop', diff.shadowResultCount, 9);
    eq('finding-1 signature: mapCount − mapDetectorCount = pickups Map\'s detector no longer holds', diff.mapCount - diff.mapDetectorCount, 7);
    eq('finding-1 signature: mapCorrected < shadowResultCount', diff.mapCorrected < diff.shadowResultCount, true);
    eq('agree.count true, agree.corrected false', [diff.agree.count, diff.agree.corrected], [true, false]);
    eq('mode disagreement is visible (Map loses session_mode on remount)', diff.agree.mode, false);
    const result = await stop.confirm;
    eq('confirmEnd() agrees with the prediction here too', result?.pickupCount, 9);
    await r2.observer.observeDraftCleared('saved');
    eq('idle', r2.controller.getSnapshot().status, 'idle');
    const writes = r2.store.touched.filter((k) => k.startsWith('set:') || k.startsWith('remove:'));
    ok('relaunch path also wrote only the shadow key', writes.length > 0 && writes.every((k) => k.endsWith(SHADOW_DRAFT_KEY)));
    eq('real draft still byte-identical', r2.store.items.get(REAL_DRAFT_KEY), REAL_DRAFT_VALUE);
  }

  console.log('\n=== 5. launch-time "Restore" → summary, and "Discard" → idle ===');
  {
    const r3 = rig();
    const draft: SessionDraft = { startedAt: 1, savedAt: 2, pickupCount: 4, elapsedSeconds: 300, route: [], pickups: [] };
    await r3.observer.observeLaunchDraft(draft);
    await r3.observer.observeRestoreToSummary(draft);
    eq('summary with the draft count (no trim: nothing attached)', [r3.controller.getSnapshot().status, r3.controller.getSnapshot().result?.pickupCount], ['summary', 4]);
    eq('no attach on the restore-to-summary path', r3.shadow.detector.calls, []);
    await r3.observer.observeDraftCleared('discarded');
    eq('idle after discard', r3.controller.getSnapshot().status, 'idle');

    const r4 = rig();
    await r4.observer.observeLaunchDraft(draft);
    await r4.observer.observeDraftCleared('discarded'); // the root prompt's Discard
    eq('recoverable → idle on Discard (via confirmEnd + dismiss)', r4.controller.getSnapshot().status, 'idle');
    ok('release row recorded', r4.rows.some((x) => x.type === `${SHADOW_DIAGNOSTIC_PREFIX}release`));
  }

  console.log('\n=== 6. self-healing: a stale shadow is released before the next real start; a failed Map start releases too ===');
  {
    const r5 = rig();
    await r5.observer.observeStart();
    await settle();
    r5.observer.observeBackgroundMode('foreground');
    await settle();
    r5.observer.observeStop(); // Map stopped, but suppose no clearWalkDraft() touch ever fired
    await settle();
    eq('stuck in summary', r5.controller.getSnapshot().status, 'summary');
    await r5.observer.observeStart();
    await settle();
    eq('next start still observed', r5.controller.getSnapshot().status, 'active');
    ok('the release was recorded', r5.rows.some((x) => x.type === `${SHADOW_DIAGNOSTIC_PREFIX}release` && x.data.at === 'start'));
    ok('a fresh session id', r5.controller.getSnapshot().sessionId !== null);

    await r5.observer.observeStartFailed('sensor init failed');
    await settle();
    eq('Map start failure releases the shadow walk', r5.controller.getSnapshot().status, 'idle');
    eq('both starts and both stops went through the mirror only', r5.shadow.background.calls, ['start', 'stop', 'start', 'stop']);
  }

  console.log('\n=== 7. late background resolution after Stop → one more recorded stop, nothing else (inventory D4) ===');
  {
    const r6 = rig();
    await r6.observer.observeStart();
    await settle();
    const stop = r6.observer.observeStop();
    await stop.confirm;
    eq('start, stop', r6.shadow.background.calls, ['start', 'stop']);
    r6.observer.observeBackgroundMode('background'); // Map's promise settles late
    await settle();
    eq('late resolution → a second recorded stop', r6.shadow.background.calls, ['start', 'stop', 'stop']);
    eq('mirrored mode cleared by that stop', r6.shadow.background.mirroredMode, null);
    eq('the walk\'s mode stays unresolved', r6.controller.getSnapshot().result?.sessionModeLabel, 'unresolved');

    const r7 = rig();
    await r7.observer.observeStart();
    await settle();
    r7.observer.observeBackgroundFailure('Location services disabled');
    await settle();
    eq('a failed Map start reason is mirrored verbatim', r7.controller.getSnapshot().modeFailure, 'Location services disabled');
    eq('and labeled the way the saved session_mode would be', r7.controller.requestEnd().status === 'active' && r7.controller.getSnapshot().mode, null);
  }

  console.log('\n=== 8. the tap while detached, and a stop with nothing to end ===');
  {
    const r8 = rig();
    r8.observer.observePickup({ timestamp: 1 });
    eq('dropped while detached', r8.shadow.detector.droppedWhileDetached, 1);
    eq('nothing counted', r8.controller.getSnapshot().pickupCount, 0);
    r8.observer.observeLocation({ lat: 1, lon: 2, timestamp: 3, accuracy: 4 }, []);
    eq('nothing routed while idle', r8.controller.getSnapshot().route.length, 0);
    const stop = r8.observer.observeStop();
    eq('cannot end while idle', stop.preview.canEnd, false);
    eq('confirm resolves null', await stop.confirm, null);
    ok('desync recorded', r8.rows.some((x) => x.type === `${SHADOW_DIAGNOSTIC_PREFIX}desync`));
    const diff = r8.observer.emitDiff(mapSideFromShadow(r8, { count: 5, corrected: 5, detectorCount: 5 }), stop);
    eq('diff still emits, saying the shadow missed the walk', [diff.shadowStatus, diff.shadowCanEnd, diff.shadowCount], ['idle', false, 0]);
  }

  console.log('\n=== 9. buildShadowDiff arithmetic and the pinned cutoff, in isolation ===');
  {
    const r9 = rig();
    const c9 = r9.controller;
    void c9.start();
    await settle();
    const t = r9.clock.now();
    for (const dt of [-30_000, -20_000, -5_000, -1_000]) r9.shadow.detector.feed({ timestamp: t + dt });
    const stop = observeShadowStop(c9);
    const diff = buildShadowDiff(mapSideFromShadow(r9, { count: 4, corrected: 2, detectorCount: 4 }), stop, r9.shadow.detector, t);
    eq('two of four inside the 6 s window', diff.shadowTrimmed, 2);
    eq('result 2', diff.shadowResultCount, 2);
    const result = await stop.confirm;
    eq('confirmEnd() trims the same two', result?.trimmedAtStop, 2);
    r9.controller.dispose();
  }
}

// A real timer so a hung `await` cannot drain the event loop and exit 0 with half the suite unrun.
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
