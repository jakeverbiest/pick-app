# Pick — Pre-Launch QA Test Plan

Device-first checklist for the structured pass. Work top to bottom; **P0 = launch-blocker**, **P1 = should fix before launch**, **P2 = nice to have**. Note anything off in the "Issues found" log at the bottom.

Test device: __________________  ·  iOS version: ______  ·  Build/date: ______

---

## 1. First run & onboarding
- [ ] **P0** Fresh install launches to branded splash → login (no white flash, no emoji).
- [ ] **P1** First-run safety briefing appears before the map, and only once.
- [ ] **P1** Safety briefing can't be skipped without acknowledging.

## 2. Auth & account  *(P0 — gates the store)*
- [ ] **P0** Sign up with a new email works; lands in the app.
- [ ] **P0** Log out, then log back in with the same credentials.
- [ ] **P0** **Session persists**: force-quit the app and reopen — still logged in (no kick to login). *(This was the June 3 bug — verify carefully.)*
- [ ] **P0** Wrong password / unknown email shows a clear error, not a crash.
- [ ] **P1** Password reset email sends and arrives.
- [ ] **P0** **Delete account** (You → Advanced/Danger) removes the account and data, returns to signup. *(App Store requires this.)*
- [ ] **P1** A second account only sees its own cleanups/stats (per-user isolation).

## 3. Core cleanup flow  *(P0)*
- [ ] **P0** "Start cleanup" begins a session; live stats bar shows time / pickups / weight.
- [ ] **P0** Bending to pick up is detected and increments the count (test ~10 real pickups).
- [ ] **P1** Pickup count is reasonably accurate (note false positives/negatives).
- [ ] **P0** "Stop & save" ends the session and opens the summary.
- [ ] **P1** Summary lets you adjust item count and add a photo; saved values persist.
- [ ] **P0** Saved cleanup appears in history/activity with correct stats.

## 4. Map
- [ ] **P1** Map opens at the new zoomed-out level (neighborhood, not street).
- [ ] **P1** "Leaflet | OpenStreetMap" attribution sits at the bottom; zoom slider and Start button positioned well (note if any overlap or feel off — screenshot it).
- [ ] **P1** Your location dot is accurate; map recenters on real movement only.
- [ ] **P1** Active route draws as a green corridor; pickup pins drop at the right spots.
- [ ] **P2** Past cleanups render as freshness-colored routes.

## 5. Background & long-walk resilience  *(P0 — Pick's biggest risk)*
- [ ] **P0** Start a cleanup, **lock the screen, walk 20–30+ min**, return — session still running, route intact, no crash.
- [ ] **P0** After a long walk, stop & save — data is complete (no truncation).
- [ ] **P1** If a crash/force-quit happens mid-walk, a black-box trace appears in You → Advanced → Diagnostics.
- [ ] **P0** **Phantom tracker check**: after a cleanup ends, the iOS location arrow turns OFF (not left running).
- [ ] **P1** "Force-stop background tracking" clears a stuck location arrow.

## 6. Teams & leaderboard
- [ ] **P0** Create a new team — it appears in the directory.
- [ ] **P0** Join an existing team; "Joined" shows; leave returns you to solo.
- [ ] **P1** After a cleanup on a team, the **Leaderboard** updates for that team (give the Cloud Function a few seconds).
- [ ] **P1** Leaderboard sort toggles (pickups / weight / days) re-rank correctly.
- [ ] **P1** "Your team is #N" reflects your actual rank.

## 7. You / settings
- [ ] **P1** Edit display name and neighborhood; Save persists across reloads.
- [ ] **P1** Units (lb/kg, mi/km) toggle and stick.
- [ ] **P1** Fitness apps show as clean toggle buttons (no emoji), enable/disable in Edit mode.
- [ ] **P1** "Show advanced settings" reveals Weight Calibration, Carry Mode, Diagnostics, Developer; collapsed by default.
- [ ] **P2** Manual weigh-in updates the calibration factor.
- [ ] **P1** Privacy Policy and Terms open and are readable.

## 8. Fitness / Health sync
- [ ] **P1** With Apple Health enabled, a saved cleanup logs a walking workout in the Health app.
- [ ] **P1** Workout duration/distance roughly match the cleanup; no duplicate entries.
- [ ] **P2** Toggling Health sync off stops new workouts being written.

## 9. Impact, badges, activity
- [ ] **P1** Impact/activity totals update after a cleanup (items, weight, streak).
- [ ] **P1** Badges auto-award at the right milestones.
- [ ] **P2** Streak logic is correct across day boundaries.

## 10. Data, offline & sync
- [ ] **P1** Turn on Airplane Mode, do a cleanup, save — it stores locally and syncs when back online.
- [ ] **P1** Cleanups survive an app restart and reinstall-after-login.

## 11. Permissions & privacy  *(P0)*
- [ ] **P0** Location permission prompt appears with a clear purpose string; "While Using" works.
- [ ] **P0** Motion & Fitness permission prompt appears and detection works after granting.
- [ ] **P1** Denying a permission degrades gracefully (clear message, no crash).
- [ ] **P1** No precise location/route data is exposed to other users.

## 12. Performance & battery
- [ ] **P1** A 30-min cleanup doesn't drain an alarming amount of battery (note % used).
- [ ] **P1** App stays responsive during a long session (no jank/freezes).
- [ ] **P2** Memory stays stable on long walks (no growth → crash).

## 13. Store readiness
- [ ] **P1** New leaf icon shows on the home screen; splash matches.
- [ ] **P0** App name, version, and build number are correct.
- [ ] **P1** No placeholder text, debug logs, or "Developer" tools visible to normal users.

---

## Issues found
| # | Area | What happened | Severity | Repro steps |
|---|------|---------------|----------|-------------|
| 1 |      |               |          |             |
| 2 |      |               |          |             |
| 3 |      |               |          |             |

---
*After this pass, fix P0s first, then P1s. P2s can ship as fast-follows.*
