# A7a — analysis, 19 Aug 2026

Control leg of the four-tester group walk. Walking, zero stopping, zero pickups.
Cleanup `gkprKj3OToxx1BuycJJT`, team FED U.P., 2.4 min (log spans t=6–148s).

---

## Headline

| Metric | Value |
|---|---|
| Candidate motion events | 136 |
| Counted (leaked as pickups) | **23** in `motion_log` / **21** stored in `items_detected` |
| Suppressed | 113 (83%) |
| **False-positive rate** | **9.7 /min** (8.9 using the stored 21) |

Progression across the A-series: A3 5.4 → A5 6.7 → A6 7.1 → **A7a 9.7**.

**Read this as condition, not regression.** A7a was also the slowest walk on
record: GPS speed ran 0.24–1.39 m/s, mostly 0.5–0.9, and **only 1 of 136 samples
cleared the 1.3 m/s brisk-walk gate** — so the speed pause gate effectively
never fired. Slower stroll, more leak, monotonically across all four runs.

Suppression breakdown: walking-context 31, cooldown 24, monotony 24, cadence 19,
low-rotation 13, pre-walk 1, settling 1.

---

## The duration hypothesis — tested and killed

Within A7a alone, the leak looks beautifully separable:

| | n | dur median | dur mean | peak median | gyro median |
|---|---|---|---|---|---|
| Leaked | 23 | 806ms | 950ms | 1.25 | 2.04 |
| Suppressed | 113 | 503ms | 612ms | 1.20 | 1.75 |

Events ≥750ms leaked 50% of the time; events <750ms leaked 5%. A 10× difference.

**It's a selection artifact.** Monotony, cadence and walking-context all key on
a ~500ms stride rhythm (`CADENCE.minGapMs` 350 / `maxGapMs` 1100,
`MONOTONY.maxDurationSdMs` 150). The short events are exactly what those filters
are built to catch, so the survivors are long *by construction*. Comparing
leaked against suppressed measures the filters, not the phenomenon.

The honest comparison is leaked-vs-**real picks**, using the committed fixtures
in `detectorRegression.ts`:

- C3 real picking: 596, 1094, 1592, 597
- Cigarette pile (real, stationary): 900, 920, 890, 910
- Uniform real picks: 1208, 1208, 1109, 1208
- **Real-pick band: 596–1592ms**

**83% of A7a's false positives (19 of 23) fall inside the real-pick band.**

| Duration cap | False positives suppressed | Real picks killed |
|---|---|---|
| ≥700ms | 19/23 | **10/12 (83%)** |
| ≥750ms | 18/23 | **10/12 (83%)** |
| ≥900ms | 11/23 | **9/12 (75%)** |
| ≥1000ms | 11/23 | **6/12 (50%)** |

And the decisive counter-example is already in the fixtures: **A3's strides were
all 1194ms** — long-duration false positives.

**Conclusion: no duration cap, no duration-weighted confidence.** This extends
the A5/C4 "overlap on every axis" finding to duration. Recording it so it isn't
re-derived.

---

## Two real bugs in the save path (`app/(tabs)/map.tsx`)

### Bug A — `items_detected` can lag `motion_log`

`saveSummary` (line 1552) is a plain function in the render body, closing over
the `pickupCount` React state. `motion_log` is read live at save time via
`MotionDetector.getSessionEvents()` (line 1666), and `items_detected` is written
from the closed-over state (line 1637).

Any pickup landing after the last flushed render — likely while the app is
backgrounded and the phone is pocketed, when RN defers renders — is in the
recorder but not the closure. That is exactly the 21-vs-23 gap, and the two
missing events are the last two counted (t=142, t=145, log ends 148).

**Impact:** the raw training figure is quietly low, and `motion_log` can't be
trusted as a cross-check of `items_detected`.

**Fix:** derive the saved count from the recorder so they cannot diverge —
`MotionDetector.getSessionEvents().filter(e => e.counted).length`.

### Bug B — `pickupCounterRef` is never reset between walks

Declared `useRef(0)` at line 166 ("Track pickups since last location record"),
incremented at line 1299. The session-start handler resets `setPickupCount(0)`
but **not** the ref, and there are only four references to it in the entire
file — none of them a reset.

So it is cumulative-since-app-launch, not per-session. It feeds:

- `commitSessionPickups()` — the **challenge live counter** (line 1473)
- the **crash heartbeat** (line 1085)

Second and later walks in one app lifetime over-report both. Didn't bite today
because these were independent walks with no challenge, but it would have
corrupted a shared-challenge session — which is the format proposed for the
next group walk.

**Do not fix Bug A by swapping in this ref.** It's wrong for a different reason.
Fix both separately: reset the ref on session start, and derive
`items_detected` from the recorder.

---

## What's still needed

1. **C6a** — the real-cleanup leg, plus roughly how many pieces were actually
   picked up. This is what tells us whether anything separates real from false
   on this walk.
2. **A7b / A7c / A7d** — the other three control legs. Same route, same pace,
   different bodies and devices: the first per-device variance data the project
   has ever had.
3. **C6b / C6c / C6d.**
4. Phone model + iOS per tester, to label the leak rates by device.
