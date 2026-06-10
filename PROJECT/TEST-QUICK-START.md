# PICK Apartment Test #2 - Quick Start

## Setup (2 min)
1. Open the companion app on your phone
2. You'll see "Pickups Detected: 0" at the top
3. Below that is "Expected Pickups: 0" with +/- buttons

## Before Test (1 min)
1. Tap the + button under "Expected Pickups" until it shows **25**
2. This tells the system you're about to do 25 pickups

## During Test (5 min)
1. Tap "▶ Start Test" (button turns green and says "⏹ Stop")
2. Do ~25 **natural pickup motions** at normal speed:
   - Bend down, grab can, lift, set down
   - Don't think about it—act natural
   - Vary speed/intensity if you normally do
3. The counter "Pickups Detected" auto-increments when motion settles
4. Below the counter, you'll see:
   - **Expected:** 25
   - **Detected:** (live count, should grow to 18+)
   - **Accuracy:** (updates live, target 70%+)
5. When done with ~25 pickups, tap "⏹ Stop"

## After Test (2 min)
1. **Check the counter:** How many detected vs. expected?
2. **Check terminal/console:** Look for `✅ PICKUP` logs (should be ~20-30 lines)
3. **Report:** "Expected 25, detected X. Confidence levels: Y-Z%"

## What to Expect

### Good (70%+):
```
Expected: 25
Detected: 18-25
Accuracy: 72-100%
Console: ~20-25 ✅ PICKUP logs
```
→ Thresholds are working. Proceed to street test.

### Okay (40-70%):
```
Expected: 25
Detected: 12-17
Accuracy: 48-68%
Console: ~12-17 ✅ PICKUP logs, some missing
```
→ Need minor tuning (adjust confidence threshold or duration range).

### Poor (<40%):
```
Expected: 25
Detected: <10
Accuracy: <40%
Console: ~5-10 ✅ PICKUP logs, mostly missing
```
→ Current relaxation not enough. Need different approach.

## Terminal Output Example
```
Motion detection started with location tracking
✅ PICKUP at (40.123456, -73.654321) - Peak: 1.15g, Duration: 1850ms, Confidence: 75%
✅ PICKUP at (40.123457, -73.654322) - Peak: 1.32g, Duration: 1620ms, Confidence: 88%
✅ PICKUP at (40.123458, -73.654323) - Peak: 0.95g, Duration: 1400ms, Confidence: 52%
...
Motion detection stopped
```

## Troubleshooting

**Counter not incrementing?**
- Check that sensor permissions are granted
- Restart app

**Getting 0 detections?**
- Try doing pickup motions SLOWER (1.5-2 seconds)
- Thresholds may still need relaxation

**Getting too many false positives?**
- Phone might be detecting ambient noise as motion
- Make sure you're in a quiet space (apartment, not street)

---

**File:** `/Users/jakeverbiest/Desktop/pick-app/PROJECT/TEST-QUICK-START.md`  
**Time Estimate:** 10-12 minutes total  
**Status:** Ready to run
