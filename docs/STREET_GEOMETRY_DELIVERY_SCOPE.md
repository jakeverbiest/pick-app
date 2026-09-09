# Scope — a sustainable replacement for the street-geometry precache

**Status: scoping and spec only. Nothing built, nothing deployed, not approved.**
Written 2026-09-09 by the `code` subagent, at Jake's direct request to scope a long-term
replacement for the drip-based precache he called "a band-aid."

Companion docs, all still valid as history: `OVERPASS_PRECACHE_SPEC.md` (what was built and
why), `VECTOR_BASEMAP_MIGRATION_SCOPE.md` (the MapLibre move this borrows a delivery idea
from), `NEIGHBORHOOD_ARCHITECTURE_REVIEW.md`, `LEDGER_INBOX.md` 2026-09-05 and 2026-09-09.

---

## 0. What was verified in this session, what was assumed, what could not be checked

Written first, deliberately, because the recommendation turns on one measurement.

### Verified live (2026-09-09, real network calls)

| Fact | Method |
|---|---|
| OSM edit rates for three real NYC neighborhoods | Overpass `out tags meta` on the app's own sidewalk/path query, timestamps binned locally |
| Most recent edits are tag-only, not geometry | 30-way sample against `api.openstreetmap.org/api/0.6/way/{id}/history`, diffing consecutive versions' node-ref lists |
| Chopped-geometry document sizes | Real Overpass `out geom` responses run through **this repo's own** `functions/shared/streetGeometry.js#chopWaysIntoSegments`, then serialized exactly as `refreshStreetTile` stores it |
| Compression ratio of that payload | `zlib` gzip -9 / brotli on the serialized form |
| Geofabrik extract size and freshness | HTTP HEAD on `download.geofabrik.de` |
| Every code claim below about `streetSegments.ts`, `functions/index.js`, `shared/streetGeometry.js`, `neighborhoods.ts`, `firebase.json` | Read directly in `~/Desktop/pick-app` this session |

### Assumed (taken from the ledger / task brief, not re-derived)

- 1,226 roster tiles; 95 currently warm; median 12 cells per NYC neighborhood (range 4–63);
  21 of 312 over the 25-cell cap. These come from `LEDGER_INBOX.md` and the code comments in
  `functions/index.js`, which were measured when written.
- The 8-tiles/4h ceiling traces to real 429s observed 2026-09-03. The ledger itself flags this
  as "inference from one data point, not a verified-safe ceiling," and nothing here changes that.

### Could not check — flagged, not worked around

1. **Firestore contents.** Reading `~/.secrets/pick-app/serviceAccountKey.json` was blocked by
   this session's permission layer, so I could not read `precache_streets` or
   `precache_meta/nyc_street_roster` directly. The task asked for "a sample of tiles' current
   Overpass response vs. what is stored." I could not do that literal diff. I substituted a
   measurement that answers the same question from the other side — how much OSM itself changed
   over the relevant windows — and say so plainly below. **If Jake wants the literal stored-doc
   diff, it needs a session with that key readable; the script is ~30 lines.**
2. **Overpass attic queries.** The cleanest test would have been to re-run the exact tile query
   with `[date:"2026-08-10T00:00:00Z"]` and diff the chopped output against today. The public
   `overpass-api.de` instance returned `runtime error: Query run out of memory using about
   2048 MB of RAM` for a *single* 0.01° cell, both with and without the regex clause. Not
   available on the free instance.
3. **Node-coordinate moves.** A way's `timestamp`/`version` do **not** bump when a member node
   is moved. So the edit rates below **undercount** pure geometry drift by an unmeasured amount.
   This cuts against my own conclusion and is stated rather than buried.
4. **Offline processing time** for a `.osm.pbf` extract. `osmium`/`pyosmium` are not installed
   here and I did not install them. Phase 2's runtime is an estimate, not a measurement.
5. **`england-latest.osm.pbf`** returned no `Content-Length` through its redirect chain. Every
   other region size below is a real header value.
6. **Discrepancy with the task brief:** the brief says "the 8 other curated cities."
   `CITY_SOURCES` in `apps/companion/src/services/neighborhoods.ts` currently holds **eleven**
   entries — `nyc, atl, sf, sea, la, chi, bos, sd, mia, ams, bri`. Two of those (Amsterdam,
   Bristol) are outside the US, which matters for Phase 2's extract list. Flagging rather than
   silently using my own number.

---

## 1. The measurement that reframes the problem

Direction 3 asked whether the 30/52-day refresh cadence is measured or merely conservative.
**It is not measured, and the data says it is roughly two orders of magnitude too aggressive.**

Three real NYC neighborhoods, queried with the app's own sidewalk/path filter, bucketed by each
way's current-version timestamp. (Bounding boxes are hand-drawn approximations of each
neighborhood, not the GeoJSON rings the app uses — close enough for a rate, not for a count.)

| | ways | edited ≤30d | ≤52d | ≤90d | ≤365d | ≤730d |
|---|---:|---:|---:|---:|---:|---:|
| Fort Greene | 671 | 71 (10.58%) | 79 (11.77%) | 80 (11.92%) | 175 (26.08%) | 195 (29.06%) |
| Sunset Park | 1,723 | **0 (0.00%)** | 2 (0.12%) | 6 (0.35%) | 41 (2.38%) | 553 (32.10%) |
| Astoria | 2,439 | 17 (0.70%) | 20 (0.82%) | 23 (0.94%) | 222 (9.10%) | 427 (17.51%) |
| **pooled** | **4,833** | **88 (1.82%)** | 101 (2.09%) | 109 (2.26%) | 438 (9.06%) | 1,175 (24.31%) |

Two things jump out, and both matter more than the headline percentage.

**(a) Change is bursty and spatially concentrated, not a steady rate.** Fort Greene's 71 recent
edits are **one mapper** (`TheBestIdea`) across **8 changesets**, one of which touched 40 ways.
Sunset Park had literally zero edits in 30 days but 32% in the 730-day window — an import burst
that finished over a year ago. A fixed TTL is the wrong instrument for this shape: it pays the
same cost everywhere, every cycle, to catch activity that lands in one neighborhood at a time.

**(b) Most edits do not change what we store.** Sampling 30 of Fort Greene's 67 recently-edited
ways against the OSM API's per-way version history and diffing the node-ref list between the
last two versions:

- **26 of 30 — node list unchanged.** A tag-only edit. `chopWaysIntoSegments` reads only
  `way.geometry`, so its output is byte-identical: same segment ids, same coordinates. Refetching
  these tiles produces a document identical to the one already stored.
- **4 of 30 — node list changed.** A real geometry edit. Even here, only the segments near the
  changed vertices move; a way's other 50m pieces keep their ids.

Applying that 13% structural ratio to the pooled way-level rate: **roughly 0.24% of ways per 30
days actually change the geometry we serve.** Even taking the way-level number at face value and
ignoring the tag-only finding entirely, **98.2% of every refresh cycle's work returns data
identical to what is already stored.**

Caveat repeated: node moves don't bump way versions, so the true figure is somewhat higher than
0.24%. It is not plausibly higher by the ~40x that would be needed to justify a 30-day TTL.

**Conclusion for direction 3: yes, most of the treadmill is waste, and it is the cheapest large
win available.** It is also the only one of the four directions that can ship this week.

---

## 2. What the current design actually costs, restated

Not re-derived — this is the task's own verified framing, kept here so the rest reads standalone.

- `getPrecachedSegmentsForRing()` (`apps/companion/src/services/streetSegments.ts:516`) is
  all-or-nothing. Any missing cell, any cell past `PRECACHE_STALENESS_MS` (52 days), any cell
  with an empty `segments` array, or any ring needing more than `MAX_RING_PRECACHE_CELLS` (25)
  → the entire neighborhood falls through to a live ~20s Overpass fetch.
- 21 of 312 NYC neighborhoods exceed 25 cells and **can never be fast**, including Sunset Park
  (30 cells), one of the ten hand-picked `STREET_SEED_POINTS`.
- 1,226 tiles at a 30-day refresh age expires ~41 tiles/day. Capacity is 8 × 6 = 48/day. **~15%
  headroom in steady state**, before any growth.
- 95 of 1,226 warm → the initial fill alone is ~24 days, competing with refresh.
- NYC only. The other ten curated cities have boundaries but no street precache at all.

The load-bearing observation: **almost every mechanism in `functions/index.js`'s precache
section exists solely to ration Overpass calls.** `PRECACHE_DRIP_BATCH_SIZE`,
`PRECACHE_MAX_GROUPS_PER_RUN`, `PRECACHE_GROUP_STALL_RUNS_MARGIN`, the roster cursor, the
append-only ordering invariant, `precacheGroups.js`, `PRECACHE_PRIORITY_LABELS`, the 15s retry
cooldown, `enforceCooldown` — all of it is scheduling machinery around a rate limit. Remove the
rate limit and roughly 600 lines of carefully-reasoned code become unnecessary. That is the
strongest argument for direction 1, and it is an argument about *complexity*, not just speed.

---

## 3. The four directions, evaluated

### Direction 1 — bulk extract instead of Overpass. **Adopt.**

Verified: `https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf` is
**496,139,693 bytes (473 MiB)**, `Last-Modified: Tue, 08 Sep 2026 22:55:37 GMT` — i.e. rebuilt
daily, free, no rate limit, no fair-use ceiling to reason about.

Extract sizes for every region containing a curated city (real `Content-Length` headers):

| region | size | covers |
|---|---:|---|
| `us/new-york` | 473 MiB | NYC |
| `us/california` | 1,266 MiB | SF, LA, San Diego |
| `us/georgia` | 339 MiB | Atlanta |
| `us/illinois` | 342 MiB | Chicago |
| `us/massachusetts` | 296 MiB | Boston |
| `us/washington` | 346 MiB | Seattle |
| `us/florida` | 626 MiB | Miami |
| `europe/netherlands` | 1,336 MiB | Amsterdam |
| `europe/great-britain/england` | *(no Content-Length returned)* | Bristol |

~5 GiB total for a full all-cities rebuild. That is a download, not standing infrastructure.

**Ingestion cost.** `osmium tags-filter` on a state extract, filtered to the exact tag
predicates already in `shared/streetGeometry.js`
(`highway=footway + footway=sidewalk`, `highway~pedestrian|path|living_street`, and the road
regex for the fallback), then the existing `chopWaysIntoSegments` over the filtered ways. The
chopping code is already pure and already shared between client and Functions — it can be
imported by an offline builder unchanged, which is the single most important compatibility
property here: **segment ids are `${wayId}_${index}` derived from the full way geometry, so a
`.pbf`-sourced chop produces the identical ids an Overpass `out geom` chop produces.** That is
what makes this a drop-in replacement rather than a data migration: every `segment_status` doc
ever written stays valid. (Verified by reading `chopWaysIntoSegments`; not executed against a
`.pbf` in this session.)

**Where it runs.** Offline, on Jake's Mac or a one-shot Cloud Run job. Not a scheduled function
— nothing about this needs to be unattended, and making it unattended is how the current design
grew its complexity.

**Refresh.** Re-run the whole build on a human cadence (see §4). No incremental sync, no
replication diffs, no per-tile freshness state. The measurement in §1 says a quarterly full
rebuild is more than adequate, and a full rebuild is dramatically simpler to reason about than
any incremental scheme.

**What it does not fix on its own:** all-or-nothing assembly, the 25-cell cap, empty tiles. Those
are client rules, not a supply problem.

### Direction 2 — cache the unit you serve. **Adopt the insight, reject the literal form.**

The claim that the grid decomposition manufactures the all-or-nothing problem is half right. The
grid does create the assembly problem — but **assembly is not what is broken; the assembly
*rule* is.** A partial hit being worth exactly zero is a policy choice made in
`getPrecachedSegmentsForRing`'s doc comment, and it can be changed without changing the storage
unit at all. So "the grid is the root defect" overstates it.

More decisively, I measured what a one-document-per-neighborhood store would actually weigh, by
running real Overpass geometry through this repo's own chopper and serializing it exactly as
`refreshStreetTile` does:

| | ways | segments | points | stored JSON | at 5-dec precision | gzip | brotli |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fort Greene (~4 cells) | 671 | 1,122 | 3,141 | 130 KiB | 118 KiB | 16 KiB | 12 KiB |
| Astoria (~12 cells) | 2,439 | 4,472 | 11,960 | **504 KiB** | 457 KiB | 70 KiB | 49 KiB |

Density: **~30–38 KiB of stored JSON per 0.01° cell** in dense NYC sidewalk coverage.
Extrapolating against Firestore's hard **1 MiB per-document limit**:

| neighborhood size | stored JSON | % of Firestore doc cap |
|---:|---:|---:|
| 4 cells | ~160 KiB | 16% |
| 12 cells (median) | ~480 KiB | 47% |
| 20 cells | ~800 KiB | 78% |
| 25 cells (today's cap) | ~1,000 KiB | **98%** |
| 63 cells (largest) | ~2,520 KiB | **246% — exceeds the limit** |

Note the Astoria row is measured over a bbox of about 12 cells; the roster says the real Astoria
is 20. Its true single-document size is therefore closer to ~800 KiB than the 504 KiB measured.

**This is the finding that kills the naive version of direction 2.** One Firestore document per
neighborhood does not fit for the large tail — and the neighborhoods it fails on are *the same
21* that break the 25-cell cap today. It would reproduce the identical failure set through a
different mechanism, while also making the median case a 480 KiB single-document read.

The insight survives, though: **the unit you serve should be the unit you store.** It just
cannot be a Firestore document. At 10–15% compression (verified: gzip 14–15%, brotli 10–11% —
this data compresses extraordinarily well because it is repetitive coordinate text), a
63-cell neighborhood is ~756 KiB gzipped or ~500 KiB brotli. Those fit anywhere that is not
Firestore-document-shaped.

**Coexistence with the point-radius path.** The task correctly flags that
`getSegmentsAround`/`markRouteCleaned` also read these tiles. Verified by reading: `markRouteCleaned`,
`nearestStreetSegment`, `assignRoutePointsToNearestSegment`, `routeCoverageFraction` and
`getTileStats` all consume `StreetSegment[]`/`RenderSegment[]` in React Native JS — they are not
render-only. So the spatial unit cannot be dropped. The resolution is not "two stores that can
drift": build **both artifact shapes from one offline pass**, so they are the same data sliced
two ways, generated together, versioned together. Drift is only a risk when two *fetchers* race;
it is not a risk when one build emits both.

### Direction 3 — question the refresh cadence. **Adopt, and do it first.**

Covered in §1. The measurement supports moving the server refresh age from 30 days to somewhere
in the 270–365 day range and the client staleness ceiling from 52 days to ~400.

Arithmetic at a 365-day refresh age: 1,226 tiles / 365 = **3.4 tiles/day** expiring against a
48/day capacity — **7% utilization instead of 85%**, a 14x margin. Growth stops eating the
margin. The 21 oversized neighborhoods are still broken (that is a client-rule problem), and the
~24-day initial fill is still ~24 days (that is a supply problem) — but the *treadmill* problem
disappears entirely, for the cost of two constants.

Two guardrails worth writing into the change:

- **The three TTLs must be reasoned about together.** `GEOMETRY_CACHE_TTL_MS` (AsyncStorage,
  30 days, checked *before* precache), `PRECACHE_TILE_REFRESH_AFTER_MS` (server, 30 days), and
  `PRECACHE_STALENESS_MS` (client rejection ceiling, 52 days). The client ceiling must stay
  comfortably above the server refresh age or good data reads as stale — that invariant is
  already documented in `streetSegments.ts` and must survive the change.
- **A long TTL raises the cost of shipping bad data.** The 2026-09-07 seed-offset bug served
  wrong geometry for days; a 365-day ceiling would have extended that window enormously. The
  only invalidation lever today is bumping the cache-key version (`@pick_sidewalks_v4_`), which
  requires an OTA. Before lengthening the TTL, there should be a deliberate kill switch — a
  remote-config-style `minGeometryVersion` or `precache_meta` epoch the client compares against,
  so a bad build can be invalidated server-side without an OTA. **This is a precondition, not a
  nice-to-have.**

### Direction 4 — vector tiles. **Adopt the delivery path, reject MVT as the primary format.**

Verified from `VECTOR_BASEMAP_MIGRATION_SCOPE.md` and the code: all four maps run **MapLibre GL
JS inside WebViews**, loaded from a CDN, and the whole migration ships OTA with no native build.
So the rendering side genuinely could consume vector tiles.

But the rendering side is not the only consumer. As established above, the RN side needs street
geometry **as data** for route snapping, coverage fractions and tile denominators — all of which
run in React Native JS, not in the WebView. Serving geometry only as MVT would mean adding a
Mapbox Vector Tile decoder to the RN bundle and reconstructing `StreetSegment[]` from tile
features, including stitching ways clipped at tile boundaries back together. **Tile clipping is
the killer:** segment ids are `${wayId}_${index}` computed by walking a way's *full* geometry.
A way clipped at a tile edge chops differently, producing different indices — which silently
breaks every `segment_status` doc ever written for that street. That is a correctness landmine,
not a performance tradeoff.

What direction 4 gets right is the **delivery model**: pre-built, static, CDN-cacheable,
city-agnostic, no per-request server work. That is achievable without MVT, and there is already
a precedent for it in this codebase: every entry in `CITY_SOURCES` downloads a large GeoJSON
from a plain public HTTPS URL into `FileSystem.documentDirectory` and caches it there. **Serving
street geometry as static compressed files on a CDN is not a new client primitive — it is the
pattern the app already uses for boundaries.** It ships OTA.

(If vector tiles are wanted *later* purely as a rendering optimization for very zoomed-out views,
that can be layered on top of the same build. It should not be the source of truth.)

---

## 4. Recommendation

**Do not pick one direction. The correct design is 3 → 2's insight → 1, with 4's delivery model,
sequenced so that each phase is independently shippable and each one is useful even if the next
never happens.**

Stated as a single sentence: **build the artifacts offline from a Geofabrik extract, publish them
as compressed static files keyed by both neighborhood and cell, drop the TTL treadmill in favor of
rebuild-on-publish, and fix the client's assembly rules so partial coverage is worth something.**

Why this order, and why not the alternatives:

- **Direction 3 first** because it is the only one that is a two-constant change, it is now
  backed by measurement, and it converts a 15%-headroom system into a 14x-headroom system
  *today* — buying the time to do the rest properly instead of under pressure.
- **Direction 1 as the actual long-term answer** because the drip's entire complexity budget is
  spent rationing a rate limit that a bulk extract does not have. This is what makes it a real
  replacement rather than a better band-aid: it deletes the mechanism instead of tuning it.
- **Direction 2's insight, not its literal form**, on the measured 1 MiB result.
- **Direction 4's delivery, not its format**, on the verified segment-id/clipping hazard.

### Target shape

One offline build (`tools/geometry-build/`, run on demand, not scheduled) that:

1. Downloads the relevant Geofabrik extracts (checksummed — the `.md5` files exist).
2. Filters to the app's exact tag predicates with `osmium tags-filter`.
3. Chops with the **unmodified** `functions/shared/streetGeometry.js#chopWaysIntoSegments`, so
   segment ids are guaranteed identical to everything already in `segment_status`.
4. Emits, per city, into a versioned prefix (`geometry/v1/<city>/…`):
   - one **cell artifact** per 0.01° cell — serves the point-radius/route-crediting path;
   - one **neighborhood artifact** per curated neighborhood — serves the ring-activation path,
     pre-filtered to segments whose midpoint is inside the ring so the client's
     `pointInPolygon` pass becomes unnecessary;
   - one small **manifest** (build id, timestamp, per-artifact byte size and checksum, and the
     list of cells that are *legitimately empty*).
5. Uploads to the existing Cloud Storage bucket (already configured — `storage.rules` is in
   `firebase.json`; **Firebase Hosting is not configured**, so Storage is the lower-friction
   host, though Hosting's CDN is worth pricing as an alternative).

Client reads the artifact, gunzips, caches in `FileSystem.documentDirectory` keyed by build id.
Same pattern as `CITY_SOURCES`. Falls open to today's live-Overpass path on any failure — that
fail-open property is the single best thing about the current design and must be preserved
verbatim.

**Expected artifact sizes, from the measured density:** median neighborhood ~144 KiB gzipped,
largest ~756 KiB gzipped, per-cell ~5 KiB gzipped. Whole-NYC street geometry is on the order of
tens of MiB compressed — one bucket, no sharding needed.

### What this removes

`PRECACHE_DRIP_BATCH_SIZE`, `PRECACHE_TILE_REFRESH_AFTER_MS`, `PRECACHE_MAX_GROUPS_PER_RUN`,
`PRECACHE_GROUP_STALL_RUNS_MARGIN`, `PRECACHE_PRIORITY_LABELS`, `precacheGroups.js`, the roster
cursor and its append-only invariant, `scheduledOverpassPrecacheDrip`, the 15s retry cooldown,
`enforceCooldown` on the background path, the 25-cell cap, the all-or-nothing rule, the
~24-day initial fill, and the entire question of what Overpass's fair-use policy means for a
shipped app. `precache_streets` itself can be retired once the artifact path is proven.

`runOverpass` stays exactly where it is for the live client fallback and for brand-new cities.

---

## 5. Defects the new design must not inherit

### 5.1 A legitimately empty tile permanently blocks its neighborhood (known)

`getPrecachedStreetSegments` and `getPrecachedSegmentsForRing` both treat
`!Array.isArray(segments) || segments.length === 0` as a miss. A cell that is open water, a park
interior, or a cemetery is **warm to the drip and a miss to the client**, forever. Because the
ring rule is all-or-nothing, one such cell condemns its whole neighborhood to the ~20s path
permanently, no matter how completely the rest is warmed.

The new design must distinguish **"no data yet"** from **"correctly zero."** Two mechanisms, and
the design should carry both: an explicit `segmentCount: 0` with a valid `builtAt` is a *hit*
that contributes zero segments; and the build manifest carries the known-empty cell list so the
client can tell the difference even for an artifact it has not fetched.

Note this is also fixable **today**, independently, as a one-line client rule change plus an OTA
— it does not need to wait for any of this.

### 5.2 Partial coverage is worth exactly zero (known)

The all-or-nothing rule is defended in `getPrecachedSegmentsForRing`'s doc comment on the
grounds that a gap-filling Overpass fetch costs about the same ~20s as a full one, so there is no
latency win in merging. **That reasoning is sound for Overpass and wrong for a CDN.** Once the
supply is static files, fetching the three artifacts you are missing is genuinely cheap and
parallel, so partial coverage becomes worth something and the ordering pressure that made the
drip's sequencing matter so much evaporates.

Consequence for the new design: **the assembly rule must allow partial hits**, fetching only the
missing artifacts. And `MAX_RING_PRECACHE_CELLS` should be deleted, not raised — it exists only
because probing 25+ cells against a nearly-empty Firestore collection was wasted reads. Against
a manifest, the client knows what exists before it asks.

### 5.3 A third defect, found while reading — the two read paths can disagree about segment ids

Not in the task's list, and worth flagging because it is live today and the new design would
inherit it silently.

Both fetch paths apply the same fallback: if the sidewalk query yields fewer than
`MIN_SIDEWALK_SEGMENTS` (30) segments, discard it and chop road **centerlines** instead, split
into `_L`/`_R` per-side virtual sidewalks. But they apply it at different scopes:

- `fetchStreetGeometry` (per tile, `shared/streetGeometry.js`) decides **per 0.01° cell**.
- `fetchStreetGeometryForRing` (`streetSegments.ts:770`) decides **once for the whole ring**.

So the same street can be `123456_4` on one path and `123456_4_L` / `123456_4_R` on the other.
`segment_status` is keyed by segment id, so **cleaning credit recorded under one id set does not
render under the other.** A neighborhood assembled from precached tiles can be a *mixture* of
both conventions, while the same neighborhood fetched live is uniformly one.

This produces exactly the user-visible symptom the 2026-09-08 seed-offset repair described — the
overview showing almost no streets cleaned while tapping into the neighborhood shows the full
history — via a second, independent mechanism that the seed-offset fix did not address. It
predates the precache (it is inherent to having two fetch paths) and I did **not** verify how
many real NYC cells fall under the 30-segment threshold, so its live blast radius is unmeasured.
**Recommend `qa` or a follow-up session measure that before it is treated as low-priority.**

The offline build fixes this by construction: make the sidewalk-vs-road decision **once per
neighborhood** at build time, record which convention each artifact uses, and emit cell artifacts
consistent with the neighborhood they belong to.

---

## 6. Migration path from today's state

Each phase is independently shippable and independently valuable. Nothing here requires a native
build — **every client change in this document is TypeScript and ships via `eas update`.** Stated
explicitly per the constraint. Server changes are `firebase deploy --only functions`.

**Phase 0 — invalidation kill switch.** *Precondition for Phase 1.* Add a server-controlled
epoch (a `precache_meta` doc or equivalent) the client compares against before trusting any
cached geometry, so bad data can be invalidated without an OTA and without waiting out a TTL.
Small. OTA + one function.

**Phase 1 — lengthen the TTLs.** `PRECACHE_TILE_REFRESH_AFTER_MS` 30d → 270–365d (functions
deploy); `PRECACHE_STALENESS_MS` 52d → ~400d (OTA). Optionally `GEOMETRY_CACHE_TTL_MS` too.
Backed by §1. Turns 85% capacity utilization into ~7% and stops growth eating the margin.
Reversible in one constant. *This is the fix Jake should get this week.*

**Phase 2 — fix the assembly rules.** Empty-is-a-hit (§5.1); allow partial hits; delete
`MAX_RING_PRECACHE_CELLS`. OTA-only. Unblocks the 21 oversized neighborhoods including Sunset
Park, and makes the drip's remaining runway productive instead of all-or-nothing. Note Phase 2's
partial-hit change is only clearly a win **after** Phase 3 changes the supply — against Overpass,
the existing reasoning still holds. Sequence accordingly, or ship the empty-tile half alone.

**Phase 3 — the offline build.** `tools/geometry-build/`, importing the existing chopper
unmodified. First target NYC only, published to Cloud Storage behind the existing bucket. Prove
it by diffing its output against a handful of live Overpass fetches — segment ids must match
exactly, which is the acceptance test.

**Phase 4 — client reads artifacts.** New read path in front of the precache read, same
fail-open shape. Precache stays as a second-tier fallback during the transition so there is no
flag day. OTA.

**Phase 5 — retire the drip.** Once artifact hit rates are confirmed in the field, delete
`scheduledOverpassPrecacheDrip` and the roster machinery. Keep `runOverpass` for live fallback
and for cities outside the build.

**Phase 6 — the other ten cities.** Now nearly free: the build is city-agnostic, gated only on
downloading another extract. This is the point at which the NYC-only limitation stops being a
limitation.

---

## 7. Cost — a real pass is required, not done here

**Flagged for `finance`, who owns the cost ceiling. The numbers below are shapes, not a budget,
and this document should not be treated as having done the math.**

What changes, and what needs pricing:

- **Firestore reads/egress today.** A ring activation on a 20-cell neighborhood is
  `ceil(20/10) = 2` queries returning 20 documents of ~35 KiB — **~700 KiB of Firestore egress
  per cold activation, per user**. The same content as a gzipped artifact is ~240 KiB, in one
  request. The read-count saving is real; the *egress* saving is the larger one and is the part
  most likely to matter as tester count grows.
- **Cloud Storage.** Storage of tens of MiB is negligible. Egress is the line item. The bucket
  already exists (`storage.rules` in `firebase.json`); **Firebase Hosting is not configured**, so
  if Hosting's CDN and free transfer tier would be cheaper, that is a config addition to price,
  not an assumption to make.
- **Firestore writes.** Publishing 1,226 artifacts per rebuild is trivial if they go to Storage;
  if any index lands in Firestore, count it.
- **Cloud Functions.** Phase 5 *removes* six scheduled invocations per day plus their 1,800s
  timeout headroom. A saving, not a cost.
- **The offline build.** Free if run on Jake's Mac. If it becomes a Cloud Run job, price it —
  ~5 GiB of ingress per full rebuild across all cities.
- **The one genuinely new recurring cost** is CDN egress scaling with active users, which the
  current design does not have (Firestore egress is on the same free tier as everything else).
  That substitution is the thing `finance` should actually model.

---

## 8. Open questions for Jake

1. **Rebuild cadence.** §1 supports quarterly. Monthly is cheap enough that the answer may just
   be "monthly because it is easier to remember." Either is defensible; a 30-day *TTL* is not.
2. **Phase 1 alone, or hold for the full plan?** Phase 1 is two constants and buys 14x headroom.
   Recommendation: ship it, and let Phase 3 be unhurried.
3. **Storage vs. Hosting** for the artifacts — a cost question, deferred to `finance`.
4. **Should the literal stored-doc drift check still be run?** I could not do it (§0). It would
   confirm §1 from the other direction. Cheap, ~30 lines, needs the service-account key.
5. **§5.3's blast radius** — how many real NYC cells fall under the 30-segment sidewalk
   threshold? Unmeasured, and it decides whether that defect is a footnote or a priority.
