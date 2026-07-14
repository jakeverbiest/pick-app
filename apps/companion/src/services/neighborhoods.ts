import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { tileId, pointInPolygon } from './streetSegments';

/**
 * Neighborhood NAME resolver (scalable, no per-city data).
 *
 * Apple's reverseGeocodeAsync frequently returns no sub-locality for a point,
 * so the app falls back to the borough ("Brooklyn"). OpenStreetMap's address
 * breakdown has neighborhood/suburb names where Apple doesn't, it's free, and
 * it works in any city — so it's the right universal fallback.
 *
 * To stay within OSM's usage policy we cache the result per completion TILE
 * (so at most one network call per ~500m tile per TTL), and only ever call this
 * when Apple has already come up empty.
 */
const CACHE_PREFIX = '@pick_hood_';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // names are stable — cache a month
const EMPTY_TTL_MS = 3 * 24 * 60 * 60 * 1000; // retry a "no name" tile sooner

async function readCache(key: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const { name, ts } = JSON.parse(raw);
    const age = Date.now() - ts;
    if ((name && age < TTL_MS) || (!name && age < EMPTY_TTL_MS)) return name;
  } catch {}
  return null;
}

export async function osmNeighborhood(lat: number, lon: number): Promise<string> {
  const key = CACHE_PREFIX + tileId(lat, lon);
  const cached = await readCache(key);
  if (cached !== null) return cached;

  let name = '';
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'PICK-cleanup-app/1.0 (neighborhood labeling)',
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const data: any = await res.json();
      const a = data?.address ?? {};
      // Most specific → least: a real neighborhood beats a district beats nothing.
      name = a.neighbourhood || a.suburb || a.quarter || a.city_district || a.residential || '';
    }
  } catch {}

  try {
    await AsyncStorage.setItem(key, JSON.stringify({ name, ts: Date.now() }));
  } catch {}
  return name;
}

// ---------- real neighborhood boundary (where OSM has one) ----------

const BCACHE_PREFIX = '@pick_hoodgeo_';

/** GeoJSON ([lon,lat]) → Leaflet ring ([lat,lon]); picks the largest ring of a
 *  Polygon/MultiPolygon so we outline the main body, not a tiny detached piece. */
function geojsonToRing(g: any): [number, number][] | null {
  if (!g) return null;
  let rings: number[][][] = [];
  if (g.type === 'Polygon') rings = [g.coordinates[0]];
  else if (g.type === 'MultiPolygon') rings = g.coordinates.map((p: number[][][]) => p[0]);
  else return null;
  let best: number[][] | null = null;
  for (const r of rings) if (!best || r.length > best.length) best = r;
  if (!best || best.length < 4) return null;
  return best.map(([lon, lat]) => [lat, lon] as [number, number]);
}

export interface BoundaryResult {
  poly: [number, number][] | null;
  source: 'nyc' | 'osm' | 'none';
  name: string; // authoritative neighborhood name when the shape carries one (NYC)
}

// NYC bounding box — only attempt the NYC fine-neighborhood source inside it.
function inNYC(lat: number, lon: number): boolean {
  return lat >= 40.49 && lat <= 40.92 && lon >= -74.27 && lon <= -73.68;
}

// NYC fine neighborhoods (Pediacities, ~310 hoods — Carroll Gardens ≠ Cobble
// Hill, unlike the merged NTAs). Fetched once from a static GeoJSON, held in
// memory for the session, then matched client-side with point-in-polygon. We do
// NOT persist the ~1.5MB blob (too big for AsyncStorage); instead the resolved
// per-tile polygon is cached (see neighborhoodBoundary), so the big file is
// fetched at most once per session and only when a new tile isn't cached yet.
let nycHoodsCache: any[] | null = null;
let nycHoodsInflight: Promise<any[]> | null = null;
const NYC_HOODS_URL =
  'https://raw.githubusercontent.com/HodgesWardElliott/custom-nyc-neighborhoods/master/custom-pedia-cities-nyc-Mar2018.geojson';
// Too big for AsyncStorage, so it goes to a plain file — fetched ONCE per
// install instead of once per session (the ~1.5MB download was a visible chunk
// of every cold start, and all of the first one).
const NYC_HOODS_FILE = FileSystem.documentDirectory + 'nyc-hoods.json';

async function loadNycHoods(): Promise<any[]> {
  if (nycHoodsCache) return nycHoodsCache;
  // Coalesce concurrent callers (outline layer + a hood tap) into one load.
  if (nycHoodsInflight) return nycHoodsInflight;
  nycHoodsInflight = (async () => {
    try {
      const raw = await FileSystem.readAsStringAsync(NYC_HOODS_FILE);
      const features = JSON.parse(raw);
      if (Array.isArray(features) && features.length) {
        nycHoodsCache = features;
        return features;
      }
    } catch {} // no file yet — first run
    try {
      const res = await fetch(NYC_HOODS_URL, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const fc: any = await res.json();
        const features = fc?.features ?? [];
        if (features.length) {
          nycHoodsCache = features;
          FileSystem.writeAsStringAsync(NYC_HOODS_FILE, JSON.stringify(features)).catch(() => {});
        }
        return features;
      }
    } catch {}
    return [];
  })();
  try {
    return await nycHoodsInflight;
  } finally {
    nycHoodsInflight = null;
  }
}

/** Fire-and-forget warm-up: call early (login/splash) so the hoods layer is
 *  already on disk/memory by the time the map wants it. */
export function prefetchNycHoods(): void {
  void loadNycHoods();
}

/** Does a GeoJSON Polygon/MultiPolygon contain the point? (outer rings only) */
function geomContains(g: any, lat: number, lon: number): boolean {
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const p of polys) {
    const outer = p?.[0];
    if (!outer) continue;
    const ring = outer.map(([lo, la]: [number, number]) => [la, lo] as [number, number]);
    if (pointInPolygon(lat, lon, ring)) return true;
  }
  return false;
}

async function nycFineNeighborhood(
  lat: number,
  lon: number
): Promise<{ name: string; poly: [number, number][] } | null> {
  const features = await loadNycHoods();
  for (const f of features) {
    if (geomContains(f.geometry, lat, lon)) {
      const ring = geojsonToRing(f.geometry);
      if (ring) {
        const p = f.properties || {};
        const name = p.neighborhood || p.name || p.ntaname || p.NTAName || '';
        return { name, poly: ring };
      }
    }
  }
  return null;
}

/** OSM neighborhood polygon by name (fallback outside NYC / where NYC misses). */
async function osmBoundaryByName(name: string, city: string): Promise<[number, number][] | null> {
  if (!name) return null;
  try {
    const q = encodeURIComponent(`${name}${city ? ', ' + city : ''}`);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&polygon_geojson=1&limit=8&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PICK-cleanup-app/1.0 (neighborhood labeling)', Accept: 'application/json' },
    });
    if (res.ok) {
      const arr: any[] = await res.json();
      const isArea = (r: any) => r.geojson && (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon');
      const hit =
        arr.find((r) => isArea(r) && /neighbourhood|suburb|quarter|city_district|residential|hamlet/.test(r.addresstype || r.type || '')) ||
        arr.find((r) => isArea(r));
      return hit ? geojsonToRing(hit.geojson) : null;
    }
  } catch {}
  return null;
}

/**
 * The real neighborhood outline + authoritative name. In NYC: the fine
 * Pediacities neighborhood (small, single hood). Elsewhere: OSM by name.
 * Returns null where neither has a shape, so we draw nothing rather than a fake
 * box. Cached per tile, including the "none" answer.
 */
export async function neighborhoodBoundary(
  lat: number,
  lon: number,
  name: string,
  city: string
): Promise<BoundaryResult> {
  const key = BCACHE_PREFIX + tileId(lat, lon);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { poly, source, name: cName, ts } = JSON.parse(raw);
      if (Date.now() - ts < TTL_MS) return { poly, source, name: cName || '' };
    }
  } catch {}

  let poly: [number, number][] | null = null;
  let source: BoundaryResult['source'] = 'none';
  let outName = '';
  if (inNYC(lat, lon)) {
    const fine = await nycFineNeighborhood(lat, lon);
    if (fine?.poly) {
      poly = fine.poly;
      source = 'nyc';
      outName = fine.name;
    }
  }
  if (!poly) {
    poly = await osmBoundaryByName(name, city);
    if (poly) source = 'osm';
  }

  try {
    await AsyncStorage.setItem(key, JSON.stringify({ poly, source, name: outName, ts: Date.now() }));
  } catch {}
  return { poly, source, name: outName };
}

// ---------- neighborhood OUTLINES layer (tap to focus) ----------

export interface HoodShape {
  name: string;
  ring: [number, number][]; // [lat,lon], simplified for drawing/hit-testing
}

function ringBBox(ring: [number, number][]): [number, number, number, number] {
  let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
  for (const [la, lo] of ring) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  return [minLat, minLon, maxLat, maxLon];
}

/** Thin a dense ring so we can ship/hit-test many polygons cheaply. */
function decimate(ring: [number, number][], max = 160): [number, number][] {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Every neighborhood whose shape intersects the current map view. */
export async function getNycHoodsInBounds(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number
): Promise<HoodShape[]> {
  const features = await loadNycHoods();
  const out: HoodShape[] = [];
  for (const f of features) {
    const ring = geojsonToRing(f.geometry);
    if (!ring) continue;
    const [a, b, c, d] = ringBBox(ring);
    if (c < minLat || a > maxLat || d < minLon || b > maxLon) continue; // no bbox overlap
    const p = f.properties || {};
    const name = p.neighborhood || p.name || p.ntaname || '';
    if (name) out.push({ name, ring: decimate(ring) });
  }
  return out;
}

/** % of segments inside a polygon that are fresh (cleaned ≤5d) — a hood's score. */
export function polygonStats(
  ring: [number, number][],
  segments: { coords: [number, number][]; daysOld: number | null }[]
): { total: number; fresh: number; freshPct: number; toGo: number } {
  let total = 0;
  let fresh = 0;
  for (const s of segments) {
    const c = s.coords;
    if (!c.length) continue;
    const m = c[Math.floor(c.length / 2)];
    if (pointInPolygon(m[0], m[1], ring)) {
      total++;
      if (s.daysOld !== null && s.daysOld <= 5) fresh++;
    }
  }
  return { total, fresh, freshPct: total > 0 ? Math.round((fresh / total) * 100) : 0, toGo: Math.max(0, total - fresh) };
}

/** The neighborhood (name + ring) containing a point — for auto-activating the
 *  level you're standing in when you start a cleanup. NYC only; null elsewhere. */
export async function hoodContaining(lat: number, lon: number): Promise<HoodShape | null> {
  if (!inNYC(lat, lon)) return null;
  const fine = await nycFineNeighborhood(lat, lon);
  if (fine?.poly && fine.name) return { name: fine.name, ring: fine.poly };
  return null;
}
