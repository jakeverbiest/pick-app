# Ledger inbox — interactive sessions → scheduled reconciliation

**`docs/LAUNCH_LEDGER.md` has one writer: the daily `pick-ledger-reconciliation` scheduled
task.** Interactive sessions (Claude Code or otherwise) read the ledger freely but do not edit
it directly — that was the point of moving to a single writer: no more collisions between a live
session and the scheduled run on the same file (this repo has hit that class of bug before —
duplicate commits 72s apart, a stranded `.git/index.lock`).

If you're in an interactive session and learn something that should update the ledger — a fix
landed, a blocker cleared, a new open item — append a dated bullet here instead. The scheduled
task reads this file first, folds entries into the ledger's actual structure, and clears it on
each run.

Format: one dated bullet per item, plainly stated — the scheduled task will reconcile it into
the ledger's actual structure, not paste it verbatim.

<!-- Example:
- 2026-08-26 — PhoneLink.swift split-response fix committed as 7b19cd8, xcodebuild clean. No
  longer an open item.
-->

- 2026-09-07 — **FIRST GROUND-TRUTH WALK EVER RECORDED. The watch LOG PICK -> Firestore chain is
  proven end to end.** Cleanup `TVfzDQzgfOJ5vkfuZNRT`: 10 deliberate taps produced
  `ground_truth: [13,17,24,35,41,47,50,53,56,62]` — ten entries, in walk-seconds, sensibly spaced.
  Every prior walk carrying the field had an empty array.
  **Correcting an error made earlier the same day:** an export summary reported "11 walks with
  ground_truth." All 11 were **empty arrays** — `Array.isArray` was checked, `.length` was not.
  `ground_truth` is written UNCONDITIONALLY on every walk (`"[]"` when there are no taps), so that
  count only ever meant "walks recorded after the field was added," never "walks with usable
  ground truth." True prior count was **zero**. Jake confirmed he had never used the feature.
  **The reported failure was not a failure.** Jake's symptom was "I click the button and it
  doesn't increase the pick count." That is the designed behavior, stated in
  `groundTruthMode.ts`: the taps are deliberately not wired into the count, because "the moment
  they also move the number they are measuring, they stop being a measurement." Worth recording
  as a UX finding — the one tester who knows the codebase best still read correct behavior as a
  bug, and the Settings sub-label ("It never changes your count") did not prevent it.
  Ruled out along the way, each checked rather than assumed: build 36 (`fac45bb`, 2026-09-01) DOES
  contain the native LOG PICK button and the `logPick` sender — verified by reading
  `ContentView.swift`/`PhoneLink.swift` at that exact commit; the pending cache-v4 OTA is
  irrelevant to it (native button, no OTA can add or fix one); and the JS cache that gates the
  watch push is warmed on map mount (`map.tsx:346`).
  **NOT a bug, checked before reporting: `items_detected: 2` while the motion log carries 4 events
  flagged `counted: true`.** `trimRecentPickups(3500)` drops pickups in the final 3.5s because
  pulling the phone out to hit Stop reads exactly like a pickup; t=63 and t=66 were trimmed.
  **Analysis trap worth recording: `counted: true` in `motion_log` does NOT equal the final count.**
  Anything scoring this corpus by counting those flags will over-count by whatever the tail guard
  removed.
  **This walk measures nothing about accuracy** and must not be read as if it does: Jake tapped 10
  times without picking anything up, so the true reading is 0 real picks against 2 reported. What
  it does show is the pause gate behaving — **25 of 40 events rejected for "still at own pace,"**
  correctly noticing he never paused.
  **Hypothesis to control for, deliberately NOT recorded as a finding:** 3 of the 4 counted events
  landed 1-2s after a wrist tap, raising the worry that raising the wrist to tap reads as a pickup
  and the measurement contaminates itself. **The evidence is weak and was sanity-checked rather
  than reported as-is:** ten taps put a 3s shadow over ~55% of a 55-second walk, so chance alone
  predicts ~2 of 4. Control for it on the real walk by tapping BEFORE bending, not after standing,
  which separates the two motions in time.
  **Real walk protocol:** 20-30 actual pickups, tap just before each, walk normally and pause
  naturally, no other watch taps.

- 2026-09-07 — **Detector telemetry export DEPLOYED and verified live (`aeeade4`, `a62ab86`) — and
  the first run surfaced the finding that actually matters: under the conservative privacy reading
  the export is EMPTY.**
  `exportDetectorTelemetry` is wired into `index.js`, `DETECTOR_EXPORT_KEY` created in Secret
  Manager, deployed to `us-central1`. Verified: HTTP 200 / `ok:true`; auth gate returns 403 for
  both a missing and a wrong key. `detectorExport.staged.js` renamed to `detectorExport.js` — a
  deployed file called ".staged" is the exact stale-label trap this repo keeps hitting.
  **THE FINDING — this is now the real gate, not the function.** Of 206 cleanups, **162 carry a
  `motion_log`** (the actual detector payload). Cleanups **since 2026-09-06** (the date the privacy
  policy disclosed detector R&D as a use): **1, and it has no `motion_log`.** So *every one* of the
  162 usable detector records predates the disclosure. Run inside the disclosed window the export
  returns **0 rows** — confirmed, not predicted. The retroactive-scope question is therefore not a
  footnote to be settled later; it is the difference between having a corpus and having nothing.
  **Jake's call, two options, both legitimate:** (1) decide the disclosed use reaches
  pre-disclosure walks and export the full history, or (2) hold the line and build the corpus from
  new walks only — which makes the still-outstanding ground-truth walk the critical path rather
  than a nice-to-have. Nothing has been exported beyond the bounded `since=2026-09-06` probe, which
  wrote a 0-row file. **No unbounded run has been made and none should be until Jake decides.**
  **Bug found by testing, not review (`a62ab86`):** the first real invocation returned HTTP 500.
  `getSignedUrl` needs `iam.serviceAccounts.signBlob`, which the default compute service account
  lacks — the export had already completed and the object was in the bucket, but the throw reported
  a successful export as a total failure. Signing is now best-effort: `object_path`/`row_count`
  always returned, with a ready-to-run `gcloud storage cp` command when signing fails. Chose that
  over granting `roles/iam.serviceAccountTokenCreator`, which would hand the function broad
  impersonation rights purely to produce a download link.
  **`carry_mode`/`device_model` remain excluded**, unchanged — policy discloses collecting them,
  not using them for cross-tester analysis. Worth restating as a real cost rather than a clean win:
  those are precisely the two fields that would stratify a multi-tester corpus by phone and carry
  position. Unlocking them is a privacy-policy amendment, not a code change.
  Privacy boundary verified by execution, not by reading the comment: `buildTelemetryRow` run
  against a realistic doc carrying `location_lat/lon`, `city`, `team`, `carry_mode`,
  `device_model`, `route_points` and `userId` — none survive, and the timestamp reduces to a day
  bucket. The allowlist is enforced at the *query* level via Firestore `select()`, so excluded
  fields are never read out of the database at all.

- 2026-09-07 — **REAL BUG, user-reported and root-caused: the precache served the wrong half of
  its own cell, so the map overview showed almost no cleaned streets. Fixed in `d93873b`;
  code NOT YET DEPLOYED and the data repair NOT YET RUN (both blocked by the tool classifier —
  Jake's to run, in that order).**
  Jake's report: "when I start the app, my neighborhood shows very little streets that have been
  touched, when I click into my neighborhood it shows a huge amount of decaying streets."
  **Those are two different geometry sources, and the overview was the wrong one.** The level view
  runs a live whole-ring poly query that never consulted these tiles, so it was correct all along.
  **Root cause:** `gridKeysAround()` stored the STEPPED point as each cell's representative fetch
  point, preserving the original hand-picked seed's offset within its cell across the whole
  generated block. Fort Greene's centroid sits ~539m from its cell center, so all 56 cells in that
  block inherited the same corner-ward offset. `refreshStreetTile` fetches a 600m disc around that
  point and files it under the cell key — a disc centered 539m off-center covers about half of its
  own 1112m x 843m cell and spills the rest outside.
  **Evidence (measured, not inferred), cell `40.67_-74.00`:** a live fetch at the true cell center
  matched **196/202 (97%)** of that cell's `segment_status` docs; the cached off-center disc
  matched **12/202 (6%)**. precache∩live was only 43%.
  **Scope:** 56 of 1,226 roster tiles, worst offset 631m — and because they were the original
  Brooklyn block they sat at the FRONT of the drip queue, so **all 56 were already written: 60% of
  the 94 tiles cached**, centered on exactly where the app is used. It worsened as the drip
  advanced, which is why it surfaced now rather than at rollout.
  `deriveNycNeighborhoodTiles` (2026-09-05) already derived centers correctly; the roster is
  append-only first-writer-wins, so the 2026-09-03 cells kept the wrong point.
  `promotedStreetTilesFromCleanups` had the identical defect (stored the cleanup's own coordinate)
  and is fixed too — it had never fired, so it never bit. Boundary cells are unaffected:
  `refreshBoundaryCell` floors the cell to build its bbox, so the seed's position never reaches
  the query.
  **NOT a bug, checked separately:** that the history renders red is correct. 70% of the 547
  `segment_status` docs are genuinely 20+ days old (range 4.2-87.8 days) and the gradient
  saturates at 20. Only 9% are inside the 5-day green band.
  **Order of operations matters:** deploy the `gridKeysAround` fix FIRST, then run
  `functions/repair-precache-seeds.js --apply` — otherwise Monday's roster rebuild writes the bad
  coordinates straight back. The repair recenters the 56 entries, deletes the 56 poisoned docs
  (client fails OPEN on a miss, so those cells revert to the live path rather than serving wrong
  geometry until the 52-day ceiling), and resets the cursor so Brooklyn re-warms in ~1.2 days
  instead of ~25. Dry-run by default; safe to re-run.
  **Three wrong theories worth not repeating**, all killed by measurement: (1) per-pan re-projection
  cost — 0.8ms, fine; (2) the 600m disc vs the cell's 698m half-diagonal — only 4.6% of cell area,
  and Overpass returns whole ways reaching 1331m; (3) the `MIN_SIDEWALK_SEGMENTS` road-centerline
  fallback poisoning tiles — all 94 tiles contain sidewalk-id segments, and the worst-matching tile
  is 99% sidewalk. The seed offset was the only theory the data supported.

- 2026-09-07 — **Backlog cleared: 4 commits pushed to the public repo, and the signup/invite OTA
  shipped to production.** The 13-day unpushed gap that caused the 2026-09-07 secret incident is
  now zero — `0b9639f..cbb081c` pushed to `origin/main`, pre-push secret scan clean.
  **OTA published** from a completely clean working tree (so the shipped bundle is exactly
  `cbb081c`, not a working-tree variant — the hazard `publish-detector.sh` exists to prevent):
  branch `production`, runtime 1.2.2, update group `c7ad7766-7795-414e-9d15-e3858bc43d1a`,
  iOS+Android. Carries `339d9f0` only, in app terms — Sign in with Apple promoted to the primary
  signup path with name/email/password collapsed behind "Use email instead," plus the
  `Share.share()` challenge invite link. The three later commits are Cloud Functions and docs, so
  they needed no OTA and were already deployed.
  Pre-flight: `tsc --noEmit` clean, `test:hoods` 10/10, `test:recap` pass.
  **CARTO key verified inlined in the shipped iOS Hermes bundle** — `key=undefined` occurs 0
  times and the real 35-char key occurs once. Worth doing every time: this exact regression
  shipped three times (31 Aug native, 1 Sep OTA x2), and `apps/companion/.env` does NOT exist —
  the publish only works because `publish-detector.sh` falls back to the repo-root `.env`.
  Adjacency in `strings` output is NOT evidence either way, since Hermes stores string literals
  in a separate table; the positive check (grep for the actual key value) is the one that counts.
  **Not yet field-verified:** nobody has force-quit and reopened the app to confirm the new bundle
  is actually running, and the signup change is on the one screen a new tester sees first.

- 2026-09-07 — **Neighborhood-outline slowness root-caused: `precache_boundaries` has been empty
  since it shipped. Fixed in `05de916`, COMMITTED BUT NOT DEPLOYED — the deploy was blocked by
  the tool classifier and is Jake's to run.**
  Measured, not inferred: `precache_boundaries` holds **zero documents and always has**, so every
  client read of it (`neighborhoods.ts` `getPrecachedBoundaryFeatures`) is a guaranteed Firestore
  miss followed by a live Overpass call — the ~20-27s wait on the outline path. **46 of 206
  cleanups (22%) sit outside every curated `CITY_SOURCES` city** and so take that path, 39 of them
  in one cell (Pawleys Island / Murrells Inlet / Georgetown County, SC — the Litchfield area).
  **Root cause was a bootstrapping deadlock, not a defect in the refresh job.** The only entry
  point was three unique requesters tapping "request my city" for the same city, and that card
  only appears in the narrow `isFallbackCityWithNoSubdivision` case. `city_requests` is still
  empty, so the gate is unreachable at current user numbers. Streets never hit this because they
  seed from a static roster *and* promote from real cleanups; boundaries had no equivalent.
  Fix mirrors the street side (`promotedBoundaryCellsFromCleanups`, same collection/window/
  threshold, keyed by the ~20km `osmCellKey`), plus one deliberate divergence: promoted cells are
  **sticky** (`precache_meta/boundary_cells`, append-only). `refreshBoundariesOnce` recomputes its
  set every run, so without persistence the SC cell would drop out of the 30-day window around
  2026-09-19, go stale 14 days later, and fall back to live Overpass silently.
  Dry-run against production: **2 cells, 2 Overpass calls/week** (SC, plus a Brooklyn cell that
  writes a doc nobody reads — curated cities never call `getOsmHoodsInBounds`; accepted rather
  than duplicating the client's city registry into `functions/`).
  **DEPLOYED AND VERIFIED 2026-09-07.** Jake ran the deploy; the manual trigger
  (`runOverpassPrecacheRefresh?rebuildRoster=1`) returned HTTP 200 in 69s with
  `boundaries: {attempted: 2, ok: 2, failed: 0}` and `roster: {total: 1226, added: 0}` — the
  `attempted: 2` is itself the proof the new code was live, since the old code could only ever
  report 0. `precache_boundaries` now holds **2 documents where it had held 0 since it shipped**,
  and `precache_meta/boundary_cells` persisted both cells, so next Monday's run refreshes them
  without re-deriving. The SC cell serves from cache now instead of a live Overpass call.
  **Caveat found in the verification output, NOT fixed here and not caused by this change:** the
  SC cell came back with only **2 shapes — "Garden City" and "Pawleys Island."** Murrells Inlet
  and Georgetown County, both of which appear as `city` on real cleanups there, are absent. The
  Brooklyn cell is more telling still: it returned Edgewater, West New York, Guttenberg, North
  Bergen and Bronx County — **New Jersey municipalities and a county, no Brooklyn neighborhoods
  at all.** This is the already-documented `admin_level=8` limitation (LAUNCH_BUGLIST.md: the
  level means whole-municipality in most of the US, sub-city district elsewhere), not a
  regression. Net effect of this fix on the OSM path is therefore **speed only — the same thin
  outlines, ~20-27s sooner.** Real outline QUALITY outside the curated cities is a separate open
  problem, and the honest path to it is the buglist's own answer: promote a city into
  `CITY_SOURCES` with a curated source. Worth considering for the SC coastal strip given 39
  cleanups and Jake's own testing there.
  **Two negative results worth not re-investigating.** (1) The curated-city per-pan cost is NOT a
  problem: `getHoodsInBounds` re-projects and bbox-tests all 312 NYC hoods on every pan, which
  looked like an obvious win, but it **measures 0.8ms** for 32,315 vertices — `map.tsx`'s existing
  "cheap regardless of zoom" comment is correct, and the 1.5MB GeoJSON is one-time-per-install.
  (2) The street-tile roster is **already demand-ordered** — all nine seeded Brooklyn
  neighborhoods sit at indices 0-49 and are done; Astoria (idx 137) lands ~2026-09-08 and Jackson
  Heights (idx 762) ~2026-09-21, matching what the ledger already predicted. Reordering it buys
  nothing. Street precache is at **94/1,226 tiles (7.7%)**, cursor 96, full cycle ~2026-10-01 —
  on plan, not a bug.

- 2026-09-07 — **Loose ends tied up: three files left uncommitted across two sessions are now
  in, and a direct contradiction between two committed docs is resolved.**
  **`docs/PUBLIC_BETA_GONOGO.md`** (another session's edit) rewrote the draft Beta App
  Description to match the locked positioning line and marked the "one stale line, three places"
  item RESOLVED. **That RESOLVED claim was verified rather than taken on trust** — `about.html`,
  `support.html` and `index.html` still contain the words "over-count," but in the past tense
  ("it used to over-count badly on a slow walk; an August fix brought a controlled test to 20
  counted for 20 real"). The copy is corrected and notably honest, carrying "that's one tester on
  one afternoon" and the screenshot-before-correcting instruction. Claim holds.
  **`docs/DETECTOR_EXPORT_SPEC.md` + `functions/detectorExport.staged.js`** are a careful first
  pass — staged, not deployed, not wired into `index.js`. The code enforces its privacy scope at
  the *query* level (`.select()` over an `ALLOWED_TOP_LEVEL_FIELDS` allowlist) rather than
  filtering after reading, which is stronger than the spec required.
  **The contradiction, and the correction:** `DETECTOR_VALIDATION_PLAN.md` §7a (written
  2026-09-06) declared the export Cloud Function unnecessary; this spec argues it is the top
  priority. Both were partly wrong and both are now amended in place.
  §7a was right that **access is not the constraint** — the owner-only rule governs client SDK
  access, not the admin SDK, and the admin service account has read every cleanup repeatedly this
  week. The spec's original "unreadable by Jake" framing was imprecise and is corrected.
  But §7a was **wrong to conclude the function has no purpose**: it judged it as an access tool
  when its real value is **privacy posture**. Routinely reading raw identifiable owner-scoped
  documents is heavier than analyzing a non-identifying derivative — and Safety's 2026-09-06 pass
  independently declined to write "anonymized" into the privacy policy on the grounds that the
  pipeline did not exist yet, explicitly deferring the stronger claim until this function ships.
  Net: **worth building, for privacy rather than access**, and not a prerequisite for the
  ground-truth walk, which needs no new infrastructure.
  **Two open questions in that spec are policy, not engineering, and should not be settled by
  writing code:** (1) whether a use disclosed 2026-09-06 may be applied retroactively to walks
  collected before it — the design as staged exports every cleanup ever written, including
  anonymous public-tester walks predating any detector-R&D disclosure; and (2) whether
  `carry_mode`/`device_model` may enter the export at all, given they received a *collection*
  disclosure but not a *use* one. The spec correctly declines to answer both. Both need Jake.

- 2026-09-07 — **Three bug-and-hygiene items closed. `test:hoods` runs again after eight weeks,
  so all six suites are green for the first time since 2026-07-14.**
  1. **`test:hoods` unrunnable since 2026-07-14 (`5609385`).** It died before a single assertion
     with `react-native/index.js:27:7: Unexpected "typeof"` — esbuild cannot parse React Native's
     Flow-typed entry point. It reached that import transitively: the test imported
     `neighborhoods.ts`, which imports `expo-file-system/legacy`, which pulls in `react-native`.
     `streetSegments.ts` has no such import, which is why every other suite loaded fine.
     `polygonStats` and `isFallbackCityWithNoSubdivision` were always pure — just trapped behind
     a platform import. Moved to new `src/services/hoodMetrics.ts`, following the same separation
     `functions/shared/*` already uses; `neighborhoods.ts` re-exports both so `app/(tabs)/map.tsx`
     (the only importer) is untouched. **All 10 assertions pass and nothing was actually broken
     behind the failure** — the logic was correct the whole time, it just could not be loaded.
     Worth stating plainly: for eight weeks "we have a test for this" was not true.
  2. **Challenge `status` derived from dates instead of a stale stored field (`5d39d2d`).** The
     stored field was written once at creation and never updated, so it drifted the moment a
     challenge started or ended — Litchfield stores "upcoming" three weeks after it ran; Saturday
     Smith Street Sweepers stores "active" five weeks after it ended. `fromDoc()` already
     recomputes status on read, which is why nothing looked wrong in the UI and why the drift went
     unnoticed. Two queries (`findMyActiveChallenge`, `challengeLive.ts`) matched
     `status in ['active','upcoming']`, which every challenge ever created keeps matching forever
     — correct only because both re-filtered by date in JS afterward, but fetching the whole
     collection to do it. Both now filter `end_date >= now`. `getChallenges` in
     `firebaseDatabase.ts` queried `status == 'completed'`, which returned nothing ever;
     **deleted rather than fixed** — no callers repo-wide, and it was a stale parallel
     implementation of what `challenges.ts` already does. Status is no longer written at creation.
     Verified before shipping: `end_date` is a plain seconds number on all five live challenges,
     so the inequality matches them all. Existing docs keep their stale field — harmless now that
     nothing reads it, not worth a production write.
  3. **Park fetches now back off after a mirror outage (`b49e3fa`).** Not a correctness bug — the
     path already caught, returned `[]`, and rendered without parks. The real problem was waste:
     **parks are the only geometry layer with no precache** (streets have `precache_streets`,
     boundaries `precache_boundaries`), so every park lookup hits live Overpass, and in the eight
     cities added 2026-09-05 a full three-mirror timeout costs ~27s and three requests — then the
     next pan repeated it immediately, burning the fair-use budget the drip pacing was tuned
     against. Failure is now remembered per grid cell for 10 minutes, in memory only so a relaunch
     retries. Kept **local to the park path** rather than changing `overpassClient` pacing that the
     precache Cloud Functions also depend on. Log downgraded error→warn: logging handled
     degradation at error level is what made this read as an app bug and put a red LogBox screen up
     during simulator capture on 2026-09-06.
     **Open, deliberately not built here: there is no parks precache.** That is the structural gap
     and it belongs in a spec, not a drive-by fix.
  Typecheck clean throughout; all six suites pass. No Cloud Functions changed by these three, so
  they ship by `eas update` alone.

- 2026-09-07 — **New spec: `docs/GROUP_IMPACT_MAP_SPEC.md`** — the shareable group impact map,
  drafted from Jake's framing that the output artifact *is* the product (it drives organic reach
  and is what an organization donates against or pays for). Decides: the event is challenge-shaped
  rather than team-shaped (`Challenge.kind` is already `'day' | 'range'`); build the one-day event
  first because its artifact has a floor under how bad it can look, where a week-long distributed
  challenge's map quality depends on participation nobody controls; export a full-size 4:5 image
  with no social-platform integrations; organization is the hero and "Powered by PICK" is the
  byline, because a card that reads as PICK advertising will not get posted. **Supersedes
  `CHALLENGE_RECAP_SPEC.md` §11.4 (Tier 2 photos)** — that section framed the question as
  publishing private photos and correctly answered no; the real use case is contribution to an
  event the participant deliberately joined, answered by consent at join rather than a server-side
  access argument. Two mockups built against it, the second using real Litchfield data (309 actual
  pickup coordinates): 96% of those points sit in a 715 × 423 m stretch while twelve strays push
  the bounding box to ~20 km, so **auto-fitting the map to extent would waste the entire frame** —
  recorded because it will happen on every real event.

- 2026-09-07 — **Zero-pickup accounts removed from both leaderboards; fixed, committed
  (`a502673`), and deployed.** Scope was larger than the 2026-09-06 website fix assumed: **five
  of eight `user_stats` docs** were signed-up-never-picked accounts — Da Cleaner, Kyle, Nick,
  Stinky Side, Tester — all with `hidden: false`, so the in-app Ranks tab read as roughly 60%
  dead accounts. That is the screen an org tester lands on, and Astoria goes precache-warm
  around 2026-09-08 with org sends following.
  Two halves: `getIndividualLeaderboard()` now filters `total_pickups > 0` for **every** metric
  rather than the selected one — a zero-pickup account can still hold a nonzero `active_days`
  (Da Cleaner has 1), so a per-metric test would let it back onto the "days" board. And
  `topPickers()` in `functions/index.js` applies the same rule at the source, so
  `global_stats.topPickers` stops being *written* with those rows; the 2026-09-06 `web/map.html`
  / `web/city.html` filters treated the symptom, this fixes the cause.
  Deployed both: `firebase deploy --only functions` (scheduledPublicStats updated) and
  `eas update` → `production`, runtime 1.2.2, update group
  `e7d676eb-e581-4f21-9249-5748f94e3947`, commit `a502673`. Typecheck clean; CARTO key verified
  inlined in the shipped bundle. **`global_stats.topPickers` still carries the two stale rows
  until the next `scheduledPublicStats` run (every 4 hours)** — `rebuildPublicStats` is an
  authenticated callable and returned 401 to an unauthenticated trigger, so it was left to
  self-correct rather than forced.
  Deploy hygiene note: the working tree also contained another session's untracked
  `functions/detectorExport.staged.js` and `docs/DETECTOR_EXPORT_SPEC.md`. Only the two files
  belonging to this fix were staged and committed. The staged detector-export module was
  verified inert before the functions deploy — it is not imported by `index.js` and uses
  `module.exports` rather than registering a Firebase function, so it uploads as a file but
  cannot deploy as one.

- 2026-09-07 — **BUG: `challenges/{id}.status` is written once at creation and never updated
  again, and three Firestore queries filter on that stale stored value.** Found while pulling
  real data for the Litchfield Litter Invitational, which ran 2026-08-14 → 08-20 and still
  stores `status: "upcoming"` seventeen days later; "Saturday Sweep" and "Trash Me Tuesday" are
  the same.
  **Why it is not visible in the app, and why that masks it:** `fromDoc()`
  (`src/services/challenges.ts:302`) recomputes `c.status = challengeStatus(c)` from
  `start_date`/`end_date` on every read, so anything displayed is correct. The stored field is
  effectively decorative — but it *looks* authoritative, which is the trap.
  **What actually consumes the stale field:**
  1. `src/services/challenges.ts:353` and `src/services/challengeLive.ts:44` —
     `where('status','in',['active','upcoming'])`. Every completed challenge keeps matching
     forever, so these queries over-fetch permanently and the client filters in JS afterward.
     Harmless at 5 challenges; unbounded read growth as challenges accumulate.
  2. `src/services/firebaseDatabase.ts:1564` — `where('status','==',status)`. Querying for
     `'completed'` returns **nothing, ever**, because no document is ever written with that
     value after creation. Any "past challenges" view built on this path is silently empty.
  **Forward risk worth recording now:** `docs/GROUP_IMPACT_MAP_SPEC.md` assumes an artifact
  produced when an event finishes. Anything server-side that reaches for stored `status` to
  detect completion would be wrong. No Cloud Function reads it today (verified) — so the fix is
  cheap while that stays true.
  **Likely fixes, not chosen:** derive status in the query by comparing `end_date` against now
  instead of filtering on the stored field; or drop the stored field entirely, since `fromDoc`
  already makes it redundant; or maintain it on write. Deriving from dates is probably right —
  the field is redundant with data already present, and a stored duplicate of derivable state is
  what created this.
  Read-only investigation; no code changed.
