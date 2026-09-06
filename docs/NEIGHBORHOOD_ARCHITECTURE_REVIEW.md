# Neighborhood/boundary architecture — investigative review

Written 2026-09-02. Investigation only — no app code changed. Everything below is grounded
directly in `apps/companion/src/services/neighborhoods.ts`, `streetSegments.ts`,
`app/(tabs)/map.tsx`, `git log`, and live Overpass queries run during this session (not
reasoned from `PROJECT_TIMELINE.md` or memory summaries).

## 1. Code as it actually is today

`neighborhoods.ts` (729 lines) has three layers, all confirmed by reading the file:

1. **Universal tile grid** (`streetSegments.ts`, `TILE_SIZE_DEG = 0.005`) — the real underlying
   unit everywhere, zero curated data required. Street-by-street freshness coloring and pickup
   tracking run on this regardless of anything below. **Confirmed in `map.tsx`**: when neither
   a curated city nor a usable OSM boundary exists, the code explicitly does *not* fall back to
   a fake circle (comment at `map.tsx:613-622`: "a made-up circle... was confusing/unwanted...
   the app just stays in normal (non-level) overview mode"). So the tile layer is genuinely the
   floor, not a degraded state — **a city with no neighborhood data produces the same core
   experience as a pure-tile city, just without a bounded "% complete" number.** This answers
   one of the review's open questions directly: yes, it already degrades the way you'd want.

2. **Curated per-city registry** (`CITY_SOURCES`, three entries — confirmed by reading the
   array, not inferred):
   - **NYC**: GitHub-hosted static GeoJSON (`HodgesWardElliott/custom-nyc-neighborhoods`,
     Pediacities set), ~310 hoods, `basemapLabels: true` (CARTO already prints NYC hood names).
   - **Atlanta**: live query against the City of Atlanta's own ArcGIS `MapServer` REST endpoint
     (`gis.atlantaga.gov/dpcd/.../GeopoliticalArea/MapServer/1/query`), 248 official
     neighborhoods, server-side simplified (`maxAllowableOffset=0.0003`) because full-resolution
     export was too slow to load on device. `basemapLabels: false` — the app draws its own
     labels.
   - **SF**: DataSF Socrata resource `gfpk-269f` ("SF Find Neighborhoods"), 117 hoods, no
     server-side simplification needed (287KB full-res). `basemapLabels: false`.

3. **Generic OSM Overpass admin-boundary fallback** (`fetchOsmBoundariesInBox`, everywhere else)
   — queries `admin_level` 6-9, hedged across 3 mirrors, with a size filter
   (`MAX_SHAPE_DIAGONAL_KM = 25`) to exclude county-scale relations. Renders whatever comes
   back, real subdivision or just the city's own border — never rejects to a worse fallback.

`hasNeighborhoods(lat, lon)` **only** checks whether the point falls in one of the three
`CITY_SOURCES` bounding boxes — it has nothing to do with data quality or CARTO. `map.tsx`
branches on it at `map.tsx:623`: true → curated per-city path; false → generic OSM path.

## 2. SF status and Atlanta source — corrected

**SF is fully committed, not uncommitted.** `git log` on `neighborhoods.ts` shows
`528acbd "Register San Francisco as the third neighborhood city"`, and the current file has the
SF entry live in `CITY_SOURCES`. `docs/SF_NEIGHBORHOODS_EXPLORATION.md`'s own header ("entry
written into the working tree, unpublished and uncommitted... needs one Metro session on a real
device") **is stale** — it predates the commit. What's actually still unverified is only the
device-verification checklist in that doc's §6 (overview render, small-hood tap/spotlight,
park zero-denominator display, cold-start cost) — a QA task, not a commit-status question. Worth
flagging to `qa` directly rather than leaving it implied by a stale doc header.

**Atlanta** is not curated from OSM or a GitHub file — it's a live per-install fetch straight
from the city's own ArcGIS GIS server, all 248 official neighborhoods in one request, with
server-side polygon simplification for payload size. This is a fourth pattern beyond
"GitHub raw file" and "Socrata," and it's the only one of the three curated cities with zero
copy of the source data checked into the repo or cached as a static asset — see §5's "one
dependency per city" tradeoff below.

## 3. CARTO labels vs. Pick's own polygons — confirmed as two independent things

Grounded directly in code: `basemapLabels` on each `CitySource`, and `hoodLabelsNeeded()`,
exist purely to decide whether Pick draws its **own text labels** over its **own polygon
outlines**. Pick's polygons render unconditionally regardless of what CARTO's tiles print. The
SF exploration doc documents this was empirically checked against real `light_all` tiles (z13
"SAN FRANCISCO" only, z14 one district name, z15 one label) before setting `basemapLabels:
false` for SF — CARTO's basemap label density is real and does vary by city/zoom, but it is a
pure *rendering* choice about whether Pick draws duplicate labels, never a determinant of
whether a neighborhood polygon exists or is usable. **These are fully decoupled, as the review
suspected** — "some cities are neighborhood-rich, others aren't" is entirely about
Pick's-own-polygon availability (§2/§4 below), not about CARTO.

## 4. What OSM Overpass actually returns for un-curated cities — tested live, right now

Queried the app's exact fallback query shape (`admin_level` 6-9, `boundary=administrative`)
against real bounding boxes for three plausible next-city targets. (`docs/CITY_REQUESTS.md` has
**zero requests logged yet** — the feature shipped 2026-08-31 and the first weekly digest hasn't
run, so there's no real demand signal to target off yet; these three were picked as generically
plausible US expansion cities, not because of any logged request.)

| City | Admin-boundary relations 6-9 | What's actually in it |
|---|---|---|
| Chicago | 110 | Level 8 = "Chicago" as ONE shape, indistinguishable from Burr Ridge/Hometown/Evergreen Park (peer suburbs) at the same level. No neighborhood-level relations (Wicker Park, Logan Square, etc.) exist as `boundary=administrative` at all. |
| Boston | 22 | Same pattern — level 8 = "Cambridge," "Somerville," "Newton," etc. as peer municipalities; Boston's own internal neighborhoods (Back Bay, Jamaica Plain, ...) have no administrative-boundary relations. |
| Los Angeles | 74 (12 at level 9) | Level 9 is NOT a clean neighborhood tier here — it's a mix of unincorporated LA County areas (Westmont, Willowbrook, East Compton), Pasadena city-council districts, and exactly **one** real LA neighborhood (`Westwood, Los Angeles`). Same admin_level, wildly different meaning within one metro. |

Then checked the *other* OSM tagging convention actually meant for neighborhoods
(`boundary=neighbourhood` ways/relations, and `place=neighbourhood|suburb|quarter` nodes) for LA
and Chicago:

- **LA**: 267 matches, **all 267 were nodes** (label points) — zero ways/relations, i.e. zero
  polygons. Real names (Venice, Lincoln Heights, Jefferson Park, Century City...) but no shapes.
- **Chicago**: 307 matches, **all 307 nodes**, same story.

This directly confirms the project-memory framing: for cities outside the three curated ones,
OSM typically has neighborhood **names as label points**, not polygons, and the
`admin_level`-based fallback resolves to municipality/suburb tier, not anything usable as a
neighborhood. The generic Overpass fallback path in the code is working as designed and as
documented in its own comments — this isn't a bug, it's a real, structural data-availability
gap. (Separately and independently: `overpass-api.de`, the app's primary/first-tried mirror,
timed out on even a trivial `node(1)` query during this session, and
`overpass.kumi.systems` failed to connect at all — only the third mirror,
`maps.mail.ru/osm/tools/overpass`, answered. This is a live, real-time reconfirmation of the
mirror-reliability structural risk `LAUNCH_LEDGER.md` already flagged as Jake's 2026-09-02
priority — worth noting as independent evidence, not a new finding.)

## 5. Is there a better global source? — flagged as needing a real browser pass, with one lead

No web-browsing tool available this session, so this is not a confident survey — treat it as a
lead, not a recommendation.

**Checked what's reachable by plain HTTP from this environment:**
- **Who's On First (WOF)** — a free, open (mostly CC0/CC-BY), community-maintained gazetteer
  (originally Mapzen/Mapbox, now `whosonfirst-data` on GitHub) that includes `neighbourhood`
  as a first-class place type with real polygons, for the US and internationally. Confirmed
  reachable: `raw.githubusercontent.com/whosonfirst-data/whosonfirst-data-admin-us/...` returns
  200 and real content; their `spelunker.whosonfirst.org` browsing UI is also live. **Not
  verified beyond reachability** — didn't confirm actual per-city coverage depth, polygon
  quality/precision, update recency, or the exact license terms for redistribution inside the
  app, none of which are safe to guess. This is the one candidate worth a real follow-up pass
  with browser access before treating it as a real alternative to the per-city manual hunt.
- Zillow's old neighborhood shapefiles are long retired (confirmed by the SF exploration doc's
  own source-comparison table, which already tried the GitHub mirror of them and rated it
  "2013 snapshot, no maintainer, fallback only").
- US Census TIGER/Line has tracts and "places" (incorporated municipalities), not
  neighborhoods — doesn't solve this problem, just confirms the general shape of the gap:
  neighborhood is not a governmental unit in most of the US, so there's no single authoritative
  federal source the way there is for counties or ZIP codes.

## 6. Options — tradeoffs, not a recommendation

**A. Tiles-as-floor, neighborhoods as opportunistic enhancement (already true today).**
Confirmed in §1: this is already exactly how it degrades. The only gap is that it's implicit —
nothing tells a user in Chicago *why* there's no neighborhood level, vs. a user in NYC who has
one. A one-line "neighborhood boundaries aren't available here yet" state (distinct from silence)
is a small, cheap addition to consider, orthogonal to which sourcing strategy comes next.

**B. Turn SF's bespoke process into a repeatable recipe/checklist.** The SF doc is already
close to this in spirit — dead-id trap, overlap/gap sweep methodology, CARTO label check are all
generalizable steps. Formalizing it (a checklist or small script: find city GIS/open-data
neighborhood layer → check overlap/gaps with a grid sweep → check CARTO label density → measure
payload size → decide on server-side simplification) would cut the multi-hour "hunting" phase
but not eliminate the manual research (finding the right dataset per city is inherently
per-city investigative work; there's no shortcut visible in what was checked here). Doesn't
scale past maybe "onboard a city in under an hour" rather than "in minutes."

**C. Algorithmic middle tier (H3 hexagons + reverse-geocoded label).** Genuinely solves "any
city, zero manual work," at the cost of the boundary not matching a place people actually call
by that name — a hexagon isn't "Wicker Park." Already flagged in project memory as future
polish, not started. Given §4's finding that most cities' real OSM neighborhood data is label
points with no shape, this is the most literal way to get *some* shape without waiting on any
external polygon source — it's a genuinely different tier from "curated neighborhood," not a
replacement for it, and worth being explicit about that distinction to users if shipped (e.g.
"Area 4B" vs. "Wicker Park" reads very differently).

**D. WOF (or an equivalent open polygon dataset) as a fourth, semi-automated `CITY_SOURCES`
tier.** If §5's lead holds up under a real evaluation pass, this could replace "hunt for each
city's own open-data portal" with "pull the WOF neighbourhood layer for any requested city" —
turning B into something closer to automatic. This is squarely the "needs a follow-up pass with
browser access" item, not something to act on from this session's findings alone.

**E. Gate curation effort behind real demand.** The `requestCity` feature (shipped 2026-08-31)
is built for exactly this, but **has zero data yet** — `docs/CITY_REQUESTS.md` is empty, first
weekly digest hasn't run. This is a real, cheap lever already in place; it just hasn't had time
to produce a signal. Worth deferring any further city-curation work until at least one digest
cycle has real numbers, rather than guessing at demand the way this review had to (picking
Chicago/Boston/LA as "plausible" rather than "requested").

**F. Static-asset hosting for the three existing curated sources.** Not squarely in scope for
"new cities," but the SF doc's own closing note flags it: NYC (GitHub raw), Atlanta (city
ArcGIS), SF (Socrata) are three different third-party runtime dependencies for data that never
changes. Collapsing them to one fetch from `pickglobal.org`-hosted static files would remove
three points of failure — same shape as the Overpass-mirror-reliability question already on the
ledger, and worth deciding together rather than separately.

**What's genuinely Jake's call, not something this review can resolve:** whether it's worth
spending scarce engineering time on B/C/D before there's any real demand signal from E, and
whether a hexagon-based "Area 4B" naming scheme is an acceptable-looking fallback for a growth
mechanic that depends on feeling like a real place.

## Sources checked this session

- `apps/companion/src/services/neighborhoods.ts` (full file, 729 lines)
- `apps/companion/src/services/streetSegments.ts` (header + constants)
- `apps/companion/app/(tabs)/map.tsx` (lines ~495-670, the `hasNeighborhoods`/`loadHoodsInView`
  branch)
- `docs/SF_NEIGHBORHOODS_EXPLORATION.md`
- `git log --oneline -- apps/companion/src/services/neighborhoods.ts` and `git status` on that
  file (confirms SF is committed, `0224b04`/`528acbd`/`41b5114`)
- `~/pick-app/docs/CITY_REQUESTS.md` (empty — no demand data yet)
- Live Overpass queries (this session, via `maps.mail.ru`'s mirror after `overpass-api.de`
  timed out and `overpass.kumi.systems` failed to connect) against Chicago, Boston, and Los
  Angeles bounding boxes, both `boundary=administrative` (admin_level 6-9) and
  `boundary=neighbourhood`/`place=neighbourhood|suburb|quarter`
- Reachability check (not a full evaluation) of Who's On First via `raw.githubusercontent.com`
