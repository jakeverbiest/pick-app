# San Francisco neighborhood boundaries

Status: **entry written into the working tree, unpublished and uncommitted.** Typechecks clean.
Needs one Metro session on a real device before it goes anywhere.
Written 24 Aug 2026. Related: `NEIGHBORHOOD_COMPLETION_SPEC.md` §3 / build-order item 4.
Code: `apps/companion/src/services/neighborhoods.ts`.

## TL;DR

SF is registered as the third city in `CITY_SOURCES` — a 37-line purely additive diff, no other
file touched. Source is DataSF **"SF Find Neighborhoods", resource id `gfpk-269f`**: 117 fine
neighborhoods, full-resolution payload **287 KB**, and — measured, not assumed — **no
meaningful polygon overlap and no interior gaps**. The one recommendation that changed under
measurement is `basemapLabels`, which is `false`, not `true`.

---

## 1. What SF gets without this

Unregistered, `hasNeighborhoods()` is false and `map.tsx:522` routes to the generic OSM
admin-boundary fallback. In the US, `admin_level` 6–8 for SF resolves to the consolidated
city-and-county — so the tappable "neighborhood" is **the entire City of San Francisco**,
with Daly City, Brisbane and South SF alongside it as peer shapes from the same 0.2° cell.

An uncompletable level. That's the whole argument for registering SF.

(The Farallon Islands worry from the first draft is moot for the DataSF path — the dataset's
own extent stops at -122.5149, no Farallones. It remains a live concern only for the OSM
fallback, which is now bypassed inside the bbox.)

## 2. Source: DataSF `gfpk-269f`

| Source | Count | Verdict |
|---|---|---|
| **SF Find Neighborhoods** — `gfpk-269f` | **117** | ✅ Chosen. |
| Analysis Neighborhoods — `p5b7-5n3h` | 41 | ❌ As coarse as the merged NTAs already rejected for NYC. |
| Realtor / Planning neighborhoods | ~37–39 | ❌ Same coarseness. |
| `blackmad/neighborhoods` SF (Zillow, GitHub raw) | ~100 | ⚠️ 2013 snapshot, no maintainer. Fallback only. |
| OSM `place=neighbourhood` | — | ❌ Label points, not polygons. |

Granularity is right: Cole Valley ≠ Haight Ashbury, Inner ≠ Outer Richmond, and Dogpatch,
Duboce Triangle, Mission Dolores, Polk Gulch, Lower Nob Hill, Showplace Square all stand as
their own shapes. Largest is Golden Gate Park at 5.4 km bbox diagonal; largest residential is
Outer Sunset at 4.4 km. No duplicate names across the 117.

### ⚠️ The dead-id trap

**`pty2-tcw4` is a husk.** It's the id on the dataset's own landing page and every top search
result. Post the Nov-2023 reformat it returns the right *number* of features with
`"geometry":null` and `"properties":{}` (and `[{},{}]` from `.json`) — so it fails silently
and reads like a network fault.

**The live id is `gfpk-269f`.** This is very likely what "NYC Open Data Socrata `.geojson`
endpoints returned empty" actually was during the NYC work — a migrated id, not a Socrata
limitation. Worth re-testing NYC against its current id sometime; the Pediacities GitHub file
works, so there's no urgency, just a wrong belief on the record.

### Payload — the first draft's estimate was wrong by ~7×

Measured against the live endpoint:

| | bytes | vertices |
|---|---|---|
| Full resolution, all 117 | **287 KB** | ~55/hood avg, 240 max |
| `simplify_preserve_topology(…, 0.0003)` | 81 KB | 15/hood avg, 71 max |

I'd guessed 2 MB+ by extrapolating from NYC's coordinate precision. Wrong premise: SF Find
polygons are *already* generalized hand-drawn shapes, ~55 vertices each, not survey-grade
outlines. 287 KB is a fifth of NYC's ~1.5 MB and sits inside `decimate()`'s own 160-point
drawing budget, so **no simplification is used** — Atlanta's `maxAllowableOffset` problem
simply doesn't arise here. The SoQL simplify call works and is noted in the code as the escape
hatch, but at 15 vertices/hood it visibly eats corners, so it's a last resort, not the default.

## 3. The overlap question — answered with data

This was the flagged risk: SF Find describes itself as "general location definitions… not
strictly defined demarcation lines," and `fineNeighborhood()` returns the **first** containing
feature, so genuine overlaps would make your neighborhood depend on file order.

I swept a **~100 m grid over the whole city — 22,800 points** — running the app's own
`pointInPolygon` / `geomContains` against full-resolution geometry.

| Result | Points | Share |
|---|---|---|
| Exactly one neighborhood | 12,188 | — |
| **Two or more (overlap)** | **2** | **0.01 %** |
| No neighborhood (ocean, bay, outside city) | 10,610 | — |

The two overlaps are `Apparel City ∩ Produce Market` and `Inner Sunset ∩ Outer Sunset` — one
grid point each, i.e. a sample landing exactly on a shared edge. **There is no real overlap in
this dataset.** The risk is closed.

**Gaps**, by flood-filling the uncovered cells from the map border (anything unreachable from
outside is an interior hole rather than water): **14 hole cells** across 13 clusters, every one
1–2 cells (~1 ha), all on the Bayview/Hunters Point shoreline. Shared-edge seams at grid
resolution, not real gaps — 0.1 % of covered area.

**Coverage sanity check:** 12,190 covered cells × ~0.01 km² ≈ **122 km²** against SF's actual
land area of 121.4 km². The dataset tiles the city completely.

Also confirmed: **all 117 features are single-part MultiPolygons**, so `geojsonToRing()`'s
"largest ring wins" rule discards nothing — no hood loses a detached piece.

## 4. `basemapLabels: false` — this one flipped

The first draft guessed `true` (matching NYC) on the assumption CARTO labels SF neighborhoods.
I pulled the real `light_all` tiles and looked:

- **z13, whole city** — one label: `SAN FRANCISCO`.
- **z14, central SF** — `RICHMOND DISTRICT`, plus street and park names. No Mission, no Castro,
  no Haight, no Hayes Valley, no Noe Valley.
- **z15, Mission/Castro** — one label: `MISSION DISTRICT`.

SF is effectively unlabeled at neighborhood level by this basemap — nothing like NYC. So SF
draws its own labels, the way Atlanta does. Had this shipped as `true`, the SF overview would
have been 117 anonymous shapes.

## 5. The change

Appended to `CITY_SOURCES`; everything below that list is already city-agnostic, so SF inherits
the outline layer, tap-to-activate levels, the spotlight mask, `hoodContaining`, `polygonStats`
and the disk cache untouched.

```ts
{
  id: 'sf',
  inBox: (lat, lon) => lat >= 37.7 && lat <= 37.84 && lon >= -122.52 && lon <= -122.35,
  url: 'https://data.sfgov.org/resource/gfpk-269f.geojson?$limit=500',
  file: FileSystem.documentDirectory + 'sf-hoods.json',
  nameKeys: ['name'],
  basemapLabels: false,
}
```

(The committed version carries the full reasoning as comments — the dead-id trap, the payload
measurement, and the CARTO evidence — so the next person doesn't re-derive them.)

The bbox is held tight to the data's own extent rather than padded. **This matters:** inside
the bbox `hasNeighborhoods()` is true, which permanently disables the OSM fallback, so anywhere
inside the box but outside the polygons draws *nothing at all* (`map.tsx:545` returns early on
an empty list). A padded box would have handed Daly City and Brisbane a blank map. NYC and
Atlanta have the same latent sharp edge in their bboxes — worth a look at some point, out of
scope here.

**Verification run:** `npx tsc --noEmit` clean. `test:tiles` 12/12, `test:impact`, `test:recap`
all pass. `test:hoods` fails to *transform* — `npx -y tsx` now pulls a tsx that chokes on
`react-native/index.js`'s Flow syntax. Pre-existing environment drift, not this change: the
import block is byte-identical to HEAD, and the failure is in react-native's own file. Worth
pinning tsx in `package.json` separately.

## 6. What still needs a device

I can't drive Metro or the phone from here, so these are yours:

1. **Load the SF overview** — outlines appear, 117 shapes, own labels legible and not fighting
   the street names.
2. **Tap a small hood** (Duboce Triangle, Cole Valley) — the level frames and locks correctly at
   that size; the spotlight mask reads right on a shape this small.
3. **Tap a park** — Golden Gate Park, Presidio National Park, McLaren Park. These have almost no
   street segments, so `polygonStats` returns a tiny or zero denominator. Check what
   "0% · 0 to go" looks like before an SF tester finds it. This is the one real unknown left.
4. **Cold-start cost** — first `loadHoods('sf')` should be a ~287 KB one-time fetch, then disk.

## 7. Not addressed

Whether SF should be a launch city at all, and whether anyone is testing there — a
`LAUNCH_LEDGER.md` question, not a boundary-data one.

Longer term: NYC pulls from GitHub raw, Atlanta from a city ArcGIS server, SF now from Socrata
— three third-party runtime dependencies for data that never changes. Fetching each once and
hosting all three as static assets on `pickglobal.org` would collapse that to one dependency we
control. Its own decision, not this one.
