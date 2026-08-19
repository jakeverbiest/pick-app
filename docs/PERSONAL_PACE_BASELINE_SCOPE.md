# Personal pace baseline — technical scope

Status: **CLOSED 19 Aug 2026 — C7a answered the gate NO. Do not build.**

> **C7a result (19 Aug):** strolled at 0.73 m/s (matching A7a's 0.73), 20 real
> picks in blocked 30s windows. Walking halves produced 22 false positives;
> picking halves produced 26 — against a predicted floor of ~22. Roughly **4 of
> 26 attributable to 20 real picks (~20% recall)**, per-block counts
> indistinguishable (exact permutation p = 0.20), and only **~0.4 extra
> candidate motion events per real pick** — meaning most picks generate no
> event at all at a stroll.
>
> The gate below required "signal at a stroll that absolute thresholds are
> burying." There is no signal to unbury. A personal baseline would only locate
> the dead zone more precisely. **The confidence-flag use of pace shipped
> separately as `walkPaceProfile()` and stands on its own.**
>
> Kept in full below because the HealthKit findings (library already installed,
> Apple computes mobility metrics from a waist/pocket phone, samples are
> suppressed during irregular movement) are reusable if wrist fusion ever
> revives the idea. See `WATCH_MOTION_FUSION_SCOPE.md`.

---

<details>
<summary>Original scope, superseded</summary>

Status: scoped 19 Aug 2026, BLOCKED on C7a.
Related: `A7a_ANALYSIS.md`, `MOTION_DETECTION.md`, `WATCH_MOTION_FUSION_SCOPE.md`,
`src/services/motionEvaluation.ts` (`PACE`, `PACE_CONTEXT`, `walkPaceProfile`).

---

## 0. The gate — why this is blocked

The 19 Aug field data showed pace is the dominant variable in overcounting:
0.73 m/s → 9.7 false positives/min; 1.19 m/s → 2.0. This scope proposes making
the pace thresholds **relative to each user** instead of absolute.

**That only pays off if there is signal to recover at a stroll.** Right now we
don't know, because the grid has an empty cell:

| | normal pace | slow stroll |
|---|---|---|
| **not picking** | A2 — 0/min | A7a — 9.7/min |
| **picking** | C6a — 2.0/min, 60% recall | **C7a — unrun** |

**Run C7a first.** Same blocked design as C6a — 4 min, alternating 30s walk-only
/ 30s walk-and-pick-5 — but strolled throughout at A7a's pace.

- **If C7a's picking blocks look meaningfully different from A7a's** → there IS
  signal at a stroll, the current absolute thresholds are burying it, and a
  personal baseline is the right unlock. Build this.
- **If C7a looks like A7a** → the signal is physically absent below ~1 m/s, and
  a personalised threshold just locates that regime more precisely. Then this
  degrades to a *confidence* improvement only (still real, much lower value),
  and the actual answer is the watch or the correction UI.

Everything below assumes the first branch.

---

## 1. Problem

Every threshold in the detector is absolute and was fitted to one tester:

- `PACE.briskWalkSpeedMps = 1.3` — the pause gate
- `PACE_CONTEXT.strollMps = 1.0` — the new confidence flag

But 1.0 m/s is not the same event for different bodies. A tall person's amble
and a shorter or older person's purposeful walk can be the same number and mean
opposite things. The gate should ask *"are you moving slowly **for you**?"*, not
*"are you below 1.3 m/s?"*

Design in one line: **the baseline is the denominator, live GPS is the
numerator, and the detector gates on the ratio.**

---

## 2. Two sources for the denominator

### Option A — self-derived from the user's own walks (recommended first)

As of 19 Aug every cleanup stores `pace_median_mps`. A user's baseline is the
median of their recent walks' medians.

- No new permission, no new prompt
- No native change — **ships OTA**
- Works on Android
- No privacy-policy change
- Cost: a small helper plus a cached value

**Weakness: cold start.** A brand-new user has no history. Options: fall back to
today's absolute thresholds until N walks exist (simplest, recommended), or seed
from Option B.

### Option B — HealthKit mobility metrics (cold-start only)

`@kingstinct/react-native-healthkit` **v14.0.2 is already installed**, and
`healthService.ts` already calls `requestAuthorization` — currently with
`toRead: []`. The library exposes the identifiers we'd need:

- `HKQuantityTypeIdentifierWalkingSpeed` ← the one that matters
- `HKQuantityTypeIdentifierWalkingStepLength`
- (also `WalkingAsymmetryPercentage`, `WalkingDoubleSupportPercentage`)

Query via `queryStatisticsForQuantity` for a median/average over the last ~30
days. One call at signup, cached; this is a *baseline*, not a live stream.

**Fit is unusually good:** Apple computes these passively from an iPhone carried
**at the waist — i.e. a trouser pocket**, which is exactly Jake's documented
carry mode. Introduced iOS 14 / watchOS 7.

**Important caveat that shapes the design:** Apple only emits these samples
during *steady, unaided walking* and filters out irregular movement. A cleanup
walk — constant stooping and stopping — will likely produce **no samples at
all**. So HealthKit can only ever supply the everyday-walking baseline. It
cannot measure the cleanup itself. That's fine; it's what we want it for.

---

## 3. What actually changes in code

Small surface:

1. `motionEvaluation.ts` — add `paceRatio(liveMps, baselineMps)` and switch the
   two gates to relative form, keeping the absolute values as the
   no-baseline-yet fallback:
   - pause gate: `ratio > ~0.85` replaces `speed > 1.3`
   - confidence flag: `ratio < ~0.6` replaces `speed < 1.0`
   *(Exact ratios must be fitted to C7a + the multi-tester data, not guessed.)*
2. New `src/services/paceBaseline.ts` — derive from recent cleanups, cache in
   AsyncStorage, expose `getBaselineMps(): Promise<number | null>`.
3. `motionDetection.ts` — read the cached baseline at session start (never
   per-event).
4. `detectorRegression.ts` — every existing speed fixture gains a baseline, so
   relative thresholds are covered by tests.
5. Option B only: `healthService.ts` gains a read scope, plus a
   `getWalkingSpeedBaseline()`.

---

## 4. Costs and risks — Option B specifically

- **Needs a native build.** `NSHealthShareUsageDescription` currently reads
  *"PICK reads nothing from Health — this permission accompanies workout
  writing."* Changing it is an `app.json` edit, which cannot ship OTA.
- **Three privacy-policy copies must be updated together** —
  `legal/PRIVACY_POLICY.md`, `docs/privacy.html`, and
  `src/constants/legal.ts`. These have drifted before (fixed 12 Aug); assume
  they'll drift again unless changed in one pass.
- **A second Health prompt** on top of the workout-write one. Health permissions
  are per-type, so users can grant write and deny read.
- **iOS only.** Android has no equivalent, and already lacks
  `ACTIVITY_RECOGNITION`, so it has no pedometer either.
- **Sparse data** for users who don't carry their phone while walking.
- **Perception risk:** "why does a litter app read my health data?" is a fair
  question, and the honest answer — *to calibrate what walking speed is normal
  for you* — needs to be visible at the prompt, not buried in a policy.

Option A has essentially none of these.

---

## 5. Recommendation

1. **Run C7a.** Four minutes, no coordination, decides everything above.
2. If there's signal: build **Option A** and ship it OTA. It gets ~90% of the
   value at ~10% of the cost, and it's the only version that works on Android.
3. Treat **Option B** as a cold-start enhancement, bundled into whatever build
   carries the splash fix and the `PhoneLink.swift` decision — not its own
   release, and not before Option A has proven the ratio approach works on real
   users' data.
4. Fit the ratio constants to data. Do not port 1.3 and 1.0 into ratio form by
   dividing by Jake's own baseline — that just re-encodes one tester's gait as a
   universal constant, which is the exact problem this is meant to solve.

</details>
