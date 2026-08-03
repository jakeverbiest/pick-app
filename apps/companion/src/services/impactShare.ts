/**
 * Assembles the current user's "impact" into the shape an impact post needs:
 * a stat summary + a compact, re-renderable map snapshot (their adopted blocks).
 *
 * Kept independent of the heavy map screen: it reads adoptions + lifetime
 * cleanup stats, which are available anywhere. pctGreen / toGo (which need the
 * live street-coverage set) are optional and simply omitted here — the map
 * screen can pass them in when it has them.
 */
import { listMyAdoptions } from './adoptions';
import { getDatabase, type ImpactStats, type ImpactCoverage } from './firebaseDatabase';

export interface MyImpact {
  stats: ImpactStats;
  coverage: ImpactCoverage;
  hasBlocks: boolean;
}

type Item = { block?: [number, number][]; tile?: [number, number]; at: [number, number] };

/** Same rough scale as "one metro area" — wide enough that boroughs of one
 *  city cluster together, narrow enough that genuinely different cities don't. */
const SAME_CITY_DEGREES = 0.3;

/**
 * Group adopted items by proximity (flood-fill union) and return only the
 * largest cluster. A shareable map that has to zoom out to fit blocks in two
 * different cities doesn't get more legible by being bigger — it needs a
 * tighter, single-place scope instead. Most users only ever have one
 * cluster, so this is a no-op for them.
 */
function largestCluster(items: Item[]): Item[] {
  if (items.length <= 1) return items;
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [lat1, lon1] = items[i].at;
      const [lat2, lon2] = items[j].at;
      if (Math.abs(lat1 - lat2) <= SAME_CITY_DEGREES && Math.abs(lon1 - lon2) <= SAME_CITY_DEGREES) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, Item[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(items[i]);
  }

  let best: Item[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best;
}

export async function buildMyImpact(extra?: { pctGreen?: number; toGo?: number }): Promise<MyImpact> {
  const [adoptions, db] = await Promise.all([listMyAdoptions(), getDatabase()]);
  const cl = await db.getCleanupStats();

  const items: Item[] = [];
  for (const a of adoptions) {
    if (Array.isArray(a.coords) && a.coords.length >= 2) {
      items.push({ block: a.coords, at: a.coords[0] });
    } else if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
      items.push({ tile: [a.lat, a.lon], at: [a.lat, a.lon] });
    }
  }
  const scoped = largestCluster(items);

  const blocks: [number, number][][] = [];
  const tiles: [number, number][] = [];
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const grow = (lat: number, lon: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };
  for (const item of scoped) {
    if (item.block) { blocks.push(item.block); for (const [lat, lon] of item.block) grow(lat, lon); }
    else if (item.tile) { tiles.push(item.tile); grow(item.tile[0], item.tile[1]); }
  }

  const hasBlocks = blocks.length > 0 || tiles.length > 0;
  // Fall back to a small default box if the user has no adopted geometry yet,
  // so the snapshot renders as an empty (but valid) frame instead of NaN.
  if (!hasBlocks) { minLat = 0; minLon = 0; maxLat = 1e-4; maxLon = 1e-4; }

  const stats: ImpactStats = {
    adopted: adoptions.length,
    cleanups: cl.total_cleanups,
    bags: Math.round((cl.total_bags || 0) * 10) / 10,
    pickups: cl.total_pickups,
    ...(extra?.pctGreen != null ? { pctGreen: Math.round(extra.pctGreen) } : {}),
    ...(extra?.toGo != null ? { toGo: extra.toGo } : {}),
  };

  const coverage: ImpactCoverage = {
    bbox: [minLat, minLon, maxLat, maxLon],
    blocks,
    tiles,
  };

  return { stats, coverage, hasBlocks };
}
