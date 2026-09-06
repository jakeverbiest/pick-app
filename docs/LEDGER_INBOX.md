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

- 2026-09-06 — Pre-send hygiene batch, all **draft-only, awaiting a Netlify drop**, flowing from
  Jake's decision that Pick's goal is "pays for itself, stays a fun project, works as personal PR."
  1. **`web/support.html`: the "reports are reviewed within 24 hours" SLA is gone.** A fixed
     response-time promise turns a side project into an obligation for no benefit; it was the only
     such promise anywhere (grepped `web/`, `TESTFLIGHT_SUBMISSION.md`, in-app `constants/`).
     Replaced with copy leading on the protection that IS immediate and user-controlled —
     blocking — and honest that a human reply may take days because one person runs this. App
     Store Guideline 1.2 posture preserved: report mechanism, review commitment, immediate
     blocking, published contact all still present.
  2. **Zero-pickup accounts no longer render on the public leaderboards** (`web/map.html`,
     `web/city.html`). Two signed-up-never-used accounts were showing as real "Top pickers" rows
     on pickglobal.org/map — confirmed live in-browser, matched to exactly two Firestore accounts
     with 1 walk and 0 pickups each. That page is about to be linked in org-outreach email. Fixed
     client-side deliberately: root cause is `scheduledPublicStats` writing them into
     `global_stats.topPickers`, but `functions/index.js` currently carries another session's
     staged-undeployed precache-drip work and editing it now would conflate two stories in one
     commit. **Follow-up: filter zero-pickup users server-side once that file is untangled.**
     Both files verified to still parse as ES modules after the edit.

- 2026-09-06 — **New scheduled task `pick-public-page-canary`** (weekly, Tuesdays). Loads
  pickglobal.org/map, /, and /org in a real browser and checks they render actual data rather than
  merely returning 200, including a console check for CORS/failed-fetch errors. Motivated by a
  failure that already happened: `web/org.html` shipped 2026-08-31 and was silently broken for
  three days by a missing `Access-Control-Allow-Origin` header, caught only by hand-testing.
  Sentry covers app crashes; nothing watched the public pages. Deliberately quiet — one line when
  healthy, appends here only when something is actually broken.

- 2026-09-06 — Detector generalization: ran the scoped-down Phase 1 comparison (descriptive event
  features, not a replay harness), time-matched so each tester is compared against Jake's walks in
  the same date window — his 138 logged walks span June–September and several detector versions.
  **Both outside testers sit outside Jake's central range in the same direction, in two
  independent windows**: multi-peak share 43.2% vs 24.8% (Claire) and 52.3% vs 31.6% (Will), lower
  `counted` share, more rhythmic-motion rejections. **Most likely explanation is pace, not gait** —
  both walk faster, and Claire's 43.2% lands almost exactly on C6a's 42%, i.e. the detector
  behaving on her the way it already does on Jake at her speed. **Will is the exception pace
  doesn't explain**: median gyro 52% above Jake's on only a modest pace advantage, the signature of
  a different carry position rather than a different gait — and carry position isn't recorded, so
  it can't be confirmed (n=3 walks; a lead, not a finding). Two limits keep this inconclusive: no
  ground truth exists on any tester walk, so the lower counted rate is ambiguous between correct
  suppression and lost recall; and Jake's June–July data includes deliberate lab runs while both
  testers' data is entirely organic. Recorded as §8a of `docs/DETECTOR_VALIDATION_PLAN.md`:
  moderate generalization risk, variance concentrated in precisely the variable that isn't
  instrumented — independently reaching the same conclusion as that plan's §4 argument for fixing
  carry-mode/device capture before the next tester cohort.

- 2026-09-06 — **Detector corpus audited directly against live Firestore (admin read, 205 cleanup
  docs, all users). Headline: there is ZERO multi-tester detector-validation data — not thin,
  none.** 0 of the 33 non-Jake walks carry `items_detected`, and 0 carry the `pace_*` fields.
  `items_detected` first appears 2026-08-17 and the pace fields 19 Aug; the only substantial
  non-Jake tester (`Fhrfbd7wrm`, 28 walks / 486 minutes) stopped walking **2026-07-26**, i.e.
  three weeks before the instrumentation existed, and the second (`qI0d4X9BwM`, 3 walks) ran
  13–15 Aug, also just before. Their accuracy data is not recoverable — it was never captured.
  Two further accounts have 1 walk each and no data at all.
  **Jake's own paired set is n=38** (the only labeled data in existence): overall
  `items_detected/items_count` = 1.04, count accepted unchanged on 33/38 walks (87%). Both figures
  need a caveat before being quoted — the 5 corrected walks are the deliberate lab experiments
  (two 48→20 stroll runs at pace 0.70/0.73 = C7a/B4; the B5-series 16→20 and 19→20; one 9→8), and
  "user didn't correct" is weak evidence of correctness rather than an accuracy measurement.
  **The recoverable asset:** 24 non-Jake walks DO carry `motion_log` (21 + 3; 6,024 recorded
  events), so the *generalization* question — do other people's motion signatures sit inside the
  range Jake's occupies — is answerable retroactively today at zero build cost. **Hard limit worth
  recording:** `motion_log` stores candidate events that were already emitted, so replay can test
  gating/filter changes but can never measure recall for picks that generated no event at all —
  which A7a/C7a measured at ~60% of picks in the stroll case. Replay is a regression harness, not
  a validation.
  **Instrumentation gap that blocks the next round:** carry position is never persisted to the
  cleanup doc (`session_mode` only ever holds `background`/`unresolved`, 11 docs) and device model
  is not stored at all, while pace is. Recruiting testers before fixing that repeats the
  A3/A5/A6 pace-confound one variable over. **Disclosure gap:** the privacy policy discloses that
  motion-event summaries are retained, but its "HOW WE USE IT" clause covers only running the app
  — systematically mining tester walks for detector work needs a one-clause amendment across the
  five legal copies, and should be decided consistently with the Tier 2 photo deferral (the
  distinction that holds: non-identifying numeric telemetry never shown to another user, vs.
  surfacing private photos publicly).
  Full write-up, acceptance bar, and 4-phase sequence in new `docs/DETECTOR_VALIDATION_PLAN.md`.
  Nothing built or changed in app code this pass — audit and planning only.

- 2026-09-06 — Investigated the two `code`-routed IDEAS_INBOX.md backlog items ("Bundle-size
  bloat risk as more cities' boundary data gets added" and "Neighborhood loading is slow —
  performance pass") against the real code and a real exported bundle in
  `~/Desktop/pick-app/apps/companion`. Read-only pass, no code changes.

  **Bundle-size bloat: largely NOT a real risk — closer to a non-issue than a live concern.**
  Every `CITY_SOURCES` entry in `src/services/neighborhoods.ts` (11 cities as of the 2026-09-05
  batch) fetches its GeoJSON from a remote URL at runtime (`loadHoods()`) and caches it to
  `FileSystem.documentDirectory` (on-device disk, no TTL check on the cached copy — fetched once
  per install, then read from disk indefinitely) — nothing is bundled as a static asset. Confirmed
  directly against the real exported iOS bundle (`dist/_expo/static/js/ios/entry-....hbc`, 5.07MB,
  built 2026-09-05 same day as the 8-city batch): `strings` on the compiled Hermes bytecode finds
  exactly one occurrence each of the Bristol/Amsterdam/San Diego/LA/Boston/Chicago/SF GIS-endpoint
  URLs — the fetch targets, not the geometry itself. Comparing the committed HEAD version of
  `neighborhoods.ts` (3 cities: nyc/atl/sf, 34,111 bytes source) against the current uncommitted
  11-city version (50,642 bytes source) and stripping comments from both (comments don't survive
  TS→JS compilation) shows the real code growth from adding 8 cities is ~15.4KB → ~18.4KB, i.e.
  **~3KB of actual bundled code for 8 new cities** (~375 bytes/city — a bbox check + URL string +
  name-key array), against a 5.07MB bundle: about 0.06%. The real cost of city growth is device disk
  space and a one-time per-install network fetch (per-city payloads documented in the file's own
  comments range from Bristol's 29KB simplified to NYC's ~1.5MB / Amsterdam's 661KB unsimplified),
  not app-bundle or OTA-payload size. This scales fine through Melbourne and well beyond — the
  backlog item as originally framed (data bloating the bundle) doesn't hold up; if there's a real
  concern here it's per-city cold-fetch latency/disk use, not "bundle size."

  **Neighborhood loading is slow: partially stale, but a real chunk of it is still genuinely
  open — specifically for the 8 cities just added.** Two distinct code paths answer to "loading":
  (1) the neighborhood BOUNDARY outline draw (`loadHoodsInView` → `getHoodsInBounds` →
  `loadHoods()`) — a one-time per-city GeoJSON fetch/cache, not gated by any spinner, and not what
  the precache work targeted; (2) the STREET-SEGMENT coverage fetch on tapping into a neighborhood
  (`activateHood` → `getCoverageForRing` → `getSegmentsForRing` → `getPrecachedSegmentsForRing` on
  a miss falling through to `fetchStreetGeometryForRing`'s live Overpass poly query) — this is the
  path the code itself documents as slow (`ACTIVATE_TIMEOUT_MS = 22000`, comment: "Street detail
  can take a long time on a cold cache... took minutes for a mid-size neighborhood"). The
  ring-precache fix (`getPrecachedSegmentsForRing`, shipped OTA 2026-09-04) genuinely helps, but
  its own doc comment states the seed coverage plainly: `STREET_SEED_POINTS` is a **10-point,
  Brooklyn-only** hand-pick (`functions/index.js`). The NYC-wide roster/drip expansion that would
  cover the rest of NYC is designed but explicitly **not deployed** (per the ledger's Launch-gates
  row, awaiting Jake's direct go-ahead) — and even once deployed, it is NYC-only by design (derived
  from NYC's own 312-neighborhood bboxes). **None of the 8 newly-added cities (Seattle, LA, Chicago,
  Boston, San Diego, Miami, Amsterdam, Bristol) have any street-segment precache coverage at all**
  — every `activateHood()` there hits the same live-Overpass cold path NYC had before any precache
  work started, with the same up-to-22s wait and "Still loading street detail…" banner. So: the
  slowness this backlog item was about is real, still happens today for most of the map (all
  non-Brooklyn NYC, and all 8 new cities), and is not fixed by the infra that's already shipped —
  only a small hand-picked slice of Brooklyn currently benefits. Boundary-outline loading itself
  (path 1) is comparatively minor: no blocking spinner, cached to disk after one fetch per city per
  install.

  Net: recommend downgrading/closing the bundle-bloat item (measured, real number, not a risk at
  current or foreseeable city counts) and keeping the neighborhood-loading item open but re-scoped
  — it's specifically "street-segment cold-load latency outside the small Brooklyn precache seed,"
  most acute right now for the 8 cities that just shipped with zero precache coverage, not a
  general/vague performance concern.

- 2026-09-06 — Read-only git audit of `~/Desktop/pick-app` (`git --no-optional-locks
  status`/`diff` against `9d4856f`; no commits/stages/deploys made). The "six app-code files
  modified, uncommitted" line in the 2026-09-05 ledger run undercounts: there are actually
  **seven** modified tracked app-code files, plus `docs/LAUNCH_LEDGER.md`/`docs/LEDGER_INBOX.md`
  themselves showing modified (expected — that's the 2026-09-05 scheduled run's own
  not-yet-committed reconciliation output, not a code story; `LEDGER_INBOX.md`'s working copy
  already shows the prior entries cleared).
  1. `apps/companion/src/services/streetSegments.ts` and
     `apps/companion/src/services/neighborhoods.ts` — the two files the ledger table already
     named, confirmed as the two already-OTA-shipped stories (ring-precache fix, update group
     `ae49781d…`, 2026-09-04; 8-city curation batch + widened `loadHoods()` Accept header,
     update group `2907d543…`, 2026-09-05). **Caveat**: `streetSegments.ts`'s current diff is
     NOT purely the shipped ring-precache fix — the same file also carries a later edit (dated
     2026-09-05 in its own comment) bumping `PRECACHE_STALENESS_MS` 14→28→52 days, explicitly
     marked "staged alongside functions/index.js's NYC-wide roster/drip expansion, NOT
     deployed." So this one file currently mixes an already-live change with a second,
     still-undeployed one — committing it as-is would conflate both stories in a single commit.
  2. `apps/companion/functions/index.js`, `apps/companion/functions/shared/boundaryGeometry.js`,
     `apps/companion/functions/shared/overpassClient.js`,
     `apps/companion/functions/shared/streetGeometry.js` — a third, previously-unenumerated
     story: the NYC-wide Overpass precache drip (persisted tile roster + 4-hourly bounded batch
     drain, a 429/406 cooldown added to `overpassClient.js`, batch size reconciled down to
     8 tiles/run against the OSM wiki's real "regular application" 100-queries/day fair-use
     text). Every file's own comments say "staged 2026-09-05, NOT deployed," and one comment
     block explicitly notes an agent-relayed "Jake said go" was correctly declined by the
     session that received it (no agent message is the user's own consent). This lines up with
     the concurrent Cloud Functions deploy task Jake separately approved — presumably
     in-progress work, not stray drift.
  3. `apps/companion/src/constants/legal.ts` — a fourth, previously-unenumerated story,
     unrelated to mapping/precache: privacy-policy content changes (`PRIVACY_LAST_UPDATED`
     bumped to September 5, 2026; "team name" broadened to "team or event name"; a substantial
     GDPR/UK-EEA addition — legal basis, international-transfer, and data-subject-rights
     sections; a street-cleaning-status-is-shared disclosure). Reads as Safety-team legal work
     landing in the same working tree — likely why the 2026-09-05 ledger count of six doesn't
     include it, since it looks newer than that run.
  - **Flag — commit gap**: `streetSegments.ts` and `neighborhoods.ts` represent OTA-shipped,
    live-in-production behavior with no corresponding git commit — a real rollback/review gap,
    since `eas update` ships the working tree, not a commit. `neighborhoods.ts`'s diff is a
    single coherent, already-fully-shipped story and looks safe to commit as-is. `streetSegments.ts`
    should NOT be committed as-is without separating the shipped ring-precache portion from the
    not-yet-deployed staleness-bump portion tied to the in-progress NYC precache work.
  - Nothing found that looks like accidental/unrelated drift — every modified tracked file traces
    to one of the four stories above. Untracked docs (`docs/NEIGHBORHOOD_ARCHITECTURE_REVIEW.md`,
    `docs/ZIP_BOUNDARY_TIER_SPEC.md`, `docs/TEST_DATA_WIPE_PLAN.md`) and untracked non-doc files
    (`PICK Content/`, `PICK_seed_shotlist.txt`, `youtube_banner_v4_2560x1440.png`) are new, not
    modified, and out of scope for the "six files" claim — not investigated further this pass.

- 2026-09-06 — **NYC-wide Overpass precache drip: Cloud Functions deployed and roster-rebuild
  triggered, on Jake's own direct chat "go" today — not a relayed instruction.** Sequence for the
  record: 2026-09-05, an agent-relayed "Jake said let's do it" was correctly declined by the
  session that received it (no agent message is the user's own consent). Today, 2026-09-06, Jake
  replied directly in chat to a morning-brief item describing this exact pending decision with
  "go" — that is the direct approval this project's rules require, and this session proceeded on
  that basis.

  **What was deployed.** Syntax-checked all four changed function files first (`node --check`,
  clean on `functions/index.js` and `functions/shared/{overpassClient,streetGeometry,
  boundaryGeometry}.js`). Ran `firebase deploy --only
  functions:scheduledOverpassPrecacheRefresh,functions:scheduledOverpassPrecacheDrip,functions:runOverpassPrecacheRefresh`
  from `~/Desktop/pick-app` — scoped to just these three, not a blanket redeploy of the other 21
  live functions. Deploy completed clean (`✔ Deploy complete!`). Confirmed live via `firebase
  functions:list`: all three (`runOverpassPrecacheRefresh` v2 https, `scheduledOverpassPrecacheDrip`
  v2 scheduled, `scheduledOverpassPrecacheRefresh` v2 scheduled) present in `us-central1`.

  **Roster rebuild triggered.** `curl` against the deployed
  `runOverpassPrecacheRefresh` URL with `?key=pick-precache-9k3p&rebuildRoster=1` returned
  `{"ok":true,"roster":{"total":1226,"added":0,"generatedAt":...},"boundaries":{"attempted":0,"ok":0,"failed":0,"failedKeys":[]}}`.
  The roster (`precache_meta/nyc_street_roster`, confirmed at that exact path from
  `functions/index.js`'s `PRECACHE_ROSTER_DOC` constant) holds 1,226 tiles — matches the spec's
  designed ~1,225 NYC-wide tile count. Flagging honestly rather than glossing over it:
  `added:0` means this call found zero *new* tiles beyond what the doc already held, which only
  makes sense if the roster doc already contained 1,226 tiles before today's call (the rebuild
  logic seeds `seen` from the existing doc and only counts genuinely new keys) — since
  `firebase functions:list` had confirmed these functions were NOT deployed as of 2026-09-05, this
  was most likely populated by a local/emulator test run with production Firestore credentials
  during the 2026-09-05 build session, not by today's trigger. Today's call is still real
  confirmation the roster exists and is stable/idempotent at the designed size; it just isn't
  evidence of a from-empty population happening today. Did not separately trigger a drip batch —
  the scheduled 4-hourly `scheduledOverpassPrecacheDrip` will begin draining it on its own cadence
  starting from cursor 0.

  **`eas update` for the staleness-window bump — NOT run, stopped deliberately.** Per this
  project's `eas update`-ships-the-working-tree risk (17 Aug incident) and this task's explicit
  safety gate, ran `git --no-optional-locks status`/`diff` in `~/Desktop/pick-app` before
  considering it. Independently reproduced the finding already logged above in this same file
  (this session's audit ran before reading that entry, then cross-checked against it): the
  working tree has **seven** modified app-code files, not six — `streetSegments.ts` and
  `neighborhoods.ts` (both already OTA-live, and both carry the drip's staleness-window bump,
  `PRECACHE_STALENESS_MS` 14→52 days, confirmed in the diff), the four precache-drip Cloud
  Functions files just deployed above, and **`apps/companion/src/constants/legal.ts`** — a
  substantial, unrelated GDPR/UK-EEA privacy-policy rewrite (`PRIVACY_LAST_UPDATED` bumped to
  September 5, 2026; new legal-basis/international-transfer/data-subject-rights sections; a
  street-cleaning-status-sharing disclosure; "team name" broadened to "team or event name"),
  reading as Safety-team legal work landed in the same working tree, with zero relationship to
  the precache work and not mentioned anywhere in the ledger's "In progress, uncommitted" table.
  Since `eas update` publishes everything under `apps/companion`, running it now would ship that
  unreviewed legal-copy change to production alongside the intended staleness-window bump. Per
  this task's explicit instruction, stopped here rather than guessing that's safe to ship
  together. **The `eas update` step remains outstanding** — needs either `legal.ts` isolated
  (commit/stash it out, or get it reviewed and blessed in its own right) before publishing, or a
  separate explicit go-ahead from Jake to ship it bundled in. Nothing was published to `production`
  this session.

  **Net for the ledger's flagged Launch-gates row:** Cloud Functions side of the NYC-wide Overpass
  precache drip is now deployed and its roster populated (1,226 tiles) — no longer "NOT deployed."
  The client-side staleness-window bump is still stuck behind the working-tree conflict above and
  has not shipped.

- 2026-09-06 (later same day) — **`eas update` published, closing the two items the entry above
  left open.** Jake reviewed the `legal.ts` GDPR content directly (it was verified to match the
  already-live `web/privacy.html` GDPR text) and gave direct, explicit chat approval — "publish
  them all, let's cross them off the list" — to ship both outstanding `apps/companion` changes
  together in one update rather than isolating `legal.ts`. Jake ran the publish himself from
  `apps/companion` (`eas update --branch production`); this session verified the diffs immediately
  beforehand (confirmed exactly `streetSegments.ts` and `legal.ts` as the two substantive changes,
  `neighborhoods.ts` unchanged since its Sep 5 publish) and supplied the update message after the
  CLI's default prompt pre-filled with the stale `9d4856f` ("Group Recap v2") commit message — that
  commit is the tree's last commit, already shipped Sep 4, unrelated to this update's actual
  payload.

  **Published:** branch `production`, runtime version `1.2.2`, both platforms. Update group ID
  `aa221135-1e4f-4f4c-9174-ed857ed1332c` (Android update `01a07688-9e5c-7bab-94a0-44d2f6cc9833`,
  iOS update `01a07688-9e5c-7e4a-a84c-505b6b40eca7`), commit `9d4856f` (pre-existing HEAD — neither
  of the two shipped changes has its own commit yet, per the still-open commit-gap finding above).
  Message: "Precache staleness window widened 14->52 days (matches NYC-wide drip's slower Overpass
  pacing); in-app GDPR/UK-EEA privacy policy text added (legal basis, international transfers,
  data-subject rights) — mirrors web/privacy.html." Dashboard:
  https://expo.dev/accounts/jakeverbiest/projects/pick-app/updates/aa221135-1e4f-4f4c-9174-ed857ed1332c

  **No tester reminder sent** — an OTA update auto-applies to existing installs on next launch,
  unlike a new native build/TestFlight submission; a staleness-window tuning value and updated
  legal text are both invisible/backend-ish changes with nothing for a tester to notice or act on.

  **Net for the ledger:** the NYC-wide Overpass precache drip (Launch-gates row) is now fully
  live end-to-end — Cloud Functions, roster, and the client-side staleness-window bump all
  shipped. The in-app GDPR/legal.ts item is also closed — `web/privacy.html` and the in-app
  `PRIVACY_POLICY_TEXT` are back in sync, both dated September 5, 2026. **Still open, unchanged by
  this entry:** the commit gap on `streetSegments.ts`/`neighborhoods.ts`/`legal.ts` (all three
  shipped via OTA with no git commit backing them) — flagged above, not resolved here.

- 2026-09-06 — **Bug fixed in tree, NOT yet published: neighborhood-boundary lines stopped
  re-rendering after panning far away and back (Jake, live field test, Brooklyn <-> Amsterdam
  while testing the 8-city curation batch).** Only a full app restart brought Brooklyn's
  boundaries back. Root-caused and fixed in
  `apps/companion/app/(tabs)/map.tsx`'s `handleMapMessage` (`moveend` handler, was line 1049):
  a single `if (msg.zoom < 14) return;` guard was skipping BOTH the street-coverage redraw
  (`loadStreetCoverage`) AND the neighborhood-boundary redraw (`loadHoodsInView`) together
  whenever the map settled below zoom 14 — which a Brooklyn<->Amsterdam pan necessarily does
  crossing the Atlantic. Confirmed against the real code (not guessed): `hoodsCache` in
  `neighborhoods.ts` is per-city and never evicted (Brooklyn's data was never lost), and
  `renderNeighborhoods` in the WebView JS is additive-only. The redraw call itself was what
  never fired again on the return leg. Also traced why nothing else recovered it short of a
  restart: the mount-effect that redraws boundaries on WebView-ready is gated by
  `coverageLoadedRef.current`, which was already `true` from the very first load, so it's a
  no-op on anything short of a full component remount (app restart) or an app
  background/foreground cycle — neither of which a plain in-app pan triggers.
  **Fix**: split the single guard so the zoom<14 floor still applies to `loadStreetCoverage`
  only (a real per-pan cost: a live Overpass geometry fetch on a cold grid cell plus a
  Firestore statuses query every call — legitimately worth skipping when zoomed out too far to
  usefully see individual streets). `loadHoodsInView` now fires on every `moveend` regardless of
  zoom: confirmed both its paths are cheap at any zoom — the curated-city path
  (`getHoodsInBounds`) is an in-memory point-in-polygon filter over a GeoJSON payload fetched
  once per city and cached forever; the OSM fallback (`getOsmHoodsInBounds`) is keyed to a fixed
  ~20km cell independent of viewport size, and also cached. No new zoom floor needed for
  boundaries. `npx tsc --noEmit` clean. **Not committed** — the working tree already carries
  several other unrelated uncommitted stories (the NYC precache-drip Cloud Functions files,
  `legal.ts`, the `streetSegments.ts`/`neighborhoods.ts` commit gap already flagged above), so
  this fix was left alongside them uncommitted rather than bundled into any of those. **Not
  published** — `[OTA]`-eligible (pure TS, `app/(tabs)/map.tsx`), needs Jake's own explicit
  go-ahead in chat before an `eas update`.

- 2026-09-06 (later same day) — **Published, closing the Brooklyn-boundary-redraw bug above.**
  Jake gave direct chat approval ("please ship") to publish the `map.tsx` fix. A dispatched
  session verified the working tree first (only `map.tsx` had changed since this morning's
  `aa221135…` publish; `streetSegments.ts`/`neighborhoods.ts`/`legal.ts` unchanged;
  `functions/*.js` irrelevant to the client OTA bundle) and confirmed `tsc --noEmit` clean, but
  its own `eas update` call was denied by the Claude Code auto-mode permission classifier before
  reaching the network — same block hit on this morning's first publish attempt. Jake ran the
  publish himself from `apps/companion`:
  `eas update --branch production --message "Fix neighborhood-boundary redraw: split the moveend
  zoom<14 guard so loadHoodsInView always fires (was also gating loadStreetCoverage, which is the
  only part that needs the zoom floor). Fixes Brooklyn boundaries never redrawing after panning
  to Amsterdam and back during today's 8-city field test."`

  **Published:** branch `production`, runtime `1.2.2`, both platforms. Update group ID
  `7ecec3a8-9eeb-4e26-b5de-975f3410f9c0` (Android update `01a076ca-b7c3-72b1-95cb-00bbc8b053d4`,
  iOS update `01a076ca-b7c3-771d-a314-8dd468e57f86`), commit `9d4856f` (pre-existing HEAD — this
  fix, like the morning's two changes, has no git commit of its own yet). Dashboard:
  https://expo.dev/accounts/jakeverbiest/projects/pick-app/updates/7ecec3a8-9eeb-4e26-b5de-975f3410f9c0

  **No tester reminder sent** — this fixes a bug testers may have silently hit rather than
  announcing a new feature, and OTA auto-applies on next launch regardless.

  **Net:** the Brooklyn-boundary-redraw bug found during today's 8-city field test (Amsterdam
  pan-back) is closed. **Still open, unchanged:** the commit gap now spans four files
  (`streetSegments.ts`, `neighborhoods.ts`, `legal.ts`, `map.tsx`) all shipped via OTA with no
  git commit backing any of them.

- 2026-09-06 (`roadmap-ops`, `~/pick-app`) — **Hard prioritization pass over the ~10-doc unbuilt
  spec backlog across both repos.** Triage/sequencing only — no specs written, no app code
  touched, nothing built. Findings that touch the ledger's own structure:

  **Four docs should be retired rather than sequenced, with evidence:**
  (1) `~/pick-app/docs/CHALLENGE_GUEST_MODE_SPEC.md` is a self-labeled SUPERSEDED duplicate of the
  canonical `~/Desktop/pick-app/docs/CHALLENGE_GUEST_MODE_SPEC.md`, whose header records Jake's
  **2026-08-31 "RECONSIDERED — parked, not building this"** decision (all 6 open questions were
  resolved that same day, then the whole feature was declined). Guest Mode is a settled no, not a
  pending backlog item — `~/pick-app/docs/OPS_STATUS.md` still framed it as merely "drafted,
  unbuilt/unshipped"; corrected there this pass.
  (2) `~/Desktop/pick-app/docs/SF_NEIGHBORHOODS_EXPLORATION.md`'s header still reads "entry written
  into the working tree, unpublished and uncommitted" — already contradicted by
  `NEIGHBORHOOD_ARCHITECTURE_REVIEW.md`'s git evidence (`528acbd`) and doubly so now that SF is one
  of 11 curated cities live since the 2026-09-05 OTA. Only its §6 device-verification checklist
  survives; that is a `qa` task, not a spec.
  (3) `~/pick-app/PICK_technical_spec.md` is a portfolio/architecture narrative, not a feature
  spec — it does not belong in a build backlog at all. It is also stale in three checkable places:
  it says Expo **SDK 54** (`AGENTS.md` pins the v56 docs), "Firebase Auth for **email/password**
  identity" (Sign in with Apple confirmed on-device 2026-09-01), and that the privacy policy is
  "hosted on its own Netlify site" (it is `pickglobal.org/privacy`).
  (4) `~/pick-app/docs/GLOBAL_CITY_EXPANSION_TARGETS.md` is raw untriaged input already superseded
  twice over — by `GLOBAL_OUTREACH_AUDIT.md` (2026-09-04) on the org/prioritization half, and by
  the 2026-09-05 8-city curation batch on the map-coverage half (Seattle, LA, Chicago, Boston, San
  Diego, Miami, Amsterdam, Bristol all shipped). Keep as a CRM prospect list only.

  **Sequencing position handed to Jake:** the only genuine launch prerequisites in front of the
  NYC org-outreach send are already ledger items, not specs — the **staged-but-undeployed NYC-wide
  Overpass precache drip** (Astoria/Jackson Heights/Manhattan are outside today's 55-tile Brooklyn
  seed, and Jake already hit real Upper East Side slowness), the **detector-export Cloud Function**
  (the ledger's own "top priority"; without it real org walkers generate zero readable detector
  evidence and the detector stays n=1), the two unchecked **TestFlight tester-limit / Beta App
  Description** rows, the open **in-app Pick Global rebrand** gate, and the **junk public
  leaderboard entries** ("Stinky Side," "Da Cleaner") visible on `pickglobal.org/map` to any org
  that clicks through. Everything in the spec backlog proper is fast-follow or park-it.

  **Riskiest sequencing dependency found:** building `AUTO_NEIGHBORHOOD_DETECTION_SPEC.md` before
  the NYC precache drip is deployed *and* its cost measured. Per that spec's own §"Interaction with
  the in-flight precache work," the shipped ring-precache path requires **all** grid cells covering
  a ring's bbox to hit cache or it falls through to a full live Overpass fetch (~20s ceiling) — so
  auto-detection on today's seed converts a rare, user-initiated wait into an automatic mid-walk
  one, against a dependency that already has **observed production 429s** in the 2026-09-03
  `runOverpassPrecacheRefresh` logs. Secondary coupling: `ZIP_BOUNDARY_TIER_SPEC.md` §4 replaces
  `hasNeighborhoods()`'s boolean with a three-way ordered resolution, and auto-detection keys off
  exactly that branch (`map.tsx:623`) — building auto-detect first means reworking it if the ZIP
  tier ever lands.

  Nothing here is a decision; all of it is staged for Jake's review.

---

- **2026-09-06 — `carry_mode` + `device_model` now written on every cleanup. Committed `62b5ca1`, NOT deployed.**
  Closes the stratification gap that would have made the incoming community-org cohort (Litter
  Legion in Astoria, others) as unusable for detector work as the last outside tester's 28 walks.
  Pace was already recorded; carry position and device model were not, so a cohort walk could not
  separate a gait problem from a phone problem from a pocket-vs-bag problem — and carry position is
  a measured 4.6x swing in median gyro (ledger's own 25 Aug confound table), not a small effect.
  - **`carry_mode`** — the auto-classifier already existed and already drove behavior
    (`classifyCarryMode()` in `motionEvaluation.ts:533`, fed a rolling 8-event gyro baseline in
    `motionDetection.ts:396`, gating the pocket-only low-rotation filter). It was simply never
    persisted. New `MotionDetector.getCarryMode()` returns the value the run actually used;
    lifecycle deliberately matches `getSessionEvents()` (reset in `startListening()`, **not** in
    `stopListening()`) so the summary sheet's Save can still read it — the `ae3f028` `session_mode`
    failure mode, where a field cleared on finish read `"unresolved"` on every walk for weeks.
    Distinct field; `session_mode` not overloaded.
  - **`device_model`** — new `src/services/deviceInfo.ts`, `"iPhone14,3 (iPhone 13 Pro) / iOS 18.5"`.
    Hardware identity only, never `Device.deviceName` (user-set, routinely a real name).
  - **Both omitted rather than written null** when unavailable, matching `createPost()`'s
    `challengeId`. `firestore.rules` untouched — `cleanups` stays owner-only read.
  - **OTA-safe, no build slot needed.** `expo-device` was already a dependency (in `package.json`
    since `9a8c049`, in `ios/Podfile.lock`, already imported by `notifications.ts`), so the native
    module is in the shipped binary; this is pure JS/TS.
  - **Correction to a documented item:** the suspected gap where `exportCleanup()` dropped the
    `pace_*` fields is **already closed** — `activity.tsx` emits all three plus `items_detected` and
    `session_mode`. Only the two new fields were added there.
  - Verification: `tsc --noEmit` clean; `test:detector`, `test:geometry`, `test:impact`,
    `test:tiles`, `test:recap` all pass. `test:hoods` still fails on the known pre-existing Flow
    `TransformError` under tsx (`LAUNCH_BUGLIST.md`, unrunnable since 14 Jul) — unrelated.
  - **Awaiting Jake:** one `eas update` from `apps/companion` publishes it. Note the standing memory
    gotcha — `eas update` ships the **working tree**, and `map.tsx` currently also carries an
    unrelated uncommitted zoom-gate boundary-redraw fix from the same day. That change was
    deliberately kept out of `62b5ca1`, but it *will* ride any publish made from this tree.
