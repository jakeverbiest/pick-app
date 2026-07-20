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

export async function buildMyImpact(extra?: { pctGreen?: number; toGo?: number }): Promise<MyImpact> {
  const [adoptions, db] = await Promise.all([listMyAdoptions(), getDatabase()]);
  const cl = await db.getCleanupStats();

  const blocks: [number, number][][] = [];
  const tiles: [number, number][] = [];
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const grow = (lat: number, lon: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };

  for (const a of adoptions) {
    if (Array.isArray(a.coords) && a.coords.length >= 2) {
      blocks.push(a.coords);
      for (const [lat, lon] of a.coords) grow(lat, lon);
    } else if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
      tiles.push([a.lat, a.lon]);
      grow(a.lat, a.lon);
    }
  }

  const hasBlocks = blocks.length > 0 || tiles.length > 0;
  // Fall back to a small default box if the user has no adopted geometry yet,
  // so the snapshot renders as an empty (but valid) frame instead of NaN.
  if (!hasBlocks) { minLat = 0; minLon = 0; maxLat = 1e-4; maxLon = 1e-4; }

  const stats: ImpactStats = {
    adopted: adoptions.length,
    cleanups: cl.total_cleanups,
    bags: Math.round((cl.total_bags || 0) * 10) / 10,
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
