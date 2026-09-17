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

- 2026-09-16 — The five-walk bimodal count mystery is resolved as a small-sample artifact, not a
  mechanism. Read-only re-pull of all five `cleanups` docs by ID (full `motion_log`, 398
  candidates) reverses the ledger's stated lead: raw accepted-event count tracks the split only
  unnormalized — the walks run 172-248s, and per minute a low-cluster walk (`k3s8`, 12.91
  accepted/min, 62.7% acceptance) outranks a high-cluster walk (`IPbJ`, 12.34, 50.5%), while the
  1.23x over-counting walk emitted counts *slower* (8.95/min) than the 0.90x under-counting walk
  (9.42/min). Only the terminal count series is gappy; every upstream series is smooth. The
  acceptance step is explained — all between-walk variance sits in the rhythmic filter (10.9-33.8%
  of candidates) and the relative pace gate (11.3-31.7%), i.e. the walks contained 3x different
  amounts of striding despite being logged as one condition. Truth=30 is unverified on all five
  (`ground_truth` is `"[]"` on every one). No detector/threshold/build change proposed or implied.
  Full write-up: `~/pick-app/docs/DETECTOR_DIAGNOSTIC_HANDOFF.md`, section
  "The five-walk 'bimodal' mystery, read from the raw per-candidate data — September 16, 2026".
- 2026-09-16 — Pickup-detector offline review: the first pooled, properly cross-validated
  multivariate model was fit and it is another null, at a higher level than the previous ones. All
  187 labeled PICK/WALK/OTHER_MOTION events across all 6 filmed sessions (77/90/20; 121 independent
  action clusters) were pooled, percentile-normalized against each session's own full candidate
  population, and fit with a logistic regression evaluated leave-one-SESSION-out. Held-out
  AUC 0.644 — 0.002 above the best single feature through the same pipeline, every per-session 95%
  CI includes 0.50, permutation p = 0.064; at a 10% false-positive budget it recalls 9/77 picks
  (~2.0 false counts/min against 8.2 real picks/min on the best session). LDA 0.607 and a depth-2
  tree 0.562 rule out nonlinearity as the limiter. Closes the "needs a fundamentally different
  modeling approach once there's enough data" open item — the data was there and the answer is that
  the ceiling is in the feature family, not the combiner. Two corrections fall out:
  `approachEnergyChange` is at chance (AUC 0.529, 7th of 12) once cross-validated, not the strong
  survivor the report's summary called it, and sessions 1/2/4 carry a label time-position confound (AUC
  0.88/0.80/0.00 from timing alone) that makes their earlier per-session separation claims
  uninterpretable. Research only — no detector, threshold, build, OTA, or release change proposed or
  implied. Full write-up: `~/pick-app/docs/PICKUP_DETECTOR_VIDEO_LABEL_REVIEW_SESSION1.md`, section
  "The first pooled, cross-validated multivariate model — and the higher-order null it produces —
  September 16, 2026"; summary paragraph in `~/pick-app/detector-analysis/README.md`.
- 2026-09-16 — Jake's decision, direct in chat: detection accuracy is accepted as a fixed ceiling
  for launch, not an open blocker. Three independent offline passes (the 6-session/3-person
  feature review, the five-walk bimodal re-read, and today's pooled cross-validated model) all
  landed at the same ceiling with the sensors and technique on hand. Product focus shifts to
  launch UX, not further detector tuning. Any doc still framing "detector accuracy" as unresolved-
  and-blocking should be reworded to "accepted ceiling, correction-flow UX is the real launch
  dependency" on next reconciliation.
- 2026-09-16 — `roadmap-ops` drafted `~/pick-app/docs/LAUNCH_UX_PLAN.md`, a launch-UX
  prioritization following the ceiling decision above: a redesign proposal for the count-
  correction flow (grounded in a direct read of `map.tsx`/`BagDetails.tsx`, not just the ledger's
  description of it) plus a prioritized punch-list of open UX items. Draft only, nothing built.
  Two findings from that read worth folding in, both sharper than what's currently on the ledger:
  (1) the in-app "Pick Global" rebrand (Launch gates, open since 2026-08-01) is confirmed at
  **zero** — `grep -rn "Pick Global" apps/companion/app apps/companion/src` returns no matches,
  `app.json`'s name is still `"PICK"`, and every in-app string checked (share message, Settings
  footer stamp, QR-invite subtitle, crash black-box copy) says "PICK" — sharper than the
  existing "reportedly hasn't reached all screens" framing, it's total, not partial. (2) A new
  item, not previously on the ledger: `map.tsx`'s `explainLocationPermissionIfNeeded()` (the
  pre-permission-dialog explainer) never mentions the "Always" vs "While Using" location choice
  at all — it only says location is used "to map the streets you clean." The only in-app handling
  of a "While Using"-only grant is reactive (a mid-walk Alert pointing at Settings, after a session
  has already degraded to foreground-only). `VOLUNTEER_ONE_PAGER.md` currently plugs this gap with
  an organizer reading a script aloud, which doesn't scale to self-directed public-beta
  onboarding. Full detail in `LAUNCH_UX_PLAN.md`.
- 2026-09-16 — `code` implemented two items from `LAUNCH_UX_PLAN.md` (Jake approved Part 1;
  Part 2 item 2 was a confirmed gap, not a new proposal), committed as `d233bea`. **(1) Count-
  correction stepper redesign (Part 1):** `map.tsx`'s summary sheet replaces the dotted-underline
  pickup count — which every ground-truth walk on record confirmed was never touched — with an
  always-visible `[-] N [+]` stepper in the hero row; tapping the number opens a numeric keypad in
  place for larger corrections. Reuses `BagDetails`' own stepper/countDraft interaction patterns,
  recolored for the hero row, rather than a new control style. `countConfirmed` is now set by
  touching the stepper/number directly, not by opening a panel — telemetry intent preserved per
  the plan's note. "Adjust details" stays as a link, now scoped to bag size/fullness only;
  `BagDetails` renders with `showCount={false}` on the summary sheet, removing the duplicate count
  field. "Save & log" availability is unchanged — no new gate. Two items from the plan's open
  questions were deliberately left undecided rather than guessed: stepper increment is plain ±1
  (no long-press/±5 accelerator built); the optional Stop-confirm-Alert echo (labeled P1/optional
  in the plan) was not added. **(2) Location-permission explainer (Part 2 item 2):**
  `explainLocationPermissionIfNeeded()` now names the Always-vs-While-Using choice and recommends
  Always before the OS dialog fires, reusing `VOLUNTEER_ONE_PAGER.md`'s language, since previously
  only an organizer's spoken script covered this. Both changes are JS/TS only (OTA-shippable, no
  native build); `tsc --noEmit` and `npm run test:detector` clean; **not yet shipped via `eas
  update`** — publishing is Jake's separate call.
- 2026-09-16 — Re-confirmed the Launch-gates mid-walk stats-reset fix ("entering a neighborhood
  mid-walk can reset an active walk's stats to zero") is still present and intact in the working
  tree, unchanged by the stepper work above: `attachWalkListeners()` still calls
  `MotionDetector.stopListening()` before re-attaching, `resumeWalkAfterRemount()` still restores
  route/pickups/count from the walk-draft mechanism, and the `walkIntent`-recovery effect still
  calls it on remount. `tsc --noEmit` clean project-wide (checked together with the stepper
  changes above in the same pass). No overlap between the two: the stepper touches only the
  summary-sheet state (`userCount`/`countEditing`/`showAdjust`) rendered after a walk ends, while
  the remount fix touches active-walk state before the summary sheet exists. Status unchanged from
  the existing Launch-gates row otherwise — **still not shipped or device-tested.**
- 2026-09-16 — `code` resolved the one open question `d233bea` deliberately left undecided:
  long-press acceleration on the hero-row count stepper. Committed as `a314c53`. Holding `-`/`+`
  now auto-repeats via a `setInterval` started in `onPressIn`/stopped in `onPressOut` on the
  existing `TouchableOpacity`s (no existing long-press-repeat helper found anywhere in the
  companion app, and this file uses no `Pressable`, so nothing to reuse); a plain tap is unchanged
  (`adjustCount(+-1)` via `onPress`, guarded against double-counting by a ref-based `repeated`
  flag that skips `onPress` if the hold interval already fired). Timing: repeats at +-1 every
  130ms, accelerating to +-5 once held past 500ms. Per Jake, the coarse +-5 step is a deliberate
  product signal (a chunky jump tells the walker this count is an estimate to correct, not a
  precise reading), captured as a code comment so it isn't mistaken for an unexplained
  inconsistency later. `countEditing`/keypad entry, the 0 floor, and `BagDetails.tsx` untouched.
  `tsc --noEmit` and `npm test` (all 6 suites) clean. Isolated from this working tree's large
  pre-existing unrelated uncommitted changes via a hand-built 3-hunk patch applied with `git apply
  --cached` (same technique as `d233bea`) — not a broad `git add`. JS/TS only (OTA-shippable);
  **not yet shipped via `eas update`** — publishing is Jake's separate call.
