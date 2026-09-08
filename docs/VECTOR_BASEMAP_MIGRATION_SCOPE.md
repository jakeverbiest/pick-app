# Scope — migrating the basemap from raster to vector

Status: **scoping only, nothing built, not approved.** Written 2026-09-08.

## 1. Why

CARTO is retiring the raster (PNG) basemap service and hinting they may stop updating its
cartography. The load-bearing reason for Pick specifically is **not** sharpness:

> Street geometry comes from **Overpass — live OSM**. If CARTO freezes raster data, the overlay
> keeps tracking reality while the ground underneath stops. Colored coverage lines would
> gradually sit beside roads that no longer match the picture. For an app whose premise is
> street-level coverage, that is a correctness problem, not a cosmetic one.

Two secondary reasons that are real:

- **Labels are currently being painted over.** The app uses `light_all`, which has labels baked
  into the pixels, and coverage polylines draw at weight 8–18 in panes *above* the tile layer
  (`map.tsx:3249`). The more of a neighborhood you clean, the more street names vanish under
  your own lines. Vector lets labels sit above the overlay. **This is an existing defect the
  migration fixes for free.**
- **Brand-matched ground.** Runtime restyling means the basemap can be Civic Blueprint instead
  of generic Positron gray. Every share card, org dashboard and export currently inherits a
  palette that isn't Pick's. Given `GROUP_IMPACT_MAP_SPEC.md` §1 ("the shareable output *is* the
  product"), this compounds across everything downstream.

## 2. Target

| current (raster) | vector equivalent |
|---|---|
| `basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` | `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` |
| (`dark_all`, if dark mode is ever wanted) | `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` |

API key appends as a query parameter, same as today. **The same key covers both services**, so
migration is not gated on the key request and can happen whenever.

Renderer: **MapLibre GL JS**, replacing Leaflet 1.9.4. Both load from cdnjs, both run inside the
existing WebViews. **This ships over OTA — no native build, no Apple review.**

## 3. Inventory — four maps, and the work is lopsided

| file | Leaflet surface | effort |
|---|---|---|
| `app/(tabs)/map.tsx` | 13 `featureGroup`, 10 `polyline`, 6 `circleMarker`, 4 `polygon`, 2 custom panes, `popup`, `marker`, `divIcon`, follow-cam `setView` | **~80% of the job** |
| `app/challenge/new.tsx` | 1 polygon, 1 circleMarker, `fitBounds` | trivial |
| `src/pick/AreaPreview.tsx` | 1 polygon, static (dragging + scroll disabled) | trivial |
| `src/pick/ImpactMap.tsx` | 1 polyline, 2 circleMarkers, static | small |

Three of the four are near-trivial static previews. Scope the work as "port `map.tsx`, then
three small ones follow the pattern."

Total distinct Leaflet APIs across the codebase: about ten (`polyline`, `circleMarker`,
`polygon`, `featureGroup`, `tileLayer`, `map`, `control`, `popup`, `marker`, `divIcon`,
`latLngBounds`). All have MapLibre equivalents. The paradigm differs — MapLibre wants **GeoJSON
sources plus style layers**, not one object per feature — so this is a rewrite of overlay code,
not a find-and-replace.

## 4. The parts that are genuinely different

1. **Per-segment styling becomes data-driven, and that is a performance win.** Today each street
   segment is its own `L.polyline` object with its own color/weight/opacity. In MapLibre it
   becomes **one GeoJSON source** with freshness as a feature property and a data-driven paint
   expression. Rendering thousands of segments goes from thousands of objects to one layer. This
   is the biggest efficiency gain in the migration and it was not on CARTO's list.

2. **⚠️ `dashArray` is the known gotcha.** Untouched streets render dashed (`'2 9'`), everything
   else solid. MapLibre's `line-dasharray` is a paint property that does **not** accept
   data-driven expressions the way color and width do. Expect to need **two layers filtered by
   property** — one dashed, one solid — rather than one expression. Cheap, but it will surprise
   whoever ports it if it isn't written down.

3. **Panes → layer order.** `maskPane` (z 350) and `levelPane` (z 340) become insertion order in
   MapLibre's single ordered layer array, positioned relative to a named style layer. **This is
   also the mechanism that fixes the label defect** — insert overlay layers *below* the style's
   label layers instead of above everything.

4. **The spotlight mask** is `L.polygon([WORLD_RING, ring])` — a world rectangle with the
   neighborhood punched out. MapLibre handles polygons with holes natively via GeoJSON. Direct
   port.

5. **Invisible hit polylines** (weight 18, opacity 0) exist purely as tap targets. MapLibre uses
   `queryRenderedFeatures` against the real layer instead, so these can be **deleted rather than
   ported** — a simplification, not a translation.

6. **Follow-cam** `setView` → `jumpTo`/`easeTo`. Continuous zoom replaces integer zoom snapping,
   which should visibly improve the replay export.

## 5. Build order

0. **WebGL spike first — this gates everything.** MapLibre GL requires WebGL; these are
   `WKWebView`s. It should work, but "should" is not good enough for something that renders
   every map in the app. ~20 minutes on a real device: load MapLibre with the Positron style and
   confirm it paints. **If this fails, the whole migration is off and the answer is `dark_all`/
   raster until CARTO forces the issue.**
1. Port `ImpactMap.tsx` — smallest real map, establishes the source/layer pattern.
2. Port `AreaPreview.tsx` and `challenge/new.tsx` — static polygons, near-mechanical.
3. Port `map.tsx`. Do the segment layer first (the data-driven win), then panes/mask, then
   follow-cam, then hit-testing.
4. Move overlay layers below label layers. **Verify the label defect is actually fixed** on a
   heavily-cleaned neighborhood, not an empty one.
5. Restyle to Civic Blueprint — separate, after parity. Do not mix a renderer swap with a visual
   redesign in one change.
6. Update `web/map.html` and `web/org.html` (they carry hardcoded raster URLs and their own
   Leaflet copies).

## 6. What does not change

- **Overpass, `segment_status`, freshness coloring, the precache roster.** Vector is the ground
  layer only. None of Pick's own map data is affected.
- **Artifacts.** The Claude artifact CSP blocks external images *and* runtime fetches, so
  neither raster tiles nor vector styles work there. `tools/render/` draws its own geometry and
  will keep doing so. **This migration does nothing for the content pipeline's rendering.**
- **`basemap.ts`'s inline-env rule.** The style URL still needs the key interpolated inline —
  the textual-substitution trap that shipped a production regression on 2026-09-08 applies
  identically to a `style.json` URL. Keep the expression inline and dumb.

## 7. Costs and risks

- **MapLibre is a heavier library than Leaflet** (several times the bundle). Against four
  on-demand WebViews this is likely unnoticeable, but it is not free.
- **WebGL dependency** — see step 0.
- **Parity risk on `map.tsx`.** It is the app's primary screen and carries the follow-cam, the
  spotlight, tap-to-inspect and live route drawing. A partial port that regresses any of those
  is worse than staying on raster.

## 8. Recommendation on timing

**Do not run this as its own project.** `GROUP_IMPACT_MAP_SPEC.md` §8 will rebuild map rendering
anyway (roster-filtered coverage, participant coloring, the export frame). Doing the renderer
swap then means **one rewrite instead of two**, and it is the only point on the roadmap where
touching all four maps is already justified.

Nothing is gated on the API key — the same key covers both services. There is no announced
raster shutdown date, so this is directional, not urgent.

## 9. Open questions

1. **Does the WebGL spike pass?** Everything else is moot until this is answered.
2. **Restyle to Civic Blueprint, or stay Positron?** Recommended yes, but as a separate change
   after parity (step 5), and it is a design call not a technical one.
3. **Dark mode?** Vector makes it real theming rather than a style swap. Not currently requested;
   noting only that the migration unlocks it.
