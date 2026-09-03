# Ledger inbox — interactive sessions → scheduled reconciliation

**`docs/LAUNCH_LEDGER.md` has one writer: the daily `pick-ledger-reconciliation` scheduled
task.** Interactive sessions (Claude Code or otherwise) read the ledger freely but do not edit
it directly — that was the point of moving to a single writer: no more collisions between a live
session and the scheduled run on the same file (this repo has hit that class of bug before —
duplicate commits 72s apart, a stranded `.git/index.lock`).

If you're in an interactive session and learn something that should update the ledger — a fix
landed, a blocker cleared, a new open item — append a dated bullet here instead. The scheduled
task reads this file first, folds entries into the ledger, and clears it on each run.

Format: one dated bullet per item, plainly stated — the scheduled task will reconcile it into
the ledger's actual structure, not paste it verbatim.

<!-- Example:
- 2026-08-26 — PhoneLink.swift split-response fix committed as 7b19cd8, xcodebuild clean. No
  longer an open item.
-->

- 2026-09-03 — Overpass server-side pre-cache (`docs/OVERPASS_PRECACHE_SPEC.md`, the "Overpass
  mirror reliance — structural risk" launch gate opened 2026-09-01) built end-to-end per Jake's
  six §5 decisions: seed list (Fort Greene + Sunset Park, Brooklyn), weekly refresh cadence,
  hybrid street-tile growth signal (static seed + cleanups-clustering promotion, NOT
  unconditional whole-city caching), 14-day staleness ceiling, shared
  `functions/shared/{overpassClient,streetGeometry,boundaryGeometry}.js` fetch/hedge/chop
  pipeline (client and Cloud Functions both import it — no duplicated logic), built now rather
  than waiting on unrelated blockers. New Cloud Functions `scheduledOverpassPrecacheRefresh`
  (weekly) and `runOverpassPrecacheRefresh` (manual/gated); new Firestore collections
  `precache_streets`/`precache_boundaries` (rules added, public read); client-side cache-first
  checks added to `streetSegments.ts`/`neighborhoods.ts`, fail open to today's exact
  live-Overpass behavior on any miss. `tsc --noEmit` clean, `test:geometry`/`test:tiles` passing
  (26/26), and the extracted fetch pipelines verified live against real Overpass/Nominatim
  during the build. **Code committed, NOT deployed** — `firebase deploy --only
  functions,firestore:rules` and `eas update` are both still pending Jake's explicit go-ahead;
  until the functions deploy, the precache collections are empty and every read is a guaranteed
  (fail-open) cache miss, so no behavior change ships until that deploy happens. Still an open
  item for the ledger until Jake deploys.

- 2026-09-03 (follow-up, same day) — Overpass pre-cache above is now **fully deployed and
  confirmed live**, superseding the "committed, not deployed" note two entries up. Jake gave
  explicit go-ahead for both pending steps; `firebase deploy --only functions,firestore:rules`
  ran clean (new functions `scheduledOverpassPrecacheRefresh`/`runOverpassPrecacheRefresh`
  created, rules released), and `eas update` published the client cache-first check to
  `production` (runtime 1.2.2, update group `02b5d94c`).
  **A real bug was caught before it could bite testers**: the first manual trigger of
  `runOverpassPrecacheRefresh` failed every street-tile write with Firestore's "Property array
  contains an invalid nested entity" — `StreetSegment.coords`/`OsmBoundaryFeature.ring` are both
  `[number,number][]`, which Firestore rejects once nested inside the segments/features array.
  This is the same nested-array constraint `src/services/challenges.ts`'s `flattenRing` already
  works around elsewhere in this codebase; the precache code hadn't applied that pattern. Fixed
  by flattening to `[lat,lon,lat,lon,...]` on write and rebuilding pairs on client read
  (`b4b3f17`), redeployed the two functions, re-triggered the refresh, and confirmed a real
  precache doc now exists with correctly-shaped data via a direct Firestore REST read.
  **Second follow-up bug caught in the same pass**: the client-side unflatten fix was written
  after the first OTA publish had already shipped, so that published bundle didn't know how to
  read the now-correctly-flattened docs. Re-ran the OTA pre-flight + publish immediately
  (typecheck clean, all runnable suites passed) — update group `d0306cec`, published before any
  real user could hit a populated cache with the stale client logic.
  **Current state**: Fort Greene's seed tiles have at least one confirmed-good precache doc.
  Sunset Park's tiles and the full seed set weren't individually re-verified doc-by-doc this
  pass (the manual trigger's HTTP response times out at 60s — the function's own configured
  `timeoutSeconds` — well before the ~9-tile sequential Overpass fetch finishes, though the
  writes complete server-side regardless of the client timeout, confirmed by the successful
  Firestore read after the first "timeout"). Worth a follow-up pass to confirm the full seed
  list populated, and to watch the first scheduled weekly run (rather than only the manual
  trigger) succeeds end to end. No boundary-cache docs expected yet — `city_requests` is still
  empty, so nothing has crossed the promotion threshold, which is expected per the spec, not a
  bug. Field-testable now: a real device cold-loading Fort Greene street geometry should hit the
  precache fast-path instead of a live Overpass call.
