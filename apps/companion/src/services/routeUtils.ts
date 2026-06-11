/**
 * Route simplification — turns jittery GPS breadcrumbs into the clean,
 * chunky path a human would draw.
 *
 * Douglas-Peucker: keeps only points that deviate more than TOLERANCE_M
 * from the straight line between their neighbors. At 10m tolerance a walk
 * down a straight block becomes 2 points instead of 20 wobbling ones; turns
 * are preserved exactly. Pure + unit-tested (detectorRegression.ts).
 */

export interface RoutePoint {
  lat: number;
  lon: number;
  timestamp?: number;
}

export const ROUTE_TOLERANCE_M = 10;

/** Perpendicular distance (meters) from point p to the line a-b. */
function perpDistanceM(p: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const cosLat = Math.cos((p.lat * Math.PI) / 180);
  const M_PER_DEG_LAT = 110540;
  const M_PER_DEG_LON = 111320 * cosLat;

  const ax = a.lon * M_PER_DEG_LON, ay = a.lat * M_PER_DEG_LAT;
  const bx = b.lon * M_PER_DEG_LON, by = b.lat * M_PER_DEG_LAT;
  const px = p.lon * M_PER_DEG_LON, py = p.lat * M_PER_DEG_LAT;

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/**
 * Douglas-Peucker simplification. Always keeps first and last points.
 */
export function simplifyRoute(points: RoutePoint[], toleranceM: number = ROUTE_TOLERANCE_M): RoutePoint[] {
  if (!points || points.length <= 2) return points ?? [];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistanceM(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > toleranceM && maxIdx > 0) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/** Convenience for the [lat, lon] pair arrays stored in route_points. */
export function simplifyCoordPairs(pairs: Array<[number, number]>, toleranceM: number = ROUTE_TOLERANCE_M): Array<[number, number]> {
  const simplified = simplifyRoute(pairs.map(([lat, lon]) => ({ lat, lon })), toleranceM);
  return simplified.map((p) => [p.lat, p.lon]);
}
