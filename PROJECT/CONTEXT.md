# PICK — Project Context

**Status:** 🚀 Production-shaped dev build on Jake's iPhone — all desk work done, in field-validation phase
**Last consolidated:** 2026-06-11 (end of the two-day build-out marathon)
**Read this first in any new chat.** Repo: `/Users/jakeverbiest/Desktop/pick-app` (git, remote: github.com/jakeverbiest/pick-app)

---

## What PICK is

Autonomous trash-pickup tracking. Phone in pocket, motion sensors detect each pickup (no buttons), GPS tracks the route, streets turn green on a shared neighborhood map. Impact metric: ITEMS (detected) → WEIGHT (× calibrated lb/pickup) → **BAGS** (÷10 lb standard bag — the public headline number, e.g. "LES: 124 bags this month").

**Stack:** React Native + Expo SDK 54, TypeScript, Firebase (Auth + Firestore, rules deployed), Leaflet-in-WebView maps, OpenStreetMap/Overpass street data. Runs as a real dev build (Xcode, `com.jakeverbiest.pickapp`) — Expo Go retired.

---

## Current state (everything below is LIVE on Jake's phone)

**Detection** (`motionDetection.ts` → `motionEvaluation.ts` pure scoring, `motionShapeDetector.ts` windows):
- Thresholds: peak 0.9–3.5g (penalty >2.5g), timing 0–2500ms, duration 500–5000ms, confidence >30
- Settle fix: window closes when accel sits at ~1.0g±0.12 for 300ms (old 0.7g check was physically impossible — gravity). Windows now close in 600–1300ms, enabling spree counting
- Filters: rhythmic-walking rejection (peaks≥3 & ≥2s), pocket low-rotation rejection (gyro<1.5 when 👖 Carry Mode = pocket), 5s arm delay (pocket insertion), trim on pocket-exit (4s) and Stop (6s)
- **Flight recorder:** every motion event (peak/duration/peakTime/gyro/peaks/speed/confidence/counted/reason) saved with each cleanup + in session export. All tuning is data-driven from these logs
- Regression suite: `npm run test:detector` — June 10 walk replay + garbage + peak-counter + walking-filter cases. RUN BEFORE ANY THRESHOLD CHANGE
- Field history: 40% recall (June 10 am, old caps) → 67% (June 10 pm) → pocket session caught 5/5 real picks, over-count fixed by filters (replay: 10→6 on 5 real)

**Weight calibration** (`weightCalibration.ts`): learns lb/pickup from net weigh-ins (recency+size weighted, 2+ samples to activate, default 0.05). Session summary scale entry auto-feeds it; manual entry + sample management in Settings. Real data point: 91 items = 0.8 lb net → ~0.012 lb/item (default was 4x high). ⚠️ Jake's 68-item/0.8 lb sample may not be entered yet — Settings → Weight Calibration → manual entry.

**Street coverage** (`streetSegments.ts`): OSM streets → ~50m segments (cached 30d, verified: 1,198 segments in LES) → cleanup routes snap within 25m → `segment_status` in Firestore stamped `last_cleaned` — **shared across all users**. Map: grey dashed = never cleaned, green→red freshness. Header: "X% of nearby streets fresh."

**Auth & data:** Firebase Auth w/ AsyncStorage persistence (metro.config.js `unstable_enablePackageExports=false` is REQUIRED for the RN bundle — don't remove). Firestore rules deployed (owner-scoped writes, shared segment reads/validated writes). Offline-safe: walks save locally on failure, background-sync with correct timestamps, no dupes, single loop. getCleanups memoized (15s TTL). Per-cleanup delete in Activity. Mock/legacy data purged.

**Sessions:** background location keeps detection alive screen-off (real builds; `backgroundSession.ts`); keep-awake + 🌙 pocket-mode black overlay as Expo Go/no-Always fallback; ONE GPS stream (Balanced/5s) shared by detector, map, and pickup tagging (was 3 streams + per-pickup fixes — major battery fix). Battery saver toggle removed (became a no-op).

**Fitness:** ✅ VERIFIED WORKING (June 11) — each saved cleanup writes a walking workout to **Apple Health** (real GPS distance, calorie model, items in metadata; Settings toggle, default on). Gotcha that cost three rebuilds: `react-native-nitro-modules` is a peer dep of the healthkit package and MUST be declared explicitly in package.json or autolinking skips it (now declared). adidas API closed to third parties June 30 2025 — direct integration impossible; adidas only writes to Health, never reads.

**Branding:** cream "pumpkin trash bag with sage P" logo — iOS icon, Android adaptive set, sage splash, logo on auth screens. Assets in `assets/images/`, regenerate via the SVG paths in git history (commit `0628b00`).

**Legal/onboarding:** Privacy Policy + ToS drafts (`/legal/` + in-app viewers in Settings; need lawyer + hosting before store). One-time safety briefing screen gates first run (`app/safety.tsx`).

**UI state:** Activity tab redesigned (no header, 52pt impact numbers, compact rows w/ 📤🗑️). Settings de-emoji'd top half, compact unit chips. Remaining emoji: Carry Mode/Team/Fitness/About/Dev/Danger sections.

---

## Build & run cheat sheet

- JS changes: `cd apps/companion && npx expo start` → relaunch PICK on phone (same WiFi). "No script URL" error = Metro not running.
- Native changes (new module / app.json / icons): `npx expo prebuild -p ios` → open `ios/PICK.xcworkspace` → re-check Signing team → ▶ Run. PIF error = quit Xcode, `killall -9 XCBBuildService`, reopen.
- Free Apple ID build expires every 7 days (re-Run to refresh). $99 dev program removes this + unlocks TestFlight.
- Always run `npx tsc --noEmit` (must be 0 errors) + `npm run test:detector` before committing.

---

## Next steps

1. **Validation street walk** (phone pocketed, screen off): count picks, net weigh-in, export → paste motion log. Targets: recall >85%, FP <10%, route clean at Balanced/5s GPS, streets turn green, Health workout appears
2. If walking single-peak FPs persist → speed-gate using the recorded m/s column
3. **$99 Apple Developer enrollment** → TestFlight → first outside testers (~3-5 days after enrolling)
4. Store prep leftovers: host privacy policy at URL, in-app account deletion (Apple requires), screenshots
5. Backlog: coverage stats dashboard ("62% of LES"), remaining de-emoji pass, zone challenges on segment data, push notifications, Ray-Ban integration (original vision doc: `docs/ARCHITECTURE.md`)

---

## Resume instructions for new chats

"Read /Users/jakeverbiest/Desktop/pick-app/PROJECT/CONTEXT.md, then [task]." Key files: services in `apps/companion/src/services/`, screens in `apps/companion/app/(tabs)/`, detector thresholds ONLY in `motionEvaluation.ts`, tests in `src/services/__tests__/detectorRegression.ts`. Jake field-tests and pastes logs/exports; tune from the flight-recorder data, never from guesses — every threshold change needs a regression case.

**Owner:** Jake Verbiest — jlverbie@gmail.com
