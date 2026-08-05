# Sprint Log

> **⚠️ SUPERSEDED (as of 2026-08-03).** Abandoned after Week 3 (mid-June 2026) — `docs/PROJECT_TIMELINE.md` in the other connected repo (`~/pick-app/docs/PROJECT_TIMELINE.md`) took over as the running log shortly after and has been kept current since. Left below for historical reference only.

Weekly progress, learnings, and metrics. Updated every Friday.

---

## Week 1 (June 2-6, 2026)

### ✅ Completed
- [ ] Ordered Ray-Ban Meta Display
- [ ] Installed dev environment (Node v24, React Native, Expo)
- [ ] Created GitHub repo structure
- [ ] Set up Firebase project (Firestore, Auth, Cloud Functions)
- [ ] Initialized React Native/Expo app (pick-app)
- [ ] Created documentation structure (DECISIONS.md, this file, etc.)
- [ ] Ran motion detection prototype (locally)
- [ ] Field tested motion detection (5+ real pickups)

### 🔧 Work in Progress
- Motion detection algorithm tuning
- Firebase schema finalization
- React Native UI components

### 📊 Metrics (Target)
- Motion detection accuracy: 80%+
- Field test samples: 50+
- Code lines: 500+ (boilerplate)
- Bugs found: <5 critical

### 🚫 Blockers
- None yet. Ray-Ban in transit.

### 📚 Learnings
- [To be filled in Friday]

### 🎯 Next Week
- Week 2: Refine motion detection, start Firebase integration
- Week 3: Build app UI (signup, cleanup screen, results)
- Week 4: Map foundation + leaderboards

### Commits This Week
- [SETUP] Initial project structure
- [MOTION] Motion detection v1 prototype
- [DOCS] Initial documentation

---

## Week 2 (June 9-15, 2026)

### ✅ Completed (so far)
- [x] Weight Calibration system (Task #22) — learns lb/pickup from scale weigh-ins, replaces 0.05 hardcode; Settings calibration card
- [x] Draft Privacy Policy + Terms of Service (`/legal/`) — app-store blockers, pending lawyer review
- [x] CONTEXT.md brought current (was stale at May 31)
- [x] Fixed duplicate style prop bug in settings.tsx Danger Zone

### 🔧 Work in Progress
- False positive reduction (needs field data from calibrated walks)
- Task #20 remainder: visual design pass

### 🎯 Next
- First calibrated walk: weigh haul, enter scale weight, confirm factor updates
- 2-3 more weigh-ins to activate calibration (replaces default at 2 samples)
- App store prep checklist

---

## Week 3 (June 16-22, 2026)

TBD
