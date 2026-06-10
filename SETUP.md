# PICK App - Technical Setup Guide

**Last Updated:** June 1, 2026  
**Owner:** Jake Verbiest (jlverbie@gmail.com)  
**Status:** Motion detection working, UI improvements complete, ready for field testing

---

## 1. Tech Stack

**Frontend:**
- **Framework:** React Native (Expo) with TypeScript
- **Navigation:** expo-router (file-based routing)
- **State Management:** React hooks (useState, useRef) — no external state management needed yet
- **Sensors:** expo-sensors (Accelerometer, Gyroscope at 100ms intervals)
- **Location:** expo-location (foreground position tracking, 1s interval)
- **Export/Sharing:** React Native Share API

**Development:**
- **Build:** Expo CLI (run with `expo start`)
- **Language:** TypeScript
- **Package Manager:** npm/yarn

**No Backend Yet:**
- Motion detection runs entirely on-device
- All data stays local (privacy-safe zone aggregation)
- GPS never leaves device (aggregated to zones + hour buckets)
- Logs exported via Share API

---

## 2. Folder Structure

```
/Users/jakeverbiest/Desktop/pick-app/
├── apps/companion/                       # Main React Native app
│   ├── src/
│   │   └── services/
│   │       ├── motionDetection.ts        # Core motion detector (1.2g threshold)
│   │       ├── motionShapeDetector.ts    # Peak analysis & confidence scoring
│   │       ├── groundTruthCapture.ts     # Manual signature recording (training)
│   │       ├── pickupAggregator.ts       # Privacy-safe zone aggregation
│   │       └── [other services]
│   ├── app/
│   │   └── (tabs)/
│   │       └── index.tsx                 # Main test screen (start/stop/logs)
│   ├── app.json                          # Expo config
│   └── package.json
├── PROJECT/
│   ├── CONTEXT.md                        # Full project history & decisions
│   ├── PRODUCTION-READY.md               # Validation report (79% apt, 100% street)
│   ├── STREET-TEST-GUIDE.md              # Field testing procedures
│   └── field-tests/                      # Test logs organized by date
└── SETUP.md                              # THIS FILE
```

**Key Directories:**
- `apps/companion/src/services/` — All motion detection logic
- `apps/companion/app/(tabs)/` — UI screens (currently just index.tsx)
- `PROJECT/` — Documentation, test logs, threshold tuning history

---

## 3. Key Files

### Core Motion Detection
| File | Purpose | Key Functions |
|------|---------|---|
| `motionDetection.ts` | Main detector service | `startListening()`, `handleAcceleration()`, threshold: 1.2g |
| `motionShapeDetector.ts` | Motion profile analyzer | `analyzeProfile()`, peak detection, confidence scoring (0-100%) |
| `groundTruthCapture.ts` | Manual signature recorder | Captures acceleration signature when user holds button (for training) |
| `pickupAggregator.ts` | Privacy-safe aggregation | Converts GPS + pickups → zone + hour buckets |

### UI
| File | Purpose | Components |
|------|---------|---|
| `index.tsx` | Main test screen | Counter, expected input, start/stop, real-time log viewer, test summary modal, export button |

### Configuration
| File | Purpose | Content |
|------|---------|---|
| `app.json` | Expo config | App name, version, plugins (sensors, location) |
| `package.json` | Dependencies | React Native, Expo, TypeScript, etc. |

### Navigation
- **Entry Point:** `apps/companion/app/(tabs)/index.tsx` (Expo router file-based routing)
- **Current Setup:** Single tab screen (PICK test interface)
- **Future:** Plan to add heatmap, leaderboard tabs

---

## 4. Backend Setup

**Currently: None (On-Device Only)**

All processing happens on the phone:
- Sensor data → MotionDetection → MotionShapeDetector → PickupAggregator → Privacy-safe logs

**Data Flow:**
```
Accelerometer (100ms) → MotionDetector.handleAcceleration()
                     ├─ Feed to GroundTruthCapture (if capturing)
                     ├─ Feed to MotionShapeDetector (if recording)
                     └─ Check if >1.2g → start recording
                        └─ Analyze shape @ 2500ms → confidence score
                           └─ If confidence ≥30% → PickupAggregator
                              └─ Aggregated to zones (GPS never stored individually)

GPS (1s interval) → Location.watchPositionAsync() 
                 → stored as lastLocation reference only
```

**Data Persistence:**
- Pickups array (in-memory during test)
- Zone aggregates (reset on "Reset" button)
- Session logs (exported via Share API)
- No local storage, no database (yet)

**Privacy Model:**
- Raw GPS coordinates not stored
- Aggregated to: Zone (lower_east_side, etc.) + Hour bucket
- Each pickup event has: timestamp, peak accel, confidence, lat/lon (for analysis, discarded after aggregation)

---

## 5. Current Status

### ✅ Completed
- Motion detection working autonomously (no manual buttons)
- Shape-based analysis (peak, duration, settling behavior)
- Confidence scoring (30-100%)
- Privacy-safe zone aggregation
- Log verbosity fixed (3000+ lines → 20-40 lines)
- Real-time log viewer (shows last 15 detections while testing)
- Test summary modal (shows after stop with stats)
- Export logs button (Share API integration)
- Field-tested: 79% accuracy in apartment, 100% on street (5/5), 29% false positive rate

### ⚠️ Known Issues & Insights
1. **1.2g threshold too sensitive** — Normal movements (stairs, brisk walking) trigger false positives
   - Latest test: 138 detections vs 50 expected pickups (276% rate)
   - Root cause: System triggers recording on any 1.2g+ motion for 2500ms
   - Solution pending: Improve shape filtering or add state machine (only detect while stationary)

2. **Peak accelerations vary wildly** — Same motion produces 1.2-2.5g+ peaks
   - Current peak threshold: 0.9-1.6g (rejects ~80% of recordings)
   - Real pickups cluster: 1.15-1.45g (tighter range needed)

3. **Duration always ~2593ms** — All recordings force-finalize at max 2500ms
   - Masks actual motion duration
   - May need shorter max (1800ms?) to capture pickups before unrelated motion

### 🚀 Next Immediate Steps
1. **Investigate false positives** — Run baseline walking test to understand FP patterns
2. **Refine thresholds** — Narrow peak range (1.15-1.45g?), shorten max duration, add gyro requirement
3. **Add post-route form** — Capture expected/detected/FP count/conditions after each test
4. **Validate with 5-10 street routes** — Confirm thresholds work in real conditions
5. **Then implement UI features** — Heatmap, multi-picker routes, leaderboard, volume conversion

### Features Planned (Not Built Yet)
- Heatmap overlay showing pickup density by location
- Multi-picker route support (multiple users on same block)
- District/block-level aggregation for gamification
- Leaderboard with streaks and team challenges
- Volume conversion (X pickups = Y gallons of trash)
- Apple Watch integration
- Integration with fitness tracker apps

---

## 6. How to Continue in a New Chat

### Quick Reference
1. **Full context:** Read `/Users/jakeverbiest/Desktop/pick-app/PROJECT/CONTEXT.md`
2. **Production status:** Read `/Users/jakeverbiest/Desktop/pick-app/PROJECT/PRODUCTION-READY.md`
3. **Test guide:** Read `/Users/jakeverbiest/Desktop/pick-app/PROJECT/STREET-TEST-GUIDE.md`
4. **This setup:** `/Users/jakeverbiest/Desktop/pick-app/SETUP.md` (this file)

### Command to Resume
```
"Read /Users/jakeverbiest/Desktop/pick-app/SETUP.md and 
/Users/jakeverbiest/Desktop/pick-app/PROJECT/CONTEXT.md then help continue PICK development.
Current blocker: False positive rate too high in outdoor tests (138 detected vs 50 expected).
Need to investigate motion patterns and refine thresholds."
```

---

## 7. Running Locally

```bash
cd /Users/jakeverbiest/Desktop/pick-app/apps/companion
npm install
expo start

# On phone: Scan QR code with Expo Go app
# Or: Press i (iOS) or a (Android) to open in emulator
```

**Required Permissions:**
- Location (foreground): Needed for GPS tracking
- Motion sensors: Automatic (Accelerometer + Gyroscope)

---

## 8. Key Thresholds (Current Tuning)

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Motion start threshold | 1.2g | Begin recording when acceleration spikes |
| Peak accel range | 0.9–1.6g | Valid pickup signature |
| Peak timing window | 0–2000ms | When peak can occur in motion |
| Duration range | 500–5000ms | How long motion can last |
| Settling drop min | 0.02g | Minimum deceleration after peak |
| Confidence threshold | 30% | Minimum to fire detection |
| Max recording duration | 2500ms | Force-finalize after this time |
| Gyro bonus threshold | 0.6 | Bonus if wrist rotation detected |

**To Adjust:** Edit `motionDetection.ts` lines 119–201 (evaluateProfile function)

---

## 9. Contact & Questions

- **Owner:** Jake Verbiest
- **Email:** jlverbie@gmail.com
- **Latest Test:** 2026-06-01 (138 detections, 50 expected — threshold regression suspected)
- **Repo:** (PICK app, private)

---

**Note:** This summary is updated as the project evolves. Last sync: June 1, 2026.
