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

- 2026-09-08 — **Group impact map steps 1-3 built, deployed and verified live** (`8ece843`,
  `c5b5065`, `61e24f1`, `2755d5a`). Firestore rules released; `createChallengeToken` and
  `getChallengeToken` created; `onCleanupWrite` updated (rev 00021). Both callables confirmed live
  and correctly gated (`UNAUTHENTICATED` without sign-in).
  **End-to-end verification against production, on the Litchfield Litter Invitational:**
  ```
  challenge_stats   {cleanups:40, pickups:793, bags:11, hours:2, participants:2, roster_size:2}
  challenge_markers {suppressed:true, reason:"too_few_participants", cells:0, grid:0.0003}
  ```
  Both the roster-scoped rollup and the §11.6 suppression fired exactly as designed. All test
  artifacts removed afterwards — token, index, stats and marker docs all back to 0, probe field
  deleted from the cleanup.
  **⚠️ TESTING GOTCHA WORTH KEEPING: Firestore does not trigger on a write that changes nothing.**
  Three verification attempts reported "MISSING" and looked like a broken pipeline. The cause was
  the test, not the code: `set({field: <same value>}, {merge:true})` leaves the document
  byte-identical, Firestore does not create a new version, and **no `onDocumentWritten` trigger
  fires**. The function logs proved it — the last invocation predated all three writes. A
  "value-preserving touch" is not a way to exercise a Firestore trigger; a real field change is
  required. Two earlier attempts also failed for a *legitimate* reason worth separating from this
  one: they targeted cleanups outside the challenge's window/area, where declining to rebuild is
  correct behavior.
  **Also confirmed by this run:** `createChallengeToken`'s mint-time seed is load-bearing. Because
  the incremental path only rebuilds when a written cleanup falls in scope, a challenge whose work
  is all in the past would otherwise never get a stats doc at all. The two direct-write tests
  skipped the callable and so skipped the seed — which is exactly why they produced nothing.

- 2026-09-09 — **CARTO's self-serve key form is idempotent per domain: re-applying returns the
  SAME key, so the leaked basemap key cannot be rotated this way.** Jake requested a replacement
  key after the 2026-09-08 transcript leak, saved it to `.env`, and the value came back
  byte-identical to the key already in `.env`, `web/map.html`, `web/org.html`,
  `web/challenge.html` and the shipped bundle. `.env`'s mtime confirms the save happened; this is
  CARTO's behavior, not a failed edit. **Corrects an earlier guess in this session** that
  re-applying would issue a second, distinct key.
  **Consequences.** No web-file swap and no OTA were needed. The leaked key remains live and
  there is no self-serve way to retire it — CARTO documents no revocation, rotation or
  deactivation, so killing it would require a support request. Practically the exposure stays
  low: it is an `EXPO_PUBLIC_` key that ships inside the app bundle by design, so anyone with the
  app already has it, and the free tier is 5M tile requests/month. **Recorded so this is not
  re-attempted as though it were an open task** — "rotate the CARTO key" is closed, not pending.

- 2026-09-09 — **The "Always" location question CANNOT be answered from production data: there are
  ZERO foreground-mode walks on record.** Full read of the `cleanups` collection via the Admin SDK
  (217 docs, 2026-06-10 → 2026-09-08). This is a negative result, deliberately not dressed up as a
  finding.
  **`session_mode` coverage.** Field present on **23 of 217 docs (10.6%)**. Every one of the 23 is
  on or after 2026-08-25T10:51Z, and coverage in that window is **23 of 23 (100%)** — no walk since
  instrumentation has silently dropped the field. The other 194 predate it entirely. Values found
  (no unexpected ones):
  ```
  <field absent>  194  (89.4% of corpus — all pre-2026-08-25)
  "background"     17  (73.9% of the 23 instrumented walks)
  "unresolved"      6  (26.1%)
  "foreground"      0  (0.0%)
  ```
  **Answers to the five questions, plainly.** (1) Foreground share is **0 of 17 resolved walks**;
  for 89.4% of the corpus it is unknown and unrecoverable. (2) The core duration/distance
  comparison **cannot be run** — one arm is empty. (3) Per-user split **cannot be run**: all 17
  resolved walks are Jake's; the only other instrumented walk in existence (tester
  `o8CC8WkJ…`, 2026-09-06) came back `unresolved`. The other three testers have 32 walks between
  them, all pre-instrumentation. Non-Jake walks are **34 of 217 all-time**, last one 2026-09-06.
  (4) Mix over time shows no trend to report — among instrumented walks, Aug was 4 background / 2
  unresolved, Sep 13 background / 4 unresolved; zero foreground in either. (5) Correlations with
  `items_count`, `pace_median_mps` and `carry_mode` are single-arm and therefore meaningless here.
  **Background-only baseline, recorded now so a future foreground arm has something to compare
  against** (n=17, all Jake, all `iPhone14,7 / iOS 26.6` where `device_model` is present):
  ```
  duration_seconds  n=17  min 29    p25 82    med 215   p75 248   max 3962  mean 542.3
  items_count       n=17  min 0     p25 3     med 15    p75 36    max 533   mean 53.5
  pace_median_mps   n=13  min 0.21  p25 0.62  med 0.80  p75 1.22  max 1.27  mean 0.85
  distance_m        n=7   min 40    p25 185   med 290   p75 335   max 1610  mean 425.7
  carry_mode: pocket 10, hand 1, absent 6
  ```
  **Sample-size honesty.** 17 walks, one device, one tester, 15 days. Even with a foreground arm,
  a Mann-Whitney at α=0.05 / 80% power needs roughly 15 per arm to see a *large* effect (d≈1.0),
  ~26/arm at d≈0.8 and ~65/arm at d≈0.5. Nothing short of a very large effect would be visible.
  **Corrects the Launch-gates keep-awake row**, which closed 2026-08-24 on the reasoning that
  "`session_mode` is now saved on every walk, so the field answers this rather than the ledger
  asking about it." Coverage is indeed 100% since 2026-08-25 — but 15 days of it produced **zero
  foreground observations and one usable tester walk**, so the field does not yet answer the
  question. Worth stating that the foreground fallback (`activateKeepAwakeAsync`,
  `map.tsx` ~L1641, reached only when `startBackgroundSession()` returns `'foreground'`) has **no
  evidence of ever having executed in production**. It is not a demonstrated cost; it is an
  unexercised code path.
  **Four data-quality items for `code`, each with reproducible detail:**
  1. **`session_mode: 'unresolved'` still fires after `ae3f028`** (which landed 2026-08-25T10:55Z
     to fix exactly this). Post-fix rate is **4 of 14 walks since 2026-09-01 = 28.6%**. Doc IDs:
     `Lmo58pXnd5EyJHeaGdtk`, `JkjTn2Yadp6O6S7tbcC1`, `eNRzJbBdL9oHADQ0eJQI` (Jake, 2026-09-01),
     `mVHe2aXjOoEj1nOzHR8X` (tester `o8CC8WkJ…`, 2026-09-06). The two on 2026-08-25 (10:51, 11:02)
     straddle the commit and most likely predate its OTA, so they are not counted as post-fix.
     Mechanism unconfirmed — not diagnosed here, two candidates worth checking: `map.tsx` L1638
     calls `startBackgroundSession()` fire-and-forget via `.then()`, and `map.tsx` L1552 resets
     `sessionModeRef.current = null`, so a walk resumed or crash-recovered without a fresh
     `startCleanup()` would save as `unresolved`. **This matters for the permission question
     specifically: `unresolved` is ambiguous and could be masking a foreground walk**, so "zero
     foreground" is strictly 0 of 17 known, with 6 unknown.
  2. ~~**`route_points` is present on all 217 docs and EMPTY on all 217.**~~ **WRONG — RETRACTED
     2026-09-09, same day, on verification.** `route_points` is **populated on 216 of 217** docs
     (empty on exactly one; longest walk holds 73 points). Re-checked directly by parsing every
     doc and counting `.length`. Distance CAN in principle be derived from it, and the historical
     route corridors on the Map tab draw from it — a claim that it was universally empty would
     have implied several shipped features were rendering nothing.
     *Kept visible rather than deleted because of what it was:* this analysis was explicitly
     briefed on the "check `.length`, not `Array.isArray()`" trap, and then produced a
     mirror-image version of the same error — reporting real data as empty instead of empty data
     as real. **Verify any claim that a whole field is empty or absent before acting on it**; the
     cost of being wrong in that direction is concluding a working feature is broken.
  3. **`distance_m` exists on only 7 of 217 docs (3.2%)**, all from 2026-09-08. It is not yet a
     usable comparison metric for any cohort question, mode-related or not.
  4. `items_count` vs `items_detected`: both present on 50 docs, **differing on 5 (10%)** — i.e.
     45 of 50 counts were never corrected at save. Consistent with the known skipped-prompt
     problem, quantified. Separately, `ground_truth` is a non-empty array on **3 of 217** docs
     (up from 1 as of the 2026-09-07 entry).
  **What would actually answer the question — proposed, not run.** Two things, and the second is
  the one that matters. (a) A within-device forced-mode block: set PICK to "While Using" in iOS
  Settings, then run ~6 walks alternating foreground/background on the same route, pace, carry
  position and starting battery level. That is cheap, exercises a path with zero production
  evidence, and would at minimum confirm the fallback works at all. (b) The real question is about
  *other people's* phones, and we have exactly one instrumented tester walk ever — nothing about
  the permission mix in the wild is knowable until Build 36 testers produce walks. **Schema gap
  blocking the causal claim either way:** "battery drain cuts walks short" has no proxy in the
  data — battery level at walk start/end is not recorded. If this question is worth settling,
  that field is the prerequisite.

- 2026-09-09 — **`GROUP_IMPACT_MAP_SPEC.md` §11.7 steps 4/4a confirmed DEPLOYED to production**,
  not just committed. `e7cbd7f` (`warmStreetTilesForChallenge`, called inline from
  `createChallengeToken`; warms up to 12 Overpass street tiles when a challenge share link is
  minted, fixing a real bug where non-NYC challenges like Litchfield got `streets:[]`) and
  `a367f19` (new `challengeImpact` HTTPS function, token-gated, serves only pre-aggregated docs
  via `segment_status`/`precache_streets` joined on `gridKey`).
  **Verification.** `firebase functions:list --json` (from `apps/companion/functions`) shows
  `challengeImpact` live (v2 HTTPS, us-central1, ACTIVE) — it did not exist before `a367f19`, so
  its presence alone confirms the deploy. Each function's Cloud Storage source object's
  `generation` timestamp lines up with a real `firebase deploy` run immediately after each commit:
  `challengeImpact` source uploaded 2026-09-08 19:20:18 ET (12s after the 19:20:06 ET commit);
  `createChallengeToken` source uploaded 2026-09-08 19:23:56 ET (13s after the 19:23:43 ET
  commit). `git log -- apps/companion/functions/index.js` confirms `e7cbd7f` is the last commit
  touching that file, so HEAD matches what's live. Neither commit touched `firestore.rules`.
  **Gap worth flagging:** unlike steps 1-3 (which got a real end-to-end Litchfield verification,
  see the 2026-09-08 entry above), nobody has smoke-tested `challengeImpact` end-to-end yet — no
  confirmed real call, no check that it returns the expected `streets`/`stats`/`markers` shape.
  Deployed, not verified.

- 2026-09-09 — **Detector telemetry export widened to consent-gated NEW SIGNUPS (Jake's
  2026-09-09 approval). Client plumbing + Cloud Function param implemented; NOTHING DEPLOYED,
  NOTHING PUBLISHED.** Scoping brief said "plan, implement only if small and self-contained" —
  it was, so it is written, typechecked and test-harnessed, but no `eas update`, `eas build` or
  `firebase deploy` was run.

  **Consent record.** `users/{uid}` gets three fields, written once at account creation:
  `detector_telemetry_consent: true` (the queryable predicate — Firestore can't index "field
  exists"), `detector_telemetry_consent_at` (epoch **millis**, matching that doc's existing
  `created_at`/`updated_at` convention), and `detector_telemetry_disclosure_version` (the exact
  copy version shown — without it the first reword makes every prior consent unauditable).
  Durability checked rather than assumed: every writer of `users/{uid}` in the app
  (`firebaseDatabase.ts`, `notifications.ts`, `moderation.ts`) uses `setDoc(...{merge:true})` or
  `updateDoc`, so nothing overwrites the doc wholesale and the flag can't be clobbered by an
  unrelated write. Absence means NO, never "unknown" — every pre-existing account simply lacks
  the field and is not returned by the export's `== true` query. No backfill.

  **Where it lands:** `app/auth/signup.tsx` → `authService.signup()` → `initializeUserSettings()`,
  and `authService.loginWithApple()` **only on its `isNewUser` branch** (re-signing-in is not a
  fresh disclosure). The disclosure block renders *outside* signup.tsx's collapsed
  `showEmailForm` section on purpose — Sign in with Apple sits above that block and creates an
  account in two taps, so copy nested inside the email form would be invisible to the fastest
  signup path.

  **Fail-closed on the copy, which `safety` owns.** `DETECTOR_DISCLOSURE_TEXT` /
  `DETECTOR_DISCLOSURE_VERSION` in `src/constants/legal.ts` ship EMPTY. Empty text renders no
  disclosure and passes no version, which records no consent at all — so this can ship before the
  copy lands without ever claiming consent for a disclosure nobody was shown; it just yields zero
  consenting accounts. Filling in those two constants is the entire go-live step, no further code
  change.

  **Cloud Function (`apps/companion/functions/detectorExport.js`).** The brief's description of
  the current filter was wrong in a way worth recording: it is **not** a hardcoded single-account
  scope. `user=<uid>` has been an optional query param since 2026-09-07; the Jake-only 2026-09-08
  run was an *invocation* choice, not a code constant. Added a new optional `scope=consented`
  (mutually exclusive with `user`): queries `users` for consent (selecting only the consent
  timestamp — no name/email/neighborhood enters function memory), then runs one scan per
  consenting account floored at `max(since, that account's consent moment)`. **Strictly
  additive** — with no `scope` param every existing path behaves exactly as on the 2026-09-08
  run, so this file landing in an unrelated `firebase deploy --only functions` cannot change what
  an existing invocation does. Rows are unchanged: no `userId`, no doc id, no per-user key —
  consent is a *filter*, not a field, so the spec's "no cross-walk linkage" guarantee holds.
  Flagged-but-undatable accounts are skipped rather than exported, and counted in the response as
  `skipped_no_consent_at`.

  **Bug found and fixed in this session's own code, recorded because it is the second instance
  of one pattern.** The first cut reused `toEpochSeconds()` for the consent timestamp; that
  helper passes plain numbers through as *seconds*, but consent is written as `Date.now()` —
  *millis* — so every consent moment resolved to roughly the year 57000, filtered out every walk,
  and reported a clean, successful, ZERO-ROW export. Identical failure shape to the
  `cleanups.timestamp` bug this function's header already documents (silent null/empty result, no
  error), one collection over. Fixed with a dedicated `consentEpochSeconds()`.

  **Verified:** `npx tsc --noEmit` clean; `scope=consented` exercised end-to-end against a
  stubbed Firestore/Storage (throwaway harness, not committed) with four fixture accounts and
  seven walks — pre-consent walks excluded, unconsented account excluded, undatable account
  skipped and counted, `since` + consent floor resolving to the stricter of the two, rows sorted
  oldest-first, no `userId` on any row, and the `user=` path byte-identical to prior behavior.

  **OTA-able. No native build. Build 36 is untouched** — the client change is pure TS/TSX, no
  native module, no `app.json` change, so nothing here invalidates the App Review candidate. The
  Cloud Function ships via `firebase deploy --only functions`, a separate action from any OTA.
  **No Firestore rules change needed:** `match /users/{userId}` already allows `read, write: if
  isOwner(userId)`, and the export runs on the admin SDK, which bypasses rules entirely.

  **⚠️ LEDGER CORRECTION NEEDED — the Public-beta "Detector export CF" row is stale on one
  point.** It ends with *"`carry_mode`/`device_model` stay excluded from any export —
  collection-disclosed, not use-disclosed."* **That is not what the live code or the live policy
  say.** Both fields have been IN `ALLOWED_TOP_LEVEL_FIELDS` since 2026-09-07 and were in the
  2026-09-08 174-row export. Re-verified this session against both content-carrying copies of the
  policy: `src/constants/legal.ts:34` and `~/pick-app/web/privacy.html` ("To improve pickup
  detection") each disclose the **use** in as many words — *"your walking pace, and the device
  model and carry position above — to measure and improve detection accuracy"* — and the
  collection clause adds they are *"kept only to make the detection-accuracy work below
  meaningful."* There is no live policy text supporting the exclusion; the ledger row is carrying
  the superseded pre-2026-09-07 reading forward, and it was repeated back to this session as a
  standing constraint, which is how a stale line becomes a durable one. **Not changed
  unilaterally — Jake's call**, since reversing it would delete real stratification data
  (`carry_mode`/`device_model` are the two fields that let a multi-tester corpus be split by phone
  and carry position, which is the whole point of getting past n=1). A banner recording the same
  discrepancy was added to `docs/DETECTOR_EXPORT_SPEC.md`, whose §2/§6 carried the identical
  stale claim.

  **Open for Jake, beyond the above.** (1) `app/auth/login.tsx` also offers Sign in with Apple,
  which silently creates an account for anyone who has never signed up — that screen shows no
  disclosure, so those new accounts land un-consented and excluded. Fail-closed, not a leak, but
  it means a real share of new signups won't be in the corpus until `safety` puts the copy on
  login.tsx too. (2) Apple's `isNewUser` is inferred from `creationTime === lastSignInTime`; if
  it ever misfires for a returning user, consent would be stamped on a pre-existing account —
  harmless here because the per-account cutoff still excludes all of that account's earlier
  walks. (3) One Firestore query per consenting account is fine at new-signup scale; at hundreds
  of accounts, replace the per-account cutoff with a single global disclosure-date floor and
  batch the `userId in [...]` queries.

---

- **2026-09-09 — `publish-detector.sh` had no Sentry guard, and no hard failure when `.env` is
  missing. Both fixed (uncommitted).** Found while verifying whether `EXPO_PUBLIC_SENTRY_DSN` was
  set. **It is** — registered in the EAS `production` environment alongside
  `EXPO_PUBLIC_CARTO_API_KEY`, so native builds get it injected server-side. But EAS-registered
  vars apply only to `eas build`; `eas update` bundles locally and Metro inlines `EXPO_PUBLIC_*`
  from the shell's own `process.env`. The script already sources a `.env` to cover that — the
  `$APP/.env` branch is dead (that file does not exist), but the `elif "$REPO/.env"` fallback
  catches it, so sourcing does work today. *An earlier reading of this session claimed the guard
  had never worked; that was wrong and is retracted — the grep had cut off before the `elif`.*
  Two real gaps remained and are now closed: (1) if **neither** `.env` existed the chain fell
  through silently and published a bundle with every `EXPO_PUBLIC_*` var inlined as an empty
  string — now a hard `exit 1`; (2) **`EXPO_PUBLIC_SENTRY_DSN` had no assert at all**, unlike
  CARTO. That is the worse of the two: a missing CARTO key shows a map watermark and gets caught
  in minutes, while a missing DSN has *no symptom* — `errorMonitoring.ts` just no-ops, and since
  OTA JS replaces the native build's JS, an OTA publish can silently disable Sentry on a build
  that shipped with it. Now prompts the same way CARTO does. Verified: `bash -n` clean, and
  sourcing simulated from a shell with both vars explicitly unset resolves both (no spurious
  prompts on real runs). shellcheck not installed, so that lint was skipped. **Residual gap:** the
  guard only covers the script path — a hand-run `eas update` still has none.

- **2026-09-09 — Draft A detector-telemetry disclosure approved by Jake and built; staged, not
  shipped.** `DETECTOR_DISCLOSURE_TEXT`/`_VERSION` filled (`'2026-09-09'`), new
  `DETECTOR_DISCLOSURE_DETAIL` holds the "What gets analyzed" sheet, and `app/auth/signup.tsx`
  gained the link row (`What gets analyzed · Privacy Policy · Terms`) plus a **single** `<Modal>`
  with a switched body — deliberately not three modals, since two mounted at once stack behind
  each other on iOS (ShareComposer and RecapHistory both hit this). `tsc --noEmit` clean; theme is
  `as const` so that check validates the `C.*`/`Fonts.*` keys rather than passing vacuously.
  **Not visually verified** — no simulator run; the open question is whether the three links fit
  one line on a small iPhone or wrap. Draft A's Terms-acceptance line was deliberately NOT
  included (separate decision — there is no contract-acceptance moment anywhere in the app).
  `session_mode` deliberately absent from the sheet. **Consequence to know: the working tree is
  now armed.** `eas update` ships the working tree, so the next OTA publish for any reason
  carries this disclosure live and starts recording consent.

- **2026-09-09 — two things live-but-uncommitted, flagged not fixed.** (1) `~/pick-app/web/privacy.html`
  and `web/terms.html` are modified against `90c4c61` while matching what is live on
  `pickglobal.org` — production is *ahead* of the repo, so a stray `git checkout` on either
  silently reverts the live policy text in the repo of record. (2) `docs/LAUNCH_LEDGER.md` itself
  carries the 2026-09-08 scheduled-task reconciliation, uncommitted.

- **2026-09-09 — no App Store privacy-nutrition-label record exists in either repo.** Grepping both
  for "nutrition", "App Privacy", "Data Linked", "Data Used to Track" returns nothing, so what was
  answered in App Store Connect is unknown. TestFlight tolerated that. Only Jake can pull the
  current answers. Separate from any submission decision — the gap exists today either way.

- **2026-09-09 — the Draft A disclosure is LIVE, and consent is now recording.** Pushed 39 commits
  to `origin/main` (pre-push secret scan clean; the repo had been unpushed and climbing since
  2026-09-06). Then two deliberately narrow deploys, **not** a blanket one:
  `firebase deploy --only functions:exportDetectorTelemetry` (one function updated, not all 25),
  and `eas update --branch production` → group **`ff25e087-8dfc-4ba3-b3cd-b6f95f71d8a6`**,
  commit `7ddcab0`, runtime 1.2.2. Preconditions asserted before publishing: CARTO key set,
  Sentry DSN set, `apps/companion` tree clean so the bundle equals HEAD.
  **From this point, accounts created on iOS see the disclosure and get
  `detector_telemetry_consent` written; `scope=consented` can export them.**

  **Deliberately NOT deployed: the group impact map functions.** `firebase deploy --only functions`
  would have pushed six `functions/index.js` commits from source — `8ece843`, `c5b5065`,
  `61e24f1`, `2755d5a` (the GROUP_IMPACT_MAP steps this ledger flagged as committed-but-not-
  deployed), plus `a367f19` and `e7cbd7f`. `firebase functions:list` shows `challengeImpact` IS
  live, so *some* of that shipped, but there is no record of which *versions* are deployed, and
  `61e24f1` enforces a privacy floor server-side — not something to ship as a ride-along. **Open:
  reconcile deployed vs. source for `functions/index.js` before the next broad deploy.**

  **Near-miss worth recording.** An unrelated OTA went out at 07:42 ("instrumentation: unresolved
  reason + count_confirmed") while a live session had the consent UI half-built in the same tree;
  the disclosure edits landed 08:09-08:10, ~27 minutes later. Had the publish come after, it would
  have shipped an unfinished legal surface. `eas update` ships the working tree — a live session
  and a hand-run publish in the same tree is the collision, and nothing currently prevents it.

- **2026-09-09 — `count_confirmed` was shipping into a field the export could not read; fixed and
  deployed.** `01fa737` ("Record why a session mode is unresolved, and whether the count was
  looked at") landed in the 07:42 OTA and writes `count_confirmed` on every save. But
  `detectorExport.js`'s `ALLOWED_TOP_LEVEL_FIELDS` is exhaustive — it drives the Firestore
  `select()` projection, so an unlisted field is never read at all — and it did not list it. The
  instrumentation was accumulating where the analysis tool could not see it. Added to the
  allowlist and to `buildTelemetryRow`, deployed via
  `firebase deploy --only functions:exportDetectorTelemetry`.

  **Three states, not two, and this is the part worth not losing:** `true` = the correction panel
  was opened, so `items_count` is a human judgement; `false` = it was not, so `items_count` is
  `items_detected` under another name; `null` = the walk predates the instrumentation and nothing
  is known. **Never default null to false** — that relabels every historical walk as "unchecked"
  when it is genuinely unknown. Verified against all three plus a non-boolean junk value (also
  falls to null rather than coercing truthy).

  **This retires, in the right way, the recurring "six consecutive walks saved uncorrected" item.**
  The fix that actually shipped is NOT the forced confirmation an earlier session in this thread
  recommended: `map.tsx:127-141` records a deliberate product decision against it — *"Deliberately
  NOT a forced confirmation step: correcting is a face-saver we would rather nobody needed, so the
  goal is to record whether the number was seen, not to make people touch it."* The shipped
  approach is a visible affordance plus this boolean. Any future session proposing to force the
  step should read that comment first.

  **Still not exported, and needs a decision before it can be:** `session_mode` and the new
  unresolved-reason field from the same commit. Both are collected. Putting either in the export
  requires a line in the signup disclosure sheet and a `DETECTOR_DISCLOSURE_VERSION` bump — the
  sheet currently omits `session_mode` deliberately, with a code comment saying exactly this.

- **2026-09-09 — deployed-vs-source reconciled for `functions/index.js`. Nothing is waiting on a
  deployment.** Opened because a blanket `firebase deploy --only functions` was held back earlier
  the same day: six commits sat in `functions/index.js` with no record of which versions were live,
  including `61e24f1`, which enforces the marker privacy floor server-side.

  **Method (reusable — there is no deploy log, but `firebase functions:list --json` exposes a
  `hash` per function, and functions deployed together share one).** `exportDetectorTelemetry` was
  deployed from current HEAD minutes earlier, so its hash labels "current". Result: **28 functions,
  9 distinct source hashes** — production is fragmented by months of scoped deploys, with a
  19-function group on the 2026-09-07 `d93873b` baseline and eight singletons deployed since.

  **But the fragmentation is cosmetic, not behavioral, and that is the finding.**
  `git diff --numstat d93873b..HEAD` on `index.js` is **674 added, 0 deleted**, and
  `diff --unified=0` contains no `-` line at all — every pre-existing line is untouched. Of the
  four hunks, three are pure appends after an existing function, defining the new exports
  (`createChallengeToken`, `getChallengeToken`, `challengeImpact`) plus their helpers; all three
  exports are confirmed live. **So the 19 "stale-looking" baseline functions run byte-identical
  code to HEAD** — they merely lack function definitions they never call.

  **One residual uncertainty, stated rather than papered over.** The fourth hunk is a single line
  inside an existing function — `ops.push(applyChallengeStatsForCleanup(before, after))` in
  `onCleanupWrite`, added by `c5b5065` (2026-09-08 18:54). `onCleanupWrite` carries a
  non-baseline hash shared with `getChallengeToken` (added 18:48), which proves it was redeployed
  from a snapshot at or after 18:48 — but **not** that the snapshot is at or after 18:54, six
  minutes later. Hash equality cannot settle those six minutes. If `onCleanupWrite` predates
  `c5b5065`, challenge stats are not being applied on cleanup writes.

  **Consequence, which reverses the earlier caution on evidence:** a full
  `firebase deploy --only functions` is now known to be **behaviorally a no-op for 27 of 28
  functions**, and it would both unify the 9 hashes and settle the `onCleanupWrite` question. It
  was right to hold it when the contents were unknown; it is now the cheapest way to close this.
  Alternatively `--only functions:onCleanupWrite` settles just the open part.

  **Also seen:** `processqueue` reports **no hash at all** and matches nothing in
  `functions/index.js` — likely an orphaned or extension-managed function. Not investigated;
  flagged so it is not mistaken for project code.

- **2026-09-09 — `onCleanupWrite` redeployed; the challenge-stats question is settled.** Ran
  `firebase deploy --only functions:onCleanupWrite` (narrow, not the full deploy — the full one was
  proven behaviorally inert for 27 of 28 functions, so it bought tidiness rather than correctness,
  and 27 needless redeploys is the wrong trade). Verified by hash: `onCleanupWrite` moved from
  `ad9df8f0…` (shared with `getChallengeToken`, a snapshot provably ≥18:48 but not provably ≥18:54)
  to a new `6c09bf68…` built from current HEAD. **`applyChallengeStatsForCleanup(before, after)` is
  now definitely wired into the cleanup trigger** — the six-minute window hash equality could not
  resolve is closed.

  **Honest side effect, against the framing used when choosing this option:** distinct source
  hashes went **9 → 10**, not down. The narrow deploy gives `onCleanupWrite` its own snapshot and
  makes production slightly *more* fragmented, not less. That was the accepted trade — correctness
  now, tidiness folded into whatever functions deploy ships next — but it is the opposite of
  consolidation and should not be mistaken for it.

  Pre-deploy safety checks that made either option viable, recorded so they are not re-derived:
  nothing `require`s the deleted `detectorExport.staged.js` (every surviving reference is a
  comment), and `functions/package.json` and `functions/shared/` are byte-unchanged since the
  2026-09-07 baseline — so no dependency drift underlies any of the nine snapshots.

- **2026-09-09 — the MapLibre port shipped a visible control collision; fixed and published.**
  Jake reported from a real device that the map tools "+" and the zoom pill were "partially
  mixing." Measured off his screenshot (1170x2532 = a 390x844pt phone at @3x): pill 181pt above the
  screen bottom, "+" bottom ~249pt, **overlap ~8pt**.

  **Root cause, and the code had already documented its own dependency.** `styles.adoptButton`'s
  comment read *"Centered over the LEAFLET zoom control below it. That control's own margin is
  zeroed in CSS"* — its `bottom: 170` was tuned against a zero-margin control. The 2026-09-08
  MapLibre port set `.maplibregl-ctrl-bottom-right { margin-bottom: 84px }`, lifting a 76px-tall
  control into 84-160 and leaving 10px, which renders as an overlap once borders and shadows draw.

  **Ruled out before concluding, not assumed:** MapLibre is innocent — reproduced 4.7.1 with the
  port's exact CSS in a browser and the control renders clean (group 38x76, buttons 38x38, zero
  overflow). `scaleInfoButton` is dead style (only `scaleInfoButton2` is used) and `mapControls`
  is top-anchored, so neither was the circle. A viewport-scaling theory was also tested and
  refuted — the meta tag is present and the numbers reconcile once the ~97pt tab bar is accounted
  for, which is why 84px CSS renders at 181pt from the screen bottom.

  **Fix: moved the button, not the control.** Start cleanup's top edge is only ~63px above the
  map's bottom, so the control's 84px is already near-minimal and lowering it trades one collision
  for another. `bottom: 170 → 190`, which also matches the `190 + 58 * n` baseline the tool options
  already used. Both sides now carry a comment naming the coupling. Published as update group
  **`b49f52c0-6282-420f-8e72-0bed4996b98e`**.

  **Caveat: not visually verified.** No simulator build was run; the fix is reasoned from measured
  geometry. Worth a glance on the next app open. **Process note — third occurrence of this class:**
  an implicit coupling (CARTO key behind a variable, the `$APP/.env` path, now two hard-coded
  offsets in different coordinate systems) broke silently because nothing named the dependency.

- 2026-09-09 (`roadmap-ops`, from the auto-neighborhood-detection design pass) — **Four code
  findings, all from reading current source at `a3e4b20`. Nothing was changed; the design lives
  in `~/pick-app/docs/AUTO_NEIGHBORHOOD_DETECTION_SPEC.md` (DRAFT v2, unapproved).** Three of
  these are independent of whether that feature is ever built.
  1. **`hoodContaining()` is a trap for its first caller, not a bug today.**
     `neighborhoods.ts:959` returns `fine.poly` **undecimated**, while the sibling
     `getHoodsInBounds()` (`:931`) — the tap path — returns `decimate(ring)` (160-vertex cap,
     `:918`). `ringHash()` (`streetSegments.ts:748`) folds `ring.length` into the AsyncStorage
     cache key, so the *same* neighborhood reached via `hoodContaining()` vs. via a tap yields
     two different `@pick_ring_*` entries and two independent Overpass fetches. Measured against
     the live Pediacities GeoJSON: **55 of 312 NYC neighborhoods (18%) exceed 160 vertices**
     (max 1,298). Harmless right now only because `hoodContaining()` still has zero callers.
     One-line fix: `decimate(fine.poly)`.
  2. **`pingPresence()`'s recovery path wipes the neighborhood.** `presence.ts:62` — when
     `updateDoc` fails because the doc is gone, the catch calls `startPresence('')`, recreating
     the presence doc with an empty `neighborhood`. That walker then drops out of every
     `w.neighborhood === name` live count (`map.tsx:732`) for the rest of the walk. Real,
     pre-existing, unrelated to any spec.
  3. **A `cleanups` doc's `neighborhood` is the reverse-geocode of the route's arithmetic mean,
     and the active level's name is never stored at all.** `map.tsx:2015-2085`. So an L-shaped
     route around a park, or an out-and-back straddling a boundary, can already be credited to a
     neighborhood the walker never entered — this affects leaderboard attribution on walks saved
     today, not just hypothetical multi-hood ones. Flagged as a finding, not a proposed change:
     changing it is a product call and is written up as one in the spec.
  4. **The "21 of 312 NYC neighborhoods can never ring-cache-hit" figure independently
     reproduced.** Fetched the live GeoJSON and reimplemented `gridCellsForRingBbox()`: 312
     features, 4-63 cells each, median 12, **291 of 312 at or under `MAX_RING_PRECACHE_CELLS`
     = 25** — matching `functions/index.js:2001-2008`'s own measurement exactly, from a separate
     derivation. Worth recording because of one member of the over-cap 21: **Sunset Park (30
     cells) is one of the ten `STREET_SEED_POINTS`**, so a deliberately seeded neighborhood can
     still never hit the ring cache. Bedford-Stuyvesant (28), East New York (36), Long Island
     City (42), Jamaica (42) and Flushing (63) are also in that set — dense residential, not
     just parks and the airport.

- **2026-09-09 — map control stack: three iterations, and a misalignment that predated the port.**
  (a) Tools "+" overlapped the zoom pill (group `b49f52c0`) — `adoptButton`'s `bottom: 170` was
  tuned against LEAFLET's zero-margin control; the MapLibre port's `margin-bottom: 84px` lifted a
  76px control into it. Moved the button to 190, not the control: Start cleanup's top is only ~63px
  above the map bottom. (b) That revealed two near-identical plus glyphs stacked ~20pt apart — added
  a `layers` glyph to `Icon.tsx` for the tools trigger (group `f65c1501`). (c) The two still read as
  unrelated widgets — a 44px bordered circle above a 38px shadowed rounded-rect. Zoom control now
  matches the app (44px, radius 22, 1.5px border, no shadow) as `toolOptionBtn` already did
  (group `d8b7271e`).

  **The finding worth keeping: the horizontal alignment was NEVER right, and the comment hid it.**
  The original said margin-right 8 on a 38px control gives center 27px from the right, matching the
  44px button at right 5. That ignores the `.maplibregl-ctrl` wrapper MapLibre nests inside the
  corner container, which carries its own `margin: 10px` — so the real center was ~37px. **My first
  fix repeated the identical mistake** and measured 9.5px out. Zeroing the wrapper margin makes the
  outer margin mean what the comment claims; re-measured at **0.00px misalignment**, pill 46x90 at
  84-174, 16px gap to the button. Both comments now carry measured numbers and say not to
  re-derive them by arithmetic.

  **Method note:** all three were verified by reproducing real MapLibre 4.7.1 with the actual CSS in
  a browser and reading `getBoundingClientRect()`, plus pixel-measuring Jake's own screenshots
  (1170x2532 = 390x844pt @3x). Arithmetic alone was wrong twice; measurement caught it both times.

- 2026-09-09 — **NYC precache drip reworked to complete one neighborhood at a time, priority-ordered
  by real usage. Implemented, NOT deployed** (Jake's explicit instruction — he triggers the deploy).
  Functions-only change: `firebase deploy --only functions`, no OTA, no EAS build, no client change.
  Files: `apps/companion/functions/index.js`, new `apps/companion/functions/shared/precacheGroups.js`.
  - **Change 1 (grouped drip).** `runPrecacheDripBatch` now fills its batch one neighborhood group at
    a time and refuses to move on while that group still has cold cells, instead of walking the flat
    1,226-tile roster in order. The stored `tiles` array is **not reordered** and there is **no cursor
    migration** — the append-only invariant ("position N is the same tile across rebuilds") is
    untouched; only the batch *selection strategy* changed. Resume state moved from the flat `cursor`
    to `groupKey`/`groupCursor`/`groupRuns`, resolved by label first so a roster rebuild or a future
    priority-list edit can't silently restart a half-finished neighborhood. The legacy `cursor` field
    is preserved but no longer read or written.
  - **Change 2 (priority).** `PRECACHE_PRIORITY_LABELS`: Fort Greene and the brownstone-Brooklyn ring
    first, then Astoria (Litter Legion, Astoria Trash Club), then Jackson Heights (JHBG), then
    everything else in the roster's own append-only order.
  - **Overpass budget: rate unchanged (8 tiles / 4h), and the drip now stops re-warming fresh tiles.**
    `refreshStreetTile` had no freshness check of any kind — it re-fetched unconditionally, so since
    the 2026-09-08 seed-offset repair reset the cursor 40 -> 0 the drip has been spending its entire
    budget re-fetching already-warm Brooklyn. Tiles inside `PRECACHE_TILE_REFRESH_AFTER_MS` (30 days,
    against the client's 52-day ceiling) are now skipped. That reclaimed budget — not a rate increase
    — is what pays for the priority warm-up. The 8/4h ceiling is deliberately left alone.
  - **A real bug found and fixed along the way, which the whole change depended on.**
    `deriveNycNeighborhoodTiles` assigned each grid cell the label of the FIRST neighborhood whose
    bbox covered it and dropped the rest. Measured against the live GeoJSON: **0 of Jackson Heights'
    18 bbox cells carried the label "Jackson Heights"** (they were filed under Elmhurst 3, Corona 6,
    East Elmhurst 4, Astoria 2, Ditmars Steinway 1, College Point 2); Fort Greene 0 of 9, Clinton
    Hill 0 of 9. Grouping the drip by that label would have "completed" a neighborhood with several
    of the cells the client's ring check actually asks for still cold — it would have looked fixed
    and changed nothing. Tiles now carry a `labels` array (union of every neighborhood covering
    them), and the weekly rebuild enriches `labels` on existing tiles **in place**, without moving
    any tile. Roster doc grows ~74KB -> ~178KB, well under Firestore's 1MiB.
  - **Second latent bug fixed:** the weekly rebuild's `tx.set(...)` had no `{merge:true}`, so it
    would have deleted the drip's new group-progress fields every Monday, restarting whichever
    neighborhood was half-finished.
  - **Simulated against a roster rebuilt from the real 312-feature GeoJSON** (offline; production
    Firestore not touched): Astoria fully ring-ready at run 3 vs run 19 today, Jackson Heights at
    run 5 (~0.8 day) vs run 103 (~17 days), and neighborhoods ring-ready within one week go 35 -> 72.
    Holds with a 10% simulated tile-failure rate (run 4 / run 6).
  - **Two things flagged, not silently fixed.** (1) A tile whose fetch legitimately finds zero
    streets (water, park interior, cemetery) is warm to the drip but a MISS to the client, which
    rejects an empty `segments` array — so one such cell permanently blocks its whole neighborhood.
    Now reported as `emptyTileKeys` in `precache_status/drip` rather than re-fetched every 4 hours.
    (2) 21 of 268 NYC neighborhoods have more than `MAX_RING_PRECACHE_CELLS` (25) bbox cells and can
    never hit the ring cache however completely they're warmed (Sunset Park 30, Williamsburg 24 is
    just under). All three priority areas are safely under: Fort Greene 9, Jackson Heights 18,
    Astoria 20.

- **2026-09-09 — precache drip neighborhood-ordering DEPLOYED, on Jake's direct "can you deploy for
  me".** `firebase deploy --only functions:scheduledOverpassPrecacheDrip,scheduledOverpassPrecacheRefresh,runOverpassPrecacheRefresh`
  — three functions updated clean, deliberately scoped rather than a blanket deploy.

  **Pre-deploy verification done in this session, not taken on trust from the implementing agent:**
  `node --check` on both files; the new `shared/precacheGroups.js` loaded and exercised directly.
  Grouping confirmed correct (Fort Greene first, Astoria and Jackson Heights ahead of non-priority,
  unlisted last) and confirmed to store `indexes` into the tiles array rather than copying tiles —
  the append-only invariant really is intact. All five `resolveGroupIndex` cases pass, including
  **label-wins-over-stale-cursor**, which is the one that matters after a Monday rebuild shifts
  group indexes. One apparent failure during this check turned out to be my own harness passing a
  string where the function takes a `{groupKey, groupCursor}` state object — noted so it is not
  re-investigated as a bug.

  **No committed tests.** The agent's 13 unit checks ran in a throwaway harness and were not added
  to the repo, so they cannot be re-run. The grouping module is now the obvious candidate for the
  first real test file under `functions/`.

  **Known: first real exercise is the first scheduled run.** The selection loop inside
  `runPrecacheDripBatch` was mirrored in simulation, not executed — it touches Firestore. Watch
  `precache_status/drip` on the next 4-hourly run. Healthy: `groupBefore` reads a neighborhood name
  (expect `"Fort Greene, Brooklyn"`), `skippedFresh` large on early runs (Brooklyn already warm —
  this is the re-warm waste stopping, and was structurally impossible before since the old code
  always fetched exactly 8), `attempted` possibly under 8. **Failure signature:**
  `groupBefore === groupAfter` across several runs with `groupRuns` climbing, then `stalledGroup`
  appearing. Should stay empty: `stalledGroup`, `emptyTileKeys`, `unmatchedPriorityLabels`,
  `failedKeys`. End-to-end proof is `completedThisRun` listing `["Astoria"]` (expected ~3 runs)
  and Astoria then activating instantly instead of ~20s.

  **Two known gaps, flagged not fixed:** (1) a legitimately empty tile (open water, park interior)
  is warm to the drip but a MISS to the client, which rejects an empty `segments` array — it will
  permanently block its neighborhood. Fix is a one-line client rule change plus an OTA; not done.
  (2) 21 of 268 neighborhoods exceed the client's `MAX_RING_PRECACHE_CELLS = 25` and can never hit
  the ring cache however completely warmed — **Sunset Park (30) is one of the ten
  `STREET_SEED_POINTS`**, so "precache our way out" is not a plan for those. All three priority
  areas are safe (Fort Greene 9, Jackson Heights 18, Astoria 20).

- **2026-09-09 — challenges credited zero because every walk was named after its BOROUGH. Root
  cause fixed, 142 historical walks backfilled.** Jake asked whether a walk inside a live challenge
  would credit. It did not. Traced end to end against real data rather than reasoned about:

  1. **The engine is fine.** "Litchfield Litter Invitational" carries 691 pickups. Crediting works.
  2. **`cleanupInArea` matches a neighborhood-scoped area by exact lowercased STRING** against
     `cleanups.neighborhood`.
  3. **That string is written by a chain that ends at the CITY.** `map.tsx` resolved Apple
     sub-locality -> OSM -> city. The 20:41 walk at 40.67832,-73.99518 is squarely inside Carroll
     Gardens; Apple returned no district, OSM nothing, so it stored **"Brooklyn"** and matched
     neither Carroll Gardens challenge.
  4. **Scale of it: 142 of Jake's 186 cleanups had the wrong neighborhood. ZERO were correct.**
     Not an edge case — every walk ever saved. The 610-pickup walk was actually Gowanus.

  **Fixes shipped:** `hoodContaining()` (the curated list the challenge picker, neighborhood picker
  and level view all label from) is now consulted FIRST at save, with Apple/OSM/city as fallbacks
  (OTA `fd1b46e9`). Server-side `cleanupInArea` also now resolves a neighborhood area by
  coordinates against a cached boundary index, keeping the label compare as a fast path and failing
  open to the old behaviour if the index is cold (deployed to `onCleanupWrite`) — this covers team
  and org district checks too. 142 of Jake's cleanups backfilled to their true neighborhood
  (his account only, dry-run verified first).

  **Still zero, and this is the next thing to understand:** `applyChallengeStatsForCleanup` early-
  returns on `tokenizedChallengeIds()`, and **`challenge_tokens` is EMPTY — zero tokenized
  challenges exist**. So the server rebuild path is inert for every challenge in the system, and
  contributor rows are written entirely by the CLIENT. Confirmed by a no-op re-trigger of the walk
  doc: `updated_at` did not move. Litchfield's 691 was therefore client-written. **Open question:
  does the client recompute contributions from history on app open, or only publish incrementally
  during a walk?** If the latter, the backfill will not retroactively credit and a fresh walk is
  needed. One app-open answers it.

  **Also found, not fixed:** "Da count" is labelled Carroll Gardens but its custom ring is a
  3-point triangle spanning 40.683-40.696 / -73.986 to -73.978 — roughly Fort Greene, ~1.5km from
  its own label. A mis-drawn area, not a code defect.
