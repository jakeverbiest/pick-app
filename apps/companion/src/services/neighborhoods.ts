import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { tileId, pointInPolygon } from './streetSegments';
import { app } from './firebaseConfig';
// OSM administrative-boundary fetch/stitch pipeline lives under
// functions/shared/ now, not here — a single implementation the Cloud
// Functions precache-refresh job also imports, instead of a second copy
// that could drift from this one. See
// functions/shared/overpassClient.js's doc comment for why that directory
// (not src/) and how this cross-boundary import resolves in Metro.
import { ringBBox, osmCellKey, fetchOsmBoundariesInBox, OSM_CELL_DEG } from '../../functions/shared/boundaryGeometry';

const db = getFirestore(app);
const PRECACHE_BOUNDARIES_COLLECTION = 'precache_boundaries';
// 2x the weekly refresh cadence (OVERPASS_PRECACHE_SPEC.md §5 decision 4).
const PRECACHE_STALENESS_MS = 14 * 24 * 60 * 60 * 1000;

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
  {
    id: 'sf',
    // San Francisco proper. Held tight to the data's own extent (37.708-37.832,
    // -122.515 to -122.357) so the box doesn't claim Daly City or Brisbane —
    // down there we'd have no polygon AND, because hasNeighborhoods() would be
    // true, no OSM fallback either, so the map would draw nothing at all.
    inBox: (lat, lon) => lat >= 37.7 && lat <= 37.84 && lon >= -122.52 && lon <= -122.35,
    // DataSF "SF Find Neighborhoods" — 117 fine hoods (Cole Valley != Haight
    // Ashbury, Inner != Outer Richmond, Duboce Triangle and Dogpatch as their
    // own shapes): the true analog of NYC's Pediacities set. NOT the 41
    // "Analysis Neighborhoods" (p5b7-5n3h), which are as coarse as the merged
    // NTAs already rejected for NYC.
    //
    // The resource id is gfpk-269f. The id you will find first — pty2-tcw4,
    // linked from the dataset's own landing page and every search result — is
    // a dead husk left by the Nov 2023 reformat: it returns the right NUMBER
    // of features with "geometry":null and empty properties, so it fails
    // silently and reads like a network fault. That trap is almost certainly
    // what "Socrata .geojson returns empty" meant during the NYC work too.
    //
    // No server-side simplification here, unlike Atlanta. Measured 24 Aug 2026:
    // the full-resolution payload is 287KB for all 117 hoods (~55 vertices
    // each — these are generalized shapes to begin with), comfortably inside
    // decimate()'s 160-point drawing budget and a fifth of NYC's ~1.5MB. If
    // that ever stops being true, SoQL's
    // simplify_preserve_topology(the_geom, 0.0003) works on this endpoint and
    // takes it to 81KB, but it costs real corner detail at this vertex count.
    url: 'https://data.sfgov.org/resource/gfpk-269f.geojson?$limit=500',
    file: FileSystem.documentDirectory + 'sf-hoods.json',
    nameKeys: ['name'],
    // Measured against real CARTO light_all tiles, not assumed: at z13-z15 over
    // central SF the basemap prints "SAN FRANCISCO" and "MISSION DISTRICT" and
    // nothing else — no Castro, Haight Ashbury, Noe Valley, Hayes Valley. SF
    // hoods are effectively unlabeled by the tiles, so we draw our own the way
    // Atlanta does. (This is the opposite of NYC — do not copy NYC's `true`.)
    basemapLabels: false,
  },
];

/** True when we should draw our own neighborhood name labels because the
 *  basemap doesn't print them for the city at this point (e.g. Atlanta). */
export function hoodLabelsNeeded(lat: number, lon: number): boolean {
  const c = cityForPoint(lat, lon);
  return !!c && !c.basemapLabels;
}

/** True when this location has real neighborhood polygons to play with. When
 *  false (small towns, undefined neighborhoods), the app falls back to a broad
 *  "your area" radius level instead. */
export function hasNeighborhoods(lat: number, lon: number): boolean {
  return cityForPoint(lat, lon) !== null;
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

// ---------- OSM administrative-boundary fallback (any city, no registry) ----------
//
// CITY_SOURCES above only covers NYC and Atlanta — every other city (London,
// etc.) falls through to a generic "Your area" circle with no real name or
// shape. OSM has administrative boundary relations for most cities
// worldwide, queryable through the same Overpass mirrors already used for
// street geometry. This is purely additive — NYC and Atlanta keep using
// their higher-quality curated sources untouched; this only fires where
// `hasNeighborhoods()` is false.
//
// Field-tested 2026-08-12 against real cities, not just a validation query:
// admin_level is NOT a consistent "neighborhood" tier worldwide — in most
// countries level 8 literally means "the city itself" (Miami's admin_level-8
// relation IS the whole city; nothing finer exists as a boundary=administrative
// relation there at all). In others (the UK, some of Europe) level 8 is a
// sub-city district — London's boroughs. Same query, structurally different
// meaning depending on the city. Querying multiple levels (8/9/10) didn't
// fix this — it just made the query 3x heavier for no reliability gain, and
// still couldn't tell "this is a real subdivision" from "this is just the
// city" after the fact.
//
// Fix: whatever comes back from the query is shown as-is — a real city
// border (even a single shape) is strictly better than the generic unnamed
// circle, so there's no rejection gate anymore. `hasFineSubdivision` below
// just distinguishes "these are real neighborhoods" from "this is one
// shape, the city itself" for logging — both cases render, neither falls
// back to a circle (the circle concept was removed from map.tsx entirely).
// Verified live 2026-08-13 against real cities on four continents — the
// "city district" tier lives at a DIFFERENT admin_level per country, no
// single fixed level covers it: Australia = 6 (Sydney's council areas),
// Japan = 7 (Tokyo's 23 wards), France/most of Europe = 8 (Paris + its
// communes), Germany = 9 (Berlin's boroughs — Mitte, Kreuzberg, etc.).
// Widening to include level 9 also required MAX_SHAPE_DIAGONAL_KM below:
// without a size filter, widening past level 8 pulled in county/region-
// scale relations (France's départements, ~28-32km, vs. Paris itself at
// 20.4km) as if they were peers of real city districts. This is inherently
// a long tail across ~200 countries' differing conventions and will never
// be perfectly complete via a fixed level range — that's expected, not a
// bug to keep chasing. Safe to widen further later since nothing gets
// rejected based on level itself anymore (see MIN_SUBDIVISION_SHAPES
// below) — the size cap is what keeps further widening safe.
// OSM_ADMIN_LEVELS, OSM_CELL_DEG, and the fetch/stitch pipeline below are
// imported from functions/shared/boundaryGeometry (see top of file) — the
// exact same functions the precache refresh job uses, so a cache doc it
// writes is byte-for-byte what a live client fetch would have produced.
const OSM_BCACHE_PREFIX = FileSystem.documentDirectory + 'osmhoods-';
// Informational only, not a rejection gate — see OsmCellResult.hasFineSubdivision.
// Earlier versions of this file used these to REJECT single-shape ("this is
// just the city") results and fall back to a generic circle. That was wrong:
// a real city border is strictly better than an unnamed circle, so it's
// always shown now. Kept only to distinguish "these are real neighborhoods"
// (several distinct named shapes) from "this is one shape — the city
// itself" for logging/future UI use, not to hide the latter.
const MIN_SUBDIVISION_SHAPES = 3;
const MAX_DOMINANT_AREA_FRACTION = 0.7;

interface OsmBoundaryFeature {
  id: number;
  name: string;
  ring: [number, number][];
}

// samePoint/stitchOuterWays/ringDiagonalKm/MAX_SHAPE_DIAGONAL_KM/
// fetchOsmBoundariesInBox/osmCellKey are all imported from
// functions/shared/boundaryGeometry (see top of file).

const osmHoodsCache: Record<string, OsmCellResult> = {};
const osmHoodsInflight: Record<string, Promise<OsmCellResult> | null> = {};

interface OsmCellResult {
  features: OsmBoundaryFeature[];
  // Informational, not a rejection gate (see the note above OSM_ADMIN_LEVEL).
  // Computed once per cell against the cell's own fixed ~20km bounds, not
  // the current map viewport — a borough-scale city like London won't
  // always have 3+ shapes in a normal zoomed-in view, so this has to be a
  // fact about the city, not about how the user happens to be looking at it.
  hasFineSubdivision: boolean;
}

/** Rough (lat/lon-degree, not geodesic) overlap of a ring's bbox against a
 *  reference bbox — cheap enough to run per-shape, good enough to tell "this
 *  shape roughly IS the reference area" from "this is one piece within it." */
function bboxOverlapFraction(
  ring: [number, number][], minLat: number, minLon: number, maxLat: number, maxLon: number
): number {
  const [a, b, c, d] = ringBBox(ring);
  const ixLat = Math.max(0, Math.min(c, maxLat) - Math.max(a, minLat));
  const ixLon = Math.max(0, Math.min(d, maxLon) - Math.max(b, minLon));
  const refArea = Math.max(1e-9, (maxLat - minLat) * (maxLon - minLon));
  return (ixLat * ixLon) / refArea;
}

/** Read the precache doc for an OSM_CELL_DEG cell. Returns null (a cache
 *  miss) on: no doc, an empty/missing features array, a doc past the
 *  staleness ceiling, or any Firestore read error — the last case fails
 *  OPEN by design (OVERPASS_PRECACHE_SPEC.md §3): a permission problem or a
 *  transient Firestore outage must never surface as a distinct error, it
 *  just falls through to exactly today's live-Overpass path. */
async function getPrecachedBoundaryFeatures(cell: string): Promise<OsmBoundaryFeature[] | null> {
  try {
    const snap = await getDoc(doc(db, PRECACHE_BOUNDARIES_COLLECTION, cell));
    if (!snap.exists()) return null;
    const data = snap.data() as any;
    const refreshedAt = typeof data?.refreshedAt === 'number' ? data.refreshedAt : 0;
    if (Date.now() - refreshedAt > PRECACHE_STALENESS_MS) return null;
    const features = data?.features;
    if (!Array.isArray(features) || features.length === 0) return null;
    return features as OsmBoundaryFeature[];
  } catch (e) {
    console.warn(`🗺️ Precache read failed for boundary cell — falling through to live Overpass: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/** Boundaries for the metro-scale cell containing a point — fetched once per
 *  cell, cached to disk indefinitely (boundaries don't change), same pattern
 *  as loadHoods()'s per-city GeoJSON cache but keyed by area since there's no
 *  fixed city list here. */
async function loadOsmHoodsForCell(lat: number, lon: number): Promise<OsmCellResult> {
  const cell = osmCellKey(lat, lon);
  // Explicit key check, not truthy — an empty array `[]` (a cell with
  // genuinely zero boundaries) is truthy in JS, so a plain `if
  // (osmHoodsCache[cell])` check couldn't tell "confirmed empty" apart from
  // "never successfully fetched." That silently turned any transient
  // Overpass failure (timeout, rate limit, a flaky mirror) into a permanent
  // per-session blackout for that cell, with zero retry and no visible
  // error — confirmed live 2026-08-12 (hit both a 429 and a 504 testing the
  // real production query against two different Overpass mirrors).
  if (cell in osmHoodsCache) return osmHoodsCache[cell];
  if (osmHoodsInflight[cell]) return osmHoodsInflight[cell]!;
  const file = `${OSM_BCACHE_PREFIX}${cell}.json`;
  const cellLat0 = Math.floor(lat / OSM_CELL_DEG) * OSM_CELL_DEG;
  const cellLon0 = Math.floor(lon / OSM_CELL_DEG) * OSM_CELL_DEG;
  const cellMaxLat = cellLat0 + OSM_CELL_DEG;
  const cellMaxLon = cellLon0 + OSM_CELL_DEG;

  const classify = (features: OsmBoundaryFeature[]): OsmCellResult => {
    const hasDominantShape = features.some(
      (f) => bboxOverlapFraction(f.ring, cellLat0, cellLon0, cellMaxLat, cellMaxLon) >= MAX_DOMINANT_AREA_FRACTION
    );
    return { features, hasFineSubdivision: features.length >= MIN_SUBDIVISION_SHAPES && !hasDominantShape };
  };

  osmHoodsInflight[cell] = (async () => {
    try {
      const raw = await FileSystem.readAsStringAsync(file);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const result = classify(parsed);
        osmHoodsCache[cell] = result;
        return result;
      }
    } catch {} // no file yet — first visit to this cell
    try {
      // Server-side precache check (OVERPASS_PRECACHE_SPEC.md) — a pure
      // fast-path in front of the live Overpass call. A miss (no doc, stale,
      // or a Firestore read error) falls through to fetchOsmBoundariesInBox
      // unchanged, same as if the precache didn't exist.
      const precached = await getPrecachedBoundaryFeatures(cell);
      const features = precached ?? (await fetchOsmBoundariesInBox(cellLat0, cellLon0, cellMaxLat, cellMaxLon));
      if (precached) {
        console.log(`🗺️ Served OSM cell ${cell} from precache: ${features.length} boundaries`);
      }
      // Only cache on a SUCCESSFUL query, even if it legitimately found
      // nothing — a thrown error (network, timeout, bad mirror) falls
      // through without caching, so the next visit to this cell retries
      // instead of staying blacked out for the rest of the session.
      const result = classify(features);
      osmHoodsCache[cell] = result;
      if (features.length) FileSystem.writeAsStringAsync(file, JSON.stringify(features)).catch(() => {});
      if (!precached) {
        console.log(
          `🗺️ OSM cell ${cell}: ${features.length} boundaries, hasFineSubdivision=${result.hasFineSubdivision}`
        );
      }
      return result;
    } catch (e) {
      console.warn(`🗺️ OSM boundary fetch failed for cell ${cell} — will retry next visit: ${(e as Error)?.message ?? e}`);
      return { features: [], hasFineSubdivision: false };
    }
  })();
  try {
    return await osmHoodsInflight[cell]!;
  } finally {
    osmHoodsInflight[cell] = null;
  }
}

/** Same shape/contract as getHoodsInBounds, but for the OSM fallback path —
 *  only meaningful to call where hasNeighborhoods() is false (outside
 *  NYC/Atlanta), since those cities' curated sources are always preferred.
 *  Returns whatever real OSM boundaries exist in view, whether that's
 *  several real neighborhoods/boroughs or just one shape (the city's own
 *  border) — a real named border always beats the generic "Your area"
 *  circle, so nothing here gets rejected/hidden. The caller falls back to
 *  the circle only when this returns genuinely empty (OSM has nothing at
 *  all for the area), not as a "this doesn't look fine-grained enough"
 *  judgment call. */
/** Firestore-safe, readable id per city name — mirrors functions/index.js's
 *  citySlug() so the client-side AsyncStorage ack key and the callable's
 *  city_requests/{slug} doc id agree on the same slug for the same city. */
export function citySlug(city: string): string {
  return (
    String(city).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
  );
}

/** Gate for the "request my city" card: true only for the genuine "OSM gave
 *  us one shape — the city itself, no real subdivision" case. False when
 *  nothing came back at all (empty hoods — a different, "we have nothing"
 *  case that isn't what this card is for) and false when real fine
 *  districts came back (hasFineSubdivision true — nothing to request). */
export function isFallbackCityWithNoSubdivision(hoodCount: number, hasFineSubdivision: boolean): boolean {
  return hoodCount > 0 && !hasFineSubdivision;
}

export interface OsmHoodsInBoundsResult {
  hoods: HoodShape[];
  // Surfaced from OsmCellResult so callers (map.tsx) can tell "this cell is
  // genuinely one shape — the city itself, no real subdivision" apart from
  // "real fine districts exist here" or "nothing came back at all" (the
  // latter is just an empty `hoods` array). Computed once per ~20km cell —
  // see the note above OsmCellResult.
  hasFineSubdivision: boolean;
}

export async function getOsmHoodsInBounds(
  minLat: number, minLon: number, maxLat: number, maxLon: number
): Promise<OsmHoodsInBoundsResult> {
  const { features, hasFineSubdivision } = await loadOsmHoodsForCell((minLat + maxLat) / 2, (minLon + maxLon) / 2);
  const hoods: HoodShape[] = [];
  for (const f of features) {
    const [a, b, c, d] = ringBBox(f.ring);
    if (c < minLat || a > maxLat || d < minLon || b > maxLon) continue; // no bbox overlap with current view
    hoods.push({ name: f.name, ring: decimate(f.ring) });
  }
  return { hoods, hasFineSubdivision };
}

// ---------- neighborhood OUTLINES layer (tap to focus) ----------

export interface HoodShape {
  name: string;
  ring: [number, number][]; // [lat,lon], simplified for drawing/hit-testing
}

// ringBBox is imported from functions/shared/boundaryGeometry (see top of
// file) — used above by bboxOverlapFraction and below by getHoodsInBounds/
// getOsmHoodsInBounds's viewport-intersection checks.

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
