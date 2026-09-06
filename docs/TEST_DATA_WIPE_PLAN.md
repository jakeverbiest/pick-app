# Plan: wipe Jake's test data before public launch

**Status: PLAN ONLY. Nothing in this doc has been executed.** No Firestore doc has been
deleted, no Cloud Function has been called, no script referenced below has been run. This
is a future-session, explicit-go-ahead item — routed from `~/pick-app/docs/IDEAS_INBOX.md`
("Route to a subagent > code": *"Plan the 'wipe Jake's test data' step for the public-launch
checklist (don't execute yet)"*).

Everything below is grounded in reading the actual code in `~/Desktop/pick-app`
(`apps/companion/functions/index.js`, `apps/companion/src/services/firebaseDatabase.ts`,
`apps/companion/src/services/streetSegments.ts`, `web/index.html`, `web/map.html`,
`web/city.html`), not guessed from memory of the timeline docs.

No dedicated "public launch checklist" file exists yet anywhere in either repo (grepped
both for "launch checklist" / "public launch" — the only hits are this item's own mention
in `IDEAS_INBOX.md` and an unrelated line in `SOCIAL_SEED_POSTS.md`). The closest thing is
`~/Desktop/pick-app/docs/LAUNCH_LEDGER.md`'s "🌐 Public beta — go, capped" table, but that
file has exactly one writer (the daily scheduled task) — this plan lives here instead,
alongside the other Desktop-repo specs (`OVERPASS_PRECACHE_SPEC.md`,
`ZIP_BOUNDARY_TIER_SPEC.md`, `CHALLENGE_RECAP_SPEC.md`) that follow the same pattern:
written by `code`, referenced from `~/pick-app/docs/IDEAS_INBOX.md`, executed only on a
later explicit go-ahead. When a real public-launch checklist doc gets created, this
should become one line item on it, not a separate thing to remember.

---

## 1. What is actually "Jake's test data" — is it distinguishable?

**No dev/test flag exists anywhere in the schema.** Grepped `apps/companion` for
`isTest`, `test_account`, `testAccount`, `TEST_UID`, `debugUser` and Jake's own
email/username strings — zero hits. The only usable signal is **identity**: every
piece of data traces back to `cleanups.userId == <Jake's Firebase Auth uid>`
(`apps/companion/src/services/firebaseDatabase.ts:363`, `:1650` write it; `functions/index.js`
reads `d.userId` throughout).

A **pure date cutoff is not a substitute for identity.** Per point 4 below, Jake will very
plausibly keep using the *same* account as a genuine picker after launch, so "everything
before date X" and "everything on Jake's uid" are not the same set once he starts logging
real walks post-launch. What's actually needed is **identity + a cutoff together**:
`cleanups` where `userId == jakeUid AND timestamp <= <wipe boundary>`. Jake has to supply
the boundary; see the decision list in the execution plan below.

To actually run this later, someone needs Jake's real Firebase Auth uid. Not looked up in
this session (read-only, no Firestore/Console access here). Two ways to get it without
guessing: `app/(tabs)/settings.tsx:105` already holds it in a `uid` state variable — check
whether it's rendered anywhere in that screen; failing that, Firebase Console →
Authentication, matched against Jake's login email, is the ground truth.

---

## 2. What "wipe" should mean — walked through every place this data cascades to

`cleanups` is the only place with per-write history; everything else is a rollup, and the
three rollup families behave **differently** — this matters a lot for what "wipe" has to
include:

| Collection | How it's kept current | What deleting `cleanups` docs does to it | Extra step needed? |
|---|---|---|---|
| **`cleanups`** | source of truth | — this is what gets deleted | Delete via Admin SDK, **one doc at a time** (see step 3) |
| **`team_stats`** | Cloud Function **incremental delta** — `onCleanupWrite` → `applyTeamDelta` (`functions/index.js:202-302`) fires on every write *including deletes* | **Self-corrects automatically**, since a real Firestore delete fires the same `onDocumentWritten` trigger as any other write | No — but run `rebuildTeamStats` (the full-rescan callable, `functions/index.js:343`) afterward as a correctness backstop, same as the doc comment already recommends after any suspected drift |
| **`org_stats`** (civic-org/sponsor district totals) | Cloud Function **incremental delta**, but **geographic, not identity-scoped** — `applyOrgDeltaForCleanup` (`functions/index.js:922-936`) checks whether the deleted cleanup's lat/lon falls inside a sponsor's district polygon, regardless of whose uid it was | Also **self-corrects automatically** on delete, for the same reason as `team_stats` — the trigger reads the full deleted doc (with its coordinates), so this doesn't matter whether the district is a place Jake did a lot of field testing or not | No — but `buildOrgSnapshots` (`functions/index.js:936-980`, normally Monday 08:00) is the full-rescan backstop; worth forcing a manual run right after the wipe rather than waiting up to a week |
| **`global_stats/summary`, `city_stats/{slug}`** | **NOT incremental.** `scheduledPublicStats` (`functions/index.js:538`) fully rescans **all** of `cleanups` from scratch every 4 hours (`rebuildPublicStats`, `functions/index.js:419-519`) | **Self-heals automatically** the next time the scheduled job runs, purely because the source docs are gone by then | No extra step required for correctness, but call the `rebuildPublicStats` callable (`functions/index.js:543`) right after the wipe instead of waiting up to 4 hours, since this is what `web/index.html`, `web/map.html`, `web/city.html` read live and unauthenticated (see below) |
| **`user_stats/{uid}`** | **NOT a Cloud Function rollup at all.** Recomputed **client-side**, from scratch, from the signed-in user's own `getCleanups(1000)`, only when `updateUserStats()` fires — after saving a cleanup or changing a setting (`firebaseDatabase.ts:1196-1214`) | **Does NOT self-correct.** Deleting Jake's `cleanups` docs does nothing to `user_stats/{jakeUid}` — it will keep showing his old (inflated) `total_pickups`/`total_bags`/`total_cleanups`/`active_days` on the in-app individual leaderboard indefinitely, until something happens to re-run `updateUserStats()` | **Yes — explicit step required.** Simplest safe fix: delete `user_stats/{jakeUid}` outright. `getUserStats()` and `getIndividualLeaderboard()` both already handle a missing doc gracefully (return `null` / just not in the list, `firebaseDatabase.ts:1224-1249`), and the doc regenerates cleanly (all-zero) the next time Jake saves a real cleanup or touches Settings |
| **`segment_status`, `park_status`** ("% green" street/park coverage) | Written directly by `markRouteCleaned()`/park equivalent during a walk, **shared by ALL users**, keyed by segment/park id — `{ grid, last_cleaned, last_user, clean_count }` (`streetSegments.ts:1-19`, `:482-534`) | **Not touched at all** by deleting `cleanups` — this is a genuinely separate data path, not derived from `cleanups` at read time | Judgment call, see point 4 — not required for the "misrepresenting community size" concern the way leaderboard/aggregate numbers are, since `last_user` is never shown as an attribution in the UI (it's operational metadata, not a display field) |

**Net answer to "hard-delete vs. reset-and-rebuild":** it's neither purely one nor the
other, and it doesn't need to be manually reconciled the way the task's framing worried
about — **the codebase already has the exact incremental-delta-vs-full-rescan split this
concern was about, and both of the delta-based rollups (`team_stats`, `org_stats`) already
self-correct on any real Firestore delete**, because that delete fires the same
`onCleanupWrite` trigger a normal edit does. The one place that genuinely needs a manual
step is `user_stats`, because it isn't a Cloud Function rollup at all — it's a client-side
cache that nothing server-side ever refreshes.

**Where this data is actually rendered publicly today** (so it's clear what's currently
live and unauthenticated, not just theoretical):
- `~/pick-app/web/index.html:380-384` — homepage counter, reads `global_stats/summary.allTime` directly, no login.
- `~/pick-app/web/map.html:162,268` — public map, reads `global_stats/summary` for `topCities`, `topPickers`, and `recentTiles` (a live public heatmap), no login.
- `~/pick-app/web/city.html:158,202` — per-city page, reads `city_stats/{slug}` for `week`/`allTime`/`topPickers`, no login.
- `~/pick-app/web/org.html` — token-gated, reads `org_stats` via the `orgDashboard` Cloud Function (district totals; this is the page **Litter Legion (Astoria, NY)**, the first real sponsor, is actually using per the ledger's 2026-09-03 entry).
- In-app `app/(tabs)/leaderboard.tsx` — individual + team boards, reads `user_stats` and `team_stats`.

One more nuance worth flagging, not urgent: `global_stats`/`city_stats`' `hotspots` field is
**all-time** (`addHot()` runs on every cleanup unconditionally, `functions/index.js:437-448,465`),
so it will keep showing Jake's historical pin density until the wipe runs. `recentTiles` is
a **rolling 7-day window** (`inWeek` gated, `functions/index.js:394-398,476-479`) and
already self-clears on its own — no action needed there regardless of when the wipe runs.

---

## 3. Ordering/timing — right before the flip, not earlier; a flag-based alternative exists but isn't free

**Do the wipe right before whatever moment first exposes these numbers to a wide,
non-tester audience** — not earlier. Two open items still gate this being safe to schedule
concretely:

- Jake is still doing real field-test walks (per `LAUNCH_LEDGER.md`'s open items: the
  narrow-street both-sides-cleaned check, the force-quit/background-tracking check, and a
  still-wanted 2-hour+ walk for the long-walk-crash gate). Any test walk done *after* the
  wipe re-contaminates the aggregates and the wipe boundary has to move forward again.
- **"Public launch" is itself ambiguous right now** — the TestFlight link has been public
  since 2026-08-23 per the ledger, so the wipe's trigger event probably isn't "TestFlight
  goes public" (already true) but something narrower: an App Store production release, or
  the first time `pickglobal.org`'s homepage/map is actually pushed out in marketing. **This
  needs Jake to name the actual moment** — the plan below treats it as a variable
  (`<wipe boundary>`), not a fixed date.

**A "test mode" flag that avoids ever needing a destructive wipe was considered and is
worth a separate call, not a replacement for this plan.** It would mean: add an `is_test`
field to `cleanups` at write time, and have `rebuildPublicStats`, `applyTeamDelta`/
`rebuildTeamFromScratch`, `districtStatsFromSnapshot`/`applyOrgDeltaFor`, and
`updateUserStats()`'s own `getCleanups()` call all skip flagged docs. Two reasons this
isn't proposed as *the* plan here:
1. It doesn't remove the need to deal with Jake's **existing** historical test cleanups —
   those already lack the flag, so they'd still need exactly the delete-and-reconcile pass
   below as a one-time backfill. It adds scope, it doesn't replace any of it.
2. It touches the same aggregation functions that were just rewritten 2026-09-01 for the
   Cloud Functions cost fix (incremental rollups). Modifying them again this close to
   launch, for a problem that a one-time scoped delete already solves, is exactly the kind
   of native-adjacent-risk tradeoff the ledger's "don't stack changes into a fragile system
   right before shipping" posture warns against — except here it's OTA-shippable JS, so the
   risk is correctness/regression risk in a system that was just stabilized, not a build-slot
   cost.

Worth it only if Jake expects to keep doing **occasional device-testing walks on his own
account after launch** (e.g. verifying a future OTA update still counts correctly) and
wants to never have to repeat this wipe. If that's a real ongoing need, flag it as a
follow-up item for `code`, separately — not blocking this plan.

---

## 4. Risk of wiping something that is NOT just test data

- **Jake's account will very plausibly keep being used as a real future user.** This is
  the single biggest reason **not** to reuse the app's existing full-account-deletion path.
  `deleteAccountData()` (`firebaseDatabase.ts:934-1086`) already exists and is thorough — it
  removes `posts`, `likes`, `cleanups`, `badges`, `adoptions`, outgoing `follows`,
  `challenges` participation + `contrib` docs, `live_walks` presence, `profiles`, the
  `handles` claim, `email_index`, the avatar file, `user_stats`, and the `users` doc, then
  calls a server-side cleanup function for what client rules forbid — and its caller in
  `authService.ts:309-333` follows it with Firebase Auth's own `deleteUser()`, an
  **irreversible account teardown**. That is the wrong tool here: it would also kill Jake's
  profile, handle, and social graph, not just his historical test volume. **The plan below
  is a scoped delete of `cleanups` docs only** (by uid + cutoff), explicitly leaving
  `profiles`, `handles`, `users`, `email_index`, and the avatar alone.
- **Whether Jake's test-walk pickups should even count as "not real"** is a genuine
  judgment call, not something this plan resolves unilaterally — he really did pick up
  litter on those walks, even if the primary purpose was validating the detector. The
  concern the task raises is specifically about **presenting development-era volume as if
  it were community engagement** on a *public* aggregate before there's a real community
  yet — that's a framing/credibility question, not a "did the picks really happen"
  question. Recommend treating this explicitly as Jake's call at execution time, not
  something baked into the script.
- **Geographic contamination on `org_stats` does not add extra risk beyond the uid
  filter** — worth stating since it might look like it would. Because `applyOrgDeltaForCleanup`
  reads the full deleted cleanup doc (including its coordinates) regardless of whose uid
  wrote it, deleting by `userId == jakeUid` still correctly decrements *any* sponsor
  district Jake's test walks happened to fall inside — no separate geographic pass needed.
- **`segment_status`/`park_status` are the one place hard-deleting could visibly take
  something away that isn't purely "Jake's."** They're keyed by segment, not by user, and
  `last_user` only records whoever **most recently** marked a segment clean — if a real
  tester walked the same block after Jake did, `last_user` already shows the tester, not
  Jake, and reverting by `last_user == jakeUid` would miss it (segment already correctly
  "belongs" to the tester) or, in the other direction, could revert a segment a real tester
  cleaned *before* Jake happened to walk it too. This is a real but low-stakes ambiguity —
  recommend leaving `segment_status`/`park_status` **out of the default wipe**, called out
  as an optional, separate, judgment-call step (§ Execution plan, step 7).
- **This is also a pre-existing gap worth surfacing on its own, unrelated to launch
  timing**: `deleteAccountData()` — the app's real user-facing "delete my account" flow —
  never touches `segment_status`/`park_status` either. Any real future user who deletes
  their account today leaves their `last_user` stamp behind forever. Not this plan's job to
  fix, but worth a one-line flag to `qa`/backlog separately.
- **Do this against a real Firestore backup, not blind.** Since this is a live, permanent
  delete against production data (there's no soft-delete/trash here), step 2 below is a
  local export of the exact docs about to be deleted before touching anything, specifically
  so the boundary/uid choice is recoverable if it turns out wrong after the fact.

---

## Concrete execution plan (for a future session, with explicit go-ahead)

### Step 0 — decisions only Jake can make, needed before anything is written or run
1. **Is the dev/test account the same account Jake keeps using as a normal user after
   launch, or will he switch to a fresh account for real use?** Everything below assumes
   "same account, scoped delete" per point 4 — if instead he's starting fresh, this whole
   plan simplifies to "stop using the old account for anything public-facing," and
   `deleteAccountData()` becomes an option again.
2. **What is the wipe boundary timestamp?** — the moment right before whatever event first
   puts these aggregate numbers in front of a wide, non-tester audience. Not automatically
   "TestFlight goes public" (already true since 2026-08-23) — Jake needs to name the actual
   moment (App Store release? a marketing push? something else?).
3. **Does he want a final smoke-test walk *after* the wipe**, to confirm the app still
   works post-wipe? If yes, that walk needs to either be excluded from the wipe (it's after
   the boundary) or get its own tiny manual cleanup afterward — call this out explicitly at
   execution time so it isn't forgotten.
4. **In/out on `segment_status`/`park_status`** (point 4) — default recommendation is
   leave them alone; confirm.

### Step 1 — identify Jake's uid
Per §1 — via Settings screen state or Firebase Console, not guessed.

### Step 2 — back up before deleting anything
Export the target `cleanups` docs (query `userId == jakeUid AND timestamp <= boundary`) to
a local JSON file before any delete, so the operation is reversible if the boundary or uid
turns out to be wrong. A `firestore-export`/`gcloud firestore export` of the whole
`cleanups` collection is the safer option if time allows; a targeted query dump is the
minimum bar.

### Step 3 — delete the `cleanups` docs, one at a time
Via the Admin SDK (**not** a bulk/`gcloud` collection-level delete that could bypass
per-document writes) — model the script on the existing one-off admin-tool pattern already
in this repo, `create-sponsor-team.js` (repo root, uses
`~/.secrets/pick-app/serviceAccountKey.json`, project `pick-app-74c2e`). One doc at a time
(or a small batch with a short delay) so each delete fires `onCleanupWrite` individually
and `applyTeamDelta`/`applyOrgDeltaForCleanup` apply cleanly rather than racing each other
inside the same transactional rollup doc.

### Step 4 — force the correctness backstops rather than waiting for schedules
- Call the `rebuildTeamStats` callable (`functions/index.js:343`) to fully reconcile
  `team_stats` immediately.
- Call the `rebuildPublicStats` callable (`functions/index.js:543`) to refresh
  `global_stats`/`city_stats` immediately, rather than waiting up to 4 hours for
  `scheduledPublicStats` — this is what the public website reads live.
- Manually invoke `buildOrgSnapshots`'s logic (or trigger `scheduledOrgSnapshots` early)
  to refresh `org_stats` immediately, rather than waiting up to a week for the Monday
  self-heal.
- Delete `user_stats/{jakeUid}` outright (§2 — the one rollup that doesn't self-correct at
  all).

### Step 5 — verify
- Reload `pickglobal.org` (homepage counter, map, an affected city page) and confirm the
  numbers dropped as expected.
- Reload the token-gated `org.html` dashboard for any sponsor team (Litter Legion/Astoria
  currently) whose district overlapped Jake's field-test walks, confirm its totals dropped.
- Check the in-app individual and team leaderboards.
- Spot-check one or two `team_stats`/`org_stats` docs directly in the Firestore console
  against the exported backup from step 2, to confirm the delta math landed where expected.

### Step 6 — leave Jake's account itself alone
No `deleteAccountData()`, no `deleteUser()`. `profiles`, `handles`, `users`, `email_index`,
avatar all stay — his account keeps existing so post-boundary activity is genuinely his,
same identity, same handle.

### Step 7 (optional, only if Jake confirms in Step 0.4) — `segment_status`/`park_status`
A separate, smaller pass: query `segment_status`/`park_status` where `last_user == jakeUid`
and reset those segments to unclean. Treated as optional/lower-priority per §4 — not
required for the "misrepresenting community size" concern this whole plan is about, since
`last_user` is never shown as a public attribution.

---

**Nothing above touches the native app binary** — this is entirely Cloud Functions (JS) +
a one-off Node admin script against Firestore, so it has no interaction with the
native-build-batching rule (`[OTA]`/`[Native]` in `PROJECT_TIMELINE.md`) and doesn't need
to wait for an EAS build slot. It can run at any time Jake gives the go-ahead, independent
of build/submit timing.
