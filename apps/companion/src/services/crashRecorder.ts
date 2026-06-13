/**
 * Crash Recorder — PICK's on-device "black box" for long-walk crashes.
 *
 * The problem it solves: a long walk can memory-crash with the screen off.
 * When that happens, stopCleanup() never runs, so (a) the flight recorder is
 * lost (it lived only in memory) and (b) the background location task is left
 * orphaned, which is why the iOS location arrow stays on when PICK isn't
 * running. Both symptoms are the same event — a session that never ended cleanly.
 *
 * How it works:
 *  - beginSessionTrace() writes a "sentinel" to disk the moment a walk starts.
 *  - heartbeat() overwrites that sentinel every GPS tick with the latest
 *    counters and a fresh timestamp — so the last surviving copy tells us
 *    roughly WHEN the app died and how far the walk had gotten.
 *  - endSessionTrace() clears the sentinel on a clean Stop.
 *  - recoverCrashedSession() runs once at launch: if a sentinel survived, the
 *    previous session crashed (or was force-quit). It's filed as a crash report
 *    and the caller tears down the orphaned tracker.
 *
 * No native modules, no Sentry account — just AsyncStorage. Recovered reports
 * are viewable/exportable from Settings → Diagnostics.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_KEY = '@pick_session_sentinel_v1'; // present == a session is mid-flight
const REPORTS_KEY = '@pick_crash_reports_v1'; // recovered crashed/unclean sessions

/** A session marked "active" whose lastBeatAt is older than this at launch is
 *  treated as a definite crash/force-quit (not a live background relaunch). */
export const STALE_SESSION_MS = 3 * 60 * 1000; // 3 minutes
const MAX_REPORTS = 20;

export interface SessionTrace {
  startedAt: number; // ms epoch — when the walk began
  lastBeatAt: number; // ms epoch — last heartbeat ≈ moment before the crash
  elapsedSec: number; // walk length up to the last heartbeat
  routePoints: number; // GPS points recorded so far (memory-growth proxy)
  pickups: number; // pickups counted so far
  motionEvents: number; // flight-recorder events so far (memory-growth proxy)
  batterySaver: boolean;
  build: string; // app/runtime version string for context
}

export interface CrashReport extends SessionTrace {
  recoveredAt: number; // ms epoch — when launch detected the unclean session
  gapSec: number; // seconds between last heartbeat and recovery (how long it was dead/closed)
}

let current: SessionTrace | null = null;

/** Call when a cleanup session starts. Writes the sentinel to disk. */
export async function beginSessionTrace(meta: { batterySaver?: boolean; build?: string } = {}) {
  const now = Date.now();
  current = {
    startedAt: now,
    lastBeatAt: now,
    elapsedSec: 0,
    routePoints: 0,
    pickups: 0,
    motionEvents: 0,
    batterySaver: !!meta.batterySaver,
    build: meta.build ?? 'unknown',
  };
  try {
    await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(current));
  } catch {
    // Disk write failing shouldn't break the walk — black box just goes dark.
  }
}

/** Call on each GPS tick during a session. Fire-and-forget; cheap and frequent. */
export function heartbeat(patch: Partial<Pick<SessionTrace, 'routePoints' | 'pickups' | 'motionEvents'>>) {
  if (!current) return;
  current = {
    ...current,
    ...patch,
    lastBeatAt: Date.now(),
    elapsedSec: Math.round((Date.now() - current.startedAt) / 1000),
  };
  AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(current)).catch(() => {});
}

/** Call on a clean Stop. Clears the sentinel so launch sees no crash. */
export async function endSessionTrace() {
  current = null;
  try {
    await AsyncStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Run once at app launch. If a sentinel survived, the previous session never
 * ended cleanly — file it as a crash report and return it. Returns null if the
 * last session ended normally.
 *
 * `staleOnly`: when true, only treats the sentinel as a crash if its last
 * heartbeat is older than STALE_SESSION_MS — this avoids misreading a genuine
 * iOS background relaunch (where a real session may still be live) as a crash.
 */
export async function recoverCrashedSession(staleOnly = true): Promise<CrashReport | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const trace: SessionTrace = JSON.parse(raw);
    const now = Date.now();
    const gapMs = now - trace.lastBeatAt;

    if (staleOnly && gapMs < STALE_SESSION_MS) {
      // Fresh heartbeat — could be a live background relaunch. Leave it alone.
      return null;
    }

    await AsyncStorage.removeItem(ACTIVE_KEY);
    const report: CrashReport = {
      ...trace,
      recoveredAt: now,
      gapSec: Math.round(gapMs / 1000),
    };
    const reports = await getCrashReports();
    reports.unshift(report);
    await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(reports.slice(0, MAX_REPORTS)));
    return report;
  } catch {
    return null;
  }
}

/** True if a sentinel currently exists on disk (a session is/was mid-flight). */
export async function hasActiveSentinel(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ACTIVE_KEY)) !== null;
  } catch {
    return false;
  }
}

export async function getCrashReports(): Promise<CrashReport[]> {
  try {
    const raw = await AsyncStorage.getItem(REPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearCrashReports(): Promise<void> {
  try {
    await AsyncStorage.removeItem(REPORTS_KEY);
  } catch {
    // ignore
  }
}

/** Human-readable export of all crash reports — for copy/paste to a developer. */
export function formatCrashReports(reports: CrashReport[]): string {
  if (reports.length === 0) return 'No crash reports — every session ended cleanly. 🎉';
  const lines: string[] = [`PICK crash reports (${reports.length})`, ''];
  for (const r of reports) {
    const started = new Date(r.startedAt).toLocaleString();
    const died = new Date(r.lastBeatAt).toLocaleString();
    const mins = Math.floor(r.elapsedSec / 60);
    const secs = r.elapsedSec % 60;
    lines.push(
      `• Walk started ${started}`,
      `  Last alive:   ${died}  (survived ${mins}m ${secs}s into the walk)`,
      `  At crash:     ${r.routePoints} route points · ${r.pickups} pickups · ${r.motionEvents} motion events`,
      `  Battery saver: ${r.batterySaver ? 'on' : 'off'} · build ${r.build}`,
      `  Detected dead ${r.gapSec}s after last heartbeat`,
      ''
    );
  }
  return lines.join('\n');
}
