# PICK Aggregation Flow Testing Guide

## Overview

This guide walks through testing the privacy-safe data aggregation pipeline without needing to set up Firebase yet. The goal is to verify:

1. **Zone mapping**: GPS coordinates → zone IDs
2. **Aggregation logic**: Multiple pickups → counted by zone + hour
3. **Data privacy**: Raw coordinates never stored, only aggregated metrics
4. **UI display**: Aggregated zone statistics shown (no raw data)

---

## Test Plan

### Phase 1: Unit Tests (Automated)

**Button**: 🧪 Test Aggregation

This runs 7 automated tests validating the entire aggregation pipeline:

1. **Zone Mapping** - GPS to zone ID conversion
2. **Single Pickup** - One pickup aggregates correctly
3. **Multiple Same Zone** - Multiple pickups in same zone count correctly
4. **Multiple Zones** - Pickups split into separate aggregates per zone
5. **Ephemeral Session ID** - New session ID on reset
6. **Buffer Clearance** - Raw data deleted after generateAggregates()
7. **Hourly Bucketing** - Pickups in different hours create separate aggregates

**Expected Result**: All 7 tests pass ✅

Check console logs: `console.log()` outputs show detailed test flow.

---

### Phase 2: Manual Simulation (Single Zone)

**Buttons**: LES, EV, MT, UES (in yellow "Simulate Pickups" section)

Each button simulates 1 pickup in a specific NYC zone:

- **LES** = Lower East Side (40.6750, -73.9850)
- **EV** = East Village (40.7050, -73.9850)
- **MT** = Midtown (40.7480, -73.9750)
- **UES** = Upper East Side (40.7850, -73.9550)

**Test Sequence**:

1. Tap **Reset** to start fresh
2. Tap **LES** button 3 times
3. Look at "Pickups by Zone (Privacy-Safe)" box

**Expected Result**:
```
lower east side    3
```

Only zone name and count shown. No coordinates. No timestamps.

---

### Phase 3: Manual Simulation (Multiple Zones)

**Test Sequence**:

1. Tap **Reset** to start fresh
2. Tap **LES** button 2 times
3. Tap **EV** button 3 times
4. Tap **MT** button 1 time
5. Look at aggregates box

**Expected Result**:
```
lower east side    2
east village       3
midtown            1
```

Each zone aggregates independently. Totals are correct.

---

### Phase 4: Full Route Simulation

**Button**: 🗺️ Simulate Full Route

Simulates a complete collection route with realistic spacing:

- 3 pickups in Lower East Side
- 4 pickups in East Village
- 2 pickups in Midtown
- 3 pickups in Upper East Side

**Total**: 12 simulated pickups across 4 zones

**Test Sequence**:

1. Tap **Reset** to start fresh
2. Tap **Simulate Full Route**
3. Watch console logs as pickups are simulated (300ms between each)
4. Wait for "✨ Route simulation complete" message
5. Look at aggregates box

**Expected Result**:
```
lower east side    3
east village       4
midtown            2
upper east side    3
```

---

## What You're Validating

### Privacy Architecture ✅

- ✅ GPS coordinates passed to aggregator but never stored
- ✅ Only zone_id extracted from coordinates
- ✅ Hour bucket computed from timestamp
- ✅ Only aggregates leave the device
- ✅ Raw data deleted after `clearBuffer()`

### Data Flow

```
GPS Coordinates
    ↓ (passed to aggregator)
Zone Extraction (ZoneManager.getZoneFromCoordinates)
    ↓
Hour Bucketing (ISO hour format)
    ↓
Aggregation (count by zone + hour)
    ↓
generateAggregates() → Ready for Firebase
```

Raw coordinates never exist in aggregated output.

### Session Management

- Each app restart generates new `session_id`
- Session ID is ephemeral (random, non-persistent)
- Firebase receives: `{session_id, zone_id, pickups_count, hour_bucket, ...}`

---

## Console Log Markers

Watch console.log output for these markers:

- 🧪 Test start
- ✅ Test pass
- ❌ Test fail
- 📊 Aggregation event
- ✅ Pickup event
- ✨ Route simulation complete

---

## Next Steps After Testing

Once all tests pass and manual simulations work correctly:

1. **Set up Firebase project** (Firestore)
2. **Configure firebaseSync.ts** with real credentials
3. **Uncomment Firebase writes** in firebaseSync.ts
4. **Test end-to-end**: Simulate pickups → Check Firebase console

At that point, the privacy-safe data pipeline is production-ready.

---

## Troubleshooting

### "Zone: null" message

This means the simulated coordinates are outside defined zone bounds. Check:
- Coordinate in ZONE_COORDINATES array matches zone bounds in ZoneManager
- E.g., Lower East Side: lat 40.6725-40.6820, lon -73.9950 to -73.9750

### No aggregates appearing

1. Run **Test Aggregation** to verify pipeline works
2. Check console for errors
3. Tap **Reset** and try again
4. Verify PickupAggregator state: tap a simulation button and check console logs

### Tests failing

1. Open browser console (if available)
2. Check for error messages
3. Verify zone coordinates in ZoneManager match ZONE_COORDINATES
4. Ensure pickupAggregator.ts timestamps match hour bucketing logic

---

## Privacy Checklist

Before deploying to Firebase:

- [ ] Zone mapping verified (GPS → zone_id, no raw coordinates stored)
- [ ] Aggregation logic verified (counting works, multiple zones split correctly)
- [ ] Session ID verified (ephemeral, new each app restart)
- [ ] Buffer cleared after generateAggregates()
- [ ] Hour bucketing verified (ISO format, correct hour rounding)
- [ ] No raw coordinates in aggregate output
- [ ] Firebase will only receive: session_id, zone_id, pickups_count, hour_bucket

Once all boxes checked, privacy architecture is sound.
