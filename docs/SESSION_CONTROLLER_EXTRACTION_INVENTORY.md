# Session controller extraction — slice 1 inventory

_2026-09-20. Baseline: `main` at `396214e`, `apps/companion/app/(tabs)/map.tsx` at 5,540 lines. Companion to `docs/CLEANUP_SESSION_ARCHITECTURE.md` (the spec, approved 2026-09-13; its gate closed 2026-09-16 when detector accuracy was accepted as the launch baseline). Detector behavior is frozen throughout this work._

**What slice 1 is:** this inventory plus a pure, fully tested controller under `apps/companion/src/cleanup-session/` that is imported by nothing. Zero production behavior change. `map.tsx`, `motionDetection.ts`, `motionEvaluation.ts`, `backgroundSession.ts` and everything under `app/` are untouched.

**How to read the line numbers:** every reference is to `map.tsx` at `396214e` unless another file is named. They will drift the moment `map.tsx` is edited; re-derive with `grep -n` rather than trusting them after the next commit to that file.

Counts at this baseline, by method so they can be re-run: `grep -cE '= useState[<(]'` → 69 state declarations; `grep -cE '= useRef[<(]'` → 41 refs; `grep -cE '^\s*useEffect\('` → 26 effects; `grep -c 'setInterval('` → 4 intervals (3 session-related, 1 stepper UI). The 2026-09-13 audit quoted 41/17/25 at 5,396 lines with an unstated method; the stepper, remount-recovery and diagnostics work since then account for part of the gap, the counting method for the rest.

---

## A. What the controller owns (moves out of Map)

### A1. State and refs

| map.tsx | Declaration | Controller equivalent | Notes |
|---|---|---|---|
| 82 | `pickupCount` (state) | `snapshot.pickupCount` | The raw detector count, saved as `items_detected` (:2288). |
| 83 | `isListening` (state) | `status ∈ {active, backgroundActive}` | Also the button gate (:3809) and the only re-entry guard besides `startingRef`. |
| 84 | `elapsedSeconds` (state) | `snapshot.elapsedSeconds` | Derived from the wall-clock anchor on every publish. |
| 85 | `timerRef` (interval) | the controller's single ticker | Set at :1269, 1 Hz. |
| 86 | `locationRef` (interval) | ticker + `locationIntervalMs` | Set at :1277, 5 s / 10 s by `batterySaver`. |
| 91 | `sessionStartRef` | `elapsedAnchor` | Set at :1268 when `isListening` flips true, i.e. after sensors attach, not at the tap. Preserved. |
| 104 | `sessionMode` (state) | `snapshot.mode` | |
| 105 | `startingRef` | `status === 'starting'` + `startInFlight` | |
| 272 | `sessionRoute` (state) | `snapshot.route` via `RouteRecorder` | |
| 277 | `pickupLocations` (state) | `snapshot.pickupLocations` | |
| 278 / 298 | `currentLocation` (state) / `currentLocationRef` | `snapshot.lastFix` — session-time only | The idle-time use (map centering, :568-575) stays in Map. |
| 283 | `pickupCounterRef` | folded into `pickupCount` | Today two counters track the same number (:1722-1723); the ref feeds the heartbeat (:1506) and `commitSessionPickups` (:2051). |
| 295 / 297 | `sessionModeRef` / `sessionModeFailureRef` | `snapshot.mode` / `snapshot.modeFailure` | The ref exists because state is nulled when `isListening` drops (:485-487) before Save reads it. The controller keeps the value through `summary`. |
| 300 / 301 | `lastPickupTimeRef` / `highFrequencyEndRef` | dropped | Only feed a console-log label (:1493-1499); "HIGH-FREQ GPS" never changes any interval. |
| 306 / 307 | `lastFixRef` / `jumpRejectsRef` | `RouteRecorder` | |
| 390 / 397 | `walkIntent` / `walkIntentChecked` (state) | `status !== 'idle'` / mount-time recovery in the hook | The watch bridge's "active from the tap" semantics (:2094-2096) map to `starting`. |
| 398 | `watchSessionRef` | `snapshot.sessionId` | Same `w<ms>` format, now strictly increasing. |
| 1028 | `lastAutosaveRef` | autosave throttle | |

Stays in Map even though it is session-adjacent: `tooFast` (:281, derivable from `snapshot.lastFix.speed` — :1398 mirrors the detector's 3.3 m/s gate), `groundTruthRef` (:286, watch LOG PICK marks; a candidate for a later `recordGroundTruthMark()` intake), `motionTestStatus` (:287, a UI string), `batterySaver` (:282, a Map preference passed to the controller as `locationIntervalMs`), the module-level `screenRemountsThisWalk` (:54-68, :2364 — instrumentation about the *screen*, still meaningful after extraction).

### A2. Effects

| map.tsx | Effect | Disposition |
|---|---|---|
| 289 | `recordMotionDiagnostic('visibleCount')` on `pickupCount` change | controller `recordDiagnostic('visibleCount')` at activation, each pickup, restore, and after the stop-trim. |
| 418-441 | `walkIntent` remount recovery: `isSessionActiveFresh() && isBackgroundLocationTaskRunning()` → `loadWalkDraft()` → `resumeWalkAfterRemount()` | Becomes a provider-level launch/mount decision that calls `restore()` then `resume()`. The decision inputs (`isSessionActiveFresh`, `isRunning`) stay as ports. |
| 443-449 | `AppState` listener | `CleanupSessionProvider` → `reportAppState()`. |
| 479-491 | keep-awake while `isListening && sessionMode === 'foreground'` | Stays in the view layer, reading `status`/`mode`. Device policy, not lifecycle. |
| 1015-1024 | `subscribeToWalkRestore` → apply the launch-time draft and open the summary | `restore(draft)` → `confirmEnd()` (recoverable → finalizing → summary). |
| 1029-1042 | autosave, throttled to 20 s, on any of five deps | `autosave()` on tick / pickup / location, forced on activation. |
| 1262-1310 | the `isListening` effect: elapsed timer (1264-1271), location interval (1273-1279), presence (1281-1284), Live Activity (1286-1293), teardown (1294-1309) | Timer and location interval → controller. Presence and Live Activity stay in Map (social / OS card), driven by `status`. |
| 1312-1318 | unmount cleanup: `if (isListening) MotionDetector.stopListening()` | **Latent bug, documented not fixed** — see D2. Deleted in slice 3; the controller outlives the screen. |
| 2028-2054 | challenge `liveEvent` on `isListening`; commits `pickupCounterRef` on end | Stays in Map, reads `snapshot.pickupCount`. |
| 2057-2062 | `reportSessionPickups` on count change | Stays in Map. |
| 2064-2086 | watch commands → `startCleanup` / `finishCleanup` / ground-truth mark | Stays in Map; calls `controller.start()` / `confirmEnd()` from slice 3. |
| 2088-2155 | watch stats push + Live Activity update | Stays in Map, reads the snapshot. |

### A3. Functions

| map.tsx | Function | Controller equivalent |
|---|---|---|
| 1365-1539 | `trackLocation()` — session part: reuse the detector's fix (:1373-1381), accuracy gate (:1404, :1421-1425), background drain (:1414-1419), sort + jump gate (:1429-1488), heartbeat (:1504-1508) | `pollLocationOnce()` + `RouteRecorder.ingest()` + `persistence.heartbeat`. The idle part (:1382-1394 map centering) and the per-fix Firestore write `db.addLocationPoint` (:1534-1535) stay in Map — see F3. |
| 1715-1784 | `attachWalkListeners()` | `attachDetector()`. The "sensors did not start" Alert (:1778-1782) becomes `health.detector = notAttached`; the view shows it. |
| 1800-1819 | `resumeWalkAfterRemount()` | `restore()` + `resume()`. |
| 1821-1918 | `startCleanup()` | `start()`. Alerts stay in the view: the permission explainer (:1843 → :1326-1352, runs *before* `start()`), the foreground-only warning (:1881-1887, driven by `mode === 'foreground'`), "Could not start" (:1914, driven by `status === 'failed'`). |
| 1940-1950 | `stopCleanup()` (the confirm) | `requestEnd()` returns the preview; the Alert stays in Map. |
| 1952-1998 | `finishCleanup()` | `confirmEnd()`. Summary-sheet state resets (:1966-1975) stay in Map. |
| 1053-1076 | `finishSession()` | `dismissSummary('saved')` + Map's own map-reset code (:1063-1075). |
| 2166-2446 | `saveSummary()` | **Stays in Map** — the cleanup document write (:2278-2365), geocoding, challenge refresh, Health sync, auto-posting. Consumes `SessionResult`; calls `dismissSummary('saved')` where `clearWalkDraft()` is today (:2391) and `dismissSummary('discarded')` at :2181 / :4147. |
| 2455-2476 | `calculateCoverage()` | `RouteRecorder.distanceMeters()` — same planar formula, so `distance_m` (:2308) stays byte-identical. |

### A4. The Stop → confirm → correct → "Save & log" flow, end to end

1. Stop button (:3818-3824) → `stopCleanup()` Alert (:1940-1950) → `finishCleanup()` (:1952). Controller: `requestEnd()` → view Alert → `confirmEnd()`.
2. `finishCleanup()` order: `setWalkIntent(false)` → `stopBackgroundSession()` (:1955, not awaited) → `endSessionTrace()` (:1957) → `MotionDetector.stopListening()` (:1958) → `trimRecentPickups(6000)` (:1961) → `cleanupEnd` diagnostic (:1962) → `stopMotionDiagnostics()` (:1963) → `setPickupCount(correctedCount)` (:1964) → `setIsListening(false)` (:1965) → sheet state resets → save-first draft (:1981-1988). Controller `runEnd()` keeps this order, minus the UI resets.
3. Summary sheet (:3928-4166): stepper corrections write `userCount` (:151, :165-168), bag report, photo. "Save & log" (:4130-4132) → `saveSummary()` (:2166); "Discard walk" (:4133-4162) → `clearWalkDraft()` (:4147). The too-short guard (:2167, `elapsed < 60 && pickupCount === 0`) fires at save time, not at stop; the controller reports it as `tooShortToCount` and enforces nothing.
4. `saveSummary()` → `db.addCleanup` (:2278) → `clearWalkDraft()` only after success (:2391) → `finishSession()` (:2204 or via the results modal).

---

## B. What stays in Map (the spec's "must not own" list, with lines)

WebView + MapLibre HTML and bridge (:3057-3795, `handleMapMessage` :1231-1252, every `injectJavaScript`); coverage, parks, tiles (:596-656), neighborhoods and level mode (:761-1005, :1167-1207); city search (:2600-2671, :3828-3856); recenter/zoom (:2673-2718); Need and Impact overlays (:1088-1165); adopt-a-block (:2720-2758); presence (:1283-1284, :1298, :1306); Live Activity (:1288-1293, :1299, :1307, :2146-2153); the watch bridge (:2004-2155); challenge live totals (:2021-2062); photo, community and Bluesky posting (:110-133, :1652-1705, :2417-2442); the summary sheet, stepper and bag report (:137-253, :3928-4166); the results modal (:4168-4349); `saveSummary()` (:2166-2446); keep-awake (:461-491); user stats/settings (:1621-1650); visual route decimation (`simplifyRoute` at :1513, the WebView redraw at :1511-1529).

---

## C. Dependency edges — which service each session concern touches

| Service | map.tsx call sites | Controller port |
|---|---|---|
| `MotionDetector` (motionDetection.ts) | `stopListening` :1315, :1719, :1958 · `startListening` :1720 · `isActive` :1373, :1398 · `getLastLocation` :1374, :1738 · `getSessionEvents` :1507, :2218, :2342, :2493, :2566 · `sensorsAttached` :1777 · `trimRecentPickups` :1961 · `getCarryMode` :2230 | `DetectorPort`. The post-Stop data reads for the cleanup document (:2218, :2230, :2342) stay in the save flow — reads, not lifecycle. |
| `PickupAggregator` | `resetSession` :1857 | `DetectorPort.resetSession?` |
| backgroundSession.ts | `startBackgroundSession` :1872 · `stopBackgroundSession` :1955 · `drainBackgroundLocations` :1415 · `isBackgroundLocationTaskRunning` :420 | `BackgroundSessionPort` |
| crashRecorder.ts | `beginSessionTrace` :1865 · `heartbeat` :1504 · `endSessionTrace` :1957 · `isSessionActiveFresh` :420 | `PersistencePort.beginTrace/heartbeat/endTrace`; `isSessionActiveFresh` stays a recovery-decision input. |
| sessionRecovery.ts | `saveWalkDraft` :1034, :1981 · `loadWalkDraft` :433 · `clearWalkDraft` :1055, :2181, :2391, :4147 · `subscribeToWalkRestore` :1016 (and `handOffWalkRestore` from app/_layout.tsx:95) | `PersistencePort.saveDraft/loadDraft/clearDraft`; the launch prompt in `_layout.tsx` becomes `restore()` + `confirmEnd()`. |
| motionDiagnostics.ts | `startMotionDiagnostics` :1858 · `stopMotionDiagnostics` :1911, :1963 · `recordMotionDiagnostic` :289, :1962, :2081 · `subscribeMotionDiagnostics` :288 | `DiagnosticsPort`. `:2081` (watch mark) and `:288` (status text) stay in Map. |
| expo-location | `getCurrentPositionAsync` :1388 · `requestForegroundPermissionsAsync` :1356 · `getForegroundPermissionsAsync` :1328 · `reverseGeocodeAsync` :677, :2251, :2731 | `LocationPort.poll` covers :1388 only. Permission prompts and geocoding stay in Map. |
| expo-keep-awake | :481, :483 | none — view policy. |
| database (`getDatabase()`) | `addPickupLocation` :1760-1761 (inside the pickup callback) · `addLocationPoint` :1534-1535 (inside `trackLocation`) · `addCleanup` :2278 | none in slice 1 — see F3. |

---

## D. Rule-1 audit: every place that starts or stops `MotionDetector` or background location

`grep -rn` over `app/`, `src/`, `modules/` (excluding `node_modules`). `motionDetection.ts` is imported by exactly one file: `map.tsx`.

| Site | Call | Context | Disposition |
|---|---|---|---|
| map.tsx:1720 | `MotionDetector.startListening(cb, err)` | `attachWalkListeners()` — the only attach site in the codebase | Becomes `attachDetector()` — the only attach site. |
| map.tsx:1719 | `MotionDetector.stopListening()` | unconditional pre-attach (the 2026-09-10 fix) | Kept, same reason: `motionDetection.ts:172-175` silently no-ops a second `startListening()`. |
| map.tsx:1958 | `MotionDetector.stopListening()` | `finishCleanup()` | `runEnd()`. |
| map.tsx:1315 | `MotionDetector.stopListening()` | unmount cleanup with `[]` deps | Never executes — see D2. Deleted in slice 3. |
| map.tsx:1872 | `startBackgroundSession()` | `startCleanup()`, `.then`/`.catch`, not awaited | `resolveBackgroundSession()`, awaited, with a late-resolution guard. |
| map.tsx:1955 | `stopBackgroundSession()` | `finishCleanup()`, not awaited | `runEnd()`, awaited. |
| settings.tsx:236 | `stopBackgroundSession()` | "Force stop tracking" — user-initiated orphan cleanup | Stays. From slice 3 it must consult the controller: if a walk is live, this should be `confirmEnd()`, not a bare OS stop under a running session. |
| useAppInitialization.ts:52 | `stopBackgroundSession()` | launch, after `recoverCrashedSession(true)`, when launched in the foreground or a stale crash was filed | Stays. Runs before the tabs mount (the root layout renders `LoadingView` until `isInitialized`), so the provider's recovery decision always sees the post-teardown OS state. |
| backgroundSession.ts:88 / :133 | `Location.startLocationUpdatesAsync` / `stopLocationUpdatesAsync` | the module's own OS calls | Unchanged; the port wraps the module. |

Result: rule 1 is satisfiable by the controller because the attach site is already unique. The two non-Map stop sites are OS-cleanup paths that do not compete with a live walk today; the settings one needs routing through the controller once it owns the walk.

### D1. Latent bug, documented not fixed — the remount-resume count is clobbered at Stop

By code reading (not device-verified; the ledger's own row says the 2026-09-10 recovery path has no confirmed real-walk test):

1. `resumeWalkAfterRemount()` restores `pickupCount` from the draft (:1807) and calls `attachWalkListeners()` (:1813), which calls `MotionDetector.startListening()` (:1720).
2. `startListening()` resets the detector's own `pickupEvents = []` (motionDetection.ts:188) and `sessionEvents = []` (:183).
3. `finishCleanup()` then sets `pickupCount` to `MotionDetector.trimRecentPickups(6000)` (:1961, :1964) — which returns `pickupEvents.length`, i.e. only pickups since the re-attach.
4. `saveSummary()` writes `items_count: userCount ?? pickupCount` and `items_detected: pickupCount` (:2284, :2288) from that overwritten state. `motion_log` (:2342) is likewise post-remount only.

So a walk that remounts mid-way shows the right number on screen (the fix works) and loses it the moment Stop is tapped. What would disprove this: something reconciling `pickupCount` between :1964 and :2284. Nothing found; `pickupCounterRef` (restored at :1808) is not read by the save. The controller avoids this by owning the count and applying the trim as a delta (`confirmEnd()`), which is identical to today's arithmetic whenever no remount happened — tested in `sessionController.test.ts` §8.

### D2. Latent bug, documented not fixed — the unmount cleanup can never detach

The effect at :1312-1318 has `[]` deps, so its cleanup closure captures the mount-time `isListening`, which is always `false` (:83). `stopListening()` in it is unreachable. Consequence: when the screen remounts mid-walk, the old instance never detaches; the detector keeps calling `setPickupCount` on an unmounted component until the recovery effect (:418-441) re-attaches via :1719. The 2026-09-10 fix works *because* of :1719, not because of this cleanup. Under the controller the effect is deleted rather than fixed — the owner no longer unmounts.

### D3. Recovery blind spot — the heartbeat only rides accepted route points

`heartbeat()` is called inside the `setSessionRoute` updater (:1504-1508), which runs only when at least one fix passes the 25 m accuracy gate and the jump gate (:1427, :1486). `isSessionActiveFresh()` trusts a heartbeat for 60 s (crashRecorder.ts:145). A stretch longer than that with no accepted fix — indoors, a subway platform, a dense urban canyon rejecting everything as jumps — makes the remount check at :420 return false, and a remount in that window is not recovered: "Start cleanup" over a live walk, the exact 2026-09-10 symptom by a different route. The controller reproduces today's cadence deliberately (parity first); moving the heartbeat onto the 1 Hz tick is a one-line slice-3 improvement to argue for separately.

### D4. Race — a fast Stop can orphan the OS location task

`startBackgroundSession()` (:1872) is not awaited and spans the "Always" permission sheet. `finishCleanup()` → `stopBackgroundSession()` (:1955) checks `hasStartedLocationUpdatesAsync` (backgroundSession.ts:131); if the start has not completed yet that is false, stop is a no-op, and the start then registers a task nothing will ever stop (until `useAppInitialization` tears it down on the next foreground launch). The controller stops the task again when a start resolves after the walk has ended — tested in §9.

---

## E. Deliberate divergences in the controller (for the slice-2 parallel-run comparison)

1. **Stop-trim as a delta.** Final count = session count − (detector count before trim − after). Same as today when no remount occurred; correct after one (D1).
2. **`start()` awaits the background session.** The snapshot publishes `active` before the await, so the UI timing is unchanged; only the promise resolves later, with `mode` settled.
3. **Late background resolution after end → `stop()` again** (D4).
4. **Health flags are new.** `notAttached`, `degraded`, `failed`, `pending` etc. have no equivalent today beyond console output and three Alerts.
5. **No Alerts.** The controller never prompts; the four Alerts in the start/attach path stay with the view, driven by status/health.
6. **Session ids are strictly increasing** (`w<ms>`, bumped if two starts share a millisecond). Today's `w${Date.now()}` relies on wall-clock uniqueness.
7. **The draft carries `sessionId` and `mode`** inside the same `@pick_unsaved_walk_v1` JSON; today's readers ignore the extra keys.

Not divergences (checked): elapsed anchored at activation, not at the tap; the first location fix taken *before* the detector attaches (the OS prompt ordering); diagnostics started only on a new cleanup and never on resume; no `beginTrace`/background start on resume; autosave cadence (immediate, then ≥ 20 s); the accuracy/jump gate constants and order; the planar distance formula; the `session_mode` label rule.

---

## F. The three things most likely to bite slice 2

**F1. Two owners of one detector callback.** `MotionDetector` holds exactly one `onPickupCallback` (motionDetection.ts:165, :178). During a parallel run, if both Map's `attachWalkListeners()` and the controller call `startListening()`, whichever attaches last owns every pickup and the other silently counts zero — and both call `stopListening()` first, so the singleton's own guard will not save anyone. Slice 2 must give the controller a *tap*, not the detector: a `DetectorPort` adapter whose `startListening(cb)` fans out to a set of callbacks and attaches the real singleton once (Map keeps calling the singleton directly; the tap wraps it), or Map's own callback forwards each event into a controller intake. The same applies to `onError`.

**F2. Shared singletons with single-writer semantics.** Three more places where "both sides do it" corrupts one side: (a) `drainBackgroundLocations()` empties the queue for whoever calls first — the controller's port must be fed by Map's drain, not drain itself; (b) `beginSessionTrace`/`endSessionTrace`/`heartbeat` and `saveWalkDraft` write one sentinel key and one draft key — last writer wins and masks divergence, so the controller's `PersistencePort` in shadow mode must write to shadow keys (e.g. `@pick_unsaved_walk_shadow_v1`) and leave the sentinel alone; (c) `startBackgroundSession`/`stopBackgroundSession` — `stop` from either side kills the task for both; the shadow port should mirror Map's resolved mode and make `stop()` a no-op until ownership moves.

**F3. Who writes the per-event Firestore rows once the controller owns the callback.** `db.addPickupLocation` runs inside the pickup callback (:1760-1761) and `db.addLocationPoint` inside `trackLocation` (:1534-1535). Neither is lifecycle, so the controller does not call them, but when Map gives up the callback (slice 3) something must — either a subscriber on the snapshot that diffs `pickupLocations`/`route`, or an explicit `onPickup`/`onRoutePoint` hook on the controller. Decide before slice 3, and check whether either write still has a reader (the litter-hotspot layer moved to the web dashboard per :1615).

Also worth knowing before wiring: the watch bridge treats the walk as active from the tap (`walkIntent`, :2094-2096) — map it to `status !== 'idle' && status !== 'summary' && status !== 'failed'`, not to the live set; AppState `'inactive'` counts as not-active (:445) and unmounts the WebView mid-walk (:3057) — an incoming call is a map remount, which the spec's "loading flashes" note may partly be; and the pedometer's health cannot be reported until `MotionDetector` exposes its private `pedometerActive` (motionDetection.ts:150) — a one-line getter, deferred because it touches a frozen file.

---

## G. What was built (all new files, on branch `session-controller`)

| File | Role |
|---|---|
| `src/cleanup-session/types.ts` | `SessionStatus`, `SessionSnapshot`, `SessionResult`, `EndPreview`, `SessionHealth`, `SessionDraft`, and the six ports. |
| `src/cleanup-session/routeRecorder.ts` | Pure port of the :1400-1488 gates and the :2455 distance formula. |
| `src/cleanup-session/cleanupSessionStore.ts` | Subscribe / deep-frozen snapshot. Kept separate from the controller: it is exactly `useSyncExternalStore`'s contract and the one place the read-only guarantee lives. |
| `src/cleanup-session/cleanupSessionController.ts` | The lifecycle coordinator. Surface: `start`, `requestEnd`, `confirmEnd`, `restore`, `resume`, `dismissSummary`, `reset`, `subscribe`, `getSnapshot`, plus the view inputs `reportAppState`, `reportMapHealth`, `recordLocation`. |
| `src/cleanup-session/sessionPersistence.ts` | `PersistencePort` over `sessionRecovery.ts` + `crashRecorder.ts`. |
| `src/cleanup-session/appSessionDeps.ts` | Real `SessionDeps` over the singletons — imported nowhere; exists so `tsc` proves the ports fit today. |
| `src/cleanup-session/useCleanupSession.ts` | `CleanupSessionProvider`, `useCleanupSession()`, `useReportMapHealth()` — imported nowhere. |
| `src/cleanup-session/__tests__/sessionController.test.ts` | `npm run test:session`; appended to `npm test`. |
| `src/services/__tests__/harness.ts` | Shared end-of-suite guard for the six older tsx suites (`test:detector` … `test:recap`): a ref'd watchdog plus an `'exit'` listener, so a hung `await` fails non-zero with the assertion count instead of exiting 0 mid-suite (the failure mode slice 1 hit). Each suite keeps its own print format; only the counters and the exit moved. |

---

## Slice 3 prep — reader audit and open decisions

_2026-09-20, on `session-controller` at `3b6716b`. Line numbers are `map.tsx` at that commit; the slice-1 numbers above for the same sites (:1534-1535, :1760-1761, :2308, :2455) have drifted under the shadow touch points to :1550, :1777, :2351, :2499._

### H. The per-pickup / per-point "writes" never reach Firestore, and nothing reads them

F3 asked who writes `db.addPickupLocation` / `db.addLocationPoint` once Map gives up the callback. The definitions settle it before the question is reached: neither is a Firestore write.

| Writer | Definition | Call site | What it does | Readers |
|---|---|---|---|---|
| `db.addLocationPoint(lat, lon)` | `src/services/firebaseDatabase.ts:911-917` | `map.tsx:1550`, tail of `trackLocation()`, on every tick with at least one accuracy-gated fix (:1431-1442; one per 5-10 s while walking) | `this.sessionLocations.push({ lat, lon, timestamp: Date.now() })` — a private in-memory array on the `FirebaseDatabase` singleton (:908). No `addDoc`, no collection, no field. | `getSessionRoute()` (:927-929) returns the array — **no callers found**. `clearSessionData()` (:935-938) empties it — **no callers found**. |
| `db.addPickupLocation(lat, lon)` | `firebaseDatabase.ts:919-925` | `map.tsx:1777`, inside the detector pickup callback, after `setPickupLocations` (:1760) | `this.pickupLocations.push({ … })` — the sibling array (:909). Never leaves the process. | `getPickupHeatmap()` (:931-933) — **no callers found**. `clearSessionData()` — no callers. |

Searches, from the worktree root, `node_modules` excluded:

```
grep -rn "addPickupLocation\|addLocationPoint\|getSessionRoute\|getPickupHeatmap\|clearSessionData\|sessionLocations" \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.cjs' --include='*.swift' apps/companion
grep -rn "getSessionRoute\|getPickupHeatmap\|clearSessionData\|addPickupLocation\|addLocationPoint" \
  --include='*.js' --include='*.html' --include='*.ts' --include='*.py' --include='*.md' ~/pick-app      # web/, detector-analysis/, docs
grep -ohn "collection(['\"][A-Za-z_/{}$.-]*['\"]" apps/companion/functions/{index,detectorExport,fetch-detector-export,repair-precache-seeds}.js apps/companion/functions/shared/*.js | sort | uniq -c
grep -n "match /" apps/companion/firestore.rules        # no collection for either; /{document=**} at :480 denies everything else
git log -S"getPickupHeatmap()" -- apps/companion/app     # empty: no caller under app/ at any commit
```

Hits: the two definitions, the two Map call sites, the three in-class readers, nothing else — not in `app/`, `src/`, `modules/`, `targets/`; not in `functions/` (`index.js`, `detectorExport.js`, `fetch-detector-export.js`, `repair-precache-seeds.js`, `shared/*` — the 32 collection names those files touch are all listed by the third command and none is a location/pickup collection); not in `~/pick-app/web/*.html`; not in `~/pick-app/detector-analysis/*.py`. Both methods date from the 2026-06-10 checkpoint (`0fbf663`). The in-app heatmap that would have consumed `getPickupHeatmap()` was removed 2026-07-20 (`cf2bd6e`; the comment at `map.tsx:1630`), and git history has no caller under `app/` even before that.

What "hotspots moved to the web dashboard" actually refers to is a separate pipeline that these two writers never feed:

- `saveSummary()` writes a `pickups` field on the cleanup document (`map.tsx:2371-2382`): Map's `pickupLocations` **React state** (:284, appended at :1760), deduped to 4-dp (~11 m) cells, as a JSON string. Not `db.pickupLocations`.
- `rebuildPublicStats` (`functions/index.js:440-535`) reads `d.pickups` off `cleanups` (`addHot`, :457-467), bins to 3-dp cells, and writes `hotspots` onto `global_stats/summary` (:523) and `city_stats/<slug>` (:535).
- The site reads those two docs (`web/index.html:379`, `web/map.html:271`, `web/city.html:205`) but no page touches `.hotspots` — zero hits for `hotspot` in `web/*.html`; only `web/README.md:78-79` still lists the field. `index.js:1270` dates the public layer's removal to 2026-09-06 (the earlier note said 09-03; the code comment is the nearer source). So `hotspots` is still computed and written server-side with no client reader — a separate cleanup candidate, not slice-3 scope.
- The detector export (`functions/detectorExport.js:121-136`, `ALLOWED_TOP_LEVEL_FIELDS`) excludes `pickups`, `route_points`, and `distance_m` by design (:81). `detector-analysis/parse_sessions.py` reads the on-device diagnostics JSONL (`type: "location"` rows from `motionDiagnostics`), not Firestore.
- `firestore.rules`: `cleanups` is owner-read (:32); no other rule is relevant.

**Recommendation for slice 3: nobody writes them.** Delete the two call sites (`map.tsx:1550`, `:1777`) and the dead block in `firebaseDatabase.ts` (:905-938: both arrays, `addLocationPoint`, `addPickupLocation`, `getSessionRoute`, `getPickupHeatmap`, `clearSessionData`). The slice-2 suggestion — a Map-side store subscriber diffing `snapshot.route` / `snapshot.pickupLocations` and writing only the new tail — solves a problem that does not exist: there is no per-event write with a reader, so a subscriber would faithfully preserve a memory-only append that nothing consumes. One side effect worth naming: `clearSessionData()` is never called, so both arrays grow for the life of the process — every accepted fix and every pickup of every walk since launch. Small (tens of KB per hour walked) but unbounded; deleting the writers closes it.

What slice 3 does need is narrower: the per-walk consumers of Map's React state read the controller's `SessionResult` instead — `route` for `route_points` (:2368, via `simplifyRoute(privacyTrimRoute(…))`) and `pickupLocations` for the `pickups` field (:2371-2382), plus the draft/diagnostic/export-sheet reads of `pickupLocations` (:1048 autosave draft, :2002 shadow diff, :2029 save-first draft, :2518 `calculateCoverage().pickups`, :2575, :2600-2602 `exportSession`). `SessionResult` already carries `route`, `pickupLocations`, `distanceMeters` (`types.ts:170-172`). No new port, no subscriber, no Firestore change.

### I. `distance_m` — 10 m today, 1 m in the recorder; decide before the cutover

- **Map, the saved value:** `map.tsx:2351` `distance_m: Math.round((parseFloat(String(calculateCoverage().distance)) || 0) * 1000)`. `calculateCoverage()` (:2499-2521) sums planar km and returns `distance: distance.toFixed(2)` (:2516) — a string at 10 m granularity, so every stored `distance_m` is a multiple of 10.
- **Recorder:** `RouteRecorder.distanceMeters()` (`routeRecorder.ts:163-164`) = `Math.round(planarDistanceKm(route) * 1000)` — Map's formula verbatim (:40-52), 1 m granularity; surfaced as `SessionResult.distanceMeters` (`types.ts:172`).
- **Parity today is unaffected:** the shadow diff compares Map's expression with `savedStyleDistanceM()` (`shadowSessionDeps.ts:421-428`), which re-applies the `toFixed(2)`, so `agree.distance` is byte-equality either way. This decision is only about what the save writes after the cutover.
- **The same rounded km also feeds:** the in-walk top bar (:3001), the results modal (:4235, :4267), the share card's `distanceMi` (:4401), `exportSession` (:2532), two end-of-walk payloads (:2176, :2193), and the Apple Health workout distance (:2451-2456, `distanceKm: gpsKm`). Every display is 2-dp km/mi regardless; only Health and the stored field carry the number onward.
- **Downstream readers of `distance_m`: none.** `grep -rn distance_m` over `app/`, `src/`, `modules/`: the writer, the shadow mirror, and two type declarations (`src/types/index.ts:53`, `firebaseDatabase.ts:72`). `functions/`: zero hits — not in the export allowlist, and no distance aggregation under another name (`grep -in distance functions/index.js` finds one point-to-polyline helper for adopted blocks, :3296). `~/pick-app/web/`, `~/pick-app/detector-analysis/`: zero. Not Impact totals (`impactMetrics.ts` is bags and items), not leaderboards (`team_stats` / `user_stats` rollups carry no distance), not challenge stats. Stored since 2026-09-08 precisely so a future consumer has the true figure (the type comment at `firebaseDatabase.ts:68-72`); write-only so far.
- **Option A — keep Map's 10 m.** The save writes `Math.round(parseFloat(km.toFixed(2)) * 1000)` from the result's route. Byte-identical records across the cutover, nothing to annotate later; keeps a quantization in a field whose stated purpose is precision.
- **Option B — adopt the recorder's 1 m.** The save writes `distanceMeters` as-is. Every record after the cutover differs from what Map would have written by at most 5 m — pure rounding, same route, same formula — and no reader exists to notice. Old records keep their 10 m quantization, so a future distance stat mixes granularities with no marker unless the cutover date is recorded.

Not decided here. For the brief: **keep Map's 10 m rounding for `distance_m` after the cutover? `yes` (byte-parity) / `no` (1 m; a ≤5 m one-time difference on a field with no readers today).**
