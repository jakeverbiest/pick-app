# B5 — frozen prediction, made BEFORE the walk

Written 19 Aug 2026, immediately after implementing the relative pause gate and
BEFORE any B5 data exists. Thresholds are frozen: `RELATIVE_PACE.ratio = 0.8`,
`windowMs = 30000`, active only when the trailing median is below
`PACE_CONTEXT.strollMps = 1.0`.

The point of writing this down first is that the gate was tuned by looking at
A7a, C6a and B4. Validating it on those same walks proves nothing. B5 is the
held-out test.

## Protocol — identical to B4

4 minutes. Walk **slowly** (target ~0.7 m/s, the B4/A7a amble). Come to a
**full stop** for each pick. **20 picks.** Phone in front pocket, screen off.
No voice memo needed.

Run it on a build that has the relative gate published, so the counting happens
live.

## The prediction

| Measure | B4 (before) | B5 predicted |
|---|---|---|
| Counted total for 20 real picks | 48 | **12–20** |
| Ratio to truth | 2.4x over | **0.6–1.0x (at or below truth)** |
| Picks detected at stops | 17 of 20 | **10–15 of 20** |
| False positives while walking (>0.5 m/s) | 31 | **2–6** |

Derived from the simulation: at ratio 0.8 the gate kept 12 of 17 real picks and
cut 28 of 31 false positives on B4.

## What counts as a pass

- Total counted **below 24** (i.e. the 2.4x overcount is gone), AND
- at least **8 of 20** picks still detected at stops.

## What counts as a failure worth reverting for

- Recall at stops drops **below 8 of 20** — the gate is eating real picks.
  Most likely cause: GPS not registering the stop quickly enough. Five of B4's
  17 real picks already showed a ratio above 0.8 for exactly this reason.
- Total counted **above 30** — the gate isn't engaging. Check whether
  `speedHistory` is filling; it only records fixes where
  `location.coords.speed > 0`.

## Also worth checking on the same walk

- Does a walk at NORMAL pace still behave like C6a? The gate should be
  completely inert above 1.0 m/s. A quick 1-minute brisk leg with 5 picks would
  confirm the stroll-only condition is working.

---

# RESULT — B5 run 19 Aug 2026, 19:52Z (`G0djzQ7DGW0MDAqZbyZT`)

**20 counted for 20 real picks. 1.00x. Every criterion passed.**

| Measure | Predicted | Actual | |
|---|---|---|---|
| Total counted | 12–20 | **20** | PASS (top of range) |
| Pass: under 24 | <24 | 20 | PASS |
| Pass: ≥8 of 20 found at stops | ≥8 | **13–16** | PASS |
| False positives while walking | 2–6 | **5** | PASS |

Labeled by GPS speed: **13 counted at a clear stop** (<0.35 m/s), 3 more in the
0.35–0.50 band (a stop where GPS hadn't caught up), **5 while genuinely walking**.

**The total is a balanced error budget, not 1:1 detection.** Roughly 13–16 of 20
real picks were caught and ~5 false positives filled the gap. Jake observed the
same thing independently ("not always 1:1"). Do not report this as "perfect
detection" — report it as a count a user would accept without correcting.

## Who did the work

| filter | firings |
|---|---|
| **relative pause gate** | **65** |
| monotony | 10 |
| cooldown | 9 |
| rhythmic | 7 |
| absolute pace gate | **2** |

The relative gate fired 65 times against the absolute gate's 2. On a stroll it
is carrying the entire walk — exactly the hole it was built for.

## Progression, same tester, same phone, one afternoon

| walk | condition | gate | result |
|---|---|---|---|
| B4 | slow + full stops | none | 48 for 20 = **2.4x** |
| B5B | brisk + full stops | yes | 19 for 20 = **0.95x** |
| **B5** | **slow + full stops** | **yes** | **20 for 20 = 1.00x** |

B4 → B5 is the clean comparison: same pace, same protocol, gate the only change.
**2.4x to 1.00x.**

## Remaining imperfection, deliberately not tuned

4 of the 5 walking-speed false positives landed in the first 35 seconds. Not
purely a warm-up hole — the early speeds (0.84–1.47 m/s) show the walk simply
started faster and settled, so the trailing median was legitimately high and a
0.73 m/s event really was below 0.8x of it. The gate behaved correctly on the
data it had.

**Stop tuning here.** At 1.00x on held-out data, further threshold work risks
overfitting to one tester's gait — which is the exact trap that produced the
A3/A5/A6 confound. The next validation is other people, not more constants.
