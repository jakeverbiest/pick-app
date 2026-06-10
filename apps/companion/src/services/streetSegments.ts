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

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const SEGMENT_LENGTH_M = 50;
const SNAP_DISTANCE_M = 25;
const FETCH_RADIUS_M = 600;
const GEOMETRY_CACHE_PREFIX = '@pick_streets_';
const GEOMETRY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STATUS_COLLECTION = 'segment_status';

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

// ---------- OSM fetch + segmentation ----------

async function fetchStreetGeometry(lat: number, lon: number): Promise<StreetSegment[]> {
  const overpassQuery = `
    [out:json][timeout:25];
    way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street|pedestrian|footway|path)$"]
      (around:${FETCH_RADIUS_M},${lat},${lon});
    out geom;
  `;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery)}`,
  });
  if (!res.ok) throw new Error(`Overpass error ${res.status}`);
  const json = await res.json();

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

async function loadStatuses(lat: number, lon: number): Promise<Map<string, SegmentStatus>> {
  const statuses = new Map<string, SegmentStatus>();
  try {
    const q = query(
      collection(db, STATUS_COLLECTION),
      where('grid', 'in', gridNeighborhood(lat, lon))
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data() as any;
      statuses.set(d.id, {
        last_cleaned: data.last_cleaned,
        last_user: data.last_user,
        clean_count: data.clean_count || 1,
      });
    });
    console.log(`🛣️ Loaded ${statuses.size} segment statuses (all users)`);
  } catch (error) {
    console.error('Failed to load segment statuses:', error);
  }
  return statuses;
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

  const cleaned = segments.filter((seg) =>
    routePoints.some((p) => {
      for (let i = 1; i < seg.coords.length; i++) {
        if (pointToEdgeM([p.lat, p.lon], seg.coords[i - 1], seg.coords[i]) <= SNAP_DISTANCE_M) {
          return true;
        }
      }
      return false;
    })
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
      coords: seg.coords,
      daysOld: status ? (now - status.last_cleaned) / (1000 * 60 * 60 * 24) : null,
    };
  });
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
