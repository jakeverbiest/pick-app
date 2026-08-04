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
// Max plausible distance between consecutive ~5s GPS fixes while walking.
// Bigger jumps are multipath glitches (indoor GPS bounces 30-50m off walls).
export const MAX_JUMP_M = 25;
const OUTLIER_ESCAPE = 4; // N consecutive "outliers" = GPS genuinely relocated — accept

function distM(a: RoutePoint, b: RoutePoint): number {
  const x = (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (b.lat - a.lat) * 110540;
  return Math.sqrt(x * x + y * y);
}

/**
 * Spike rejection: a GPS glitch teleports away AND comes back; real movement
 * goes and stays. When a point jumps > maxJumpM, look ahead — if the track
 * returns near the last good point within a few fixes, the excursion was
 * multipath noise (drop it); if not, it's genuine movement (keep it).
 * This preserves legit sparse routes (old 20s-interval walks) while erasing
 * the indoor 40-50m zigzags.
 */
export function dropOutliers(points: RoutePoint[], maxJumpM: number = MAX_JUMP_M): RoutePoint[] {
  if (!points || points.length <= 2) return points ?? [];
  const out: RoutePoint[] = [points[0]];
  let i = 1;
  while (i < points.length) {
    const last = out[out.length - 1];
    if (distM(last, points[i]) <= maxJumpM) {
      out.push(points[i]);
      i++;
      continue;
    }
    // Excursion: does the track return near `last` within the lookahead window?
    let returnedAt = -1;
    const windowEnd = Math.min(i + OUTLIER_ESCAPE, points.length - 1);
    for (let j = i + 1; j <= windowEnd; j++) {
      if (distM(last, points[j]) <= maxJumpM) {
        returnedAt = j;
        break;
      }
    }
    if (returnedAt >= 0) {
      i = returnedAt; // spike — skip the excursion, resume at the return
    } else {
      out.push(points[i]); // genuine move — keep it
      i++;
    }
  }
  return out;
}

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
export function simplifyRoute(rawPoints: RoutePoint[], toleranceM: number = ROUTE_TOLERANCE_M): RoutePoint[] {
  const points = dropOutliers(rawPoints);
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

/**
 * Privacy trim (Strava-style): remove the first and last ~trimM meters of a
 * route before it's stored. Walks start and end at someone's front door —
 * the trimmed route shows the cleanup without revealing the home.
 *
 * Scaled to the route's own length (capped at trimM per end, floor 20% each
 * side survives) rather than a flat 100m off both ends regardless of size.
 * A fixed 100m trim collapsed most real cleanups — short, localized
 * litter-picking walks, not long hikes — down to 2 points each, which is
 * why recaps aggregating many of them rendered as scattered dots instead of
 * a walked path: there was nothing left to draw a line through.
 */
export function privacyTrimRoute(points: RoutePoint[], trimM: number = 100): RoutePoint[] {
  if (!points || points.length <= 2) return points ?? [];

  let totalM = 0;
  for (let i = 1; i < points.length; i++) {
    totalM += perpDistanceM(points[i], points[i - 1], points[i - 1]);
  }
  const effectiveTrim = Math.min(trimM, totalM * 0.2);

  let startIdx = 0;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += perpDistanceM(points[i], points[i - 1], points[i - 1]); // point-to-point distance
    if (acc >= effectiveTrim) { startIdx = i; break; }
    startIdx = i;
  }

  let endIdx = points.length - 1;
  acc = 0;
  for (let i = points.length - 2; i >= 0; i--) {
    acc += perpDistanceM(points[i], points[i + 1], points[i + 1]);
    if (acc >= effectiveTrim) { endIdx = i; break; }
    endIdx = i;
  }

  if (endIdx - startIdx < 1) {
    // Degenerate case only (near-zero-length route) — keep the middle 60%
    // of points rather than collapsing to a single pair.
    const span = Math.max(2, Math.round(points.length * 0.6));
    const mid = Math.floor(points.length / 2);
    const half = Math.floor(span / 2);
    return points.slice(Math.max(0, mid - half), Math.min(points.length, mid - half + span));
  }
  return points.slice(startIdx, endIdx + 1);
}

/** Convenience for the [lat, lon] pair arrays stored in route_points. */
export function simplifyCoordPairs(pairs: Array<[number, number]>, toleranceM: number = ROUTE_TOLERANCE_M): Array<[number, number]> {
  const simplified = simplifyRoute(pairs.map(([lat, lon]) => ({ lat, lon })), toleranceM);
  return simplified.map((p) => [p.lat, p.lon]);
}
