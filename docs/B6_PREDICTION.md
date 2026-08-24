# Frozen prediction — B6 / A8 (moderate pace, both gates live)

Written **before** the walks, on 24 Aug 2026, so the result can't be
rationalized after the fact. Same discipline as `B5_PREDICTION.md`.

## What changed since the last field data

Walks 1a, 1b, 2a and 2b were all zero-pick A-tests. Ground truth: **0 real
picks on every one.** Everything counted was a false positive.

| walk | pace median | slow share | duration | events | counted | FP/min |
|---|---|---|---|---|---|---|
| 1a | 1.34 m/s | 0.14 | 6.4 min | 138 | 1 | **0.16** |
| 2b | 1.19 m/s | 0.21 | 2.7 min | 70 | 3 | **1.11** |
| 2a | 1.07 m/s | 0.39 | 6.0 min | — | 8 | **1.33** |
| 1b | n/a | n/a | 6.0 min | **0** | 0 | — (sensor failure) |

Two causes, two fixes.

**Fix A — walking-context window no longer expires mid-walk.**
`lastRhythmicTime` was refreshed only by *rhythmic* rejections, never by the
walking-context suppression itself. At a moderate pace rhythmic windows land
every 2-3s, so any time two fell more than `WALKING_CONTEXT_MS` (2500ms) apart,
whichever stride sat in the gap got counted. All three of 2b's false positives
are that exact chain:

```
t=15 rhythmic -> t=16 walking-context (suppressed) -> t=17 COUNTED
t=22 rhythmic -> t=23 walking-context (suppressed) -> t=25 COUNTED
t=47 rhythmic -> t=49 walking-context (suppressed) -> t=50 COUNTED
```

Nothing separated those three from the 14 suppressed ones. They landed in a
hole. The suppression now refreshes the window too — but only while
`!notStriding`, so decelerating into a stop stops extending it and the first
pick after a stop is not swallowed.

**Fix B — the relative pause gate runs at any pace.**
The absolute gate fires only above `briskWalkSpeedMps` 1.3; the relative gate
switched itself off at `strollMps` 1.0. **1.0-1.3 m/s was covered by neither** —
an ordinary moderate walking pace. The FP rate climbs straight down that ramp
in the table above, and 2b's three leaks sat at 1.08, 1.15 and 1.20 m/s.
The ceiling is removed. Effective threshold is now
`min(briskWalkSpeedMps, 0.8 * trailing median)`.

**The known cost, stated up front.** On C6a — picking at 1.19 m/s *without ever
stopping* — an always-on gate costs **5 of 12 real picks**. Fix B buys precision
for walk -> stop -> pick and takes roughly 40% recall from picking on the move.
That is only an acceptable trade while stopping to pick is the normal
technique. B6 is the test of whether the trade lands where I think it does.

## The walks

**B6 — recall.** Moderate pace, target **1.1-1.3 m/s** (this is the band the
change targets; do NOT stroll and do NOT stride). **Full stop for each pick**,
about 2 seconds down and back up as if dropping into a bag. **20 picks, spaced
about 10 seconds apart** — roughly 4 minutes. Phone pocketed.

Duration is not the requirement here; **spacing** is. B6 counts events, so what
matters is that consecutive picks clear `COOLDOWN.stridingMs` (2500ms), below
which two picks merge into one and cost recall for a reason that has nothing to
do with the change under test. 10s spacing clears it four times over. Stops do
not degrade the trailing median either — `speedHistory` only records fixes with
`speed > 0`, so a stopped sample is never in the median. Dense picking is safe.

**Walk for at least 10 seconds after the final pick before tapping Stop.**
`trimRecentPickups(6000)` discards every pickup detected in the last 6 seconds
of a session — it is the pocket-removal guard, working as designed. Pick number
20 and then immediately stop, and B6 reads 19 for a protocol reason. This has
already caused one false bug report (the 23-vs-21 gap on an earlier walk).

**A8 — precision.** Same moderate pace, **zero picks, zero stops**, about 4
minutes. This is the direct rerun of 2b, and unlike B6 the **duration is the
sample size** — A8 measures a rate, so cutting it short widens the error bar on
the one number it exists to produce. At 4 minutes, PASS is 0-1 counted events
and FAIL is 3 or more. Do not shorten this one.

## Predictions (falsifiable, frozen)

| # | claim | PASS | FAIL |
|---|---|---|---|
| 1 | B6 counts close to 20 | 17-23 counted | <17 or >23 |
| 2 | A8 false positives drop sharply from 2b's 1.11/min | <= 0.4/min | > 0.7/min |
| 3 | The relative gate is doing the work at this pace | fires >= 20 times across B6+A8 | fires < 10 |
| 4 | Fix A closes the gap chain | **zero** counted events in A8 preceded within 3s by a `walking context` event | any such chain still counted |
| 5 | Fix B does not eat real stops | B6's counted events have event speeds mostly < 0.5 m/s | most counted events above 1.0 m/s |

**Prediction 1 is the one that matters.** If B6 lands below 17 the recall cost
of fix B is worse at a full stop than C6a suggested it would be at no stop, and
the `strollMps` ceiling goes back in — the code comment in `isStillAtOwnPace`
says so explicitly.

If 2 fails but 1 passes, fix A wasn't enough and the gap band needs a tighter
ratio than 0.8 rather than a wider scope.

## Not shipping to testers until this passes

Both fixes are committed but must not reach the tester cohort on an OTA before
B6 and A8 run. The `TESTER_BRIEF_B_PROTOCOL.md` cohort is still on the previous
detector.

---

# RESULT — both walks FAILED, and neither tested the fix

Run 24 Aug 2026, 16:21 (B6) and 16:25 (A8).

**Neither walk was on the fixed build.** `eas update:list` shows the newest
published update was the watch commit from ~13:00; `1d671fc` and `cc920d8` were
never pushed. Both walks ran the pre-fix detector. Everything below therefore
describes the OLD code — which is still useful, because both problems it
exposed are in code those commits never touched.

| | predicted | actual | |
|---|---|---|---|
| B6 counted (20 real) | 17-23 | **39** (1.95x) | FAIL |
| A8 false positives | <= 0.4/min | **3.19/min** (13 in 4.07 min) | FAIL |

Pace was also off protocol: B6 ran at a normal pace but recorded a 0.60 median,
A8 was walked deliberately slowly (0.58, confirmed by the walker). The 1.0-1.3
band the commits target is therefore **still unmeasured.**

## Finding 1 — the trailing median measures stops, not pace (FIXED)

B6 walked at a normal 0.9-1.3 m/s between picks, yet `pace_median_mps` came out
at 0.60 with a 0.97 slow share. That is not bad GPS. It is the twenty stops:
decelerate, stop, bend, straighten, accelerate is ~6s per pick, so 120 of the
walk's 244 seconds sit below walking speed.

`trailingMedianSpeed` filtered on `speedMps > 0`, so every 0.05-0.30 reading
taken while stopped counted as "your pace." The median collapsed to ~0.5 and set
the gate's bar at 0.8 x 0.5 = 0.40 m/s — **below a real stop**, which reads
0.00-0.35. 35 of B6's 39 counted events came in under the 0.35 floor, 14 at
exactly 0.00. The gate degenerated into "count anything under 0.40" and stopped
discriminating precisely where it was needed.

The feedback loop is the bad part: **the more you stop to pick, the lower your
median, the more the gate disarms itself.** It eats itself on the one protocol
it exists to serve.

Fixed by filtering the median to samples above `minStopMps`. Safe by
construction — the floor still guarantees nothing below it is ever suppressed,
so raising the median can never eat a genuine stop. Five regression checks added.

## Finding 2 — one pick counts about twice, and cooldown cannot fix it (OPEN)

39 counted for 20 real. Simulating every accepted event against a range of
stationary-cooldown values:

| cooldown | counted | ratio |
|---|---|---|
| 0.8s (current) | 55 | 2.75x |
| 2.5s | 30 | 1.50x |
| 4.0s | 29 | 1.45x |
| 6.0s | 25 | 1.25x |

Even six seconds — long enough to swallow genuine back-to-back picks — only
reaches 1.25x. This is not a threshold that can be tuned. It needs a different
segmentation rule, and that is a product decision (deliberate bend-and-
straighten vs. rapid picking of a pile in one spot) rather than a constant.

## Retracted

An earlier reading of this data claimed GPS speed was under-reporting by ~3x,
inferred from A8's 406m route polyline against its 0.58 median. The walker
confirmed A8 was deliberately slow. Inference lost to direct observation, again.
The loose end stands: 406m in 244s is 1.66 m/s even after `dropOutliers` (25m)
and Douglas-Peucker (10m), so either the route pipeline inflates distance or the
walk covered more ground than it felt like.

A second claim — that 39 events cluster into exactly 20 groups, implying perfect
recall — is also withdrawn. That count only appears at a 5s merge window (3s
gives 26, 6s gives 17), and one of the "clusters" spans 25 seconds. A pattern
visible at a single arbitrary threshold is not a finding.

## Why the next run needs timestamps

We know 20 picks happened. We do not know *when*. Every cluster is therefore
ambiguous between "one pick counted twice" and "one real pick plus one false
positive," and no amount of re-analysis separates them. The field card's counter
now records walk-seconds per pick, which aligns directly against `motion_log.t`.
Until a walk comes back with that list, recall and precision cannot be measured
separately and any threshold change is guesswork.

---

# B6 RE-RUN — frozen before the walk

Shipped 24 Aug 18:24 as update group `49ee67c1`, commit `6f2c6333`, branch
production. Contains the median fix, the 1.0-1.3 band change, the
walking-context refresh, and the sensor-attach reordering.

**This run is a measurement, not a validation, and it is predicted to fail on
count.** Saying so up front so a bad number is not read as new information.

| # | claim | PASS | FAIL |
|---|---|---|---|
| 1 | Still overcounts — the median fix does not touch the stop case | 30-38 counted | < 28 or > 42 |
| 2 | The overcount is double-counting, not false positives | >= 70% of counted events fall within 3s of a logged pick time | < 50% |
| 3 | Recall is near-total once double-counts are merged | >= 18 of 20 logged picks have a counted event within 3s | <= 15 |

Prediction 1 passing is the *boring* outcome and means the model of the bug is
right. Prediction 1 failing LOW would be a genuine surprise worth chasing — it
would mean the median fix reaches the stop case by some path not yet understood.

**Predictions 2 and 3 are the reason for the walk.** They cannot be evaluated at
all without per-pick timestamps, which is why the last round dead-ended: 39
counted against a bare total of 20 is consistent with both "every pick counted
twice" and "twelve picks counted twice plus fifteen false positives," and those
two call for opposite fixes. The field card's counter now stamps each tap in
walk-seconds, which aligns directly against `motion_log.t`.

If 2 and 3 both pass, the segmentation rule is the only thing left to decide and
the recall risk of a long merge window is measurably near zero. If 2 fails, the
detector is firing on things that are not picks at all and the cooldown is the
wrong place to be looking.

## Protocol

Unchanged from the first B6 — moderate pace, full stop per pick, 20 picks at
~10s spacing, ~4 minutes, walk 10s past the last pick before stopping — plus:

**Tap "Start walk clock" at the same moment the walk starts**, and send the
"Copy times" list with the JSON. Without that list this walk answers nothing the
last one didn't.
