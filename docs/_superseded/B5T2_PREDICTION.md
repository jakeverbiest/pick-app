# B5-T2 — frozen prediction, made BEFORE the walk

Written 23 Aug 2026, ~13:30 ET, BEFORE any B5-T2 data exists.

**Naming:** B5's protocol, tester 2. The letter/number carries the condition,
the `-T2` carries the body. Rename if it clashes with your scheme — the only
thing that matters is that it sorts next to B5, because B5 is the comparison.

Thresholds unchanged from B5 and frozen: `RELATIVE_PACE.ratio = 0.8`,
`windowMs = 30000`, `minStopMps = 0.35`, active only when the trailing median is
below `PACE_CONTEXT.strollMps = 1.0`.

## What this walk is for

B5 validated the relative pause gate on **one body, one phone, one afternoon**.
Every threshold in the detector was tuned by looking at A7a, C6a and B4 — all
the same walker. B5 was the held-out test for the *gate*; it was not a test of
whether any of it transfers to a different person.

That is the only question here. **Change nothing but the walker.**

## Known code delta from B5 — read this before interpreting the result

B5 ran on the bundle published 19 Aug 15:22 ET. This walk runs on the bundle
published 23 Aug, which adds the **motion-window reset on `startListening`**
(`MotionShapeDetector.resetRecording()`, commit `5c1e75b`).

The phantom event that fix removes was 40s–602s long and always rejected by the
500–5000ms duration bound, so **the counted total is not directly affected**.
What changes is that the first *genuine* event of a walk is no longer measured
against a window carried over from the previous session.

**B5's residual error was concentrated at the start of the walk** — 4 of its 5
walking-speed false positives landed in the first 35 seconds. That is exactly
where this fix acts. So:

> If B5-T2 differs from B5 mainly in early-walk false positives, suspect the
> code delta before concluding anything about the tester.

Everything after ~35s is a clean comparison.

## Protocol — identical to B4 and B5

4 minutes. Walk **slowly** (target ~0.7 m/s, the B4/A7a amble). Come to a
**full stop** for each pick. **20 picks.** Phone in front pocket, screen off.

Confirm the phone is on the new bundle before starting: tap Stop, look for the
confirm dialog. If there is no dialog, the walk is void — this is the 19 Aug
19:23Z lesson.

Screenshot the summary **before** touching the correction panel. The Cloud
Function export does not exist yet, so that screenshot is the fast channel;
`items_detected` is stored on the doc either way and is recoverable later.

## The prediction

| Measure | B5 (Jake) | B5-T2 predicted |
|---|---|---|
| Counted total for 20 real | 20 | **14–26** |
| Ratio to truth | 1.00x | **0.7x–1.3x** |
| Picks caught at a clear stop (<0.35 m/s) | 13 | **8–16** |
| False positives while walking (>0.5 m/s) | 5 | **3–9** |
| `pace_median_mps` | ~0.7 | **0.50–0.90** |

Wider than B5's band, deliberately. B5 was a prediction about a gate on a known
walker; this is a prediction about an unknown walker.

## Why that band, and the one thing that would break it

**Why it should land near truth.** The relative gate compares each event to the
walker's *own* trailing 30s median. That is the part designed to transfer — it
has no per-person constant in it.

**Why it might not.** Two thresholds around it are absolute, not relative, and
neither self-calibrates:

1. `PACE_CONTEXT.strollMps = 1.0` — the gate is **inert above this**. If this
   tester's "slow" is really 1.1 m/s, the gate never engages at all and the
   result should look like B4: roughly **2.4x, ~48 counted**. That is not a
   failure of the gate. It is a finding about `strollMps`, and it is the single
   most likely way this walk goes sideways, because "walk slowly" means
   different speeds to different people.
2. `RELATIVE_PACE.minStopMps = 0.35` — the stop floor found on B5B. A walker who
   sways more when standing, or whose GPS is noisier, sits on the other side of
   this line than Jake does. This is the most likely source of a *modest* miss
   (0.7x or 1.3x rather than 1.00x).

## Pass / fail, decided now

- **Ratio between 0.7x and 1.3x** → the gate transfers. Two bodies, and you can
  stop treating 1.00x as a one-person artefact.
- **Ratio near 2.4x AND `pace_median_mps` ≥ 1.0** → protocol miss, not a gate
  failure. The walker was above `strollMps`. Re-run slower before concluding
  anything; then consider whether `strollMps` should be a personal baseline.
- **Ratio near 2.4x AND `pace_median_mps` < 1.0** → this is the real bad case.
  The gate engaged and did not work on a second body. Stop, and do not run
  session 2 as planned.
- **Ratio outside 0.7–1.3 but not near 2.4x** → partial transfer. Look at
  `minStopMps` first: pull the per-event speeds at counted stops and see which
  side of 0.35 they sit on.

## What this walk does NOT test

Natural-pace picking without stops (that is C6a's condition, and tomorrow's
second leg), multi-person concurrency, or anything on the watch.
