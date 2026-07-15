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
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { app } from './firebaseConfig';

const db = getFirestore(app);

// Multiple public Overpass mirrors — the primary is frequently slow/rate-limited,
// which is the main reason a fresh neighborhood "fails to load on start". We try
// them in order so a single flaky endpoint doesn't leave the map empty.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const SEGMENT_LENGTH_M = 50;
// Sidewalk-level snapping: tight enough not to credit the OPPOSITE side of the
// street (~18m away in NYC), loose enough for Balanced GPS (~10m error). Field
// test showed 15m was crediting both sides on narrower streets — tightened to
// 11m. (Note: in areas with no mapped sidewalks we fall back to road CENTER
// lines, where per-side isn't possible — the whole street reads as cleaned.)
const SNAP_DISTANCE_M = 11;
// A segment counts as cleaned only if the route ran alongside this fraction of
// its length (sampled). Stops one stray GPS ping from crediting a whole block,
// and (with the tight snap) avoids crediting the opposite sidewalk you didn't walk.
const COVERAGE_THRESHOLD = 0.8; // 80% of the segment — one side of a block, not the street
const SEGMENT_SAMPLE_STEP_M = 5; // sample the segment every ~5m to measure coverage
const FETCH_RADIUS_M = 600;
const GEOMETRY_CACHE_PREFIX = '@pick_sidewalks_'; // v2: sidewalks, not centerlines
const MIN_SIDEWALK_SEGMENTS = 30; // below this, area has unmapped sidewalks → fall back to roads
const GEOMETRY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STATUS_COLLECTION = 'segment_status';

// Parks are open polygons, not sidewalk lines — you don't walk every inch, so a
// park counts as cleaned when the route spent real time inside it.
const PARK_STATUS_COLLECTION = 'park_status';
const PARK_GEOMETRY_CACHE_PREFIX = '@pick_parks_';
const MIN_POINTS_IN_PARK = 6; // route GPS points inside the polygon to count it cleaned

export interface StreetSegment {
  id: string; // `${osmWayId}_${index}` — stable across fetches
  coords: [number, number][]; // [lat, lon] pairs
  grid: string; // 0.01° grid cell of segment midpoint
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

/** Meters between two lat/lon points (equirectangular — fine at city scale). */
function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const x = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = (lat2 - lat1) * 110540;
  return Math.sqrt(x * x + y * y);
}

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

export function gridKey(lat: number, lon: number): string {
  return `${(Math.floor(lat * 100) / 100).toFixed(2)}_${(Math.floor(lon * 100) / 100).toFixed(2)}`;
}

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

// Per-endpoint timeout: without it, one hung mirror stalls the whole load
// indefinitely (fetch has no default timeout in RN) — the next mirror is
// usually fine, so fail over fast instead.
const OVERPASS_TIMEOUT_MS = 15000;

// The primary mirror is dead/rate-limited more often than not, and every fresh
// query was burning a full timeout on it before failing over. Remember which
// mirror answered last and lead with it for the rest of the session.
let preferredOverpass: string | null = null;

async function runOverpass(query: string): Promise<any> {
  let lastErr: unknown;
  const endpoints = preferredOverpass
    ? [preferredOverpass, ...OVERPASS_ENDPOINTS.filter((u) => u !== preferredOverpass)]
    : OVERPASS_ENDPOINTS;
  for (const url of endpoints) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OVERPASS_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Overpass error ${res.status}`);
      const json = await res.json();
      preferredOverpass = url;
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`🛣️ Overpass endpoint failed (${url}): ${(e as Error)?.message ?? e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('All Overpass endpoints failed');
}

async function fetchStreetGeometry(lat: number, lon: number): Promise<StreetSegment[]> {
  // SIDEWALKS, not road centerlines — pickers walk the sidewalk, and NYC OSM
  // maps each side of the street as its own footway=sidewalk way.
  const sidewalkQuery = `
    [out:json][timeout:25];
    (
      way["highway"="footway"]["footway"="sidewalk"](around:${FETCH_RADIUS_M},${lat},${lon});
      way["highway"~"^(pedestrian|path|living_street)$"](around:${FETCH_RADIUS_M},${lat},${lon});
    );
    out geom;
  `;
  let json = await runOverpass(sidewalkQuery);
  let segments = chopWaysIntoSegments(json);

  if (segments.length < MIN_SIDEWALK_SEGMENTS) {
    // Area without mapped sidewalks (common outside big cities) — fall back
    // to road centerlines so coverage still works
    console.log(`🛣️ Only ${segments.length} sidewalk segments mapped here — falling back to road centerlines`);
    const roadQuery = `
      [out:json][timeout:25];
      way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street|pedestrian|footway|path)$"]
        (around:${FETCH_RADIUS_M},${lat},${lon});
      out geom;
    `;
    json = await runOverpass(roadQuery);
    segments = chopWaysIntoSegments(json);
  }
  return segments;
}

function chopWaysIntoSegments(json: any): StreetSegment[] {
  const segments: StreetSegment[] = [];
  for (const way of json.elements || []) {
    if (way.type !== 'way' || !way.geometry || way.geometry.length < 2) continue;
    const pts: [number, number][] = way.geometry.map((g: any) => [g.lat, g.lon]);

    // Chop the way into ~SEGMENT_LENGTH_M pieces with stable indices
    let segCoords: [number, number][] = [pts[0]];
    let segLen = 0;
    let segIndex = 0;
    for (let i = 1; i < pts.length; i++) {
      segCoords.push(pts[i]);
      segLen += distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      const isLast = i === pts.length - 1;
      if (segLen >= SEGMENT_LENGTH_M || isLast) {
        if (segCoords.length >= 2) {
          const mid = segCoords[Math.floor(segCoords.length / 2)];
          segments.push({
            id: `${way.id}_${segIndex}`,
            coords: segCoords,
            grid: gridKey(mid[0], mid[1]),
          });
        }
        segIndex++;
        segCoords = [pts[i]];
        segLen = 0;
      }
    }
  }
  return segments;
}

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

  const segments = await fetchStreetGeometry(lat, lon);
  console.log(`🛣️ Fetched ${segments.length} street segments from OSM`);
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), segments }));
  } catch {}
  return segments;
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

  // A segment is cleaned only if the route ran alongside ≥80% of its length —
  // not just clipped one end. This is what stops a single pass from marking
  // whole blocks (and the opposite sidewalk) as clean.
  const cleaned = segments.filter(
    (seg) => routeCoverageFraction(seg.coords, routePoints, SNAP_DISTANCE_M) >= COVERAGE_THRESHOLD
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
  let segments: StreetSegment[] = [];
  try {
    segments = await getSegmentsAround(lat, lon);
  } catch (error) {
    console.error('Street coverage unavailable:', error);
    return [];
  }
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

const RING_CACHE_PREFIX = '@pick_ringsegs_';

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
  let json = await runOverpass(sidewalkQuery);
  let segments = chopWaysIntoSegments(json);
  if (segments.length < MIN_SIDEWALK_SEGMENTS) {
    const roadQuery = `
      [out:json][timeout:25];
      way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street|pedestrian|footway|path)$"](poly:"${poly}");
      out geom;
    `;
    json = await runOverpass(roadQuery);
    segments = chopWaysIntoSegments(json);
  }
  return segments;
}

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
  const segments = await fetchStreetGeometryForRing(ring);
  console.log(`🛣️ Fetched ${segments.length} street segments for ring (single poly query)`);
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), segments }));
  } catch {}
  return segments;
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
  for (let i = 0; i < points.length; i += CONCURRENCY) {
    const batch = points.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(([la, lo]) => getCoverage(la, lo).catch(() => [] as RenderSegment[]))
    );
    for (const segs of results) for (const s of segs) if (!seen.has(s.id)) seen.set(s.id, s);
  }
  const out: RenderSegment[] = [];
  for (const s of seen.values()) {
    const m = s.coords[Math.floor(s.coords.length / 2)];
    if (pointInPolygon(m[0], m[1], ring)) out.push(s);
  }
  return out;
}

/** Coverage stats for the area — feeds "62% cleaned in last 5 days". */
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

  const parks = await fetchParks(lat, lon);
  console.log(`🌳 Fetched ${parks.length} parks from OSM`);
  try {
    await AsyncStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), parks }));
  } catch {}
  return parks;
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
  const statuses = await loadParkStatuses(lat, lon);
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
