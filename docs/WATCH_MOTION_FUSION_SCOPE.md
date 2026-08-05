# Wrist Motion Fusion — Scope (Phase 2)

*Drafted 2026-07-25. Status: proposal — build after watch v1 field-testing.*

## Why

Pickup detection currently reads pocket/body motion from the phone — indirect,
and the source of both missed pickups and phantom counts (hence the
trim-on-stop guards). The watch sits on the wrist that does the actual
reach-down-and-grab, where the gesture signature is far cleaner: a distinct
down-swing, brief pause, grab, up-swing, often with a wrist rotation. This
attacks the #1 open thread in the project: detection threshold tuning.

## Design: fusion, not replacement

Phone stays the authority; the wrist adds a second, higher-quality vote.

```
Watch: CMMotionManager (userAccel + rotation, ~50Hz, during walks only)
  → tiny on-watch gesture detector (down-dwell-up template)
  → sends timestamped "wristPickup" events to phone (sendMessage, batched)
Phone: existing MotionDetector keeps running
  → fusion layer scores each candidate:
      wrist + phone agree (±2s)  → definite pickup
      wrist only                 → probable (count it; phone missed)
      phone only                 → demote to "weak" unless wrist unreachable
  → no-watch walks: behave exactly as today
```

Key properties: graceful degradation (watch dead/absent → current behavior),
and the fusion thresholds live phone-side in TS where they're easy to tune —
the watch just reports gestures.

## Prerequisite: HKWorkoutSession on the watch

Continuous sensor access on watchOS requires a workout session (it also keeps
the app alive with wrist-down, fixes any mirror-going-stale issues, and yields
live heart rate + calories for the display for free). This should be built
first regardless — it's the single highest-value watch addition.

## Ground truth & tuning

Reuse the existing `groundTruthCapture` approach: a field walk where Jake
narrates real pickups (or taps a button on the phone), recording both phone
motion events and wrist gesture events. One or two annotated walks are enough
to set the initial agree-window and wrist-detector thresholds; the
`detectorRegression` test harness pattern extends naturally.

## Phases & estimate

| Phase | Work | Est. |
|---|---|---|
| 1 | HKWorkoutSession wrapper on watch (+ HR/calories on display) | 1 day |
| 2 | Watch-side gesture detector + event batching to phone | 1.5–2 days |
| 3 | Phone fusion layer in MotionDetector + config flags | 1–1.5 days |
| 4 | Ground-truth walk, tuning, regression tests | 1 day + field time |

**Total: ~4.5–5.5 days.** Independent of TestFlight timing — ships whenever
ready as a native build.

## Risks / notes

- Battery on the watch: 50Hz sensors + workout session costs real battery;
  mitigate by running sensors only during walks (already the plan).
- Series 6 is the floor device — fine, sensors are identical for this purpose.
- Left/right wrist and glove/grabber-tool users change the signature; keep the
  wrist detector loose and let fusion (not the wrist alone) make the call.
- Don't block v1: ship the current watch app to TestFlight first, gather a few
  real walks, then start Phase 1 here.
