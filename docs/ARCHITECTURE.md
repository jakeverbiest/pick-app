# System Architecture

## Overview

PICK is a mobile-first environmental wellness app with optional Ray-Ban Display integration. The architecture prioritizes:
- Real-time map updates (zones turning green)
- Leaderboard calculations (competitive streaks)
- Motion detection (local on device)
- Scalability (Firebase handles 100k+ users free)

---

## Components

### 1. React Native Companion App (Frontend)

**Platform:** iOS + Android via Expo  
**Language:** JavaScript/TypeScript  
**Key Features:**
- Motion detection via accelerometer/gyroscope
- Real-time score counter
- Session tracking (GPS location, pickup count)
- Leaderboard display (weekly, friends, global)
- Achievements/badges
- Environmental impact stats

**Screens:**
1. Onboarding (signup)
2. Active Cleanup (motion detection, score counter)
3. Session Results (summary, stats save)
4. Stats Dashboard (profile, streak, leaderboard)
5. Map View (neighborhood zones, heat map)

### 2. Firebase Backend

**Firestore Database:**
- Users (profiles, stats, streaks)
- Sessions (activity logs, scores, locations)
- Zones (geofenced areas, cleanliness scores, last cleaned)
- Leaderboards (weekly, global, zone-specific)
- Achievements (earned badges)

**Cloud Functions (Node.js):**
- Validate pickup events
- Calculate score multipliers
- Update zone cleanliness scores
- Recalculate leaderboards every 10 seconds
- Achievement validation
- Push notifications (future)

**Authentication:**
- Email/password
- Google OAuth (future)
- Apple Sign-In (future)

### 3. Ray-Ban Display Integration (Optional Premium)

**Available Weeks 11-12:**
- In-lens map overlay (heat map)
- Real-time score display
- Combo notifications ("TRIPLE COMBO!")
- Hands-free touchpad interaction
- Streaming integration for creators

---

## Data Flow

```
User bends down to pick up trash
  ↓
Phone detects motion (accel spike + gyro confirmation)
  ↓
App sends pickup event to Firebase in real-time
  ↓
Cloud Function validates + calculates score
  ↓
Zone cleanliness score updates
  ↓
Leaderboard recalculates
  ↓
App displays new score + visual feedback (haptic)
  ↓
All users see neighborhood map update (zones turning green)
```

---

## Database Schema

### users/
```
{userId}/
  - email: string
  - username: string
  - avatar_url: string
  - created_at: timestamp
  - stats:
      pickups_total: number
      streak_current: number
      streak_best: number
      sessions_total: number
```

### sessions/
```
{sessionId}/
  - user_id: string
  - start_time: timestamp
  - end_time: timestamp
  - location: { lat, lng }
  - pickups_count: number
  - zone_id: string
  - points_earned: number
  - duration_minutes: number
```

### zones/
```
{zoneId}/
  - name: string
  - bounds: { lat_min, lat_max, lng_min, lng_max }
  - cleanliness_score: number (0-100)
  - last_cleaned_time: timestamp
  - cleanup_history: [{ timestamp, user_id, pickups }]
```

### leaderboards/
```
weekly/
  - {userId}: points (resets Monday)
global/
  - {userId}: points (all-time)
zones/{zoneId}/
  - {userId}: pickups_count
```

### achievements/
```
{userId}/
  - earned_badges: [badge_id]
  - timestamps: { badge_id: earned_at }
```

---

## Key Design Decisions

1. **Firestore over SQL** — NoSQL scales easier, real-time updates built-in
2. **Leaderboards materialized every 10s** — Fast reads, delayed writes acceptable
3. **Motion detection on device** — No battery drain, instant feedback, privacy-first
4. **Zones as geofences** — Simple geometry, easy to scale, clear visualization
5. **Habit-first design** — Streaks + leaderboards > data collection

---

## Scaling Considerations

- **Concurrent users:** Firebase free tier handles 100k+ simultaneously
- **Map updates:** Real-time sync via Firestore listeners
- **Leaderboard queries:** Indexed on user_id + points for speed
- **Storage:** 1GB free tier covers 500k+ sessions initially

---

## Future Integrations

- Push notifications (Firebase Cloud Messaging)
- Analytics (Firebase Analytics)
- A/B testing (Firebase Remote Config)
- Web dashboard (Firebase Hosting + React)
- API for city/nonprofit partners
