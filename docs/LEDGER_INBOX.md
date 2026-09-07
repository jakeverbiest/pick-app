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
  **Timing note:** today IS Monday and the 07:00 run already fired on the old code, so nothing
  warms until **2026-09-14** unless `runOverpassPrecacheRefresh?rebuildRoster=1` is triggered by
  hand (needs `PRECACHE_REFRESH_KEY` out of Secret Manager).
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
