# PICK Data Privacy & Architecture

## Principles
1. **Minimize collection** — only what's necessary for the app to function
2. **Aggregate on server** — never store individual location points
3. **User owns their data** — can view, control, delete
4. **Automatic destruction** — old data is deleted per policy
5. **No third-party sharing** — data stays in-house

---

## What Gets Collected

### ON-DEVICE (Never Leaves Phone)
```
- Raw GPS coordinates (lat/lon)
- Accelerometer/gyroscope values
- Session ID (random, ephemeral)
```
**Lifetime:** Deleted after upload to server (15 min) or 24 hours max if no network.

### SENT TO SERVER (Anonymized, Aggregated)
```json
{
  "session_id": "uuid-v4-random",
  "zone_id": "manhattan-lower-east-side",
  "pickups_count": 3,
  "hour_bucket": "2026-05-31T14:00:00Z",
  "app_version": "1.0.0",
  "device_type": "iOS",
  "user_id": null  // Only if user explicitly created account
}
```

**NOT sent:**
- Exact latitude/longitude
- Individual pickup timestamps
- Device identifiers (IDFA, serial, MAC)
- Movement history
- Personal information

---

## Backend Storage & Retention

### Aggregated Metrics Table
```
zone_id          | hour_bucket         | pickup_count | device_count
lower_east_side  | 2026-05-31T14:00Z   | 12           | 4
lower_east_side  | 2026-05-31T15:00Z   | 8            | 3
```

### Retention Policy
- **Raw session data:** Deleted after 7 days
- **Hourly aggregates:** Kept for 90 days
- **Daily rollups:** Kept for 1 year
- **Heatmap tiles:** Computed on-demand from aggregates, never stored raw

### No User Tracking Across Sessions
- Session IDs are random and ephemeral
- No correlation between pickups unless user creates account
- If user creates account, they're explicitly opting in to linked stats

---

## Optional: User Accounts (Leaderboards, Stats)

If user signs up for an account:
```json
{
  "user_id": "user-uuid",
  "email": "encrypted",
  "total_pickups": 247,
  "zones_contributed": ["lower_east_side", "midtown"],
  "account_created": "2026-05-31"
}
```

**Not stored:**
- Individual pickup locations (even with account)
- Detailed timestamp history
- Routes or movement patterns

**User can:**
- View aggregated stats only
- Delete account → anonymize all data
- Download all data they generated
- Opt out of leaderboards

---

## Heatmap Generation (Privacy-Safe)

Heatmaps are computed server-side from aggregates, NOT stored:

```
Input: aggregated hourly data per zone
Output: heatmap tiles showing pickup density per zone
Process: 
  1. Group pickups by zone (already aggregated)
  2. Compute density (pickups/area/time)
  3. Generate map tiles on-demand
  4. Cache for 24 hours
  5. Never store individual locations
```

Result: Users see "hot zones" without any privacy leak.

---

## Data Deletion & User Control

**User can request:**
- View all data collected (zip file)
- Delete all sessions (anonymizes in 7 days)
- Delete account (instant)

**Automatic cleanup:**
- Unused sessions: deleted after 7 days
- Old hourly buckets: deleted after 90 days
- Old daily rollups: deleted after 1 year

---

## Compliance Checklist

- [ ] Privacy policy (explain aggregation, retention, deletion)
- [ ] GDPR: Users can request/delete data
- [ ] CCPA: California residents can opt-out
- [ ] No PII stored (email only if opted-in)
- [ ] Encryption in transit (HTTPS/TLS)
- [ ] Encryption at rest (database encryption)
- [ ] No third-party trackers/analytics (build your own)
- [ ] Terms of service (clear data use)

---

## Implementation Order

1. **Week 2:** App sends aggregated zone data only (no raw coords)
2. **Week 3:** Build backend aggregation + retention policy
3. **Week 3-4:** Add optional user accounts (still no raw location storage)
4. **Week 4-5:** Heatmap tiles computed from aggregates
5. **Week 5+:** Data deletion UI + privacy dashboard for users

---

## Firebase Schema (Privacy-First)

```
/analytics/sessions/{session_id}
  └─ zone_id: "lower_east_side"
  └─ pickups_count: 3
  └─ hour_bucket: "2026-05-31T14:00Z"
  └─ created: timestamp
  └─ ttl: 604800  // 7 days

/aggregates/hourly/{zone_id}/{hour_bucket}
  └─ total_pickups: 47
  └─ session_count: 12
  └─ confidence_avg: 0.85

/users/{user_id}  // Only if account created
  └─ email: encrypted
  └─ total_pickups: 247
  └─ zones: ["lower_east_side", "midtown"]
  └─ created: timestamp
  └─ data_sharing_consent: true/false
```

**Key:** Sessions auto-delete, aggregates stay, no raw locations ever.
