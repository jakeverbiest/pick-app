/**
 * Route recorder — accepted route points, pickup positions, and the two GPS
 * gates that decide what enters the route.
 *
 * This is a port, not an import: the gates live inside `trackLocation()` in
 * app/(tabs)/map.tsx (:1400-1488), a closure over component refs
 * (`lastFixRef`, `jumpRejectsRef`) with no exported form, so "reuse" here
 * means reproducing the same constants and the same decision order with the
 * source lines cited. Slice 2's parallel run compares this recorder's route
 * against Map's `sessionRoute` on a real walk before Map gives it up.
 *
 * Pure: no imports beyond types.
 */
import type { LocationFix, PickupLocation, RoutePoint } from './types';

/** map.tsx:1404 — a noisier fix still moves the on-map dot but never enters the route. */
export const ACCURACY_LIMIT_M = 25;
/** map.tsx:1449 — implied speed above this is a GPS jump, not walking. */
export const MAX_WALK_MPS = 3.0;
/** map.tsx:1450 — consecutive rejects before the anchor is assumed to be the stale one. */
export const REANCHOR_AFTER = 4;

/** map.tsx:1451-1457 — haversine, meters. */
export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * map.tsx:2455-2469 — the planar "111 km per degree" sum behind the in-walk
 * Distance stat and the saved `distance_m` (:2308). Kept identical on
 * purpose (not haversine) so the controller's figure matches the one the
 * cleanup document stores today.
 */
export function planarDistanceKm(route: readonly RoutePoint[]): number {
  if (route.length < 2) return 0;
  let distance = 0;
  for (let i = 1; i < route.length; i++) {
    const lat1 = route[i - 1].lat;
    const lon1 = route[i - 1].lon;
    const lat2 = route[i].lat;
    const lon2 = route[i].lon;
    const dLat = (lat2 - lat1) * 111;
    const dLon = (lon2 - lon1) * 111 * Math.cos((lat1 * Math.PI) / 180);
    distance += Math.sqrt(dLat * dLat + dLon * dLon);
  }
  return distance;
}

export interface IngestResult {
  readonly accepted: RoutePoint[];
  readonly skippedInaccurate: number;
  readonly rejectedJumps: number;
  readonly reanchored: boolean;
}

export class RouteRecorder {
  private route: RoutePoint[] = [];
  private pickups: PickupLocation[] = [];
  /** map.tsx:306 (`lastFixRef`) — last fix accepted into the route, for the speed gate. */
  private lastFix: { lat: number; lon: number; ts: number } | null = null;
  /** map.tsx:307 (`jumpRejectsRef`). */
  private jumpRejects = 0;
  /** Bumped on every change so a consumer can cache derived views cheaply. */
  private version_ = 0;

  get version(): number {
    return this.version_;
  }

  /** map.tsx:1854-1856 / :1059-1061 — a fresh walk. */
  reset(): void {
    this.route = [];
    this.pickups = [];
    this.lastFix = null;
    this.jumpRejects = 0;
    this.version_++;
  }

  /**
   * map.tsx:1805-1806 (remount resume) and :1017-1018 (launch-time restore).
   * `lastFix` deliberately stays null: the jump gate re-anchors on the first
   * post-restore fix, exactly as the remounted instance's fresh `lastFixRef`
   * does today.
   */
  restore(route: readonly RoutePoint[], pickups: readonly PickupLocation[]): void {
    this.route = route.map((p) => ({ lat: p.lat, lon: p.lon, timestamp: p.timestamp }));
    this.pickups = pickups.map((p) => ({ lat: p.lat, lon: p.lon, timestamp: p.timestamp }));
    this.lastFix = null;
    this.jumpRejects = 0;
    this.version_++;
  }

  /**
   * map.tsx:1400-1488 in the same order: accuracy filter → oldest-first sort
   * (background-drained points can arrive out of order, :1459-1461) → speed
   * plausibility gate with re-anchoring (:1463-1485).
   */
  ingest(candidates: readonly LocationFix[]): IngestResult {
    let skippedInaccurate = 0;
    const newPoints: RoutePoint[] = [];
    for (const c of candidates) {
      if (c.accuracy !== undefined && c.accuracy > ACCURACY_LIMIT_M) {
        skippedInaccurate++;
        continue;
      }
      newPoints.push({ lat: c.lat, lon: c.lon, timestamp: c.timestamp });
    }
    if (newPoints.length === 0) {
      return { accepted: [], skippedInaccurate, rejectedJumps: 0, reanchored: false };
    }

    newPoints.sort((a, b) => a.timestamp - b.timestamp);

    const accepted: RoutePoint[] = [];
    let rejectedJumps = 0;
    let reanchored = false;
    for (const p of newPoints) {
      const prevFix = this.lastFix;
      if (prevFix) {
        const dt = Math.max(1, (p.timestamp - prevFix.ts) / 1000);
        const d = metersBetween(prevFix.lat, prevFix.lon, p.lat, p.lon);
        if (d / dt > MAX_WALK_MPS) {
          this.jumpRejects += 1;
          if (this.jumpRejects < REANCHOR_AFTER) {
            rejectedJumps++;
            continue;
          }
          reanchored = true;
        }
      }
      this.jumpRejects = 0;
      this.lastFix = { lat: p.lat, lon: p.lon, ts: p.timestamp };
      accepted.push(p);
    }
    if (accepted.length) {
      this.route.push(...accepted);
      this.version_++;
    }
    return { accepted, skippedInaccurate, rejectedJumps, reanchored };
  }

  /** map.tsx:1742-1744. */
  addPickup(p: PickupLocation): void {
    this.pickups.push({ lat: p.lat, lon: p.lon, timestamp: p.timestamp });
    this.version_++;
  }

  getRoute(): readonly RoutePoint[] {
    return this.route;
  }

  getPickups(): readonly PickupLocation[] {
    return this.pickups;
  }

  /** Meters, via the same planar sum the saved `distance_m` uses (map.tsx:2308). */
  distanceMeters(): number {
    return Math.round(planarDistanceKm(this.route) * 1000);
  }
}
