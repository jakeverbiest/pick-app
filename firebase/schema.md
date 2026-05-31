# Firebase Schema

Firestore collections and documents for PICK.

---

## Collections Overview

### users/
User profiles and stats.

```firestore
users/{userId}
  email: string
  username: string
  avatar_url: string (optional)
  created_at: timestamp
  updated_at: timestamp
  stats:
    pickups_total: number
    pickups_this_week: number
    pickups_this_month: number
    sessions_total: number
    streak_current: number (days)
    streak_best: number (days)
    last_pickup_date: timestamp
  preferences:
    notifications_enabled: boolean
    zone_radius_meters: number
```

### sessions/
Activity logs (cleanup sessions).

```firestore
sessions/{sessionId}
  user_id: string
  start_time: timestamp
  end_time: timestamp
  duration_seconds: number
  location:
    latitude: number
    longitude: number
  zone_id: string (which geofence)
  pickups_count: number
  pickups_details: [
    {
      timestamp: timestamp
      location: { lat, lng }
      confidence: number (0-100)
    }
  ]
  points_earned: number
  multiplier: number (streak bonus)
```

### zones/
Geofenced neighborhood areas.

```firestore
zones/{zoneId}
  name: string
  city: string
  bounds:
    lat_min: number
    lat_max: number
    lng_min: number
    lng_max: number
  center:
    latitude: number
    longitude: number
  cleanliness_score: number (0-100)
  last_cleaned_timestamp: timestamp
  last_cleaned_by: string (userId)
  cleanup_count_this_month: number
  heat_level: enum (red|yellow|green)
  cleanup_history:
    - timestamp: timestamp
      user_id: string
      pickups: number
    - (more entries...)
```

### leaderboards/
Competitive rankings. Updated every 10 seconds.

```firestore
leaderboards/weekly/{year}-week-{number}
  {userId}: number (points this week)
  created_at: timestamp
  resets_at: timestamp (next Monday)

leaderboards/global/all-time
  {userId}: number (lifetime points)
  updated_at: timestamp

leaderboards/zones/{zoneId}/monthly
  {userId}: number (pickups in zone)
  month: string (YYYY-MM)
  updated_at: timestamp
```

### achievements/
Earned badges and milestones.

```firestore
achievements/{userId}
  earned_badges: [
    {
      badge_id: string
      name: string
      earned_at: timestamp
      level: number
    }
  ]
  

Badge Types:
- pickup_rookie: 10 pickups total
- pickup_pro: 100 pickups total
- pickup_legend: 500 pickups total
- streak_warrior: 7-day streak
- streak_champion: 30-day streak
- zone_guardian: 50 pickups in one zone
- speed_demon: 30+ pickups in 30 min
- community_hero: invited 5 friends
- green_master: turned 10 zones green
```

---

## Indexes Required

For performance, create these Firestore indexes:

1. **leaderboards/weekly** — Query by points descending
2. **leaderboards/global** — Query by points descending
3. **sessions** — Query by user_id + start_time descending
4. **zones** — Query by city (future, for multi-city support)

---

## Security Rules (Week 2)

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
    
    // Sessions are write-only by owner, read-only by owner
    match /sessions/{sessionId} {
      allow create: if request.auth.uid != null;
      allow read: if request.auth.uid == resource.data.user_id;
    }
    
    // Zones are read-only for all users
    match /zones/{zoneId} {
      allow read: if request.auth.uid != null;
      allow write: if false; // Admin only
    }
    
    // Leaderboards are read-only
    match /leaderboards/{document=**} {
      allow read: if request.auth.uid != null;
      allow write: if false; // Cloud Functions only
    }
    
    // Achievements are read-only by owner
    match /achievements/{userId} {
      allow read: if request.auth.uid == userId;
      allow write: if false; // Cloud Functions only
    }
  }
}
```

---

## Real-time Listeners (Frontend)

The app will listen to:
1. **Current user profile** — Update stats in real-time
2. **Nearby zones** — Show zones within 1km
3. **Weekly leaderboard** — Update as points change
4. **Current session** — Update score as pickups come in

---

## Cloud Functions (Week 3)

Triggered automatically:

1. **onSessionEnd()** — Calculate final score, update user stats
2. **onPickupEvent()** — Validate pickup, update zone, add points
3. **updateLeaderboards()** — Runs every 10s, recalculates all rankings
4. **validateAchievement()** — Check if user earned new badge
5. **updateZoneCleanliness()** — Recalculate zone heat map

---

## Estimated Costs (Year 1)

- **Storage:** 1GB free tier covers 500k+ sessions
- **Reads:** 50k reads/day = free tier
- **Writes:** 10k writes/day = free tier
- **Functions:** 2M monthly invocations = free tier

**Total:** $0 until we hit 100k+ daily active users
