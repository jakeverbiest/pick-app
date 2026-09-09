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
  2. **`route_points` is present on all 217 docs and EMPTY on all 217.** Distance cannot be
     backfilled from it. Flagging because it reads as populated data until you check `.length`.
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
