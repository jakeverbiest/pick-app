# Apple Watch Companion — Scope

*Drafted 2026-07-25. Status: scoped — decisions locked (no pause, no distance, watchOS 10+).*

## Goal

A minimal watchOS companion that acts as a remote control + glanceable display for a cleanup walk. No standalone tracking — the phone stays the source of truth for GPS, motion detection, and Firebase. The watch just starts/stops the session and mirrors live stats.

## UX (fitness-tracker style)

Single screen, modeled on the Apple Workout app:

- **Idle state:** app icon + one big green "Start Pickup" button.
- **Active state:**
  - **Pickups** — the hero number, huge (like heart rate in Workout).
  - **Time** — elapsed, directly below in secondary size.
  - Swipe left (Workout-style page) → **End Walk** button. End requires a confirm tap to prevent wrist mis-taps. No pause — matches the phone (start/stop only).
- Haptic tick on each pickup registered (subtle, can disable later).

## Architecture

```
watchOS app (SwiftUI, native target in PICK.xcodeproj)
   ⇅ WatchConnectivity (WCSession)
iPhone app (Expo RN) — native module bridge (Swift + RN EventEmitter)
   → existing MotionDetector / backgroundSession / Firebase (unchanged)
```

- **Watch → phone:** `startWalk`, `endWalk` messages.
- **Phone → watch:** stat updates `{pickups, elapsedSeconds, state}` every ~3–5s via `updateApplicationContext` (coalescing, battery-cheap) with `sendMessage` for instant pickup ticks when reachable.
- **RN bridge:** small native module (`WatchSessionModule.swift`) exposing `sendStats()` and emitting `onWatchCommand` events. Map screen's existing `startCleanup`/`stopCleanup` get called from a listener — no logic changes to the session itself.

### Key constraint

WatchConnectivity needs the phone app alive. Starting a walk from the watch when the PICK phone app is killed will NOT work reliably on iOS. Mitigation for v1: if phone is unreachable, watch shows "Open PICK on your phone." (True remote-launch would need HealthKit workout session mirroring — out of scope.)

## Build notes (Expo)

- Project already uses prebuild with a checked-in `ios/` + `PICK.xcodeproj`, so adding a watch target is feasible. Two options:
  1. **`@bacons/apple-targets` config plugin** — declares the watch target so `expo prebuild` regenerates it; keeps the managed workflow honest. Preferred.
  2. Manual Xcode target — faster to spike, but lost on the next clean prebuild.
- New bundle IDs: `<app>.watchkitapp` + extension; needs matching provisioning profiles in EAS/TestFlight.
- Watch UI is pure SwiftUI (~200–300 lines for v1). **Minimum watchOS 10.**

## Phases & estimate

| Phase | Work | Est. |
|---|---|---|
| 1 | Native module bridge on phone (WCSession, events) | 0.5–1 day |
| 2 | Watch target + SwiftUI screen (idle/active, buttons) | 1–1.5 days |
| 3 | Wire start/end + live stats, haptics | 0.5–1 day |
| 4 | Provisioning, EAS/TestFlight, on-wrist field test | 0.5–1 day |

**Total: roughly 3–4.5 days**, most risk in phase 4 (signing + Expo prebuild quirks).

## Out of scope (v1)

- Standalone watch GPS tracking / phone-free walks
- Complications, Smart Stack widgets
- HealthKit workout credit from the watch (phone already handles HealthKit)
- Android Wear
- Pause (start/stop only, matching the phone)
- Distance on the watch (pickups + time only)
