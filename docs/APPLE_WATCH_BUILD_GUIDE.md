# Apple Watch — Build & Run Guide

All code is written (see `docs/APPLE_WATCH_SCOPE.md` for design). These are the
steps to compile and run it — they need your Mac + Xcode, which Claude's sandbox
doesn't have.

## What was added

```
apps/companion/
  modules/watch-session/            ← phone-side bridge (Expo local module)
    expo-module.config.json
    index.ts                        ← JS API (safe no-op on Android/Expo Go)
    ios/WatchSession.podspec
    ios/WatchSessionModule.swift    ← WCSession: receives watch commands, pushes stats
  targets/watch/                    ← the watch app (@bacons/apple-targets)
    expo-target.config.js           ← target declaration (watchOS 10+, bundle id)
    PickWatchApp.swift
    PhoneLink.swift                 ← watch-side WCSession
    ContentView.swift               ← fitness-style UI (Pickups hero, Time, End page)
  app/(tabs)/map.tsx                ← listens for watch commands; mirrors stats out
  app.json                          ← added "@bacons/apple-targets" plugin + appleTeamId
```

## Steps (~15 min)

```bash
cd apps/companion
npm install @bacons/apple-targets
npx expo prebuild -p ios          # regenerates ios/ with the watch target
cd ios && pod install
open PICK.xcworkspace
```

Then in Xcode:

1. Select the **PICK Watch** target → Signing & Capabilities → confirm your team
   (H77DJ6QPJC) is set and "Automatically manage signing" is on. Xcode will
   create the `com.jakeverbiest.pickapp.watchkitapp` provisioning profile.
2. Pick the **PICK scheme**, run on your iPhone (watch app installs alongside;
   if it doesn't appear, open the Watch app on iPhone → scroll to Available
   Apps → install PICK).
3. Or simulator: choose an iPhone+Watch paired simulator pair.

## Caution: prebuild will regenerate `ios/`

Your `ios/` folder is checked in with history. `expo prebuild` rewrites it.
Recommended: commit everything first, run prebuild, then diff `ios/` before
committing — anything hand-edited in Xcode previously that isn't captured by
config plugins will be lost and will show up in the diff.

If prebuild is too disruptive, the fallback is adding the watch target manually
in Xcode (File → New → Target → watchOS App, then drag in the three Swift files
from `targets/watch/`) — but it won't survive a future clean prebuild.

## Testing checklist

- [ ] Phone app open → watch shows Start button → tap → phone starts a walk
- [ ] Pickups/time tick on the watch during a walk (3s cadence)
- [ ] Haptic click on the wrist when a pickup registers
- [ ] Swipe up on watch → End → confirm → phone shows the summary sheet
- [ ] Phone app closed → watch tap shows "Open PICK on your phone" (expected v1 limit)
- [ ] Android build still compiles (bridge is a no-op there)

## Known v1 limits

- Starting from the watch requires the phone app to be running (foreground or
  background). True phone-free start is out of scope (see scope doc).
- Stats resume from the last snapshot if the watch app is closed and reopened
  (`applicationContext`), so brief disconnects are fine.
