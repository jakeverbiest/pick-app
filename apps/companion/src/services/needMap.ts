/**
 * Need Map — turns cleanup history into a "where does the neighborhood most
 * need us?" signal, instead of a pickup heatmap that just shows where people
 * happen to clean.
 *
 * It's computed entirely from the `cleanups` collection (each walk's route +
 * timestamp + item count), so it needs no extra data plumbing to ship a first
 * version. Per ~110m tile it derives:
 *   - visits    — how many distinct walks crossed the tile  (recurrence / effort)
 *   - daysSince — days since the tile was last cleaned       (overdue)
 *   - itemsSum  — crude yield proxy (whole-walk items spread across its tiles)
 *
 * needScore (0–100) blends OVERDUE (staleness) with RECURRENCE, so the tiles
 * that bubble to the top are the ones cleaned again and again yet overdue right
 * now — "most often cleaned AND most in need," which is exactly the question a
 * plain heatmap can't answer.
 *
 * Layer 3 (true re-soiling rate = litter accumulated per day) needs per-tile
 * yield over time, which unlocks once the `pickups` array is populated and
 * per-tile history is logged. This module is written so that dimension can slot
 * in later without changing callers.
 */

/** One walk, trimmed to what the need model needs. */
export interface CleanupLite {
  timestamp: number; // ms epoch
  route: [number, number][]; // [lat, lon] pairs (parsed from route_points)
  items: number; // items_count for the walk
  userId?: string;
}

export interface NeedTile {
  key: string; // "lat,lon" of the tile (3-dp center)
  lat: number;
  lon: number;
  visits: number; // distinct walks that crossed this tile
  lastVisit: number; // ms epoch of most recent clean
  daysSince: number; // days since last clean
  itemsSum: number; // crude cumulative yield attributed to this tile
  needScore: number; // 0–100, higher = needs attention more
}

/** ~110m tiles — "block-ish". Coarser than a street, finer than the 1km grid
 *  the segment_status collection currently uses. */
export const NEED_TILE_DEG = 0.001;

export function needTileKey(lat: number, lon: number, tile = NEED_TILE_DEG): string {
  const snap = (n: number) => (Math.round(n / tile) * tile).toFixed(3);
  return `${snap(lat)},${snap(lon)}`;
}

/** Parse a stored route_points value (JSON string or array) into [lat,lon] pairs. */
export function parseRoute(routePoints: unknown): [number, number][] {
  let arr: any = routePoints;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: [number, number][] = [];
  for (const p of arr) {
    if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') {
      out.push([p[0], p[1]]);
    } else if (p && typeof p.lat === 'number' && typeof p.lon === 'number') {
      out.push([p.lat, p.lon]);
    }
  }
  return out;
}

export interface ComputeNeedOptions {
  now?: number;
  /** Relative weights; defaults favor "overdue" over raw recurrence. */
  weightOverdue?: number;
  weightRecurrence?: number;
}

/**
 * Aggregate cleanups into per-tile need scores, highest need first.
 */
export function computeNeed(cleanups: CleanupLite[], opts: ComputeNeedOptions = {}): NeedTile[] {
  const now = opts.now ?? Date.now();
  const wOver = opts.weightOverdue ?? 0.6;
  const wRec = opts.weightRecurrence ?? 0.4;

  const acc = new Map<string, { lat: number; lon: number; visits: number; lastVisit: number; itemsSum: number }>();

  for (const c of cleanups) {
    if (!c.route || c.route.length === 0) continue;
    // Unique tiles this walk touched → recurrence counts WALKS, not GPS points.
    const touched = new Set<string>();
    for (const [lat, lon] of c.route) {
      if (typeof lat === 'number' && typeof lon === 'number') touched.add(needTileKey(lat, lon));
    }
    if (touched.size === 0) continue;
    const perTileItems = (c.items || 0) / touched.size; // spread whole-walk yield
    for (const key of touched) {
      const [tlat, tlon] = key.split(',').map(Number);
      const e = acc.get(key) ?? { lat: tlat, lon: tlon, visits: 0, lastVisit: 0, itemsSum: 0 };
      e.visits += 1;
      e.lastVisit = Math.max(e.lastVisit, c.timestamp);
      e.itemsSum += perTileItems;
      acc.set(key, e);
    }
  }

  const tiles: NeedTile[] = [...acc.entries()].map(([key, e]) => ({
    key,
    lat: e.lat,
    lon: e.lon,
    visits: e.visits,
    lastVisit: e.lastVisit,
    daysSince: (now - e.lastVisit) / 86_400_000,
    itemsSum: Math.round(e.itemsSum),
    needScore: 0,
  }));

  if (tiles.length === 0) return tiles;

  const maxDays = Math.max(1, ...tiles.map((t) => t.daysSince));
  const maxVisits = Math.max(1, ...tiles.map((t) => t.visits));
  for (const t of tiles) {
    const overdueN = Math.min(1, t.daysSince / maxDays);
    const recurN = t.visits / maxVisits;
    t.needScore = Math.round((wOver * overdueN + wRec * recurN) * 100);
  }

  return tiles.sort((a, b) => b.needScore - a.needScore);
}

/** Color ramp for the need layer (cool = fine, hot = needs attention). */
export function needColor(score: number): string {
  if (score >= 80) return '#FF3B30'; // hot — most in need
  if (score >= 60) return '#FF9500';
  if (score >= 40) return '#FFCC00';
  if (score >= 20) return '#34C759';
  return '#8E8E93'; // low / recently handled
}
