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
