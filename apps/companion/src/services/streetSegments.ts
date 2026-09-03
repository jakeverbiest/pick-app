/**
 * Street Segment Coverage
 *
 * Coverage belongs to STREETS, not walks. This service:
 *
 *  1. Fetches street geometry from OpenStreetMap (free Overpass API) around
 *     the user and chops each street into ~50m segments with stable IDs.
 *     Geometry is cached on-device (it rarely changes) — only cleaning
 *     STATUS lives in Firestore, so the shared data is tiny.
 *  2. When a cleanup is saved, snaps the walked route to nearby segments
 *     (within 25m) and stamps `last_cleaned` on each — shared by ALL users.
 *  3. Returns render-ready segments (geometry + days since cleaned) so the
 *     map colors streets green→red, aligned with the sidewalks pickers
 *     actually walk.
 *
 * Firestore: collection `segment_status`, doc id = segment id
 *   { grid, last_cleaned, last_user, clean_count }
 * Queried by `grid` (0.01° cell ≈ 1km) so one query loads a neighborhood.
 */

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { app } from './firebaseConfig';
// Overpass hedge/mirror-failover client and the street-geometry fetch/chop
// pipeline both live under functions/shared/ now, not here — a single
// implementation the Cloud Functions precache-refresh job can also import,
// instead of a second copy that could drift from this one. See
// functions/shared/overpassClient.js's doc comment for why that directory
// (not src/) and how this cross-boundary import resolves in Metro.
import { runOverpass } from '../../functions/shared/overpassClient';
import {
  distM,
  offsetCoords,
  gridKey,
  chopWaysIntoSegments,
  fetchStreetGeometry,
  MIN_SIDEWALK_SEGMENTS,
  FETCH_RADIUS_M,
  ROAD_SIDE_OFFSET_M,
} from '../../functions/shared/streetGeometry';

const db = getFirestore(app);

export { runOverpass, offsetCoords, gridKey, ROAD_SIDE_OFFSET_M };

// Sidewalk-level snapping: tight enough not to credit the OPPOSITE side of the
// street (~18m away in NYC), loose enough for Balanced GPS (~10m error). Field
// test showed 15m was crediting both sides on narrower streets — tightened to
// 11m. (In areas with no mapped sidewalks we fall back to road CENTER lines,
// split into two virtual per-side sidewalks — see ROAD_SIDE_OFFSET_M below,
// which must stay ≥ this value or the same both-sides problem reappears.)
export const SNAP_DISTANCE_M = 11;
// A segment counts as cleaned only if the route ran alongside this fraction of
// its length (sampled). Stops one stray GPS ping from crediting a whole block,
// and (with the tight snap) avoids crediting the opposite sidewalk you didn't walk.
// 0.6 (was 0.8): 80% was too strict for real GPS on 50m pieces — the start/end
// pieces of a walk and any dropped fix fell just under, so streets you clearly
// cleaned didn't turn green. 60% of a 50m piece (~30m walked) still needs a real
// pass, not a drive-by. Tunable — watch for over-crediting on the next walk.
export const COVERAGE_THRESHOLD = 0.6;
const SEGMENT_SAMPLE_STEP_M = 5; // sample the segment every ~5m to measure coverage
// FETCH_RADIUS_M is imported from functions/shared/streetGeometry (used by
// fetchParks below, which stayed here — only geometry fetch/chop moved).
// When we can't get real per-side sidewalks and fall back to a road CENTERLINE,
// we split that centerline into two virtual sidewalks offset this far to each
// side. This MUST be ≥ SNAP_DISTANCE_M: at offset 8 (the original value) a
// point at perpendicular distance d from the centerline satisfied BOTH
// |d-8|≤11 and |d+8|≤11 for any d in [-3, 3] — meaning anyone walking within
// 3m of the centerline (very easy on a narrow street, or with a few meters of
// GPS drift on a wider one) was geometrically guaranteed to credit both
// sides, no noise required. That was reported as a real walk marking both
// sides cleaned. Raising the offset to 15 makes the two double-credit
// half-ranges [offset-11, offset+11] and [-offset-11, -offset+11] disjoint
// for any point, so no route position can ever satisfy the 11m snap against
// both virtual sidewalks at once.
// ROAD_SIDE_OFFSET_M is imported (see top of file) — re-exported for
// geometryCoverage.test.ts, which asserted this invariant directly.
const GEOMETRY_CACHE_PREFIX = '@pick_sidewalks_v3_'; // v3: split centerline fallbacks per-side
// MIN_SIDEWALK_SEGMENTS is imported — used below by fetchStreetGeometryForRing.
const GEOMETRY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STATUS_COLLECTION = 'segment_status';
const PRECACHE_STREETS_COLLECTION = 'precache_streets';
// 2x the weekly refresh cadence (OVERPASS_PRECACHE_SPEC.md §5 decision 4) —
// a doc past this age is treated as a miss, not shown as if fresh, so one
// missed scheduled run doesn't quietly serve week(s)-stale geometry.
const PRECACHE_STALENESS_MS = 14 * 24 * 60 * 60 * 1000;

// Parks are open polygons, not sidewalk lines — you don't walk every inch, so a
// park counts as cleaned when the route spent real time inside it.
const PARK_STATUS_COLLECTION = 'park_status';
const PARK_GEOMETRY_CACHE_PREFIX = '@pick_parks_';
const MIN_POINTS_IN_PARK = 6; // route GPS points inside the polygon to count it cleaned

export interface StreetSegment {
  id: string; // `${osmWayId}_${index}` — stable across fetches (road fallbacks add _L/_R)
  coords: [number, number][]; // [lat, lon] pairs
  grid: string; // 0.01° grid cell of segment midpoint
  side?: 'L' | 'R'; // set only on split road-centerline fallbacks
}

export interface SegmentStatus {
  last_cleaned: number;
  last_user: string;
  clean_count: number;
}

export interface RenderSegment {
  id: string;
  coords: [number, number][];
  daysOld: number | null; // null = never cleaned
}

export interface Park {
  id: string; // `park_${osmId}`
  name: string;
  polygon: [number, number][]; // closed ring of [lat, lon]
  grid: string;
}

export interface ParkStatus {
  last_cleaned: number;
  last_user: string;
  name: string;
}

export interface RenderPark {
  id: string;
  name: string;
  polygon: [number, number][];
  daysOld: number | null; // null = never cleaned
}

// ---------- geometry helpers ----------
// distM/offsetCoords/gridKey are imported from functions/shared/streetGeometry
// (see top of file) — the exact same functions the precache refresh job uses.

/** Min distance in meters from point p to polyline segment a-b. */
function pointToEdgeM(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const cosLat = Math.cos((p[0] * Math.PI) / 180);
  const ax = a[1] * cosLat, ay = a[0];
  const bx = b[1] * cosLat, by = b[0];
  const px = p[1] * cosLat, py = p[0];
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  // back to meters
  return distM(py, px / cosLat, cy, cx / cosLat);
}

// offsetCoords (used above by pointToEdgeM's callers indirectly, and
// re-exported below) is imported from functions/shared/streetGeometry.

/** Resample a polyline into points spaced ~stepM apart, for coverage sampling. */
function sampleAlong(coords: [number, number][], stepM: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < coords.length; i++) {
    const [aLat, aLon] = coords[i - 1];
    const [bLat, bLon] = coords[i];
    const len = distM(aLat, aLon, bLat, bLon);
    const n = Math.max(1, Math.round(len / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t]);
    }
  }
  if (coords.length) out.push(coords[coords.length - 1]);
  return out;
}

/**
 * Fraction (0..1) of a segment that the walk actually ran alongside: sample the
 * segment every ~5m and count how many samples have a route point within snapM.
 * Exported for unit tests.
 */
export function routeCoverageFraction(
  segCoords: [number, number][],
  routePoints: Array<{ lat: number; lon: number }>,
  snapM: number
): number {
  if (routePoints.length === 0) return 0;
  const samples = sampleAlong(segCoords, SEGMENT_SAMPLE_STEP_M);
  if (samples.length === 0) return 0;
  let covered = 0;
  for (const s of samples) {
    let near = false;
    if (routePoints.length === 1) {
      near = distM(s[0], s[1], routePoints[0].lat, routePoints[0].lon) <= snapM;
    } else {
      for (let i = 1; i < routePoints.length; i++) {
        if (
          pointToEdgeM(
            s,
            [routePoints[i - 1].lat, routePoints[i - 1].lon],
            [routePoints[i].lat, routePoints[i].lon]
          ) <= snapM
        ) {
          near = true;
          break;
        }
      }
    }
    if (near) covered++;
  }
  return covered / samples.length;
}

/**
 * Assign each route point to the single nearest candidate segment it's within
 * snap distance of, instead of crediting every segment the point happens to
 * fall within snap distance of. This is the fix for the both-sides-cleaned
 * bug that COVERAGE_THRESHOLD/SNAP_DISTANCE_M alone couldn't close: two
 * independently-mapped real OSM sidewalk ways (not the synthetic
 * offsetCoords() fallback) can sit closer together than 2×SNAP_DISTANCE_M in
 * places, so a route walked along one side can still land within snap
 * distance of the other. Comparing against every other nearby candidate
 * (already fetched by getSegmentsAround/getSegmentsForRing — no extra query)
 * and keeping only the closest match resolves that overlap locally, per
 * point, without having to retune the absolute threshold.
 *
 * Returns one route-point bucket per input candidate (same order/length as
 * `candidates`); a point that isn't within snapM of ANY candidate is simply
 * dropped, matching the old behavior where it wouldn't have counted either.
 */
export function assignRoutePointsToNearestSegment<T extends { coords: [number, number][] }>(
  routePoints: Array<{ lat: number; lon: number }>,
  candidates: T[],
  snapM: number
): Array<{ lat: number; lon: number }>[] {
  const buckets: Array<{ lat: number; lon: number }>[] = candidates.map(() => []);
  for (const p of routePoints) {
    let bestIdx = -1;
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const coords = candidates[i].coords;
      if (coords.length === 0) continue;
      let d: number;
      if (coords.length === 1) {
        d = distM(p.lat, p.lon, coords[0][0], coords[0][1]);
      } else {
        d = Infinity;
        for (let j = 1; j < coords.length; j++) {
          const e = pointToEdgeM([p.lat, p.lon], coords[j - 1], coords[j]);
          if (e < d) d = e;
        }
      }
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestD <= snapM) buckets[bestIdx].push(p);
  }
  return buckets;
}

// gridKey is imported from functions/shared/streetGeometry (see top of
// file) and re-exported — the precache refresh job's doc ids and this
// client's cache keys MUST agree on the same formula.

/** The 3x3 block of grid cells around a point (covers query radius). */
function gridNeighborhood(lat: number, lon: number): string[] {
  const cells: string[] = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      cells.push(gridKey(lat + dLat * 0.01, lon + dLon * 0.01));
    }
  }
  return cells;
}

// ---------- completion tiles (universal, zero per-city data) ----------
// The "complete this area" unit. A fixed geographic tile works identically in
// every city with no bespoke boundary data — the scalable alternative to
// per-city neighborhood polygons. The geocoded neighborhood NAME is just a
// label on top. Sized for an achievable loop (a handful of walks) and nests
// cleanly inside the 0.01° fetch grid (4 tiles per cell).
export const TILE_SIZE_DEG = 0.005; // ~555m N-S, ~420m E-W at NYC latitude

/** Stable id of the tile containing a point. */
export function tileId(lat: number, lon: number): string {
  const tLat = Math.floor(lat / TILE_SIZE_DEG) * TILE_SIZE_DEG;
  const tLon = Math.floor(lon / TILE_SIZE_DEG) * TILE_SIZE_DEG;
  return `${tLat.toFixed(3)}_${tLon.toFixed(3)}`;
}

/** Bounding box [minLat, minLon, maxLat, maxLon] of the tile containing a point. */
export function tileBounds(lat: number, lon: number): [number, number, number, number] {
  const minLat = Math.floor(lat / TILE_SIZE_DEG) * TILE_SIZE_DEG;
  const minLon = Math.floor(lon / TILE_SIZE_DEG) * TILE_SIZE_DEG;
  return [minLat, minLon, minLat + TILE_SIZE_DEG, minLon + TILE_SIZE_DEG];
}

/** Midpoint vertex of a segment polyline — used to assign it to one tile. */
function segMidpoint(coords: [number, number][]): [number, number] {
  if (coords.length === 0) return [NaN, NaN];
  return coords[Math.floor(coords.length / 2)];
}

export interface TileStats {
  tileId: string;
  total: number; // segments whose midpoint is in this tile (the fixed denominator)
  fresh: number; // cleaned within the last 5 days
  freshPct: number; // 0-100
  toGo: number; // total - fresh ("blocks to go")
}

/**
 * Coverage for the CURRENT TILE only — a stable, completable denominator,
 * unlike the pan-dependent radius count. Filters an already-fetched coverage
 * set to the tile containing (lat, lon), so it needs no extra network call.
 * Edge note: a tile's far corner can sit just past the 600m fetch radius, so
 * `total` settles to its true value once you've moved across the tile.
 */
export function getTileStats(lat: number, lon: number, coverage: RenderSegment[]): TileStats {
  const [minLat, minLon, maxLat, maxLon] = tileBounds(lat, lon);
  const inTile = coverage.filter((s) => {
    const [mLat, mLon] = segMidpoint(s.coords);
    return mLat >= minLat && mLat < maxLat && mLon >= minLon && mLon < maxLon;
  });
  const total = inTile.length;
  const fresh = inTile.filter((s) => s.daysOld !== null && s.daysOld <= 5).length;
  return {
    tileId: tileId(lat, lon),
    total,
    fresh,
    freshPct: total > 0 ? Math.round((fresh / total) * 100) : 0,
    toGo: Math.max(0, total - fresh),
  };
}

// ---------- OSM fetch + segmentation ----------
//
// runOverpass, fetchStreetGeometry, and chopWaysIntoSegments now live in
// functions/shared/streetGeometry.js (imported at the top of this file) —
// the exact fetch/hedge/chop pipeline the Cloud Functions precache refresh
// job reuses so a cache hit is byte-for-byte what a live client fetch would
// have produced. See that file for the full field-data reasoning behind the
// hedge timing and the sidewalk→road fallback threshold.

/** Read the precache doc for the gridKey tile a point falls in. Returns null
 *  (a cache miss) on: no doc, an empty/missing segments array, a doc past
 *  the staleness ceiling, or any Firestore read error — the last case fails
 *  OPEN by design (OVERPASS_PRECACHE_SPEC.md §3): a permission problem or a
 *  transient Firestore outage must never surface as a distinct error to the
 *  user, it just falls through to exactly today's live-Overpass path. */
async function getPrecachedStreetSegments(lat: number, lon: number): Promise<StreetSegment[] | null> {
  try {
    const key = gridKey(lat, lon);
    const snap = await getDoc(doc(db, PRECACHE_STREETS_COLLECTION, key));
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    const refreshedAt = typeof data?.refreshedAt === 'number' ? data.refreshedAt : 0;
    if (Date.now() - refreshedAt > PRECACHE_STALENESS_MS) return null;
    const segments = data?.segments;
    if (!Array.isArray(segments) || segments.length === 0) return null;
    return segments as StreetSegment[];
  } catch (e) {
    console.warn(`🛣️ Precache read failed for street tile — falling through to live Overpass: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

// In-flight request coalescing: callers that land within the same grid cell
// (or the same ring/poly) close together — e.g. the debounced pan handler
// firing right after refreshOverviewAround(), or a post-save refresh racing
// a moveend — used to each independently miss the AsyncStorage cache (which
// is only written AFTER a fetch resolves) and fire their own duplicate
// Overpass round-trip for the same streets. Same pattern already used by
// neighborhoods.ts's hoodsInflight/hoodsCache for per-city GeoJSON; applied
// here so concurrent callers share one fetch instead of paying for it twice.
const segmentsInflight: Record<string, Promise<StreetSegment[]> | null> = {};

/** Cached street segments around a point (fetches OSM on cache miss). */
export async function getSegmentsAround(lat: number, lon: number): Promise<StreetSegment[]> {
  const cacheKey = `${GEOMETRY_CACHE_PREFIX}${gridKey(lat, lon)}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { fetchedAt, segments } = JSON.parse(cached);
      if (Date.now() - fetchedAt < GEOMETRY_CACHE_TTL_MS && segments?.length) {
        return segments;
      }
    }
  } catch {}

  if (segmentsInflight[cacheKey]) return segmentsInflight[cacheKey]!;
  segmentsInflight[cacheKey] = (async () => {
    // Server-side precache check (OVERPASS_PRECACHE_SPEC.md) — a pure
    // fast-path in front of the live Overpass call. Any miss (no doc, stale,
    // or a read error) falls through to fetchStreetGeometry unchanged, so
    // behavior with an empty/unreachable precache is identical to before
    // this existed.
    let segments = await getPrecachedStreetSegments(lat, lon);
    if (segments) {
      console.log(`🛣️ Served ${segments.length} street segments from precache`);
    } else {
      segments = await fetchStreetGeometry(lat, lon);
      console.log(`🛣️ Fetched ${segments.length} street segments from OSM`);
    }
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), segments }));
    } catch {}
    return segments;
  })();
  try {
    return await segmentsInflight[cacheKey]!;
  } finally {
    segmentsInflight[cacheKey] = null;
  }
}

// ---------- shared status (Firestore) ----------

/** Segment statuses for an arbitrary set of grid cells — chunked ('in' allows
 *  10 values) and fetched in parallel, so a whole neighborhood is 2-3 queries. */
async function loadStatusesForGrids(grids: string[]): Promise<Map<string, SegmentStatus>> {
  const statuses = new Map<string, SegmentStatus>();
  const chunks: string[][] = [];
  for (let i = 0; i < grids.length; i += 10) chunks.push(grids.slice(i, i + 10));
  try {
    const snaps = await Promise.all(
      chunks.map((c) => getDocs(query(collection(db, STATUS_COLLECTION), where('grid', 'in', c))))
    );
    for (const snap of snaps) {
      snap.forEach((d) => {
        const data = d.data() as any;
        statuses.set(d.id, {
          last_cleaned: data.last_cleaned,
          last_user: data.last_user,
          clean_count: data.clean_count || 1,
        });
      });
    }
    console.log(`🛣️ Loaded ${statuses.size} segment statuses (all users)`);
  } catch (error) {
    console.error('Failed to load segment statuses:', error);
  }
  return statuses;
}

async function loadStatuses(lat: number, lon: number): Promise<Map<string, SegmentStatus>> {
  return loadStatusesForGrids(gridNeighborhood(lat, lon));
}

/**
 * Snap a walked route to street segments and mark them cleaned (shared).
 * Returns the number of segments marked.
 */
export async function markRouteCleaned(
  routePoints: Array<{ lat: number; lon: number }>,
  userId: string
): Promise<number> {
  if (!routePoints || routePoints.length === 0) return 0;

  // Center of the walk is good enough — FETCH_RADIUS_M (600m) covers a session
  const cLat = routePoints.reduce((s, p) => s + p.lat, 0) / routePoints.length;
  const cLon = routePoints.reduce((s, p) => s + p.lon, 0) / routePoints.length;

  let segments: StreetSegment[];
  try {
    segments = await getSegmentsAround(cLat, cLon);
  } catch (error) {
    console.error('Street fetch failed; skipping segment marking:', error);
    return 0;
  }

  // First, resolve which segment each route point actually belongs to when
  // multiple candidates are within snap distance (e.g. two independently-
  // mapped sidewalk ways on a narrow street) — see
  // assignRoutePointsToNearestSegment(). Then, same as before, a segment is
  // cleaned only if the route ran alongside ≥COVERAGE_THRESHOLD of its
  // length — not just clipped one end — but now measured against only the
  // route points that were actually closest to it.
  const buckets = assignRoutePointsToNearestSegment(routePoints, segments, SNAP_DISTANCE_M);
  const cleaned = segments.filter(
    (seg, i) => routeCoverageFraction(seg.coords, buckets[i], SNAP_DISTANCE_M) >= COVERAGE_THRESHOLD
  );

  if (cleaned.length === 0) {
    console.log('🛣️ No street segments within snap distance of route');
    return 0;
  }

  try {
    const batch = writeBatch(db);
    const now = Date.now();
    for (const seg of cleaned.slice(0, 400)) {
      batch.set(
        doc(db, STATUS_COLLECTION, seg.id),
        { grid: seg.grid, last_cleaned: now, last_user: userId },
        { merge: true }
      );
    }
    await batch.commit();
    console.log(`🛣️ Marked ${cleaned.length} street segments cleaned`);
  } catch (error) {
    console.error('Failed to write segment statuses:', error);
    return 0;
  }
  return cleaned.length;
}

// ---------- render-ready coverage ----------

/**
 * Everything the map needs: every street segment near the point, with
 * days-since-cleaned (null = never). Combines local OSM geometry with
 * shared Firestore status from all users.
 */
export async function getCoverage(lat: number, lon: number): Promise<RenderSegment[]> {
  try {
    return await getCoverageOrThrow(lat, lon);
  } catch (error) {
    console.error('Street coverage unavailable:', error);
    return [];
  }
}

/** Same as getCoverage(), but lets a fetch failure propagate instead of
 *  swallowing it to []. getCoverage()'s permissive swallow-to-[] is relied on
 *  by its one direct caller (the incremental per-pan overview fetch in
 *  map.tsx's loadStreetCoverage), which already has its own "don't clobber
 *  good stats with a bogus 0/0" guard for that case. getCoverageForRingTiled
 *  needs the opposite: a real failure signal, so a total Overpass outage
 *  across every sampled tile doesn't get counted as "25 legitimately empty
 *  tiles" and rendered as a false 0%/"complete" neighborhood. */
async function getCoverageOrThrow(lat: number, lon: number): Promise<RenderSegment[]> {
  const segments = await getSegmentsAround(lat, lon);
  const statuses = await loadStatuses(lat, lon);
  const now = Date.now();
  return segments.map((seg) => {
    const status = statuses.get(seg.id);
    return {
      id: seg.id,
      // 5 decimals ≈ 1m — full OSM precision tripled the WebView payload
      coords: seg.coords.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]) as [number, number][],
      daysOld: status ? Math.round(((now - status.last_cleaned) / 86400000) * 10) / 10 : null,
    };
  });
}

// ---------- whole-neighborhood coverage (one Overpass query) ----------

const RING_CACHE_PREFIX = '@pick_ringsegs_v3_'; // v3: split centerline fallbacks per-side

/** Cheap stable hash of a ring for the geometry cache key. */
function ringHash(ring: [number, number][]): string {
  let h = 0;
  for (const [la, lo] of ring) {
    h = (h * 31 + Math.round(la * 1e4)) | 0;
    h = (h * 31 + Math.round(lo * 1e4)) | 0;
  }
  return (h >>> 0).toString(36) + '_' + ring.length;
}

/** Thin a ring so the Overpass poly filter stays a reasonable size. */
function thinRing(ring: [number, number][], max = 60): [number, number][] {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
  return out;
}

/** All sidewalk/road geometry inside a polygon in ONE Overpass round-trip —
 *  this replaced tiling ~25 sequential 600m around-queries across the bbox,
 *  which on a cold cache took minutes for a mid-size neighborhood. */
async function fetchStreetGeometryForRing(ring: [number, number][]): Promise<StreetSegment[]> {
  const poly = thinRing(ring)
    .map(([la, lo]) => `${la.toFixed(5)} ${lo.toFixed(5)}`)
    .join(' ');
  const sidewalkQuery = `
    [out:json][timeout:25];
    (
      way["highway"="footway"]["footway"="sidewalk"](poly:"${poly}");
      way["highway"~"^(pedestrian|path|living_street)$"](poly:"${poly}");
    );
    out geom;
  `;
  const roadQuery = `
    [out:json][timeout:25];
    way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street|pedestrian|footway|path)$"](poly:"${poly}");
    out geom;
  `;
  // Same reasoning as fetchStreetGeometry: fire both queries together since
  // the road query doesn't depend on the sidewalk result — this is the path
  // actually used by activateHood's first-visit "activating a neighborhood"
  // flow, so it's the biggest lever on perceived load time.
  const [sidewalkJson, roadJson] = await Promise.all([
    runOverpass(sidewalkQuery),
    runOverpass(roadQuery),
  ]);
  let segments = chopWaysIntoSegments(sidewalkJson);
  if (segments.length < MIN_SIDEWALK_SEGMENTS) {
    segments = chopWaysIntoSegments(roadJson, true); // centerlines → split into per-side sidewalks
  }
  return segments;
}

const ringSegmentsInflight: Record<string, Promise<StreetSegment[]> | null> = {};

/** Cached whole-ring segments (fetches OSM on cache miss). Kept separate from
 *  the per-grid cache: a poly query clips at the hood edge, so folding its
 *  results into border grid cells would leave them permanently half-empty. */
async function getSegmentsForRing(ring: [number, number][]): Promise<StreetSegment[]> {
  const cacheKey = RING_CACHE_PREFIX + ringHash(ring);
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { fetchedAt, segments } = JSON.parse(cached);
      if (Date.now() - fetchedAt < GEOMETRY_CACHE_TTL_MS && segments?.length) return segments;
    }
  } catch {}
  // Coalesce concurrent callers for the same ring (e.g. a double-tap on the
  // same hood outline before the first activation's cache write lands) — see
  // segmentsInflight above for the full rationale.
  if (ringSegmentsInflight[cacheKey]) return ringSegmentsInflight[cacheKey]!;
  ringSegmentsInflight[cacheKey] = (async () => {
    const segments = await fetchStreetGeometryForRing(ring);
    console.log(`🛣️ Fetched ${segments.length} street segments for ring (single poly query)`);
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), segments }));
    } catch {}
    return segments;
  })();
  try {
    return await ringSegmentsInflight[cacheKey]!;
  } finally {
    ringSegmentsInflight[cacheKey] = null;
  }
}

/**
 * Every street segment inside a neighborhood polygon, with freshness — for
 * "level mode" (the whole hood at once). One Overpass poly query for the whole
 * hood + a couple of batched Firestore status reads. Falls back to tiling
 * getCoverage across the bbox (in parallel) if the poly query fails.
 */
export async function getCoverageForRing(ring: [number, number][]): Promise<RenderSegment[]> {
  try {
    const segments = await getSegmentsForRing(ring);
    const inRing = segments.filter((s) => {
      const m = s.coords[Math.floor(s.coords.length / 2)];
      return pointInPolygon(m[0], m[1], ring);
    });
    const grids = [...new Set(inRing.map((s) => s.grid))];
    const statuses = await loadStatusesForGrids(grids);
    const now = Date.now();
    return inRing.map((seg) => {
      const status = statuses.get(seg.id);
      return {
        id: seg.id,
        coords: seg.coords.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]) as [number, number][],
        daysOld: status ? Math.round(((now - status.last_cleaned) / 86400000) * 10) / 10 : null,
      };
    });
  } catch (e) {
    console.warn(`🛣️ Ring poly query failed, falling back to tiled fetch: ${(e as Error)?.message ?? e}`);
    return getCoverageForRingTiled(ring);
  }
}

/** Fallback: tile getCoverage across the polygon bbox. Same sampling as the
 *  old implementation, but samples run in parallel batches instead of one at
 *  a time. Capped so a huge polygon can't fan out unbounded. */
async function getCoverageForRingTiled(ring: [number, number][]): Promise<RenderSegment[]> {
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const [la, lo] of ring) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  const STEP = 0.006; // ~600m, matches the fetch radius so samples tile the area
  const points: [number, number][] = [];
  for (let la = minLat; la <= maxLat + STEP && points.length < 25; la += STEP) {
    for (let lo = minLon; lo <= maxLon + STEP && points.length < 25; lo += STEP) {
      points.push([la, lo]);
    }
  }
  const seen = new Map<string, RenderSegment>();
  const CONCURRENCY = 5;
  // Track real fetch failures separately from "this tile legitimately has no
  // matching segments" — getCoverage() itself swallows fetch errors to [],
  // so use the throwing variant here and distinguish the two ourselves.
  // Otherwise a total Overpass outage (every tile's fetch fails) looks
  // identical to "25 tiles sampled, genuinely nothing there," and the caller
  // renders that as a real, completed 0% result instead of an error.
  // Per-tile counts (not just booleans) so a *partial* outage — most tiles
  // fail, a handful succeed — can be told apart from "one or two blips,
  // otherwise fine." A tile that succeeds with zero segments (a genuinely
  // empty patch — water, a park, a real small neighborhood) still counts as
  // a success here; only network/Overpass fetch errors count as failures.
  // That keeps this ratio a clean signal of fetch reliability, uncontaminated
  // by real geographic sparsity.
  let succeededCount = 0;
  let failedCount = 0;
  for (let i = 0; i < points.length; i += CONCURRENCY) {
    const batch = points.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([la, lo]) =>
        getCoverageOrThrow(la, lo)
          .then((segs) => { succeededCount++; return segs; })
          .catch(() => { failedCount++; return [] as RenderSegment[]; })
      )
    );
    for (const segs of results) for (const s of segs) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  const attempted = succeededCount + failedCount;
  if (succeededCount === 0 && failedCount > 0) {
    throw new Error('Street coverage unavailable: every tiled fetch failed (Overpass likely down)');
  }
  // A minority of tiles succeeding is not enough to trust as "the real total
  // for this neighborhood" — a large neighborhood where most tiles failed
  // can otherwise settle on a tiny, implausible count (e.g. "36 to go" for a
  // neighborhood the size of Sunset Park, Brooklyn) that renders identically
  // to a real, complete result. Below this success rate, treat it as
  // unreliable and surface the existing retry error state instead of
  // silently showing a partial count as the finished total. 50% is
  // deliberately permissive of the ordinary case — one or two blips out of
  // ~20-25 tiles (90%+ success) sail through untouched — and only trips when
  // the fetch is degraded enough that the result can no longer be trusted.
  const MIN_SUCCESS_RATE = 0.5;
  if (attempted > 0 && succeededCount / attempted < MIN_SUCCESS_RATE) {
    throw new Error(
      `Street coverage unreliable: only ${succeededCount}/${attempted} tiled fetches succeeded ` +
      `(Overpass likely degraded) — refusing to show a partial result as the real total`
    );
  }
  const out: RenderSegment[] = [];
  for (const s of seen.values()) {
    const m = s.coords[Math.floor(s.coords.length / 2)];
    if (pointInPolygon(m[0], m[1], ring)) out.push(s);
  }
  return out;
}

/** Coverage stats for the area — feeds "62% cleaned in last 5 days". */
/** The street segment nearest a tapped point — powers "adopt this block".
 *  Returns null when the tap isn't near any street (> 40m away). */
export async function nearestStreetSegment(
  lat: number,
  lon: number
): Promise<{ id: string; coords: [number, number][] } | null> {
  const segs = await getCoverage(lat, lon);
  let best: { id: string; coords: [number, number][] } | null = null;
  let bestD = Infinity;
  for (const s of segs) {
    const c = s.coords;
    for (let i = 1; i < c.length; i++) {
      const d = pointToEdgeM([lat, lon], c[i - 1], c[i]);
      if (d < bestD) { bestD = d; best = { id: s.id, coords: c }; }
    }
  }
  return bestD <= 40 ? best : null;
}

export async function getCoverageStats(lat: number, lon: number) {
  const coverage = await getCoverage(lat, lon);
  const total = coverage.length;
  const fresh = coverage.filter((s) => s.daysOld !== null && s.daysOld <= 5).length;
  const everCleaned = coverage.filter((s) => s.daysOld !== null).length;
  return {
    totalSegments: total,
    freshSegments: fresh,
    everCleanedSegments: everCleaned,
    freshPct: total > 0 ? Math.round((fresh / total) * 100) : 0,
    everCleanedPct: total > 0 ? Math.round((everCleaned / total) * 100) : 0,
  };
}

// ============================ PARKS ============================
// Parks (Carroll Park, etc.) don't fit the sidewalk-line model — they're open
// polygons you clean by walking around inside. Tracked as their own zones.

/** Ray-casting point-in-polygon. poly is a ring of [lat, lon]. Exported for tests. */
export function pointInPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function fetchParks(lat: number, lon: number): Promise<Park[]> {
  const q = `
    [out:json][timeout:25];
    (
      way["leisure"="park"](around:${FETCH_RADIUS_M},${lat},${lon});
      way["leisure"="garden"](around:${FETCH_RADIUS_M},${lat},${lon});
      way["leisure"="playground"](around:${FETCH_RADIUS_M},${lat},${lon});
    );
    out geom;
  `;
  const json = await runOverpass(q);
  const parks: Park[] = [];
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 3) continue;
    const polygon: [number, number][] = el.geometry.map((g: any) => [g.lat, g.lon]);
    const cLat = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
    const cLon = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    parks.push({
      id: `park_${el.id}`,
      name: el.tags?.name || 'Park',
      polygon,
      grid: gridKey(cLat, cLon),
    });
  }
  return parks;
}

const parksInflight: Record<string, Promise<Park[]> | null> = {};

/** Cached parks around a point (fetches OSM on cache miss). */
export async function getParksAround(lat: number, lon: number): Promise<Park[]> {
  const cacheKey = `${PARK_GEOMETRY_CACHE_PREFIX}${gridKey(lat, lon)}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { fetchedAt, parks } = JSON.parse(cached);
      if (Date.now() - fetchedAt < GEOMETRY_CACHE_TTL_MS && Array.isArray(parks)) {
        return parks;
      }
    }
  } catch {}

  if (parksInflight[cacheKey]) return parksInflight[cacheKey]!;
  parksInflight[cacheKey] = (async () => {
    const parks = await fetchParks(lat, lon);
    console.log(`🌳 Fetched ${parks.length} parks from OSM`);
    try {
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), parks }));
    } catch {}
    return parks;
  })();
  try {
    return await parksInflight[cacheKey]!;
  } finally {
    parksInflight[cacheKey] = null;
  }
}

async function loadParkStatuses(lat: number, lon: number): Promise<Map<string, ParkStatus>> {
  const statuses = new Map<string, ParkStatus>();
  try {
    const q = query(
      collection(db, PARK_STATUS_COLLECTION),
      where('grid', 'in', gridNeighborhood(lat, lon))
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data() as any;
      statuses.set(d.id, {
        last_cleaned: data.last_cleaned,
        last_user: data.last_user,
        name: data.name || 'Park',
      });
    });
  } catch (error) {
    console.error('Failed to load park statuses:', error);
  }
  return statuses;
}

/**
 * Mark any park the walk spent real time inside (≥ MIN_POINTS_IN_PARK route
 * points within the polygon) as cleaned. Returns the number of parks marked.
 */
export async function markParksCleaned(
  routePoints: Array<{ lat: number; lon: number }>,
  userId: string
): Promise<number> {
  if (!routePoints || routePoints.length === 0) return 0;
  const cLat = routePoints.reduce((s, p) => s + p.lat, 0) / routePoints.length;
  const cLon = routePoints.reduce((s, p) => s + p.lon, 0) / routePoints.length;

  let parks: Park[];
  try {
    parks = await getParksAround(cLat, cLon);
  } catch (error) {
    console.error('Park fetch failed; skipping park marking:', error);
    return 0;
  }

  const cleaned = parks.filter((park) => {
    let inside = 0;
    for (const p of routePoints) {
      if (pointInPolygon(p.lat, p.lon, park.polygon)) inside++;
      if (inside >= MIN_POINTS_IN_PARK) return true;
    }
    return false;
  });

  if (cleaned.length === 0) return 0;

  try {
    const batch = writeBatch(db);
    const now = Date.now();
    for (const park of cleaned.slice(0, 50)) {
      batch.set(
        doc(db, PARK_STATUS_COLLECTION, park.id),
        { grid: park.grid, last_cleaned: now, last_user: userId, name: park.name },
        { merge: true }
      );
    }
    await batch.commit();
    console.log(`🌳 Marked ${cleaned.length} park(s) cleaned`);
  } catch (error) {
    console.error('Failed to write park statuses:', error);
    return 0;
  }
  return cleaned.length;
}

/** Parks near a point with days-since-cleaned, ready for the map. */
export async function getParkCoverage(lat: number, lon: number): Promise<RenderPark[]> {
  let parks: Park[] = [];
  try {
    parks = await getParksAround(lat, lon);
  } catch (error) {
    console.error('Park coverage unavailable:', error);
    return [];
  }
  let statuses = new Map<string, ParkStatus>();
  try {
    statuses = await loadParkStatuses(lat, lon);
  } catch (error) {
    console.error('Park statuses unavailable (rendering parks as never-cleaned):', error);
  }
  const now = Date.now();
  return parks.map((park) => {
    const status = statuses.get(park.id);
    return {
      id: park.id,
      name: park.name,
      polygon: park.polygon.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]) as [number, number][],
      daysOld: status ? Math.round(((now - status.last_cleaned) / 86400000) * 10) / 10 : null,
    };
  });
}
