# PICK: Motion Detection System - Project Context

**Status:** 🚧 FULL APP BUILD-OUT — detector validated, app features landing weekly  
**Last Updated:** 2026-06-10  
**Apartment Test #2:** 11/14 detected (79%)  
**Street Test:** 5/5 detected (100%), 2 false positives (29% FP rate)  
**Next Phase:** Field-test weight calibration with the new scale; reduce false positives

---

## June 2026 Progress (App Build-Out)

Since the May 31 detector validation, the app gained (June 3–10 sessions):

- **Firebase backend** — Firestore persistence with offline cache + migration from mock DB
- **Auth** — signup/login screens, routed via root index screen
- **Route tracking & maps** — GPS walking routes saved per cleanup, neighborhood heatmap with freshness colors, historical-walk toggle
- **Per-cleanup export** — JSON export of any past walk
- **Teams & challenges (Task #21)** — team stats, leaderboard tab, challenge join/progress UI
- **Settings** — 2×2 unit toggles (lb/kg, mi/km), team/event field, battery saver
- **UI polish (Task #20, partial)** — SafeAreaView fixes, map header (name left, group/superlative right), buttons hugged to bottom bar
- **Weight calibration (Task #22, ✅ June 10)** — new `weightCalibration.ts` service learns the real lb/pickup factor from scale weigh-ins (recency- and size-weighted average, junk-sample rejection, AsyncStorage persistence). Scale entries in the session summary auto-feed calibration; replaces the hardcoded 0.05 lb/pickup everywhere in map.tsx. Settings has a ⚖️ Weight Calibration card (factor, weigh-ins, sample list, remove/reset).
- **Legal (June 10)** — draft Privacy Policy + Terms of Service in `/legal/` (app-store blockers; need lawyer review + effective dates)

**Field test June 10 (15 expected, 6 detected = 40%):** root cause found in logs — 9 real pickups peaked 1.68–3.09g and were hard-rejected by the 1.6g peak-accel cap; 1 more rejected by the 2000ms peak-timing cap (inconsistent with the 2500ms recording window). **Fix applied:** peak range widened to 0.9–3.5g (confidence −10 above 2.5g instead of hard reject), peak timing extended to 0–2500ms, sweet-spot bonus widened to 1.0–1.8g. Next walk should validate.

**Impact metric decision (June 10):** three-layer model in `impactMetrics.ts` — ITEMS (auto-detected, atomic, stored) → WEIGHT (items × calibrated lb/pickup) → BAGS (weight ÷ 10 lb standard 13-gal bag, the public headline metric). Users never need a scale: bag-size reports and the few who weigh tune the factor for everyone. All aggregation in lb internally, displayed as bags.

**Street-segment shared coverage (June 10):** new `streetSegments.ts` — coverage now belongs to streets, not walks. Street geometry fetched from OpenStreetMap (Overpass, free), chopped into ~50m segments with stable IDs, cached on-device 30 days. Saving a cleanup snaps the route to segments within 25m and stamps `last_cleaned` in Firestore `segment_status` (queried by 0.01° grid — shared across ALL users by construction). Map renders streets: grey dashed = never cleaned, green→yellow→orange→red freshness. Header shows "X% of nearby streets fresh". Old 50m center-point circles replaced by freshness-colored route corridors. Snap/chop math unit-tested. NOT yet field-tested — Overpass call happens on first map load with location.

**✅ Auth + rules LIVE (June 10, evening):** Jake completed the full sequence on-device — Email/Password enabled in console, signed up (legacy account migrated), session survives force-quit, and `firestore.rules` deployed to production (`✔ Deploy complete`, project pick-app-74c2e). Database is no longer open. Remaining smoke test: save one cleanup with rules live.

**Firebase Auth migration (June 10):** simpleAuthService (local AsyncStorage) replaced with real Firebase Auth across all 10 screens. `firebaseConfig.ts` now initializes auth ONCE with AsyncStorage persistence (the missing piece that caused the June 3 logout-on-reload bug). `authService.ts` keeps the same interface (incl. neighborhood) so screens didn't change. One-time legacy migration re-keys cleanups/badges/settings from the old local uid to the new Firebase uid on first signup/login. Password reset emails now real. ⚠️ BEFORE TESTING: enable Email/Password in Firebase Console → Authentication → Sign-in method. After auth is verified working, deploy `firebase/firestore.rules`.

**Bags metric everywhere (June 10):** Profile shows "Bags Collected" card + total weight ≈ bags; Leaderboard weight metric now displays as bags.

**Validation walk #2 (June 10, evening, rules live):** 91 actual pickups, 68 registered, of which ~7 were stair false-positives → ~61/91 = **67% recall** (up from 40% with old thresholds), FP source identified: descending stairs. Scale: 2.5 lb gross − 1.7 lb bucket = **0.8 lb net** → real factor ≈ 0.012 lb/detected item (old 0.05 default over-estimated ~4x). No weight entered in-app, so calibration unpoisoned. **Responses shipped:** (1) flight recorder — every motion event (peak/duration/gyro/confidence/reason) recorded on-device and included in session export, so off-WiFi walks now produce tuning data; (2) tare warning in weight entry ("net weight only"); (3) manual weigh-in entry in Settings calibration card. **Next tuning question:** do stair events differ from pickups on gyro? Flight recorder will answer on the next walk.

**Dev build LIVE + pocket session #2 (June 11):** PICK now runs as its own app (Xcode dev build; CocoaPods via Homebrew; expo-file-system was 2 majors stale — `expo install --fix` resolved). Background location session works (`🌙 Background session active`). OSM segment fetch verified on-device (1,198 segments, LES). Settle fix confirmed in field: windows close naturally 600–1300ms. Session: 5 real picks → 10 counted; flight recorder identified all 5 extras: pocket insertion (gyro 0.48 vs picks' 2.9–7.4), 2 walking bursts (peaks 4–5 over ~2.6s), removal (1.3s before Stop, outside old 3.5s trim). **Filters shipped:** rhythmic-walking rejection (peaks≥3 & duration≥2s), pocket-carry low-rotation rejection (gyro<1.5, Settings toggle 👖 Carry Mode, default pocket), pocket-mode-exit trim (4s), stop trim widened to 6s, GPS speed now recorded per event (m/s column). Replaying June 11 log against new filters: 10 counted → 6 (5 real + 1 borderline walking single-peak). Next refinement candidate if needed: speed-gating using the new m/s column.

**Data cleanup (June 11):** per-cleanup 🗑️ delete shipped (Activity tab) + fixed stored-id-field override bug. Jake purged the 5 settings-mocks and the pre-June-5 legacy migration leftovers — community map now shows real walks only.

**Known issues / open items:**
1. **False positives** — Jake reports "a huge amount" in real walks (e.g., 256 items in 22 min). Re-measure after the June 10 threshold fix; consider gyro discrimination next.
1b. **Segment system untested in field** — verify Overpass fetch on phone, snap quality with 20s GPS intervals (may need denser GPS during cleanup), and Firestore write volume.
2. **Privacy note** — route GPS points are now stored in Firestore per cleanup (the old "GPS never leaves device" claim is outdated; the new privacy policy reflects reality).
3. **Task #20 remainder** — broader visual design pass.
4. **App store prep** — accounts, builds, screenshots (see production roadmap; $125–1,100 est.).
5. **Vision backlog** — zones turning green, push notifications, Cloud Functions validation, Ray-Ban Display integration.

---

## Project Overview

PICK is a motion detection system for trash pickup collection tracking. Core goal: reliably detect when someone picks up trash using only phone accelerometer and gyroscope sensors, without manual button presses.

**Real-world use case:** Trash collection workers walk a route, pick up cans. App detects each pickup autonomously and logs location. System aggregates to zones for privacy (no raw GPS stored).

---

## Current Status: Motion Shape Detector (Autonomous)

### What Works
- **Autonomous detection:** No button needed. Detector analyzes acceleration/gyro profiles in real-time.
- **Shape-based analysis:** Moved from timing-window approach (300ms→600ms→800ms all failed) to analyzing the actual motion profile (peak acceleration, duration, settling behavior).
- **Privacy-safe data flow:** Pickups → PickupAggregator → zone-level counts (GPS never leaves device).
- **Ground truth capture:** Manual signature recording for offline analysis (not needed for autonomous detector).

### Recent Improvements (May 31, 2026)

**Log Verbosity Fixed:**
- Removed continuous sensor reading logs (was 3000+ lines per test)
- Now only `✅ PICKUP` detections logged (~20-40 lines per test)
- Logs are now readable and shareable

**Autonomous Detection (No Manual Buttons):**
- Removed "Mark Pickup" button (was redundant with detector)
- Added "Expected Pickups" input for optional accuracy tracking
- Accuracy auto-calculates: `Detected ÷ Expected × 100%`
- "Stopped to pick" detected automatically when motion settles

**Thresholds Relaxed (Ready to Test):**
- Motion start: 0.8g, Peak: 0.9-1.6g, Duration: 500-5000ms, Confidence: 30
- Previous test (strict): 13% detection
- Target: 70%+ with relaxed thresholds

---

## Architecture

### Motion Detection Pipeline
```
Accelerometer/Gyro (100ms interval)
    ↓
MotionDetection.handleAcceleration()
    ├─ Feed into GroundTruthCapture (if capturing)
    ├─ If accel > 0.8g: startRecording() in MotionShapeDetector
    └─ While recording: addSample() + check shouldFinalize()
        ↓
    MotionShapeDetector.analyzeProfile()
        ├─ Duration check (500-5000ms)
        ├─ Peak accel check (0.9-1.6g)
        ├─ Peak timing check (150-2000ms)
        ├─ Settling drop check (>0.05g)
        └─ Confidence scoring (base 40, bonuses up to 100)
        ↓
    If confidence > 30: detectPickupFromShape()
        ↓
    PickupAggregator.addPickup() → Privacy-safe zone aggregation
```

### Key Files
- **motionDetection.ts** — Main detector service
- **motionShapeDetector.ts** — Profile analyzer
- **groundTruthCapture.ts** — Manual signature collection (for training data)
- **pickupAggregator.ts** — Zone-level aggregation
- **index.tsx** — Main UI screen (Start Test, Mark Pickup buttons)

---

## Thresholds (Current - May 31, 2026)

| Parameter | Previous | Current | Purpose |
|-----------|----------|---------|---------|
| Motion start threshold | 1.0g | 0.8g | Begin recording motion |
| Peak accel min | 1.05g | 0.9g | Minimum valid peak |
| Peak accel max | 1.5g | 1.6g | Maximum valid peak |
| Duration min | 800ms | 500ms | Minimum motion duration |
| Duration max | 4000ms | 5000ms | Maximum motion duration |
| Peak timing min | 300ms | 150ms | Earliest peak allowed |
| Peak timing max | 1500ms | 2000ms | Latest peak allowed |
| Settling drop min | 0.1g | 0.05g | Minimum accel drop after peak |
| Confidence threshold | 40 | 30 | Minimum to fire pickup |
| Base confidence | 50 | 40 | Starting confidence score |
| Target duration | 1900ms | 1600ms | Optimal motion length |
| Gyro bonus threshold | 0.8 | 0.6 | Bonus if gyro above this |

**Rationale:** Relaxed all constraints to catch gentler/quicker pickups that were being missed.

---

## Test Results History

### Apartment Test #1 (May 31, 2026) - BEFORE Relaxation
- **Expected pickups:** ~20-23
- **Detected:** 3
- **Detection rate:** ~13%
- **Thresholds:** Original (strict)
- **Confidence levels:** 70%, 70%, 80%
- **Peaks detected:** 1.30g, 1.38g, 1.48g
- **User assessment:** "exceptionally off"
- **Logs:** 3 PICKUP messages with location, peak, duration, confidence

### Apartment Test #2 (PASSED) - AFTER Relaxation & Log Fixes
- **Expected:** ~14 pickups
- **Detected:** 11 pickups
- **Detection Rate:** 79% ✅ (target was >70%)
- **Confidence Levels:** 55-70% (failures at 0%)
- **Status:** ✅ PASSED - Ready for street test
- **Key Fixes Applied:**
  - Removed continuous sensor logging (reduced 3000+ lines to 20)
  - Fixed motion evaluation (was resetting before evaluation)
  - Optimized maxMotionDuration from 5000ms → 3000ms → 2500ms
  - Increased motion start threshold from 0.8g → 1.0g

---

## Next Immediate Steps

### 1. Run Apartment Test #2 (TODAY - May 31)
**Simplified Workflow (no manual buttons):**
1. Open app → "Expected Pickups" field shows 0
2. Enter expected count: tap + button until it shows 25
3. Tap "▶ Start Test" (button turns green)
4. Do ~25 natural pickup motions at normal speed
5. Autonomous detector fires `✅ PICKUP` for each detection
6. Counter auto-increments, accuracy shows live (Detected ÷ Expected × 100%)
7. When done, tap "⏹ Stop"

**What to Report:**
- How many pickups were detected? (target: ≥18 out of 25 = 70%+)
- What confidence levels? (should see 40-100%)
- Any false positives? (acoustic noise, incidental movement)
- Any misses? (very quick/slow pickups? very gentle?)

### 2. Analyze Results
- If detection rate >70%: **Proceed to street test** - thresholds are working
- If detection rate 40-70%: **Minor tuning needed** - adjust confidence threshold or duration range
- If detection rate <40%: **May need different approach** - current relaxation may not be enough

### 3. Street Test (When Ready)
- Same procedure on actual trash collection route
- Log location for each `✅ PICKUP`
- Compare detected locations vs. manual count of actual pickups
- Assess false positives in real-world noise (traffic, wind)

---

## Known Unknowns

1. **Outdoor vs. Indoor Performance**
   - Current data: only 1 apartment test
   - Outdoor has higher gyro noise (1.03-2.32g vs. 0.73-1.48g indoor)
   - May need different thresholds or separate profiles

2. **False Positive Rate**
   - Not yet measured in detail
   - Could be high at low confidence thresholds (30 is lenient)
   - Need real-world street test to measure

3. **Edge Cases**
   - Very fast pickups (sub-500ms)?
   - Very gentle pickups (sub-0.9g)?
   - Repeated motions (e.g., double-tapping)?
   - Phone orientation variance?

4. **Gyroscope Utilization**
   - Currently a "nice to have" bonus (+5 confidence)
   - May be underutilized—could improve discrimination

---

## How to Continue Work in New Chats

### Option A: Use This Document
1. Start new chat
2. Reference `/Users/jakeverbiest/Desktop/pick-app/PROJECT/CONTEXT.md`
3. Say: "Continue PICK motion detection work. Last status: [see doc]"
4. Claude will have full context without needing to recap

### Option B: Use Artifact Dashboard
- A live tracking page (being created) shows test history, thresholds, next steps
- Open in new chat: "Show me the PICK dashboard"

### Option C: Use Scheduled Tasks
- Automated test runs log results to `/PROJECT/field-tests/`
- New chat can read latest results automatically

---

## File Paths (for new chats)

```
/Users/jakeverbiest/Desktop/pick-app/
├── PROJECT/
│   ├── CONTEXT.md (THIS FILE - READ FIRST IN NEW CHATS)
│   ├── field-tests/ (test logs organized by date)
│   ├── tuning-params/ (threshold history)
│   └── docs/ (findings, analysis)
├── apps/companion/src/services/
│   ├── motionDetection.ts (main detector)
│   ├── motionShapeDetector.ts (profile analyzer)
│   ├── groundTruthCapture.ts (manual capture)
│   ├── pickupAggregator.ts (privacy aggregation)
│   └── [other services]
└── apps/companion/app/(tabs)/
    └── index.tsx (main UI)
```

---

## Commands for New Chats

**To get back on track:**
```
"Read /Users/jakeverbiest/Desktop/pick-app/PROJECT/CONTEXT.md then continue the motion detection work from where Jake left off."
```

**To run a test:**
```
"Run the apartment motion detection test. Jake will do ~20-25 pickup motions. Report detection rate and confidence levels."
```

**To analyze results:**
```
"Jake got X detections out of Y expected pickups. Analyze the results and recommend next tuning steps or test direction."
```

---

## Success Criteria (For This Phase)

- [x] Apartment test #2 achieves >70% detection rate with relaxed thresholds (**79% achieved**)
- [x] System works autonomously (no button presses needed, fully automatic)
- [x] Log verbosity fixed (3000+ lines → 20 lines)
- [x] False positive rate measured on street test (**29% FP, acceptable for production**)
- [x] Real-world street test validates 100% detection rate in field conditions (**5/5 pickups caught**)
- [x] Street-validated threshold configuration documented
- [x] System ready for production deployment

---

**Owner:** Jake Verbiest  
**Email:** jlverbie@gmail.com  
**GitHub:** (PICK app repo)  
**Last Touched:** 2026-06-10 by Claude (Fable 5)
