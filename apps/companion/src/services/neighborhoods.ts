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
  // ---- 2026-09-04 additions ----
  // Sourced against `docs/GLOBAL_CITY_EXPANSION_TARGETS.md`'s "Map coverage
  // validation" section (~/pick-app), which live-Overpass-tested this
  // project's own admin_level 6-9 range against 21 candidate cities and
  // flagged 8 with a real gap at their own city core. Each entry below
  // documents the real open-data source found (all confirmed live via a
  // direct fetch + point-in-polygon check, not just "the URL returns 200")
  // and, where relevant, why the OSM fallback specifically fails there.
  // `basemapLabels` is defaulted to `false` (draw our own labels) for all
  // eight, matching Atlanta/SF's precedent for a city CARTO doesn't already
  // print hood names for — unlike NYC's/SF's `basemapLabels` values, this
  // was NOT independently re-confirmed against real rendered CARTO tiles
  // this pass; worth a direct visual check before relying on it.
  {
    id: 'sea',
    // Seattle proper, held tight to the Neighborhood Map Atlas's own extent
    // (same reasoning as SF's box comment above: a padded box would
    // silently claim Bellevue/Kirkland/Mercer Island, which have no polygon
    // in this layer at all, and — because hasNeighborhoods() would then read
    // true for a point with no actual coverage — no OSM fallback either).
    inBox: (lat, lon) => lat >= 47.49 && lat <= 47.74 && lon >= -122.44 && lon <= -122.23,
    // OSM's admin_level 6-9 has no coverage of Seattle's own core — every
    // shape returned is a neighboring suburb (Bellevue, Kirkland, Mercer
    // Island, Shoreline...). admin_level=10 was checked specifically per the
    // validation pass's own flag (Seattle's neighborhoods are sometimes
    // tagged there): it exists, but only for 3 shapes citywide (Chinatown-
    // International District's Little Saigon/Chinatown/Japantown
    // sub-areas) — sparse, single-mapper tagging, not a systematic
    // per-neighborhood convention the way 6-9 is documented to be elsewhere
    // in this file. NOT a clean widen: unlike the already-calibrated 6-9
    // range, level 10 usage has no consistent cross-city meaning, so
    // widening OSM_ADMIN_LEVELS to include it would risk pulling in noise
    // (arbitrary sub-parcel detail some other mapper tagged at 10) rather
    // than reliably surfacing more real neighborhoods — left unwidened.
    // Real source instead: the City of Seattle's own GIS "Neighborhood Map
    // Atlas Neighborhoods" (derived from the City Clerk's Geographic
    // Indexing Atlas), served live from the City's own ArcGIS FeatureServer
    // — the same live-fetch-no-static-copy pattern as Atlanta. 94 real named
    // sub-neighborhoods, confirmed by point-in-polygon: downtown Seattle ->
    // Central Business District, Ballard -> Ballard, Capitol Hill's Broadway
    // -> Broadway; a Bellevue point correctly falls outside every shape.
    // maxAllowableOffset (~30m tolerance, same trick as Atlanta) takes the
    // payload from 1.65MB full-resolution to 59KB for all 94 shapes.
    url: 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/nma_nhoods_sub/FeatureServer/0/query?where=1%3D1&outFields=S_HOOD,L_HOOD&outSR=4326&maxAllowableOffset=0.0003&f=geojson',
    file: FileSystem.documentDirectory + 'sea-hoods.json',
    // S_HOOD is the finest sub-neighborhood name on each feature (the real
    // analog of NYC's Pediacities/Atlanta's 248/SF's 117); L_HOOD is the
    // coarser district the same shape rolls up to, tried only when S_HOOD is
    // empty on that feature.
    nameKeys: ['S_HOOD', 'L_HOOD'],
    basemapLabels: false,
  },
  {
    id: 'la',
    // LA proper, held tight to the Neighborhood Council layer's own extent
    // (same reasoning as Seattle above — Culver City/Beverly Hills/Burbank
    // etc. have no polygon in this layer).
    inBox: (lat, lon) => lat >= 33.7 && lat <= 34.34 && lon >= -118.67 && lon <= -118.15,
    // OSM's admin_level 6-9 returns only separate neighboring cities in LA's
    // query cell (Culver City, Beverly Hills, West Hollywood, Burbank,
    // Vernon, Glendale, La Cañada Flintridge) — none reach Downtown/
    // Hollywood/central LA, LA's own boundary never appears (too large for
    // MAX_SHAPE_DIAGONAL_KM and filtered). Real source: LA GeoHub's official
    // Neighborhood Councils (Certified) layer, served live from the City's
    // own ArcGIS MapServer — same city-GIS pattern as Atlanta. 99 councils,
    // confirmed by point-in-polygon: Downtown LA -> DOWNTOWN LOS ANGELES,
    // Hollywood -> CENTRAL HOLLYWOOD NC, Silver Lake -> SILVER LAKE NC.
    // maxAllowableOffset takes the payload from 2.58MB to 95KB for all 99
    // shapes.
    url: 'https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/18/query?where=1%3D1&outFields=NAME&outSR=4326&maxAllowableOffset=0.0003&f=geojson',
    file: FileSystem.documentDirectory + 'la-hoods.json',
    nameKeys: ['NAME'],
    basemapLabels: false,
  },
  {
    id: 'chi',
    // Chicago proper, held tight to the Community Areas layer's own extent.
    inBox: (lat, lon) => lat >= 41.64 && lat <= 42.03 && lon >= -87.95 && lon <= -87.52,
    // OSM's query point for central Chicago resolves to "South Chicago
    // Township" (admin_level 7) — a real shape, but a legal/tax township,
    // not a name any Chicagoan uses for their neighborhood. Real source: the
    // Chicago Data Portal's official 77 Community Areas — an unusually clean
    // fit, the actual colloquial taxonomy Chicagoans use (the Loop, Wicker
    // Park's community area is really "West Town", Rogers Park, etc).
    // TRAP, same failure mode as SF's pty2-tcw4 (see that comment above):
    // the resource id you find first, `cauq-8yn6` ("Boundaries - Community
    // Areas - Map"), is a dead husk — a Socrata "map" resource type, not a
    // "dataset" — that returns the right shape count but
    // `"geometry":null` and empty `properties` for every feature. The real,
    // usable id is `igwz-8jzy` ("Boundaries - Community Areas", type
    // "dataset"). Confirmed by point-in-polygon: the Loop -> LOOP, Wicker
    // Park -> WEST TOWN (correct — Wicker Park is a sub-area within the West
    // Town community area, not its own), and the OSM-only "South Chicago
    // Township" point -> SOUTH CHICAGO (the real community area name).
    // SoQL's simplify_preserve_topology (same trick as SF) takes the payload
    // from 2.07MB to 78KB for all 77 areas.
    url: 'https://data.cityofchicago.org/resource/igwz-8jzy.geojson?$select=community,simplify_preserve_topology(the_geom,0.0003)%20as%20the_geom&$limit=500',
    file: FileSystem.documentDirectory + 'chi-hoods.json',
    nameKeys: ['community'],
    basemapLabels: false,
  },
  {
    id: 'bos',
    // Boston proper, held tight to the BPDA layer's own extent — a padded
    // box would claim Cambridge/Somerville/Brookline, which have no polygon
    // here (confirmed: a Cambridge point correctly falls outside this box's
    // data below).
    inBox: (lat, lon) => lat >= 42.22 && lat <= 42.4 && lon >= -71.2 && lon <= -70.92,
    // OSM's admin_level 6-9 never returns Boston itself in this cell — every
    // shape is a neighboring Massachusetts municipality (Cambridge,
    // Somerville, Brookline, Newton, Everett...), either filtered by the
    // 25km size cap or a genuine OSM tagging gap (not conclusively
    // determined by the validation pass — Overpass 504'd on both mirrors on
    // the follow-up query). Real source: the Boston Planning & Development
    // Agency's official "Boston Neighborhood Boundaries" (published via
    // Analyze Boston / data.boston.gov), served live from BPDA's own ArcGIS
    // FeatureServer — same live-fetch city-GIS pattern as Atlanta/LA/
    // Seattle. Note the FeatureServer's layer id is 5, not 0 — the service
    // only exposes one layer, named "BPDA Neighborhoods". 26 official
    // neighborhoods, confirmed by point-in-polygon: Faneuil Hall -> Downtown,
    // Back Bay -> Back Bay, Jamaica Plain -> Jamaica Plain; a Cambridge
    // point correctly falls outside every shape. maxAllowableOffset takes
    // the payload from 1.32MB to 30KB for all 26 shapes.
    url: 'https://gis.bostonplans.org/hosting/rest/services/Hosted/Boston_Neighborhood_Boundaries/FeatureServer/5/query?where=1%3D1&outFields=name&outSR=4326&maxAllowableOffset=0.0003&f=geojson',
    file: FileSystem.documentDirectory + 'bos-hoods.json',
    nameKeys: ['name'],
    basemapLabels: false,
  },
  {
    id: 'sd',
    // San Diego proper, held tight to the Community Planning Areas layer's
    // own extent (a Chula Vista point correctly falls outside this box's
    // data below).
    inBox: (lat, lon) => lat >= 32.53 && lat <= 33.12 && lon >= -117.29 && lon <= -116.9,
    // Same failure mode as LA/Boston: all 6 OSM shapes in the query cell are
    // neighboring cities (Chula Vista, El Cajon, La Mesa, Lemon Grove,
    // National City, Coronado) — central San Diego itself is inside none of
    // them. Real source: the City of San Diego's own Community Planning
    // Areas layer (the layer behind the City's official "Community Planning
    // Areas" web map, published under the City's own sandiego.gov ArcGIS
    // account — SANDAG's regional portal did not turn up a matching dataset
    // under its own name; this is the City's layer, not SANDAG's, despite
    // both being name-checked as candidates in the validation pass), served
    // live from the City's own ArcGIS MapServer. 61 real planning areas,
    // confirmed by point-in-polygon: the Gaslamp Quarter -> DOWNTOWN, La
    // Jolla -> LA JOLLA, North Park -> NORTH PARK; a Chula Vista point
    // correctly falls outside every shape. maxAllowableOffset takes the
    // payload to 73KB for all 61 areas.
    url: 'https://webmaps.sandiego.gov/arcgis/rest/services/Planning/PLN_LongRangePlanning/MapServer/3/query?where=1%3D1&outFields=CPNAME&outSR=4326&maxAllowableOffset=0.0003&f=geojson',
    file: FileSystem.documentDirectory + 'sd-hoods.json',
    nameKeys: ['CPNAME'],
    basemapLabels: false,
  },
  {
    id: 'mia',
    // Miami proper, held tight to the Police Neighborhoods layer's own
    // extent (a Miami Beach point correctly falls outside this box's data
    // below — Miami Beach is its own city).
    inBox: (lat, lon) => lat >= 25.7 && lat <= 25.87 && lon >= -80.33 && lon <= -80.13,
    // Matches this file's own OSM-fallback code comment exactly: Miami's
    // admin_level-8 relation IS the whole city, no finer boundary=
    // administrative relation exists there at all. Real source found
    // 2026-09-04: the City of Miami Police Department's own "Police
    // Neighborhoods" layer (`PDNETNAME` field) — despite the name, these
    // boundaries ARE the City's official NET (Neighborhood Enhancement
    // Team) areas, real colloquial names (Wynwood, Little Havana, Little
    // Haiti, Coconut Grove, Overtown, Edgewater, Brickell/Roads...), not
    // police-jurisdiction jargon. Only 13 areas — Miami proper is genuinely
    // coarser-grained than NYC/Atlanta/SF/the other cities above; this is
    // the whole city's real breakdown, not a partial/truncated result.
    // Rejected: "Miami Neighborhoods (Zillow)", a third-party crowd-sourced
    // boundary layer with no City/County authority behind it. Confirmed by
    // point-in-polygon: Wynwood -> Wynwood, Downtown Miami -> Downtown,
    // Coconut Grove -> Coconut Grove. 126KB unsimplified for all 13 shapes —
    // small enough that server-side simplification wasn't worth adding.
    url: 'https://services1.arcgis.com/CvuPhqcTQpZPT9qY/arcgis/rest/services/Police_Neighborhoods/FeatureServer/0/query?where=1%3D1&outFields=PDNETNAME&outSR=4326&f=geojson',
    file: FileSystem.documentDirectory + 'mia-hoods.json',
    nameKeys: ['PDNETNAME'],
    basemapLabels: false,
  },
  {
    id: 'ams',
    // Amsterdam proper (city, not metro — matches Jake's own population
    // figure for this city in GLOBAL_CITY_EXPANSION_TARGETS.md), held tight
    // to the wijken layer's own extent.
    inBox: (lat, lon) => lat >= 52.27 && lat <= 52.43 && lon >= 4.72 && lon <= 5.11,
    // OSM's admin_level 6-9 never returns Amsterdam itself — all 8 shapes in
    // the query cell are neighboring Dutch municipalities (Amstelveen,
    // Diemen, Ouder-Amstel...). Real source: data.amsterdam.nl's own
    // "gebieden/wijken" (wards) API, the city's official open-data
    // platform. 110 real named wards (Jordaan, Oude Pijp/Nieuwe Pijp,
    // Grachtengordel-West, Bellamybuurt...) — deliberately NOT the finer
    // "buurten" layer on the same API (a much larger set, closer to
    // census-block granularity than a neighborhood a resident would
    // recognize — the same "too fine to be useful" problem NYC's merged-NTA
    // alternative had, just in the other direction). Confirmed by
    // point-in-polygon: Dam Square -> Burgwallen-Nieuwe Zijde, De Pijp
    // (Ferdinand Bolstraat) -> Oude Pijp, central Jordaan -> Jordaan.
    //
    // REAL BUG FOUND while adding this entry: this API strictly
    // content-negotiates and returned HTTP 406 for `_format=geojson`
    // combined with loadHoods()'s previous bare `Accept: 'application/json'`
    // header — every other registered city (old and new) tolerates that
    // header, so the bug was invisible until Amsterdam. A 406 falls into the
    // same `if (res.ok)` branch as any other failure, so this would have
    // silently produced permanent empty hoods here with no visible error,
    // not a crash. Fixed by widening the Accept header in loadHoods() below
    // to `'application/geo+json, application/json'` — confirmed live this
    // does not break NYC/Atlanta/SF or any other entry in this file.
    //
    // No maxAllowableOffset-equivalent on this REST API (it isn't ArcGIS) —
    // left unsimplified. 661KB for 110 shapes, same order of magnitude as
    // NYC's ~1.5MB unsimplified set.
    url: 'https://api.data.amsterdam.nl/v1/gebieden/wijken/?_format=geojson&_pageSize=200',
    file: FileSystem.documentDirectory + 'ams-hoods.json',
    nameKeys: ['naam'],
    basemapLabels: false,
  },
  {
    id: 'bri',
    // Bristol proper, held tight to the Council's own Wards layer extent.
    inBox: (lat, lon) => lat >= 51.39 && lat <= 51.55 && lon >= -2.73 && lon <= -2.5,
    // The one genuine OSM dead zone the 2026-09-04 validation pass found:
    // ALL 4 raw admin_level-6 elements in Bristol's query cell were filtered
    // out by MAX_SHAPE_DIAGONAL_KM (the 25km size cap) — nothing renders at
    // any tested level, not even a single "this is just the city" shape the
    // way Miami/Copenhagen degrade to elsewhere. Real source: Bristol City
    // Council's own GIS "Wards" layer, served live from the Council's own
    // ArcGIS server (maps2.bristol.gov.uk) — same live-fetch city-GIS
    // pattern as Atlanta/LA/Seattle/Boston/San Diego. These are political
    // ward boundaries, not a purpose-built neighbourhood layer, but
    // Bristol's 34 wards carry genuinely colloquial names (Clifton,
    // Bedminster, Cotham, Redland, Southville, Hotwells & Harbourside...) —
    // a materially better naming fit than the Toronto-electoral-riding and
    // Dublin-1986-census-geography data-quality problems the same
    // validation pass documented for those two cities. Confirmed by
    // point-in-polygon: the Clifton Suspension Bridge -> Clifton, College
    // Green (city centre) -> Central. maxAllowableOffset takes the payload
    // from 1.34MB to 29KB for all 34 wards.
    url: 'https://maps2.bristol.gov.uk/server2/rest/services/ext/ll_boundaries/MapServer/4/query?where=1%3D1&outFields=NAME&outSR=4326&maxAllowableOffset=0.0003&f=geojson',
    file: FileSystem.documentDirectory + 'bri-hoods.json',
    nameKeys: ['NAME'],
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
      // Accepts BOTH application/geo+json and application/json — NYC/Atlanta/
      // SF/every ArcGIS+Socrata source below tolerate either, but Amsterdam's
      // data.amsterdam.nl strictly content-negotiates and returns HTTP 406
      // for a bare `application/json` Accept header when `_format=geojson`
      // is requested (confirmed live 2026-09-04 while adding the `ams`
      // entry below). A 406 hits the `if (res.ok)` branch below as false, so
      // this would have silently produced permanent empty hoods for
      // Amsterdam with no visible error, not a crash — widened here so
      // every registered city, old or new, actually gets its data.
      const res = await fetch(city.url, { headers: { Accept: 'application/geo+json, application/json' } });
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

// ---------- neighborhood boundary BY NAME (challenge recap map, no point) ----------
//
// `neighborhoodBoundary` above needs a lat/lon to know which city's curated
// source (or OSM cell) to check — it's built for "the map tab is centered
// somewhere real." A challenge's `area` (challenges.ts) stores only a label
// string for `type: 'neighborhood'` ("Carroll Gardens"), no coordinates —
// the creator's location was used once, at creation time, just to name it
// (see app/challenge/new.tsx), then discarded. So a Group Recap card built
// long after creation, possibly by a participant who lives elsewhere, has no
// point to hand `neighborhoodBoundary`. `osmBoundaryByName` above already
// covers exactly this case (name-only lookup, no point required) — this is
// just a cache wrapper around it, same TTL/AsyncStorage pattern as the rest
// of this file, keyed by the label text instead of a tile id since there's
// no tile to key by.
const CCACHE_PREFIX = '@pick_challengehood_';

/** OSM boundary for a challenge's neighborhood LABEL alone — no lat/lon
 *  needed, unlike `neighborhoodBoundary`. Used by the Group Recap card for
 *  `area.type === 'neighborhood'` challenges (CHALLENGE_RECAP_SPEC.md
 *  §11.2/§11.5 phase 3). Returns null where OSM has no matching shape by
 *  name (caller falls back to the ornamental placeholder, same as
 *  'anywhere'). Cached indefinitely-ish (30d, matching TTL_MS) since a
 *  neighborhood's shape doesn't move. */
export async function challengeNeighborhoodBoundary(label: string): Promise<[number, number][] | null> {
  const trimmed = (label || '').trim();
  if (!trimmed) return null;
  const key = CCACHE_PREFIX + citySlug(trimmed);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const { poly, ts } = JSON.parse(raw);
      if (Date.now() - ts < TTL_MS) return poly;
    }
  } catch {}

  // No city hint to disambiguate ("Carroll Gardens" vs. a same-named place
  // elsewhere) — same tradeoff §11.2 accepted by reusing the label as-is.
  const poly = await osmBoundaryByName(trimmed, '');
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ poly, ts: Date.now() }));
  } catch {}
  return poly;
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

/** Rebuild [lat,lon] pairs from the flat [lat,lon,lat,lon,...] form Firestore
 *  storage uses (nested arrays are rejected — see functions/index.js's
 *  flattenCoordPairs, and this file's own flattenRing-adjacent convention). */
function unflattenCoordPairs(flat: unknown): [number, number][] {
  if (!Array.isArray(flat)) return [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const la = flat[i];
    const lo = flat[i + 1];
    if (typeof la === 'number' && typeof lo === 'number') out.push([la, lo]);
  }
  return out;
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
    // Firestore rejects nested arrays, so the Cloud Function stores `ring`
    // flattened to [lat,lon,lat,lon,...] — rebuild the [number,number][] pairs
    // the rest of the app expects.
    return features.map((f: any) => ({ ...f, ring: unflattenCoordPairs(f?.ring) })) as OsmBoundaryFeature[];
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

/* Re-exported from ./hoodMetrics so existing importers (app/(tabs)/map.tsx)
 * are unaffected by the move. isFallbackCityWithNoSubdivision gates the
 * "request my city" card: true only for the genuine "OSM gave us one shape —
 * the city itself, no real subdivision" case. False when nothing came back at
 * all (a different, "we have nothing" case that isn't what this card is for)
 * and false when real fine districts came back — nothing to request. */
export { isFallbackCityWithNoSubdivision, polygonStats } from './hoodMetrics';

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

/* polygonStats now lives in ./hoodMetrics (re-exported above) — see that file
 * for why: it is pure, and this module's expo-file-system import made it
 * impossible to load under the test runner. */

/** The neighborhood (name + ring) containing a point — for auto-activating the
 *  level you're standing in when you start a cleanup. Works in any registered
 *  city (NYC, Atlanta); null elsewhere. */
export async function hoodContaining(lat: number, lon: number): Promise<HoodShape | null> {
  const fine = await fineNeighborhood(lat, lon);
  if (fine?.poly && fine.name) return { name: fine.name, ring: fine.poly };
  return null;
}
