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
