# ZIP/postal boundary tier — spec (for review, not a build)

**Status:** draft, awaiting Jake's decisions on the open questions below. Nothing in this
document has been implemented.

**Origin:** `docs/NEIGHBORHOOD_ARCHITECTURE_REVIEW.md` (2026-09-02), which found that curated
neighborhood data (`neighborhoods.ts`'s `CITY_SOURCES`) is a hand-curated, per-city, bespoke
layer with no repeatable sourcing process (three cities, three different data-source patterns),
and that Overture Maps — checked live that session as a hoped-for "solves it globally" fix —
does not solve it: LA's neighborhood-level Overture entries are `division` **point** features
sourced from OSM, not `division_area` polygons, the same underlying gap as raw OSM. This spec
proposes the concrete follow-up: a genuine nationwide (and eventually international) middle
tier using government-published postal/administrative boundaries, sitting between the universal
tile grid (always available, ungamified) and curated neighborhoods (best hook, opportunistic).

---

## 1. Grounding in the current code

Confirmed by re-reading `apps/companion/src/services/neighborhoods.ts` and
`streetSegments.ts` directly for this spec (not from memory of the review):

- `hasNeighborhoods(lat, lon)` (`neighborhoods.ts:180`) is a pure bounding-box membership check
  against the three-entry `CITY_SOURCES` array — nothing about data quality, just "is this point
  in NYC/Atlanta/SF's box."
- `map.tsx:623` branches directly on that boolean: true → curated per-city path
  (`getHoodsInBounds`/`hoodLabelsNeeded`/`fineNeighborhood`); false → generic OSM
  admin-boundary fallback (`getOsmHoodsInBounds`).
- The stats/level mechanism is fully decoupled from where the polygon comes from. Two functions
  do all the work, and both take a plain `ring: [number, number][]` — a boundary source, not a
  fixed set of cities:
  - `polygonStats(ring, segments)` (`neighborhoods.ts:703`) — % fresh, `toGo` count, for a hood.
  - `getCoverageForRing(ring)` (`streetSegments.ts:797`) — the actual street segments inside a
    ring, joined against Firestore `segment_status`.
  - `map.tsx`'s `activateHood(name, ring, reveal)` (`map.tsx:663`) is likewise generic: it takes
    any `name` + `ring`, calls `getCoverageForRing(ring)`, and drives the whole "level" UX
    (framing, reveal animation, `renderLevel`, `toGo`/`freshPct` stat panel, live-walker count
    scoped to that name). **Nothing in the level/activation code is NYC/Atlanta/SF-specific.**
- Conclusion: a ZIP tier does **not** need new stats math or a new level UX. It needs to produce
  the same two things any `CITY_SOURCES` entry already produces — a `{ name, ring }` — and can
  otherwise plug straight into `getHoodsInBounds`/`activateHood`'s existing contract. The design
  below treats "where does the ring come from" as the only new surface area.

---

## 2. Data source: US Census ZCTA

**What it is.** ZIP Code Tabulation Areas — the Census Bureau's polygon approximation of USPS
ZIP code service areas (ZIP codes themselves are delivery routes, not areas; ZCTAs are the
Bureau's own area-ized version, which is the thing every "ZIP boundary map" product actually
uses). Published as **Cartographic Boundary Files** (the generalized, web-weight-appropriate
product — not the full-resolution TIGER/Line files, which carry far more vertex detail than a
phone map needs and would bloat payload for no visible benefit at this zoom range). ~33,000
ZCTAs cover the entire US with one dataset, one license (US Government Works, public domain, no
attribution/redistribution restriction), one update cadence (Census releases a new vintage
roughly annually).

**URL — VERIFIED LIVE 2026-09-02 (Chief-of-Staff session, browser tool), superseding the
guessed pattern below.** Two real findings that change §2's original assumption:

1. **There is no `GENZ2023` cartographic ZCTA file.** Checked `https://www2.census.gov/geo/tiger/GENZ2023/shp/` directly — it lists per-state `bg`/`cousub`/`place`/`tract`/etc. files only, no
   `zcta520` entry at all. ZCTAs are only re-drawn at each decennial census, so cartographic
   ZCTA boundaries are published under the **2020** vintage, not the current year, and won't
   appear in a `GENZ<current-year>` directory the way other layers do — a real gotcha for
   whoever implements this, since the naturally-guessed "use the latest year" pattern silently
   404s for this one layer specifically.
2. **Confirmed working URL and real size**, via the Census's own "2023 TIGER/Line Shapefiles"
   download page (which resolves to the 2020 vintage for this layer) and a `HEAD` request:
   `https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip` — **HTTP 200,
   Content-Length 66,655,314 bytes (~63.6 MiB), last modified 2023-05-19.** That's the real
   national cartographic-boundary payload size for the one-time conversion input in §7 — no
   longer a guess. Also confirmed **no smaller Census generalization exists for this layer**:
   both `cb_2020_us_zcta520_5m.zip` and `cb_2020_us_zcta520_20m.zip` (the 1:5,000,000 and
   1:20,000,000 products that do exist for other layers) 404 for ZCTA specifically — closes
   open question 4 below with a real answer: there is no coarser off-the-shelf option to trade
   against, `mapshaper`/`ogr2ogr` simplification on the 500k file is the only lever if payload
   size needs to shrink further.
3. The raw full-resolution TIGER/Line equivalent (`https://www2.census.gov/geo/tiger/TIGER2023/ZCTA520/tl_2023_us_zcta520.zip`) was also checked and is real but **504 MB** — confirms the
   spec's original reasoning that the generalized Cartographic Boundary File, not raw TIGER/Line,
   is the only sane input for this pipeline.

**Format.** Shapefile (`.shp`/`.shx`/`.dbf`/`.prj`), not GeoJSON — needs a conversion step
(e.g. `mapshaper` or `ogr2ogr`) to produce the `[lat,lon]` ring format the app's `HoodShape`
type already expects. This is a one-time build-side transform, not a runtime dependency — no
shapefile parsing needs to happen on-device or in a Cloud Function per-request.

**Size at national scale — the reason this can't be shipped as one client asset.** ~33,000
ZCTAs nationwide, even generalized, is tens of MB as a single file — confirmed order-of-magnitude
by comparing to the review's own NYC figure (one metro's ~310 neighborhoods already run ~1.5MB
uncompressed). A flat national bundle is the wrong shape for the app's existing lazy-load
pattern (`loadHoods()`/`prefetchHoodsNear()` already fetch and cache only the one city a user is
physically in — see §3 for how ZCTA should follow the same principle, not break it).

---

## 3. Serving shape: per-region chunks, not one file

Two credible options, both consistent with patterns already in the codebase:

**Option A — Cloud Function, bbox-scoped (mirrors `fetchOsmBoundariesInBox`).** A Cloud
Function holds the full processed ZCTA dataset (as GeoJSON, pre-converted from the Census
shapefile at build/deploy time) server-side — in Cloud Storage or as a set of pre-chunked
Firestore documents keyed by a coarse grid cell (same `OSM_CELL_DEG`-style ~20km cell pattern
`neighborhoods.ts` already uses for the OSM fallback) — and returns only the ZCTAs whose bbox
intersects the caller's viewport. Client calls this exactly the way `getOsmHoodsInBounds` calls
`fetchOsmBoundariesInBox` today: same shape, same caching contract (`osmHoodsCache`/disk file
per cell), different backing data. This is the more consistent choice given `OVERPASS_PRECACHE_SPEC.md`'s Firestore-cache pattern is being built for a structurally identical
problem (serve small per-region slices of a large source dataset, cache client-side per cell) —
a ZCTA cache could literally reuse `precache_boundaries/{cellKey}`'s collection shape rather
than inventing a fourth one.

**Option B — pre-processed static asset per region, hosted like the existing curated
sources.** Chunk the national ZCTA file into per-state (or per-metro) GeoJSON files, host them
as static files (e.g. on `pickglobal.org`, the same hosting the architecture review's option F
already proposed collapsing NYC/Atlanta/SF's three different third-party dependencies onto).
Client fetches only the state/metro file for wherever the user is, same `loadHoods()` pattern
already used for `CITY_SOURCES` — literally add ZCTA as a fourth city-agnostic "source" with a
much larger `inBox` (a US bounding box, or per-state boxes) instead of a hand-picked city box.

**Recommendation for the spec, not a final call:** Option A is the better fit specifically
*because* `OVERPASS_PRECACHE_SPEC.md` is already proposing this exact caching shape
(Firestore-cached, bbox/cell-keyed, cache-first with live fallback) for a sibling problem in the
same session's work — building two different bespoke caching mechanisms for "serve a chunk of a
big polygon dataset by location" the same week would be the kind of duplication `AGENTS.md`'s
"narrow, deep work" framing argues against. Option B is simpler (no new Cloud Function, reuses
`loadHoods()` verbatim) and worth it only if Jake wants zero new server-side code — genuinely
his call, flagged in §7.

---

## 4. Where this slots into `hasNeighborhoods()` / the three-way check

**Proposed: three-way check, curated-first.** `hasNeighborhoods()` today is boolean
(true = NYC/Atlanta/SF, false = everything else). Replace its single boolean with an ordered
resolution — curated `CITY_SOURCES` first, ZCTA tier second, tile-only floor third — rather than
making ZCTA the default and curated an "opt-in override." Reasoning:

- **NYC is the concrete test case the task calls out, and it settles this cleanly.** NYC already
  has ~310 real, named, socially-legible neighborhoods (Bushwick, Park Slope, etc.), CARTO
  already prints their names on the basemap (`basemapLabels: true`), and the whole level/tap UX
  is tuned around them. Defaulting NYC into a ZIP view would be a straight regression — a ZIP
  code is a worse gamification hook than "Bushwick" for the exact reason §6 flags (administrative
  vs. social identity). Curated-first avoids ever needing a "which one wins" runtime decision for
  the three cities that already have the good data — they just keep using it, unchanged.
- **ZCTA becomes the thing that fires only where curated data doesn't exist**, extending
  `hasNeighborhoods()`'s existing "false → OSM admin-boundary fallback" branch into "false →
  try ZCTA → if that's also unavailable, OSM admin-boundary fallback" (ZCTA is US-only at
  launch per §5; the existing OSM fallback stays the true universal/international floor above
  raw tiles).
- Concretely: `cityForPoint()` stays as-is (curated match). A new `zctaForPoint()`-style check
  (bbox-then-point-in-polygon, same `pointInPolygon` helper already imported from
  `streetSegments.ts`) only runs when `cityForPoint()` returns null. `hasNeighborhoods()`'s
  boolean return either becomes a three-way enum (`'curated' | 'zip' | 'none'`) or stays boolean
  with a new `hasZipTier()` sibling — either works; the enum is slightly cleaner for `map.tsx`'s
  branch at line 623 but is a call for whoever implements this, not load-bearing for the spec.

**UI when both a ZIP and a curated neighborhood exist for the same point (NYC).** Per the
curated-first design above, this case never actually arises in the running app — NYC always
resolves to its curated hood, ZCTA data is never even fetched there. This sidesteps the "how does
a user pick a zip vs. a neighborhood" UI question the task raises: **there's no user-facing
choice to design**, because the resolution order makes it automatic and the better option always
wins where both exist. (If a future reason emerged to let a user override — e.g. a Bushwick
resident who'd rather see their ZIP's shape for some reason — that's a distinct, much smaller
feature: a per-user preference toggle, not a core resolution-order change. Not proposed here;
no evidence anyone wants it.)

**Does the ZIP tier need its own level/tap-to-focus treaty, or something simpler?** Reuse the
existing one as-is. Per §1, `activateHood(name, ring, reveal)` is already fully generic — it
doesn't know or care whether `ring` came from `CITY_SOURCES`, the OSM fallback, or a ZCTA. A ZIP
resolves to exactly the same `{ name: '11238', ring: [...] }` shape a curated hood does and
flows through `getHoodsInBounds`-equivalent → tap → `activateHood` → `getCoverageForRing` →
stats panel, unchanged. The only genuinely new UI surface is the **label**: showing "11238" (or
"ZIP 11238") as the level name reads differently from "Bushwick," and is worth a one-line
"ZIP 11238" vs. "Bushwick" visual treatment check (e.g. does the level-name text field need a
zip-code-shaped monospace/format hint) — a design nit, not an architecture question.

---

## 5. International pattern — forward-looking context only, not a build item

Pick has no international testers yet (per the task framing). This section lays out the general
shape of the same problem for other countries, for future reference — nothing here is proposed
for near-term work.

| Country/region | Candidate source | Confidence |
|---|---|---|
| United States | Census ZCTA (Cartographic Boundary Files) | **Confirmed AND verified live 2026-09-02** — free, complete, standardized, real download URL confirmed working (~63.6 MiB, see §2). |
| EU (27 members) + EFTA candidates | Eurostat LAU (Local Administrative Units — municipality/commune level), published via GISCO | **Verified live 2026-09-02** (same architecture-review session) via Eurostat's own site — a real, free, standardized structure exists at the municipality tier across the bloc. Not yet evaluated for file format/size/licensing depth the way ZCTA is here. |
| United Kingdom | ONS postcode boundaries | High-confidence-pattern candidate, **not verified**. UK's Office for National Statistics is a plausible analog to the US Census, but no live check was done this session. |
| Canada | StatCan Forward Sortation Areas (first 3 characters of a Canadian postal code) | High-confidence-pattern candidate, **not verified**. Same reasoning — Statistics Canada is the plausible national-stats-agency analog. |
| Australia | ABS Postal Areas | High-confidence-pattern candidate, **not verified**. Same reasoning — Australian Bureau of Statistics. |

**The general shape worth remembering:** check whether a country's national statistics agency
publishes open geospatial boundary data. Where it does (confirmed for US, EU), it tends to be
free, complete, and consistent — a fundamentally more tractable problem than the per-city
neighborhood hunt documented in the architecture review, because it's *one* national dataset
covering an entire country rather than city-by-city bespoke sourcing with a different data
portal, license, and format each time. This pattern is the reason the US/ZCTA tier is worth
building now even though Pick is US-only today: the same "find the stats agency's open data"
playbook is the thing to reach for later, not a new investigative process each time a new
country comes up.

---

## 6. The real tradeoff — administrative boundary vs. social identity (be honest about this)

This is a genuine regression risk, not a checkbox win, and worth stating plainly rather than
folding into a bullet elsewhere:

**A ZIP code is not what makes "% green in Bushwick" feel good.** The gamification hook depends
on the boundary matching a place people actually identify with and call by that name in
conversation — "I cleaned up my neighborhood" lands; "I cleaned up 11221" does not carry the
same weight. ZCTA boundaries are a USPS delivery-routing artifact repurposed by the Census into
a shape; they don't track how residents describe where they live, they sometimes split a single
real neighborhood across two ZIPs (or merge two identity-distinct neighborhoods into one ZIP),
and the numeric label itself is memorable to nobody the way a place name is.

**The recommendation is explicitly not "replace neighborhoods with ZIPs."** It's "ZIPs fill the
reliability gap where neighborhoods don't exist" — per §4's curated-first design, a real
neighborhood always wins where Pick has one. The ZIP tier is a strict improvement only relative
to the two alternatives a user in Chicago/Boston/an un-curated city has *today*: a fixed
0.005° tile grid with no bounded "% complete" number at all, or (per the review's §4 findings)
an OSM admin-boundary fallback that in most un-curated US cities resolves to "the whole city as
one shape" — also not a socially meaningful unit, arguably worse than a ZIP since it's not even
locally specific. Framed against those two, not against "Bushwick," a ZIP is a real upgrade; framed
against "Bushwick," it's a downgrade Pick should never force on a city that already has better
data.

---

## 7. Rough cost/complexity estimate (same lens as `OVERPASS_PRECACHE_SPEC.md`)

Citing that spec's precedent directly, per the task instruction: the 2026-09-01 Cloud Functions
cost fix (incremental Firestore rollups replacing full-collection-scan patterns) is the standing
lesson — cost should scale with actual traffic/footprint, not a fixed workload re-processed
every time. This design follows the same shape:

- **One-time build cost, not a recurring one.** Unlike the Overpass pre-cache (which re-fetches
  live data on a recurring schedule because OSM sidewalk geometry/boundaries can shift), ZCTA
  boundaries are a Census-published, versioned dataset that changes on Census's own ~annual
  release cadence, not continuously. The conversion (shapefile → per-cell/per-region GeoJSON) is
  a one-time (or once-a-year) build-time job, not a scheduled function running weekly like the
  Overpass pre-cache's refresh job.
- **Read volume mirrors the Overpass pre-cache's own estimate.** If built as Option A
  (Firestore-cached, cell-keyed, reusing `precache_boundaries`'s shape), the marginal read cost
  per user is the same "one extra Firestore read replacing a live external HTTP call" the
  Overpass spec already sized as comfortably inside Firestore's free tier at current tester-scale
  traffic. This isn't a new cost category, it's the same bucket.
- **Write volume is bounded by US geography, not by user count or history.** ~33,000 ZCTAs
  chunked into ~20km cells is a fixed, finite write set populated once (or once a year), fully
  `O(dataset size)`, never `O(users)` or `O(cumulative history)` — exactly the property the
  2026-09-01 fix was chasing.
- **The only genuinely new cost is the one-time conversion pipeline** (shapefile → GeoJSON →
  chunked-and-uploaded) — a build script, not standing infrastructure. Rough complexity: similar
  order of effort to the SF neighborhood onboarding work documented in
  `docs/SF_NEIGHBORHOODS_EXPLORATION.md`, but done once for the whole country instead of once
  per city — which is the entire point of this tier versus continuing the per-city hunt.

This estimate is directional, not measured — no live Census file was actually downloaded or
sized this session (the URL itself is unverified, per §2), and no Cloud Functions/Firestore
billing data was pulled. Same caveat `OVERPASS_PRECACHE_SPEC.md` already carries.

---

## 8. Open questions / decisions for Jake

1. ~~Confirm the exact Census Cartographic Boundary File URL and current vintage year via a live
   fetch before any implementation.~~ **CLOSED 2026-09-02** — verified live: 2020 vintage (not
   2023 — ZCTAs are decennial-only), `cb_2020_us_zcta520_500k.zip`, ~63.6 MiB, confirmed working.
   See §2.
2. **Option A (Cloud Function/Firestore cell cache, reusing `OVERPASS_PRECACHE_SPEC.md`'s shape)
   vs. Option B (static per-state files hosted like the existing curated sources)** — §3 leans A
   for dedup-with-the-precache-spec reasons, but B is simpler if Jake would rather avoid a new
   Cloud Function. Genuinely his call.
3. **`hasNeighborhoods()`'s return type: three-way enum vs. boolean + a new `hasZipTier()`
   sibling function** — an implementation-detail call, not architecture, but worth deciding
   before someone writes the code so `map.tsx`'s branch at line 623 doesn't get built twice.
4. ~~1:500,000 vs. a coarser Census generalization (1:5,000,000)~~ **CLOSED 2026-09-02 —
   no coarser option exists.** Verified live: only the 1:500,000 product is published for ZCTA
   (the 5m/20m generalizations that exist for other Census layers both 404 for this one). The
   ~63.6 MiB 500k file is the only off-the-shelf input; if payload still needs to shrink after
   the app's existing `decimate()` step, `mapshaper`/`ogr2ogr` simplification on that file is the
   only remaining lever, not a different Census download.
5. **Sequencing against `OVERPASS_PRECACHE_SPEC.md`.** If Option A is chosen, this tier and the
   Overpass pre-cache share a caching mechanism closely enough that building them together (one
   Firestore cell-cache layer serving two different polygon sources) may be less total work than
   building the Overpass pre-cache first and retrofitting ZCTA in later. Worth deciding order,
   not just "both eventually."
6. **Whether to build this before there's any real demand signal at all.** Unlike the
   architecture review's neighborhood-city-expansion options (gated behind `city_requests` demand
   data, currently empty), a ZIP tier is a nationwide floor-raise that benefits every non-curated
   US city simultaneously rather than one city at a time — so it doesn't need a per-city demand
   signal to justify building, but it's still discretionary engineering time versus the still-open
   Overpass-reliability and EAS-build-budget items already on `LAUNCH_LEDGER.md`. Jake's call on
   priority, not something this spec can resolve.
7. **Label treatment for a ZIP-code level name** (§4's "ZIP 11238" vs. "Bushwick" formatting
   question) — a small design decision, flagged so it isn't dropped once the architecture is
   approved.

---

*Spec only. No Cloud Function, Firestore collection, conversion script, or client code has been
written or deployed. Does not touch the CARTO basemap tile provider or its configuration — this
is a boundary/geometry data source only, fully decoupled from which tiles render underneath, per
Jake's explicit instruction. See `~/Desktop/pick-app/docs/LEDGER_INBOX.md` for the pointer note
appended for the next ledger reconciliation.*
