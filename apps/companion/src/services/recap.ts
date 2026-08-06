/**
 * "My Path" recaps — weekly/monthly and year-end ("Wrapped") summaries.
 *
 * Two pure pieces (easy to test, no I/O):
 *   - previousPeriodRange: the most recently CLOSED week/month/year window.
 *   - buildRecap: turns a user's raw cleanups into stats + a re-renderable
 *     path (bbox + polylines from route_points), the same shape ImpactMap /
 *     impactShare already use for the community "impact post" snapshot — so
 *     recaps reuse ImpactMap instead of a new renderer.
 *
 * "My Path" deliberately never surfaces exact pickup coordinates — only the
 * walked route polylines and a merged bbox, matching the no-pin ImpactMap
 * convention used everywhere else impact is shared publicly.
 *
 * Plus a thin AsyncStorage-backed layer (impure, not unit-tested — mirrors
 * weeklyGoal.ts) that remembers which closed periods the user has already
 * seen a recap for, so the Impact tab can surface "Your July recap is ready"
 * exactly once per period.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Cleanup, ImpactCoverage } from './firebaseDatabase';
import { cleanupBags, formatKitchenBags } from './impactMetrics';
import { startOfWeek } from './streaks';

/** Same TestFlight fallback used by challengeInviteMessage — keeps one real join link across the app. */
export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/6753UhuM';

export type RecapPeriod = 'week' | 'month' | 'year';

export interface RecapRange {
  period: RecapPeriod;
  startMs: number; // inclusive
  endMs: number; // exclusive
  /** Stable id for a period, used to dedupe "have we shown this one yet". */
  key: string;
  /** Human label, e.g. "Jul 21 – 27", "July 2026", "2026". */
  label: string;
}

const DAY = 86400000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A closed period `offset` steps back from the current one (offset 0 = the
 * most recently closed week/month/year, 1 = the one before that, …). Shared
 * by previousPeriodRange (offset 0) and listRecentRanges (offset 0..N-1) so
 * the boundary math — week/month/year rollover, label formatting — lives in
 * exactly one place.
 */
function rangeAt(period: RecapPeriod, offset: number, now: number): RecapRange {
  if (period === 'week') {
    const thisWeekStart = startOfWeek(now);
    const startMs = thisWeekStart - (offset + 1) * 7 * DAY;
    const endMs = startMs + 7 * DAY;
    const start = new Date(startMs);
    const end = new Date(endMs - DAY);
    const sameMonth = start.getMonth() === end.getMonth();
    const label = sameMonth
      ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.getDate()}`
      : `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    return { period, startMs, endMs, key: `W${startMs}`, label };
  }

  if (period === 'month') {
    const d = new Date(now);
    // Count months back from the CURRENT month (offset 0 = last month).
    const monthIndex = d.getFullYear() * 12 + d.getMonth() - (offset + 1);
    const y = Math.floor(monthIndex / 12);
    const m = ((monthIndex % 12) + 12) % 12;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    return {
      period,
      startMs: start.getTime(),
      endMs: end.getTime(),
      key: `${y}-${pad2(m + 1)}`,
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  // year
  const d = new Date(now);
  const year = d.getFullYear() - (offset + 1);
  const startMs = new Date(year, 0, 1).getTime();
  const endMs = new Date(year + 1, 0, 1).getTime();
  return { period, startMs, endMs, key: String(year), label: String(year) };
}

/** The most recently CLOSED period of this type, relative to `now`. */
export function previousPeriodRange(period: RecapPeriod, now: number = Date.now()): RecapRange {
  return rangeAt(period, 0, now);
}

/**
 * The last `count` CLOSED periods of this type, most recent first — powers
 * "My Path" history browsing (as opposed to the single auto-surfaced banner).
 */
export function listRecentRanges(period: RecapPeriod, count: number, now: number = Date.now()): RecapRange[] {
  const out: RecapRange[] = [];
  for (let i = 0; i < count; i++) out.push(rangeAt(period, i, now));
  return out;
}

export interface RecapStats {
  cleanups: number;
  pickups: number;
  bags: number;
  activeDays: number;
  neighborhoods: number;
  bestDay: { dateLabel: string; pickups: number } | null;
}

export interface RecapData {
  range: RecapRange;
  stats: RecapStats;
  coverage: ImpactCoverage;
  /** False when there's nothing to draw (no route data that period) — caller
   *  should still show the stats, just skip/placeholder the path art. */
  hasPath: boolean;
}

/** Exported so impactShare.ts can build a map from the same route_points
 *  encoding without duplicating the parse/validate logic. */
export function parseRoutePoints(raw?: string): [number, number][] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p: unknown): p is [number, number] =>
        Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
  } catch {
    return [];
  }
}

/** Build a recap from a user's full cleanup history + a target range. Pure. */
export function buildRecap(cleanups: Cleanup[], range: RecapRange): RecapData {
  const inRange = cleanups.filter((c) => {
    const ms = (c.timestamp || 0) * 1000;
    return ms >= range.startMs && ms < range.endMs;
  });

  const pickups = inRange.reduce((s, c) => s + (c.items_count || 0), 0);
  const bags = inRange.reduce((s, c) => s + cleanupBags(c), 0);
  const dayKeys = new Set(inRange.map((c) => startOfDay((c.timestamp || 0) * 1000)));
  const neighborhoods = new Set(inRange.map((c) => c.neighborhood).filter(Boolean));

  const pickupsByDay = new Map<number, number>();
  for (const c of inRange) {
    const day = startOfDay((c.timestamp || 0) * 1000);
    pickupsByDay.set(day, (pickupsByDay.get(day) || 0) + (c.items_count || 0));
  }
  let bestDay: RecapStats['bestDay'] = null;
  for (const [day, p] of pickupsByDay) {
    if (!bestDay || p > bestDay.pickups) {
      bestDay = {
        dateLabel: new Date(day).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        pickups: p,
      };
    }
  }

  const blocks: [number, number][][] = [];
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const grow = (lat: number, lon: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };
  for (const c of inRange) {
    const pts = parseRoutePoints(c.route_points);
    if (pts.length >= 2) {
      blocks.push(pts);
      for (const [lat, lon] of pts) grow(lat, lon);
    } else if (Number.isFinite(c.location_lat) && Number.isFinite(c.location_lon)) {
      grow(c.location_lat, c.location_lon);
    }
  }
  const hasPath = blocks.length > 0;
  // Empty-but-valid frame so ImpactMap never divides by zero when a period has stats but no route data.
  if (!Number.isFinite(minLat)) { minLat = 0; minLon = 0; maxLat = 1e-4; maxLon = 1e-4; }

  return {
    range,
    stats: { cleanups: inRange.length, pickups, bags, activeDays: dayKeys.size, neighborhoods: neighborhoods.size, bestDay },
    coverage: { bbox: [minLat, minLon, maxLat, maxLon], blocks },
    hasPath,
  };
}

/**
 * Caption for the share sheet when posting a recap card. Distinct from
 * ShareComposer's per-cleanup captions — this summarizes a whole PERIOD, not
 * one session, so it doesn't fit that component's props shape. Kept as a
 * pure function so the exact wording is testable and reused between the
 * in-app preview and the actual Share.share() call.
 */
export function buildRecapCaption(recap: RecapData, displayName?: string): string {
  const { period, label } = recap.range;
  const { pickups, bags, cleanups, activeDays } = recap.stats;
  const bagsText = formatKitchenBags(bags);
  const join = `Join me on Pick: ${TESTFLIGHT_URL}`;

  if (period === 'year') {
    return (
      `My ${label} in Pick: ${pickups.toLocaleString()} pieces of litter (${bagsText}) off our streets across ` +
      `${cleanups.toLocaleString()} cleanup${cleanups === 1 ? '' : 's'} and ${activeDays} day${activeDays === 1 ? '' : 's'} out. ` +
      `${join} #PickWrapped`
    );
  }

  const periodWord = period === 'week' ? 'week' : 'month';
  const who = displayName ? `${displayName}'s` : 'My';
  return (
    `${who} ${periodWord} on Pick (${label}): ${pickups.toLocaleString()} pieces (${bagsText}) across ` +
    `${cleanups.toLocaleString()} cleanup${cleanups === 1 ? '' : 's'}. ${join}`
  );
}

// ------------------------------------------------------------- "seen" state

const SEEN_KEY = '@pick_recap_last_shown_v1';

interface SeenMap {
  week?: string;
  month?: string;
  year?: string;
}

async function readSeen(): Promise<SeenMap> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** The most recently closed period, if the user hasn't been shown its recap yet. */
export async function getUnseenRecap(period: RecapPeriod, now: number = Date.now()): Promise<RecapRange | null> {
  const range = previousPeriodRange(period, now);
  const seen = await readSeen();
  if (seen[period] === range.key) return null;
  return range;
}

/** Mark a period's recap as shown, so it doesn't surface again. */
export async function markRecapSeen(period: RecapPeriod, key: string): Promise<void> {
  try {
    const seen = await readSeen();
    seen[period] = key;
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {}
}
