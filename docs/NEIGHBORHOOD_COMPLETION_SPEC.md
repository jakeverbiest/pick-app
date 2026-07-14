# Spec — Neighborhood Completion ("keep it green") + city-scale map

Status: proposal for review. Builds on the existing street-segment coverage system.

## 1. The shift
Move the in-app hero from cumulative impact metrics (vanity numbers that only go up) to a **completion + maintenance loop** scoped to a neighborhood. Impact metrics (bags, lbs) stay — demoted to the credibility layer for cities/funders. The picker's daily motivation becomes: *get my neighborhood to 100% green, and keep it there.*

## 2. Metric model (decided)
- **Bags (gallons)** = headline. Tangible + lowest friction (user holds the bag; tap fullness). Already have the bag input.
- **Pounds** = derived only (pickups × calibration factor, tuned by the few who weigh or report bag fullness). Display "≈X lb", never ask users to weigh.
- **Pickups** = automatic engine that feeds estimates. Don't feature the raw count as hero until detector overcounting is fixed.

## 3. Neighborhood boundaries
- Source: OSM has admin/neighborhood polygons (`boundary=administrative` / `place=neighbourhood`). Fetch the polygon containing the user; fall back to a ~1 km radius "your area" if none mapped.
- Each user has a "home neighborhood" (from settings or auto-detected); that's their board.

## 4. Completion %
- Reuse `segment_status`. Completion = (fresh segments ÷ total segments) within the neighborhood polygon, where "fresh" = cleaned within the freshness window (currently ≤5 days, tunable).
- "Streets left" = stale or never-cleaned segments inside the boundary.

## 5. The decay / keep-green loop (the sticky part)
- Segments already age green→yellow→red. So a neighborhood at 100% naturally drifts back down — completion is renewable, not one-and-done.
- Surface "N streets slipping back" so there's always a reason to go out, and it's communal (neighbors collectively hold the boundary green).

## 6. UI changes
- **Map tab**: add the neighborhood boundary outline + a completion header (ring + "78% clean · 12 streets left"). Tapping a stale street routes you there.
- **Ranks tab**: add a **neighborhood** board — neighborhoods ranked by % green / streets held, not just individual/team pickup totals. This is the communal completion competition.
- Keep impact (bags/lbs) as a secondary stat, not the headline.

## 7. City-scale map — "grows as you zoom" (the architecture question)
Today: geometry is fetched live from public Overpass for a 600 m radius around the user, cached per grid cell. That doesn't scale to panning around a city.

How running apps (Strava etc.) do it WITHOUT a mess: **they never ship raw geometry to the client.** They pre-aggregate activity server-side into **map tiles** (or vector tiles) per zoom level, and the client just renders the tile images/vectors for whatever's on screen. Fast, bounded payloads, works at city/world scale.

Recommended path for PICK, in two stages:
- **Stage 1 (no backend, ships soon):** viewport-driven loading. On map pan/zoom-end, fetch coverage for the visible bounding box (debounced), keyed + cached by grid cell (already have the cache). Cap detail at low zoom so a city-wide view doesn't request thousands of segments. This makes the map "grow as you explore" with the current architecture.
- **Stage 2 (the real scale answer):** a server (Cloud Function + scheduled aggregation) that rolls `segment_status` into **vector tiles** of cleanliness per zoom level. Client renders tiles. At low zoom show a heatmap/choropleth of neighborhood % green; at high zoom show individual segments. This is the "show full activity in a city" answer, and it's the same OSM-caching backend already proposed in WALK_FEEDBACK — they're the same project.

## 8. Visual polish (shipped)
- Uncleaned dotted segment lightened (`#C7CAC1`, opacity 0.35, fine dash) so it recedes into the map instead of reading as dark clutter.

## Build order
1. Visual: lighten uncleaned lines ✅ (done, OTA).
2. Stage-1 viewport loading (map grows as you pan) ✅ (done — WebView posts `moveend` → app loads coverage for the new area, debounced, skips zoom < 14). Client-only, OTA.
3. Neighborhood name + completion header on Map ✅ (done — geocoded neighborhood name as the headline + "X% clean · N streets to go" + a % green pill; updates as you pan). Walks geo-tagged with city + neighborhood at save. Boundary model: **names everywhere now (phone geocoder), crisp official GeoJSON shapes per launch city later** (Jake's call).
4. Crisp boundary polygons for launch cities (bundle official open-data GeoJSON, e.g. NYC NTA, Atlanta neighborhoods) — draw the real outline + clip completion to it. ← next
5. Neighborhood board on Ranks + city/global rollup aggregates + the "keep it green" decay nudges.
6. Stage-2 tile/aggregation backend (shared with the OSM-caching infra).
