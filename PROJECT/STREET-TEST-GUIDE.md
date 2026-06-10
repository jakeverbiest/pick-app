# PICK: Street Test Guide

## Pre-Test Setup (5 min)

1. **Open the app** on your phone
2. **Ensure location permissions are ON** (the detector logs GPS for each pickup)
3. **Set "Expected Pickups"** to however many cans you plan to hit (e.g., 25-30)
4. **Tap "▶ Start Test"** (button turns green)

## During Test (Route Duration)

**Just do your normal trash pickup route.** The detector runs automatically.

- Walk/drive to each can
- Do natural pickup motions at normal speed
- Counter auto-increments when detected
- Don't overthink it—system is autonomous

**Optional:** Tap "Hold for Pickup" button if you want to manually mark pickups for comparison, but it's not required.

## After Test (5 min)

1. **Tap "⏹ Stop"** when route is complete
2. **Check the counter:**
   - How many detected vs. expected?
   - What was the final accuracy %?
3. **Check the logs:**
   - Open browser console or terminal
   - Copy all `✅ PICKUP` logs (should be ~20-30 lines)
4. **Report:**
   - Expected: X pickups
   - Detected: Y pickups
   - Accuracy: Z%
   - Copy/paste the console logs

## What to Expect

### Ideal (70%+):
```
Expected: 25
Detected: 18-25
Accuracy: 72-100%
Console: ~18-25 ✅ PICKUP logs with locations
```
→ System ready for production

### Good (50-70%):
```
Expected: 25
Detected: 13-17
Accuracy: 52-68%
Console: ~13-17 ✅ PICKUP logs, some misses
```
→ Acceptable, may need minor tuning or different routes

### Poor (<50%):
```
Expected: 25
Detected: <13
Accuracy: <52%
Console: <13 ✅ PICKUP logs, many misses
```
→ May have environment-specific issues (noise, motion patterns)

## Troubleshooting

**Counter stuck at 0?**
- Restart the app
- Check location permission is granted

**Lots of false positives?**
- May indicate ambient noise/vibration on route
- Check phone is secure in pocket/bag

**High detection but different locations?**
- GPS accuracy varies by building/street
- This is expected (±10-20m accuracy typical)

## Data Collection

Each `✅ PICKUP` log includes:
- **Timestamp** (when detected)
- **Location** (lat/lon with accuracy in meters)
- **Peak acceleration** (how hard the motion was)
- **Duration** (how long the motion lasted)
- **Confidence** (55-70% typical)

All data is aggregated to zones before storage—raw GPS never persists.

---

**File:** `/Users/jakeverbiest/Desktop/pick-app/PROJECT/STREET-TEST-GUIDE.md`  
**Status:** Ready to deploy  
**Target:** Real-world validation of 70%+ detection + false positive measurement
