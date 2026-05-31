# Cloud Functions Architecture

Backend logic for PICK. Handles scoring, leaderboards, zones, and achievements.

All functions run in Firebase Cloud Functions (Node.js runtime).

---

## Function Overview

| Function | Trigger | Purpose | Priority |
|----------|---------|---------|----------|
| `onPickupEvent` | User pickup detected | Validate + score + update zone | P0 |
| `onSessionEnd` | User ends cleanup session | Calculate final score, update stats | P0 |
| `updateLeaderboards` | Every 10 seconds (scheduled) | Recalculate rankings | P0 |
| `validateAchievement` | User hits milestone | Check if new badge earned | P1 |
| `updateZoneCleanliness` | Zone updated | Recalculate heat map color | P1 |
| `recordSession` | Session data received | Persist to Firestore | P0 |
| `calculateEnvironmentalImpact` | Session ends | Estimate weight/CO2 saved | P1 |
| `notifyStreakMilestone` | Streak updated | Send push notification | P2 |

---

## P0 Functions (Week 3-4)

### 1. onPickupEvent()

**Trigger:** User's phone sends pickup event (motion detected)

**Input:**
```javascript
{
  userId: string,
  sessionId: string,
  timestamp: number (ms),
  location: { latitude: number, longitude: number },
  confidence: number (0-100),
  moveType: string ("bend" | "tap")
}
```

**Logic:**
1. Validate pickup (confidence > 50%)
2. Find zone (geofence) from lat/lng
3. Calculate score:
   - Base: +1 point
   - Speed bonus: +0.5 if 2+ pickups in 30 sec
   - Zone bonus: +5 if completing a zone cleanup (50+ pickups)
   - Streak multiplier: +1% per day of active streak
4. Update user session (increment pickups_count, add points)
5. Update zone (increment cleanup_count, update last_cleaned_time)
6. Send back to user: { points_earned, zone_updated, new_combo? }

**Output:**
```javascript
{
  points_earned: number,
  zone_id: string,
  zone_cleanliness_new: number,
  combo_multiplier: number,
  success: boolean
}
```

**Firestore Updates:**
- `sessions/{sessionId}` — Add pickup to pickups_details
- `zones/{zoneId}` — Increment cleanup_count, update last_cleaned_time

---

### 2. onSessionEnd()

**Trigger:** User clicks "End Session" on phone

**Input:**
```javascript
{
  userId: string,
  sessionId: string,
  total_pickups: number,
  duration_seconds: number,
  final_points: number
}
```

**Logic:**
1. Finalize session record
2. Update user stats:
   - pickups_total += total_pickups
   - sessions_total += 1
   - streak_current += 1 (if last_pickup_date is today or yesterday)
   - last_pickup_date = today
3. Check if streak broken (if gap > 1 day):
   - Save streak_best = max(streak_best, streak_current)
   - Reset streak_current = 1
4. Validate and award achievements
5. Return summary to user

**Output:**
```javascript
{
  session_finalized: boolean,
  points_earned: number,
  streak_current: number,
  new_achievements: [string]
}
```

**Firestore Updates:**
- `sessions/{sessionId}` — Mark end_time, finalized: true
- `users/{userId}` — Update stats

---

### 3. updateLeaderboards()

**Trigger:** Scheduled function, runs every 10 seconds

**Logic:**
1. Query all active users this week
2. Sum points for each user
3. Sort by points descending
4. Write to leaderboard materialized views

**Firestore Updates:**
- `leaderboards/weekly/{week_id}` — { userId: points }
- `leaderboards/global/all-time` — { userId: lifetime_points }

---

### 4. recordSession()

**Trigger:** Phone uploads completed session data

**Logic:**
1. Validate session
2. Create Firestore document
3. Return confirmation

**Firestore Updates:**
- `sessions/{sessionId}` — Create new session document

---

## P1 Functions (Week 4-5)

### 5. validateAchievement()

**Trigger:** User milestone reached

**Logic:**
1. Check achievement rules (10 pickups = rookie, 100 = pro, etc.)
2. If earned and new: Add to achievements, send notification
3. Return badge info

**Firestore Updates:**
- `achievements/{userId}` — Add to earned_badges

---

### 6. updateZoneCleanliness()

**Trigger:** Zone receives pickup

**Logic:**
1. Calculate cleanliness score (0-100)
2. Set heat_level (red/yellow/green)
3. Broadcast zone update

**Firestore Updates:**
- `zones/{zoneId}` — Update cleanliness_score, heat_level

---

### 7. calculateEnvironmentalImpact()

**Trigger:** Session ends

**Logic:**
1. Estimate weight: pickups_count * 50g
2. Estimate CO2 saved: weight * 0.5kg CO2 per kg
3. Estimate trees: CO2 / 21kg per tree

**Firestore Updates:**
- `sessions/{sessionId}` — Add environmental_impact

---

## P2 Functions (Week 5+)

### 8. notifyStreakMilestone()

**Trigger:** User hits 7/30/100/365-day streak

**Logic:**
1. Check if milestone
2. Send push notification

---

## Deployment Order

**Week 3:**
1. onPickupEvent (core)
2. recordSession (core)
3. onSessionEnd (core)

**Week 4:**
4. updateLeaderboards (scheduled)
5. validateAchievement
6. updateZoneCleanliness

**Week 5:**
7. calculateEnvironmentalImpact
8. notifyStreakMilestone

---

## Testing Strategy

### Local Testing
```bash
firebase emulators:start
```

### Unit Tests
- Scoring logic (pickups, combos, streaks)
- Zone calculations
- Achievement validation

### Integration Tests
- End-to-end: user pickup → score → leaderboard update
- Streak logic across multiple days

### Load Testing (Week 5)
- Simulate 100 concurrent users
- 10,000 pickups/minute
- Monitor latency
