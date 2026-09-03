# Overpass server-side pre-cache — spec + build record

**Status (2026-09-03, updated same day):** all six open questions in §5 decided by Jake and
implemented by the `code` subagent, then **deployed and confirmed live** on Jake's explicit
go-ahead. `firebase deploy --only functions,firestore:rules` and `eas update` (production,
runtime 1.2.2) both ran clean. A real bug surfaced on the first live refresh — Firestore
rejected the nested `[number,number][]` shape of `coords`/`ring` once embedded in the cached
array — fixed by flattening to `[lat,lon,lat,lon,...]` on write and unflattening on client read
(commit `b4b3f17`), redeployed, and **confirmed via a direct Firestore REST read** that a real
precache doc now exists with correctly-shaped data. The OTA was re-published a second time after
that fix so no client ever ran the stale unflatten-less code against real flattened data. Full
account in `LEDGER_INBOX.md`'s two 2026-09-03 entries. See the "Built / pending" note at the end
of §5 for what shipped.

**Origin:** `LAUNCH_LEDGER.md`'s "Overpass mirror reliance — structural risk" launch gate
(opened 2026-09-01), scoped 2026-09-02 in `LEDGER_INBOX.md` (three options evaluated: paid
Overpass host, self-host, server-side pre-cache). Jake picked pre-cache (Option C) as the
zero-new-standing-infra option that fits this thread's "narrow, deep work" framing per
`AGENTS.md`, not a recurring ops commitment like self-hosting would be.

**What this solves, and what it deliberately doesn't.** A genuine total outage across all
three public Overpass mirrors was confirmed live via curl (`LAUNCH_LEDGER.md`, 2026-09-01)
and mirror health was reconfirmed still flapping on a minutes-not-hours timescale the next day
(`LEDGER_INBOX.md`, 2026-09-02). This spec removes live Overpass from the critical path for
the common case — a new user's first map load in a popular tester city — by serving pre-fetched
data from Firestore instead. It does **not** eliminate the Overpass dependency for long-tail or
brand-new cities; those still make a live call and inherit today's hedge/retry/outage behavior
unchanged. That's an accepted tradeoff per the task framing, not a gap to close here.

---

## 1. What "popular neighborhood" means

Two things are cached, because the app makes two structurally different kinds of Overpass call
(grounded in `apps/companion/src/services/streetSegments.ts` and `neighborhoods.ts`, read
directly for this spec):

- **Street geometry** (`fetchStreetGeometry` in `streetSegments.ts`): sidewalk/road segments
  within a `FETCH_RADIUS_M` (600m) circle, keyed by `gridKey`. Fetched by *every* user in
  *every* city, including NYC/Atlanta/SF — the curated `CITY_SOURCES` in `neighborhoods.ts`
  only supply neighborhood *names and outline polygons*, not the sidewalk/coverage geometry
  the app tracks pickups against. This is the highest-volume Overpass caller.
- **Admin boundary polygons** (`fetchOsmBoundariesInBox` in `neighborhoods.ts`): city/district
  outlines for cities *outside* the three curated `CITY_SOURCES` (NYC, Atlanta, SF), keyed by
  a ~20km `OSM_CELL_DEG` cell. Only fires where `hasNeighborhoods()` is false.

**Seed list (initial, static).** Grounded in what's actually discoverable from this repo, not
invented: every tester walk on record so far is in Brooklyn, NYC — field-data coordinate
references in `LEDGER_INBOX.md`'s 2026-09-02 entry name Fort Greene (test query origin) and
Sunset Park (a real field incident, "36 to go"); `docs/fielddata/*.csv` file names (A7a, B4,
B5, B5B, B6, C6a, C7a) don't encode place names themselves, so exact neighborhoods can't be
pulled from those without opening and cross-referencing each CSV's lat/lon columns — worth
doing before build, not assumed here. Proposed seed, pending that confirmation:

- A handful of Brooklyn neighborhoods (Fort Greene, Sunset Park, at minimum — the two named
  in existing field records) as `gridKey` street-geometry tiles.
- NYC as a whole is already a curated `CITY_SOURCES` entry, so its *boundary* fetch isn't the
  bottleneck — only its street-geometry grid cells need pre-caching.
- Atlanta and SF: same reasoning — curated boundary source already fast/local; pre-cache their
  street-geometry grid cells too if/when testers are active there (currently no field evidence
  they are).

**How it grows over time — reuse `city_requests`, don't invent a second signal.** The task
brief is explicit that Pick already ships a demand-signal mechanism
(`requestCity`/`city_requests/{slug}` in `apps/companion/functions/index.js`, digested weekly
by `scheduledCityRequestsDigest` into `admin_rollups/city_requests_digest`, mirrored to
`~/pick-app/docs/CITY_REQUESTS.md`). That signal is *specifically* about cities that hit the
"OSM gave us one shape, no real subdivision" fallback case (`isFallbackCityWithNoSubdivision`)
— i.e., exactly the boundary-cache half of this problem. Proposal: extend
`buildCityRequestsDigest()`'s weekly rollup (or a sibling scheduled function reading the same
`city_requests` collection) to feed the pre-cache candidate list directly — e.g., any city
crossing a small request-count threshold (3-5 unique requesters, tunable) gets added to the
cache-refresh list on the next run. No new "what's popular" mechanism; this is additive to a
feature that shipped 2026-08-31.

The street-geometry half (gridKey tiles within registered cities) has no equivalent per-tile
demand signal today — `requestCity` only fires on the boundary-fallback path. Simplest fix:
approximate "popular tile" from wherever `cleanups` documents already cluster (real usage,
already in Firestore) rather than building new instrumentation — see open question 3.

**Second demand signal, added 2026-09-02 (Jake): outreach targets, not just organic requests.**
`city_requests` is a *pull* signal (users asking) and is currently empty — there's no organic
data to grow from yet. `crm`'s outreach target list (`docs/CRM_OUTREACH_AUDIT.md`, e.g. Litter
Legion, Astoria Trash Club, Jackson Heights Beautification Group) is a *push* signal: a known,
specific area Pick is about to proactively invite someone into. Proposal: before an outreach
email goes out to a specific org, pre-warm this cache for that org's neighborhood — the goal is
a fast, reliable first load at exactly the moment a new contact is deciding whether to trust the
app, not a coverage gap (the ZIP tier, `ZIP_BOUNDARY_TIER_SPEC.md`, already guarantees *some*
real boundary everywhere regardless of targeting). This doesn't require new infrastructure, just
feeding the existing seed-list mechanism from a second source (the outreach target list) in
addition to `city_requests`, whenever `crm` is about to reach out somewhere new.

---

## 2. Cloud Function shape

**What's cached — processed output, not raw Overpass JSON.** Cache the same shape the client
already builds client-side today: `StreetSegment[]` (post-`chopWaysIntoSegments`) for street
geometry, and `OsmBoundaryFeature[]` (post-`fetchOsmBoundariesInBox`'s stitch/filter/dedup
pipeline) for boundaries. Reasoning: caching raw Overpass JSON would just move the client-side
parsing/stitching cost server-side without removing it, and would tie the cache format to
Overpass's own response shape rather than the app's. Caching the processed shape means a
cache-hit is a straight Firestore read → same in-memory objects the client already knows how
to render, no new client-side code path for "cached vs. live" beyond the source of the bytes.

**Where — Firestore, not Cloud Storage.** Both artifact types are small per-tile (street
geometry `decimate()`s to a bounded point count already; boundary rings likewise bounded by
`MAX_SHAPE_DIAGONAL_KM`/dedup). Firestore's 1MiB document cap is comfortably clear of these
sizes at tile granularity, and it means one code path (Firestore reads) for both this cache and
the existing `org_stats`/`segment_status` rollups the same incremental-pattern precedent uses —
no new storage primitive to wire up SDK-side. Proposed collections:
`precache_streets/{gridKey}` and `precache_boundaries/{cellKey}`, each holding the processed
array plus a `refreshedAt` timestamp.

**Refresh cadence — daily/weekly, matching `neighborhoods.ts`'s own header comment that OSM
geometry "rarely changes."** A scheduled function (`onSchedule`, same convention as
`scheduledCityRequestsDigest`/`scheduledOrgSnapshots`) walks the current seed+demand-grown list
and re-fetches each tile from live Overpass, same `runOverpass` machinery already proven (mirror
hedge, preferred-mirror memory) — just called from the Cloud Functions runtime instead of the
client. Weekly is proposed as the default (cheap, matches the demand-signal's own weekly
cadence); daily is available if Jake wants faster pickup of new popular tiles, at roughly 7x the
function-invocation cost for the same Overpass call volume either way (this is a low-volume job
regardless — see cost estimate).

**Client-side cache-first check.** In `streetSegments.ts`/`neighborhoods.ts`, before calling
`runOverpass`: compute the tile/cell key exactly as today (`gridKey`/`osmCellKey`), read
`precache_streets/{key}` or `precache_boundaries/{key}` from Firestore first. On a hit, use that
data directly — skip the live Overpass call entirely. On a miss (doc doesn't exist, or exists
but is past a staleness ceiling — proposed: 2x the refresh cadence, so a weekly refresh job that
missed one run doesn't false-negative into treating good data as stale), fall through to exactly
today's live-Overpass path, unchanged. This preserves every existing in-memory/AsyncStorage/disk
cache layer already in place (`hoodsCache`, `osmHoodsCache`, `AsyncStorage` TTL caches) — the
Firestore precache slots in as a new, earlier check, not a replacement for those.

---

## 3. Cache-miss fallback behavior

Explicit requirement per the task: a cache miss must degrade to **today's** live-Overpass
behavior, not fail harder. Concretely, on a miss the client takes the exact same code path it
takes today with no precache in place at all — same `runOverpass` hedge/retry, same
`getCoverageOrThrow`/`getCoverageForRingTiled` 50%-success-rate refusal gate, same "Couldn't
load, try again" banner on a genuine total outage. The precache is a pure fast-path addition in
front of existing logic; it introduces no new failure mode of its own beyond "one extra Firestore
read before falling through," which fails open (any Firestore read error — permission,
transient outage — is treated identically to a cache miss, not surfaced as a distinct error to
the user).

---

## 4. Rough cost estimate (incremental-rollup-pattern lens)

Citing the precedent directly, per the task instruction: the 2026-09-01 Cloud Functions cost fix
(`LAUNCH_LEDGER.md` Closed section, "Cloud Functions cost fix — incremental Firestore rollups
replacing three full collection scans") replaced full-collection-scan-per-write/per-tick
patterns with maintained rollup documents read/updated incrementally, specifically because *cost
scales with cumulative history and call frequency, not with a fixed workload*. This pre-cache
design deliberately mirrors that lesson rather than repeating the mistake it fixed:

- **Write volume is bounded and small, not scan-based.** The scheduled refresh job touches only
  the seed+demand-grown tile list — order of tens of tiles at launch scale (a handful of Brooklyn
  neighborhoods' worth of `gridKey` cells, plus whatever `city_requests` promotes weekly), not a
  full re-scan of anything. Firestore write cost here is `O(cached tiles)` per refresh run, not
  `O(users)` or `O(history)`.
- **Read volume scales with actual traffic, same as any other Firestore read the app already
  does per session** (e.g. `city_stats`, `org_stats` reads already shipped) — one extra read per
  cache-check, replacing what would otherwise have been a live Overpass HTTP call. This is a
  *substitution* of cost (Firestore read instead of nothing, since Overpass itself is free) more
  than a new cost center, and Firestore's free tier (50K reads/day) has ample headroom at current
  tester-scale traffic.
- **Overpass call volume actually drops** for the common case: the scheduled refresh makes O(tile
  count) calls on its own cadence (weekly ≈ tens of calls/week) instead of every individual user's
  cold-load making one. This directly addresses the second flagged risk (the 6s hedge tripping
  the same rate limit under multi-tester load) by removing most client-triggered Overpass calls
  for popular areas — see the note in section 5.
- **No paid tier expected at this scale.** Rough order of magnitude: tens of cached tiles,
  weekly refresh, low-hundreds of reads/day at current tester counts — all comfortably inside
  Firestore's free-tier read/write quotas, similar order of magnitude to the already-shipped
  `org_stats` rollup reads. Should Firestore usage approach the free tier ceiling as tester count
  grows, that's the same signal that triggered the 2026-09-01 fix and should get the same
  treatment (rollup/cadence tuning), not a reason to avoid shipping this now.

This estimate is directional, not measured — no live Firestore billing data was pulled for this
spec (matches the "no live-verified pricing" caveat already flagged in `LEDGER_INBOX.md`'s
resiliency-options scoping). Worth a real cost check once built, same as `finance`'s existing
read-cost-tracking discipline on `org_stats`/`segment_status`.

### Note on the 429/hedge risk

The task asked to note, not necessarily solve, the finding that the 6s mirror hedge got a real
429 after two back-to-back heavier queries from one IP (`LEDGER_INBOX.md`, 2026-09-02). This
design is a natural, if partial, mitigant: for any tile the precache already covers, the client
never calls `runOverpass` at all — no hedge, no risk of tripping a rate limit on that request.
The residual risk is unchanged for cache-miss traffic (long-tail neighborhoods, brand-new
cities), where the existing hedge behavior and its 429 exposure remain exactly as they are
today. This spec doesn't attempt to fix the hedge's own rate-limit interaction — that's a
separate, still-open item.

---

## 5. Decisions (Jake, 2026-09-03) and what was built against them

1. **Seed list: Fort Greene + Sunset Park, Brooklyn.** `docs/fielddata/*.csv` were checked
   before implementing — they hold motion-classifier logs only (peak/dur/gyro/conf/accepted/
   counted/reason/speed), **no lat/lon columns**, so they can't further confirm or refine this
   list. That's the ceiling of available evidence; the two named neighborhoods were used as-is
   rather than blocking on data that doesn't exist. Built as `STREET_SEED_POINTS` in
   `apps/companion/functions/index.js` — three seed points (Fort Greene; Sunset Park
   north/south, since it's long and narrow along the waterfront), each public-knowledge
   centroids (not derived from the CSVs), each expanded to a 3x3 block of 0.01° `gridKey`
   tiles (27 tiles total before any demand-driven growth).
2. **Refresh cadence: weekly**, matching the `city_requests` digest cadence. Built as
   `exports.scheduledOverpassPrecacheRefresh = onSchedule('every monday 07:00', ...)` in
   `apps/companion/functions/index.js`.
3. **Street-geometry growth signal: hybrid of (a) + (c).** Starts on the static seed list
   (option c); grows past it once real `cleanups` documents cluster in a `gridKey` tile (option
   a) — threshold: **3+ cleanups in the same tile within a rolling 30-day window**
   (`CLEANUP_PROMOTION_THRESHOLD` / `CLEANUP_PROMOTION_WINDOW_MS`). Reads the same `cleanups`
   collection `scheduledPublicStats` already scans on its own schedule, so this is a second
   consumer of an existing weekly-cadence read, not a new standing cost. **Option (b)
   (unconditionally caching all of NYC/Atlanta/SF) was explicitly NOT implemented** — it
   reintroduces the unbounded-scan cost pattern the 2026-09-01 Firestore fix eliminated.
   Boundary-side growth reuses `city_requests` per §1's own proposal (not a new mechanism):
   `promotedBoundaryCellsFromCityRequests()` promotes any city crossing 3 unique requesters
   (`city_requests.count`, already deduped by `requestCity`'s transaction), forward-geocodes it
   via Nominatim (same client convention as `osmBoundaryByName`), and precaches that boundary
   cell. `city_requests` is empty at the time this shipped, so this makes the mechanism real
   without there being anything to promote yet.
4. **Staleness ceiling: 2x refresh cadence = 14 days.** Built as `PRECACHE_STALENESS_MS` in
   both `src/services/streetSegments.ts` and `src/services/neighborhoods.ts` — a doc past this
   age is treated as a cache miss, not served as fresh.
5. **Code reuse: extracted, not duplicated.** `runOverpass`'s hedge/mirror-failover logic moved
   to `apps/companion/functions/shared/overpassClient.js`. Because building the refresh job also
   requires producing the *exact same cached shape* the client builds (§2's "same shape"
   requirement), the fetch/chop/stitch pipelines around it were extracted too, not just
   `runOverpass` itself: `apps/companion/functions/shared/streetGeometry.js`
   (`fetchStreetGeometry`, `chopWaysIntoSegments`, `gridKey`, `distM`, `offsetCoords` — moved
   verbatim from `streetSegments.ts`) and `apps/companion/functions/shared/boundaryGeometry.js`
   (`fetchOsmBoundariesInBox`, `stitchOuterWays`, `ringBBox`, `ringDiagonalKm`, `osmCellKey` —
   moved verbatim from `neighborhoods.ts`). These live under `functions/shared/`, not
   `src/shared/` or a repo-root `shared/`, because `firebase deploy` only packages the directory
   named in `firebase.json`'s `functions.source` ("functions") — a shared file has to physically
   live inside that tree to ship with the deployed function. The client reaches IN with a
   relative import from `src/services/{streetSegments,neighborhoods}.ts`; Metro's project root
   is `apps/companion`, so `functions/` is inside the same dependency graph and this resolves
   like any other sibling module — verified via `tsc --noEmit` (0 errors) and the existing
   `npm run test:geometry` / `test:tiles` suites (26/26 passing) after the extraction.
   `hasFineSubdivision` classification (`MIN_SUBDIVISION_SHAPES`/`MAX_DOMINANT_AREA_FRACTION`)
   stayed client-only — it's a UI-only judgment call the refresh job has no use for.
6. **Sequencing: built now**, not held for EAS build-number confirmation or mirror-health
   stabilization — both unrelated blockers per this section's own original reasoning.

**Built / committed (2026-09-03):**
- `apps/companion/functions/shared/overpassClient.js`, `streetGeometry.js`,
  `boundaryGeometry.js` — the shared fetch/hedge/chop/stitch pipelines (decision 5).
- `apps/companion/functions/index.js` — `refreshOverpassPrecache()` and its helpers
  (`promotedStreetTilesFromCleanups`, `promotedBoundaryCellsFromCityRequests`,
  `geocodeCityCentroid`, `refreshStreetTile`, `refreshBoundaryCell`), exported as
  `scheduledOverpassPrecacheRefresh` (weekly `onSchedule`, decision 2) and
  `runOverpassPrecacheRefresh` (gated manual `onRequest` trigger, same convention as
  `runCityRequestsDigest`/`runAdoptionCheck`, so Jake can force a refresh without waiting for
  Monday once this deploys).
- `apps/companion/src/services/streetSegments.ts` — cache-first check in `getSegmentsAround()`
  reading `precache_streets/{gridKey}` before falling through to live Overpass (spec §3: fails
  open on any miss or Firestore read error, identical to today's behavior with no precache).
- `apps/companion/src/services/neighborhoods.ts` — same cache-first check in
  `loadOsmHoodsForCell()` reading `precache_boundaries/{cellKey}`.
- `apps/companion/firestore.rules` — `precache_streets`/`precache_boundaries`: public read
  (matches `city_stats`'s pattern — this is the same public-domain OSM geometry the app already
  fetches directly, unauthenticated), write blocked to clients (Admin SDK bypasses rules; only
  the scheduled/manual refresh functions write these).
- This file (§5, above) and `~/Desktop/pick-app/docs/LEDGER_INBOX.md` (dated entry for the next
  reconciliation).

**Deployed (2026-09-03, same day, Jake's explicit go-ahead):**
- `firebase deploy --only functions,firestore:rules` — ran clean. `scheduledOverpassPrecacheRefresh`
  and `runOverpassPrecacheRefresh` created, rules released, every other function updated
  without incident.
- `eas update` — published twice. The first publish (update group `02b5d94c`) shipped before a
  bug was found (see below); a second publish (update group `d0306cec`) shipped the fix before
  any real device could hit a populated cache with the broken client logic.

**Bug found and fixed post-deploy (2026-09-03):** the first manual trigger of
`runOverpassPrecacheRefresh` failed every street-tile write — Firestore rejected
`StreetSegment.coords`/`OsmBoundaryFeature.ring` (`[number,number][]`) once nested inside the
segments/features array ("Property array contains an invalid nested entity"). This is the exact
nested-array constraint `src/services/challenges.ts`'s `flattenRing`/`unflattenRing` already
works around elsewhere in this codebase — the precache write path hadn't applied it. Fixed
(commit `b4b3f17`) by flattening `coords`/`ring` to `[lat,lon,lat,lon,...]` in
`refreshStreetTile`/`refreshBoundaryCell` and rebuilding pairs in the two client read functions.
Redeployed the two functions, re-triggered the refresh, and **confirmed via a direct Firestore
REST read** (`GET .../documents/precache_streets/40.67_-73.99`) that a real doc now exists with
correctly-shaped flattened data. Full account in `LEDGER_INBOX.md`.

**Not yet independently re-verified:** the manual trigger's HTTP response times out at 60s (the
function's own `timeoutSeconds`) before the full ~9-tile sequential refresh finishes, though
writes complete server-side regardless (confirmed by the successful read after the "timeout").
Only one Fort Greene tile was spot-checked this pass — worth confirming the rest of the seed set
populated, and watching the first real scheduled (not manual) weekly run succeed end to end.

**Judgment calls made without a separate ask:**
- Exact seed-point coordinates and the 3x3-tile radius per point (§1) — sized to keep the seed
  list in the "tens of tiles" range costed in §4, not to exhaustively cover either
  neighborhood's real extent.
- The manual-trigger secret `PRECACHE_REFRESH_KEY` follows this file's existing
  `CITY_REQUESTS_DIGEST_KEY`/`ADOPTION_TRIGGER_KEY` convention (hardcoded query-param secret,
  not `process.env` — nothing else in `functions/index.js` reads from `process.env` for a gate).
- `city_requests`-driven boundary growth (spec §1's proposed extension) was implemented now
  rather than deferred, since it required no new mechanism beyond reading the existing
  collection and reusing the existing Nominatim-geocode convention already used client-side.
