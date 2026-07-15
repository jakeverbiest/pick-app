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
  source: 'city' | 'osm' | 'none';
  name: string; // authoritative neighborhood name when the shape carries one (registered city)
}

// ---------- city registry: per-city fine-neighborhood sources ----------
//
// Each city plugs in a bounding box (a cheap gate before we attempt its
// source), a GeoJSON URL, a disk-cache filename, and the property keys that
// carry the neighborhood NAME. Everything below this list is city-agnostic:
// add a city here and it gets the same outline layer, tap-to-activate levels,
// boundary lookup, and point containment that NYC has.
interface CitySource {
  id: string;
  inBox: (lat: number, lon: number) => boolean;
  url: string;
  file: string;
  nameKeys: string[]; // property keys to try, most-authoritative first
  // Does the CARTO basemap already print neighborhood names here? NYC's hoods
  // are labeled by the tiles, so we don't double them up; Atlanta's are not, so
  // we draw our own soft labels to match.
  basemapLabels: boolean;
}

const CITY_SOURCES: CitySource[] = [
  {
    id: 'nyc',
    // NYC bounding box.
    inBox: (lat, lon) => lat >= 40.49 && lat <= 40.92 && lon >= -74.27 && lon <= -73.68,
    // Fine neighborhoods (Pediacities, ~310 hoods — Carroll Gardens ≠ Cobble
    // Hill, unlike the merged NTAs).
    url: 'https://raw.githubusercontent.com/HodgesWardElliott/custom-nyc-neighborhoods/master/custom-pedia-cities-nyc-Mar2018.geojson',
    file: FileSystem.documentDirectory + 'nyc-hoods.json',
    nameKeys: ['neighborhood', 'name', 'ntaname', 'NTAName'],
    basemapLabels: true, // CARTO prints NYC hood names already
  },
  {
    id: 'atl',
    // Atlanta bounding box (city proper, padded).
    inBox: (lat, lon) => lat >= 33.6 && lat <= 33.93 && lon >= -84.62 && lon <= -84.24,
    // The City of Atlanta's 248 official neighborhoods — fine-grained, the true
    // analog to NYC's Pediacities hoods (not the coarser NSA groupings).
    // Queried live from the city GIS as GeoJSON; all 248 fit in one request.
    // maxAllowableOffset simplifies the polygons server-side (~30m tolerance):
    // without it, exporting full-resolution rings for all 248 hoods takes 3min+
    // and the layer never loads on device. At neighborhood scale the
    // simplification is invisible (and we decimate rings again on our side).
    url: 'https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/GeopoliticalArea/MapServer/1/query?where=GEOTYPE%3D%27Neighborhood%27&outFields=NAME&outSR=4326&maxAllowableOffset=0.0003&f=geojson',
    file: FileSystem.documentDirectory + 'atl-hoods.json',
    nameKeys: ['NAME', 'name'],
    basemapLabels: false, // CARTO doesn't label Atlanta hoods — we draw them
  },
];

/** True when we should draw our own neighborhood name labels because the
 *  basemap doesn't print them for the city at this point (e.g. Atlanta). */
export function hoodLabelsNeeded(lat: number, lon: number): boolean {
  const c = cityForPoint(lat, lon);
  return !!c && !c.basemapLabels;
}

/** The city whose bounding box contains the point, if any. */
function cityForPoint(lat: number, lon: number): CitySource | null {
  return CITY_SOURCES.find((c) => c.inBox(lat, lon)) ?? null;
}

/** First non-empty NAME property, trying the city's keys in priority order. */
function hoodName(props: any, keys: string[]): string {
  const p = props || {};
  for (const k of keys) if (p[k]) return String(p[k]);
  return '';
}

// Per-city in-memory + inflight caches. The GeoJSON is fetched at most once per
// install — persisted to a plain file (too big for AsyncStorage), then held in
// memory for the session and matched client-side with point-in-polygon. The
// ~1.5MB download was a visible chunk of every cold start, and all of the first.
const hoodsCache: Record<string, any[]> = {};
const hoodsInflight: Record<string, Promise<any[]> | null> = {};

async function loadHoods(city: CitySource): Promise<any[]> {
  if (hoodsCache[city.id]) return hoodsCache[city.id];
  // Coalesce concurrent callers (outline layer + a hood tap) into one load.
  if (hoodsInflight[city.id]) return hoodsInflight[city.id]!;
  hoodsInflight[city.id] = (async () => {
    try {
      const raw = await FileSystem.readAsStringAsync(city.file);
      const features = JSON.parse(raw);
      if (Array.isArray(features) && features.length) {
        hoodsCache[city.id] = features;
        return features;
      }
    } catch {} // no file yet — first run
    try {
      const res = await fetch(city.url, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const fc: any = await res.json();
        const features = fc?.features ?? [];
        if (features.length) {
          hoodsCache[city.id] = features;
          FileSystem.writeAsStringAsync(city.file, JSON.stringify(features)).catch(() => {});
        }
        return features;
      }
    } catch {}
    return [];
  })();
  try {
    return await hoodsInflight[city.id]!;
  } finally {
    hoodsInflight[city.id] = null;
  }
}

/** Fire-and-forget warm-up for the city at a location — call once we know
 *  roughly where the user is (e.g. a cached fix at launch) so the map's hood
 *  outlines and first tap don't wait on the GeoJSON download. Downloads ONLY
 *  the city the point falls in, and nothing when it's outside every registered
 *  city, so a user never pulls a city's data they aren't in. */
export function prefetchHoodsNear(lat: number, lon: number): void {
  const city = cityForPoint(lat, lon);
  if (city) void loadHoods(city);
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

/** The fine neighborhood (name + ring) containing a point, from whichever
 *  city's registered source covers it. Null outside every registered city. */
async function fineNeighborhood(
  lat: number,
  lon: number
): Promise<{ name: string; poly: [number, number][] } | null> {
  const city = cityForPoint(lat, lon);
  if (!city) return null;
  const features = await loadHoods(city);
  for (const f of features) {
    if (geomContains(f.geometry, lat, lon)) {
      const ring = geojsonToRing(f.geometry);
      if (ring) return { name: hoodName(f.properties, city.nameKeys), poly: ring };
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
 * The real neighborhood outline + authoritative name. In a registered city
 * (NYC, Atlanta): the fine official neighborhood (small, single hood).
 * Elsewhere: OSM by name. Returns null where neither has a shape, so we draw
 * nothing rather than a fake box. Cached per tile, including the "none" answer.
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
  const fine = await fineNeighborhood(lat, lon);
  if (fine?.poly) {
    poly = fine.poly;
    source = 'city';
    outName = fine.name;
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

/** Every neighborhood whose shape intersects the current map view. Uses the
 *  registered source for whichever city the view is centered on (NYC, Atlanta);
 *  returns [] when the view isn't over a registered city. */
export async function getHoodsInBounds(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number
): Promise<HoodShape[]> {
  const city = cityForPoint((minLat + maxLat) / 2, (minLon + maxLon) / 2);
  if (!city) return [];
  const features = await loadHoods(city);
  const out: HoodShape[] = [];
  for (const f of features) {
    const ring = geojsonToRing(f.geometry);
    if (!ring) continue;
    const [a, b, c, d] = ringBBox(ring);
    if (c < minLat || a > maxLat || d < minLon || b > maxLon) continue; // no bbox overlap
    const name = hoodName(f.properties, city.nameKeys);
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
 *  level you're standing in when you start a cleanup. Works in any registered
 *  city (NYC, Atlanta); null elsewhere. */
export async function hoodContaining(lat: number, lon: number): Promise<HoodShape | null> {
  const fine = await fineNeighborhood(lat, lon);
  if (fine?.poly && fine.name) return { name: fine.name, ring: fine.poly };
  return null;
}
