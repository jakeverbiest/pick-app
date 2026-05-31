# Motion Detection Algorithm

Core competitive advantage. Tuned through field testing.

---

## Algorithm v1 (Current)

### Detection Thresholds
- **Accelerometer spike:** >1.5g for 500ms
- **Gyroscope confirmation:** rotation detected within 1s of spike
- **Cooldown:** 3 seconds between valid pickups (prevents bounce detection)

### Logic
```
1. Monitor accelerometer continuously
2. When spike >1.5g detected:
   - Check if gyroscope detected rotation in last 1s
   - If yes: Record pickup event
   - If no: Discard (false positive)
3. Ignore pickups within 3s of last valid pickup
```

### Why This Works
- **Accelerometer alone is noisy** — walking triggers false positives
- **Gyroscope confirmation** — only bend-down motions include rotation
- **Cooldown prevents bouncing** — natural bending doesn't register twice
- **Instant feedback** — haptic buzz when pickup detected

---

## Field Test Data

### Test Environment
- Outdoor (concrete, asphalt, grass)
- Various clothing (jeans, shorts, sweatpants)
- Different bend speeds (slow, normal, fast)
- Real pickups mixed with false scenarios (walking, jumping, etc.)

### Metrics Tracked
- Total manual pickups attempted
- Detected pickups
- Accuracy % (detected / attempted)
- False positives (non-pickup events detected)
- False negatives (missed real pickups)

### Example Log
```json
{
  "test_id": "001",
  "date": "2026-06-05",
  "location": "Washington Square Park, NYC",
  "conditions": "sunny, concrete, jeans",
  "manual_pickups": 15,
  "detected_pickups": 12,
  "accuracy_percent": 80,
  "false_positives": 1,
  "false_negatives": 2,
  "notes": "Some false positives when walking quickly. Overall working better than expected."
}
```

---

## Known Issues & Fixes

### Issue 1: False Positives While Walking
**Cause:** Rapid walking triggers accelerometer spikes  
**Fix:** Gyroscope confirmation filters these (rotation pattern different from bend)  
**Status:** Resolved in v1

### Issue 2: Misses Very Slow Pickups
**Cause:** Threshold of 1.5g too high for slow/careful movements  
**Fix:** Could lower to 1.2g but increases false positives  
**Current:** Accept 3-5% miss rate for cleaner gameplay

### Issue 3: Different Phones Have Different Sensors
**Cause:** Accelerometer sensitivity varies by phone model  
**Mitigation:** 
- Calibrate per device on first run (optional)
- Gyroscope confirmation reduces phone-specific variance
- Fallback to manual tap if motion fails

---

## Tuning Parameters (Week 2-4)

Based on field test results, adjust:

| Parameter | Current | Range | Notes |
|-----------|---------|-------|-------|
| Accel Threshold | 1.5g | 1.0-2.0g | Lower = more sensitivity, more false positives |
| Gyro Threshold | 0.5 rad/s | 0.2-1.0 | Confirmation sensitivity |
| Cooldown | 3s | 2-5s | Time between pickups |
| Spike Window | 500ms | 300-800ms | How long spike must last |

---

## Testing Protocol (Week 2-4)

**Each session:**
1. Find area with ~15-20 pieces of trash
2. Attempt 15 manual pickups
3. Log exactly: what app detected, what you actually picked
4. Vary: speed, clothing, ground type, phone position
5. Save raw sensor data to `data/motion-calibration/test_XXX.json`

**Weekly analysis:**
- Calculate accuracy % across all tests
- Identify patterns (jeans better than shorts? etc.)
- Adjust thresholds if accuracy <75%

---

## Success Criteria

- **Week 2:** 75%+ accuracy in field (15+ tests)
- **Week 3:** 80%+ accuracy (30+ tests)
- **Week 4:** 85%+ accuracy (50+ tests)
- **Beta (Week 5):** Real-world validation with 20+ users

---

## Fallback: Manual Tap

If motion detection reliability issues arise, app has manual tap button:
- User taps "+1" button on screen
- Score increments
- Still updates map + leaderboard
- Less sexy than motion, but fully functional

---

## Future Enhancements

- Per-device calibration (profile optimal thresholds on first run)
- Machine learning (train model on real pickup patterns)
- Combination with GPS (higher confidence in specific locations)
- Context awareness (time of day, phone orientation)
