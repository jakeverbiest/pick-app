# Pick — Launch Ledger

**Machine-maintained.** The Pick Chief of Staff agent reads and updates this file
**once a day at 16:30 ET**, as a scheduled task bound to Jake's Mac (set up
2026-08-24, replacing the cloud run that could not reach the repo). It lands 30
minutes before the 17:00 Handoff block, which already assumed a 16:30 refresh.
Edit it freely by hand — the agent reconciles rather than overwrites, and it
never deletes a line you added.

> The 09:00 "Clock in → Pick" calendar block still says its item is chosen
> "by the Chief of Staff at 6:45". There is no 06:45 run: at that hour Jake is
> out on the Movement block and the Mac is not reliably awake, and a
> device-bound task needs the Mac. The morning pick therefore comes from the
> previous afternoon's ledger. Jake's calendar text to change if he wants.

- `SHIPPING_PLAN.md` = the narrative. `LAUNCH_BUGLIST.md` = the item-level record.
- **This file = the live status of what is open, on whom, and for how long.**

Last agent run: `2026-08-24` (local run on Jake's Mac; the 2026-08-24 cloud run also could not reach this machine — reconciled from Jake's briefing)
Ledger opened: 2026-08-23

### Build naming convention (settled 2026-08-24)

**A build is named by its TestFlight number.** TestFlight is at Build 31, so the next
cut is **Build 32** — which is what Apple, App Store Connect, testers, and every other
doc in this repo already call it (`LAUNCH_BUGLIST.md` records builds 27, 28, 31).

**EAS monthly quota is a separate count and is never a build name.** Write it as
"14th of 15 EAS builds this month". The next build is **Build 32**; it is not "build 14".

---

## ⛔ Hard blockers

| Item | Owner | Open since | Status |
|---|---|---|---|
| _(none open)_ | — | — | Both prior hard blockers cleared 2026-08-23 — see Closed. |

## 🟠 Build 32 — assembled, waiting

| Item | File | Open since | Status |
|---|---|---|---|
| **`PhoneLink.swift`** | `targets/watch/PhoneLink.swift` | 2026-08-17 | **Decided 2026-08-23 (Jake): split the response.** The earlier "removes the guard" summary was wrong — the 17 Aug diff *broadened* it, and reset the whole session on every stale payload. Now in tree: the staleness **check** covers both paths; the **response** splits — `resetToIdle()` on the activation snapshot or on an explicit `state: 'idle'`, drop-and-keep on an unverifiable stale *active* payload. Out-of-order check moved ahead of the staleness check. **Still uncommitted. ⚠️ NOT verified — no `xcodebuild` run; no Swift toolchain reachable from this session.**<br><br>**RE-CONFIRMED 2026-08-24 (Jake): restore the guard. Open 7 days (since 17 Aug).** New, and it is the first *field* evidence this thread has ever had: **the watch has been flashing old counts intermittently since the last update** — the resurrected-count mode, which the Watching row below recorded as never observed. Builds 28–31 carry the narrow activation-only guard, which does not cover the ongoing delivery path. **Correction to the 2026-08-24 briefing:** the fix is *implemented*, not merely decided — `git status` shows `PhoneLink.swift` modified, +43/−7 in the working tree. What is left is `xcodebuild` verification and a commit, not writing it. <br><br>**UPDATED 2026-08-24 (evening session).** **DONE — committed and compiled.** Committed as `7b19cd8`; `xcodebuild` (full workspace, Watch target included) **BUILD SUCCEEDED** at 13:50. Both remaining conditions on this row are met. Rides Build 32, uncut as of this edit. |
| **`lastAppliedAt` on the stale-reject branch** | `targets/watch/PhoneLink.swift` | 2026-08-24 | **Written 2026-08-24, uncommitted.** Second defect found while reading the flash: `resetToIdle()` deliberately leaves `lastAppliedAt` alone, so at activation it is still `0` — and a re-delivery of the same queued context on the ongoing path passed the out-of-order check against that zero and repainted the old count over the 0 the cached guard had just painted. **That is the mechanism behind the flash Jake reported.** Now records the rejected payload's `sentAt`, so either check alone rejects a re-delivery. <br><br>**UPDATED 2026-08-24 (evening session).** **DONE — committed in `7b19cd8` alongside the guard, and compiled clean.** No longer unverified. |
| Watch End confirm hardening | `targets/watch/ContentView.swift` | 2026-08-19 | 6s auto-disarm + "Keep Going" promoted. <br><br>**UPDATED 2026-08-24 (evening session).** **DONE — committed and compiled.** No longer uncommitted, no longer unverified. Rides Build 32. |
| Splash transparency | `app.json` @ `4c64a0f` | 2026-08-17 | Committed, stranded — `app.json` cannot ship OTA. |
| **Watch LOG PICK button (tester ground truth)** | `targets/watch/`, `modules/watch-session/` @ `70d0eba` | 2026-08-24 | **NEW, committed and compiled.** A watch-side button that timestamps each real pick, saved as `ground_truth` next to `motion_log`. Exists because B6 counted 39 for 20 real picks and that number is equally consistent with "every pick counted twice" and "twelve double-counts plus fifteen false positives" — opposite fixes, indistinguishable without per-pick times. On the **wrist** deliberately: a phone button would mean handling the phone mid-walk, which flips `classifyCarryMode` to `hand` for the whole walk and adds a raise-and-tap 1–2s after every pick, i.e. it would manufacture the very artefact being measured. Tester-only and **off by default**; visibility rides the stats payload as `groundTruth`, so the gate stays in JS and can be enabled per-tester over the air after Build 32 ships. Never feeds the count. |
| EAS iOS build quota | Expo Free plan | 2026-08-13 | **Not a blocker — reclassified as a budget line, see Build budget below (2026-08-24).** **Warning, not a stop.** The 13 Aug Expo email is a courtesy notice: *"has used 80% of the iOS build limit included with your Free plan."* The subject line and preheader say "limit reached" — the body does not. Headroom remains this billing period; confirm the exact count at expo.dev/accounts/jakeverbiest/settings/billing before cutting. Corrected 2026-08-23 from the original email. |

> **Conflict flagged 2026-08-24 — `SHIPPING_PLAN.md` §1 is stale.** It still says the
> `PhoneLink.swift` change "removes the watch's stale-snapshot guard (the 28 Jul fix)"
> and frames the call as "commit or revert". `LAUNCH_BUGLIST.md` (modified 2026-08-23
> 17:06Z) and this ledger (2026-08-23 17:46Z) are both newer than `SHIPPING_PLAN.md`
> (2026-08-19 19:58Z) and record the opposite: the change *broadens* the check, and the
> resolution was a third option, not commit-or-revert. **Preferring the newer files.**
> With the §2 note above, that is two stale sections in the shipping plan — it needs a
> rewrite or a stale banner. Not done here: it is Jake's narrative doc.

## 💰 Build budget (not a blocker)

Counts confirmed by Jake, 2026-08-24. This row used to be a hard blocker; it never
should have been.

| Fact | Value |
|---|---|
| EAS iOS builds used this billing period | **13 of 15** |
| Remaining | **2** |
| Billing period ends | ~1 week from 2026-08-24 |

**Plan for the two remaining builds (Jake, 2026-08-24):**

1. **Build 32 — the batch.** Carries the `PhoneLink.swift` stale-snapshot guard
   restore, the keep-awake / `sessionMode` change, and the watch bug, together.
   (14th of 15 this month.)
2. **One build held in reserve** for an App Review rejection fix. (15th of 15.)

> ~~Dependency, stated without a recommendation: the batch in (1) includes keep-awake,
> which is still an open decision under Launch gates. Build 32 cannot be assembled as
> planned until that call is made.~~
>
> **SUPERSEDED 2026-08-24.** Keep-awake was decided and shipped **OTA** (`afaed31`), so
> it never needed a build slot and is no longer in the Build 32 batch. **Build 32 has no
> remaining dependencies** — every native item on it is committed and `xcodebuild`-clean.
> Its batch is: watch stale-snapshot guard + `lastAppliedAt`, End confirm hardening,
> splash transparency, and the LOG PICK button.

## 🎯 Detector: what "good enough" means (Jake, 2026-08-25)

**No per-carry modes.** Not cross-body mode vs pocket mode vs purse mode. One
detector, close enough that people can semi-trust the number, with an easy way
to correct it when they care.

**The asymmetry that follows.** Over- and under-counting are not equally bad.
An inflated count feeds leaderboards, team totals and any published aggregate,
so it is a credibility problem people notice and resent. A shy count reads as
conservative, the user tops it up, and nobody feels lied to. So the constraint
is **never systematically over** — a detector that runs slightly under and is
easy to correct upward is trustworthy; one that runs hot is not, whatever its
average.

This reframes the week: B6's **1.95x overcount is the failure that threatens the
product**. B7's 2-of-10 is too far, but it fails in the safe direction.

**Target, replacing "1.00x on a controlled walk":** land at or just under truth
— roughly 8-11 counted per 10 real picks — with no walk coming in high.

> **MET on the first walk after the fix (B7, 25 Aug pm, front pocket): 12 real
> picks -> 10 counted, 0.83x, under truth, zero false positives.** Same protocol
> and carry position that produced 39-for-20 (1.95x over) the day before. Every
> counted event maps to a real pick within 6s with none left over; the two misses
> were a pace-gate rejection at 1.20 m/s (GPS had not caught the stop) and a
> likely `trimRecentPickups(6000)` casualty on the final pick, which would make
> true recall 10 of 11. Caveat: pick times were reconstructed from the protocol,
> not logged — Build 32's LOG PICK button turns this into measurement. Still n=1
> tester.

**Measured carry-position confound (25 Aug), recorded so it is not rediscovered.**
Cross-body bag vs front pocket is not a small difference:

| | median gyro | classifyCarryMode | peak accel spread |
|---|---|---|---|
| 2b, pocket | 6.21 | `pocket` | 1.50–4.60g (3.10) |
| A9, cross-body | 1.65 | `hand` | 1.43–2.02g (0.59) |
| B7, cross-body | 1.36 | `hand` | same shape |

Rotation is **4.6x weaker** in a bag and the acceleration range collapses to 23%
of the detection band. In a pocket a bend swings the phone hard against the
thigh and separates from a stride; in a bag both read ~1.7g at ~1.4 gyro and the
contrast the detector runs on is gone. `classifyCarryMode` does correctly call a
bag `hand`, which disables the pocket-only low-rotation filter — without that,
65% of B7's events would also have been cut as "low rotation (handling?)".

**Consequence for field data: A9 and B7 are not comparable to the pocket series**
(B5, B6, 2a, 2b, A7a, C6a). A9's 0.00 false positives per minute is partly a bag
not producing stride bounces; B7's 2-of-10 is partly a bag pick being a weak
event. Run the comparable series in a **front pocket**. Cross-body is a real
carry position and deserves its own baseline later — as a separate question, not
a mode.

**Open, not yet acted on:** the correction path is behind an "Adjust details"
disclosure, collapsed by default. If approximation is the design, the summary
screen should invite correction rather than hide it. The safety valve this whole
approach leans on is currently tucked away.

## 🟡 Launch gates

| Item | Type | Open since | Status |
|---|---|---|---|
| `MIN_CLEANUP_SECONDS` 20 → 120 | code | 2026-08-17 | Lowered for short test walks; comment says RESTORE BEFORE LAUNCH. Note it does not guard the pocket-stop case. |
| Keep-awake while `sessionMode` is null | decision | 2026-08-19 | **CLOSED 2026-08-24 (Jake): the screen must not be on during walks — battery is the constraint.** Shipped as `afaed31`, **OTA, no build needed** — so this is no longer a Build 32 dependency and the Build-budget note below is superseded.<br><br>Two things reframed it. First, the pocket-stop bug it was called the "root enabler" of already has a direct fix in the field — `stopCleanup` is a confirm dialog, so a lit screen is no longer dangerous; what remained was a battery question wearing a bug's clothes. Second, **`sessionMode` was never recorded anywhere**, so there was no evidence about how often the expensive path is taken — this was a missing measurement, not a judgment call, which is why it could not be resolved for five days.<br><br>Keep-awake now fires only on `'foreground'`, never on the unresolved `null` window. `'foreground'` has one realistic cause on a real build: "Always" location not granted — a fixable permission problem `startCleanup` already surfaces with a Settings pointer. The old behaviour paid battery to paper over a prompt already being shown. `session_mode` is now saved on every walk, so the field answers this rather than the ledger asking about it. |
| Long-walk crash / map memory | field test | — | Fixed long ago, never confirmed on a real multi-hour walk. Needs one long walk. |
| In-app rebrand to Pick Global | code | 2026-08-01 | Name and domain locked; rebrand reportedly hasn't reached all in-app screens. Audit pass. |
| Bundle ID / LLC / developer name | business | — | **DEFERRED 2026-08-23 (Jake) — not a beta blocker.** A public TestFlight beta ships under the personal Apple Developer name, which is public the moment the link is. Reversible. Revisit before App Store release or EU distribution. |

## 🟢 OTA-able, not done

| Item | Open since | Status |
|---|---|---|
| **Test walk results not yet folded in** | 2026-08-24 | ~~Open, on Jake.~~ **FOLDED IN 2026-08-24 (evening).** Walks 1a/1b/2a/2b, A8 and B6 are all recorded in `docs/B6_PREDICTION.md`, including two frozen predictions and their results. Still **n=1 tester** — that has not changed, and the LOG PICK button on Build 32 is what makes multi-tester ground truth practical (a stopwatch-and-transcribe protocol will not survive four testers, and `cleanups` is owner-only so their walks cannot be read directly). |
| **Watch push throttled on `elapsedSeconds % 3`** | 2026-08-24 | **Fixed in tree 2026-08-24, not yet published.** The effect is driven by a 1Hz `setInterval` and iOS throttles JS timers while backgrounded — every real walk — so `elapsedSeconds` jumps rather than counts and `% 3 === 0` can miss for long stretches, starving the watch's clock. Now a wall-clock check; counts were never throttled and still are not. Live Activity heartbeat gets the same treatment on its own timer. **Ships OTA, no build needed — reaches builds 28–31 testers today.** <br><br>**PUBLISHED 2026-08-24** in the update messaged "Watch: guard stale snapshots on both paths; wall-clock watch-push throttle". Live on builds 28–31. |
| `exportCleanup()` omits the `pace_*` fields | 2026-08-19 | One line. Walk stores `pace_median_mps`, `pace_slow_share`, `pace_low_confidence`; export doesn't emit them. |

> **Note (2026-08-23):** `SHIPPING_PLAN.md` §2 also lists `pickupCounterRef` and the
> motion-window reset as outstanding. `LAUNCH_BUGLIST.md` — written three hours
> later the same night — records both as fixed and published in `c384599`.
> The buglist is the newer record. **Section 2 of the shipping plan is stale.**

## 🌐 Public beta — go, capped

| Item | Status |
|---|---|
| Approved build | ✅ Build 31, cleared TestFlight review 12–13 Aug. **No build 32 needed, no Apple wait.** |
| **Is the link already public?** | **CONFIRMED PUBLIC 2026-08-23 (Jake).** `testflight.apple.com/join/6753UhuM` is a live public link, published on `download.html`. **The public beta is already running** — the question was never go/no-go, it is how to tighten a beta that is already open. Every item below is live exposure, not a future risk. |
| Tester limit — set? | **CHECK.** If no limit was set, the link is open to the 10,000 ceiling. This is the support-load lever and it may currently be wide open. |
| Beta App Description — current? | **CHECK.** It is the first thing a public joiner reads. Unknown whether it was ever written or whether it still describes the pre-19-Aug detector. Draft in `PUBLIC_BETA_GONOGO.md`. |
| Test Information | Beta App Description + feedback email required. Draft in `PUBLIC_BETA_GONOGO.md`. |
| Tester limit | 1–10,000, editable any time. **The support-load lever.** |
| Detector export CF | **Now the top priority — the beta is already open.** Any stranger who has walked since the link went up produced `items_detected` that is stored, owned, and unreadable. The function recovers it retroactively. **Gates the value, not the launch.** Public testers are anonymous in App Store Connect — no one to ask for a screenshot. Without it a public beta yields zero detector evidence. |
| Support promises | `support.html` commits to "every message is read" and reports "reviewed within 24 hours" — a moderation SLA in writing. Cap the beta so both stay true, or soften them. |
| Stale detector claim | `index`, `about`, `support` all still say the detector over-counts on a slow stroll. Untrue since 19 Aug. Fix before inviting strangers. |

## 🌐 Website

| Item | Status |
|---|---|
| Five copies of the site | `web/` canonical; `pickglobal-site 4` byte-identical; ` `, ` 2`, ` 3` + `.zip` are drift. Delete four. |
| index.html is 1,168 words | Three simplification options in `WEBSITE_SIMPLIFICATION.md`. Recommendation: Option B (one screen, ~250 words) now, upgrade hero to video later. |
| Missing assets | Walk loop video, one real photograph, before/after map pair, watch-on-wrist. Shot list in the same doc. |
| Screenshots may be stale | All six dated 17 Aug, 540×1168 (too small for retina hero). Unknown whether they show pre-rebrand branding. |

## 👁 Watching

| Item | Since | Why it's here |
|---|---|---|
| **Watch stale-payload handling** | 2026-08-23 | Neither failure mode has ever been observed in the field — not the resurrected count (narrow guard, builds 28–31), not the mid-walk drop-out (broad guard, never shipped). The in-tree fix is reasoned from code, not measured. **Watch for, once build 32 is in testers' hands:** (a) watch showing "Start cleanup" or 0 during a walk the phone is still tracking; (b) watch stuck showing an active walk after the phone finished one; (c) a wrist-raise mid-walk landing on the clock face instead of the walk screen — that would mean the WorkoutSession ended. Any of the three is this code.<br><br>**UPDATED 2026-08-24 — no longer purely hypothetical.** Jake reports **the watch flashing old counts intermittently since the last update**. That is the resurrected-count mode named at the top of this row (narrow guard, builds 28–31), not one of (a)/(b)/(c). It is the first field observation in this thread, and it is consistent with the shipped code: the committed guard only runs on the activation snapshot, so a delayed *ongoing* `didReceiveApplicationContext` delivery lands unchecked. (a), (b) and (c) remain unobserved and stay on watch for build 32. |

## 🔵 Repo hygiene

| Item | As of | Status |
|---|---|---|
| ~~29 commits unpushed on `main`~~ | 2026-08-24 | **Appears resolved.** `main` and `origin/main` are both at `bfd91f6`, 0 ahead / 0 behind as of 2026-08-24. The 19 Aug detector evidence is no longer single-machine. Caveat: no `git fetch` has run from this session, so this reads the local remote-tracking ref — a push updates it, so the push evidently went through. |
| 3 untracked helper scripts | 2026-08-23 | `ship-cleanup.sh`, `ship-fixes.sh`, `ship-gate.sh`. `ota-tonight.sh` was flagged as worth committing. |
| `test:hoods` unrunnable | since 2026-07-14 | Flow syntax under tsx. `polygonStats()` covered only by the typechecker. |
| `aggregationFlow.test.ts` wired to no npm script | — | Never part of `npm test`. Unknown whether it passes. |

## ✅ Closed

| Item | Opened | Closed | Notes |
|---|---|---|---|
| Apple Developer Program License Agreement — Attachment 14 | 2026-08-18 | 2026-08-23 | Accepted by Jake in App Store Connect. Releases no longer blocked by an unsigned agreement. **Signing detail added 2026-08-24: signed 2026-08-23 16:45 UTC, team `H77DJ6QPJC`. Was a hard blocker for 5 days.** Evidence: Gmail message `1a02f83b25bbfe64`. |
| “EAS build limit reached / Build 32 cannot be cut” | 2026-08-13 | 2026-08-23 | **Closed as misread, not as resolved.** The 13 Aug email body says 80% of the Free-plan iOS limit used. Build 32 was never quota-blocked. Live quota row moved to Build 32 above. **Note 2026-08-24:** the 8/24 briefing described the ledger as having carried this as a hard blocker for 11 days. It did not — this ledger opened 8/23 and reclassified it the same day, 10 days after the email. The genuinely new information on 8/24 is the hard count: **13 of 15 used, 2 left** — now in Build budget. |
| Keep-awake while `sessionMode` is null | 2026-08-19 | 2026-08-24 | Decided by Jake — screen off during walks, battery is the constraint. Shipped OTA (`afaed31`). Resolved once it was reframed: the bug it was blamed for already had a direct fix in the field, and `sessionMode` had never been recorded, so it was a missing measurement rather than a judgment call. Full reasoning on the Launch-gates row. |
| Detector: pace-gate dead zone at 1.0–1.3 m/s | 2026-08-24 | 2026-08-24 | Zero-pick walks showed false positives rising as pace fell (1.34 m/s: 0.16/min, 1.19: 1.11, 1.07: 1.33). The absolute gate only fires above 1.3 and the relative gate switched off at 1.0, so ordinary moderate walking pace was covered by neither. Ceiling removed (`1d671fc`). Costs ~40% recall for picking without stopping (measured on C6a) — acceptable only while walk→STOP→pick is the normal technique; the code says to restore the ceiling if that premise changes. |
| Detector: trailing median measured stops, not pace | 2026-08-24 | 2026-08-24 | `trailingMedianSpeed` filtered on `speed > 0`, so readings taken *while stopped* counted as pace. On B6 that dragged the median to ~0.5 and set the gate's bar at 0.40 m/s — below a real stop. The gate disarmed itself in proportion to how often the user stopped to pick, i.e. it failed worst at exactly its intended job. Fixed in `fd05a95`. |
| Walk 1b: silent total sensor failure | 2026-08-24 | 2026-08-24 | A normal-looking 6-minute walk saved with a completely empty `motion_log`. `startListening()` ran location setup between the events reset and the accelerometer subscribe inside one `try`; `watchPositionAsync` rejected, the catch swallowed it, and the accelerometer never attached — while the route still drew from map.tsx's own watch, so nothing looked wrong. Sensors now attach first, location is best-effort in its own try, and `sensorsAttached()` raises an alert instead of letting someone walk for nothing. `1d671fc`. |

---

## Testers & field data

- **TestFlight:** build 31 (`1.2.2`) live since 2026-08-13. Builds 27–31 all cleared 12–13 Aug.
- **Detector validation:** B5 result was 20 counted / 20 real, 1.00x — **validated on one tester.**
- **Next milestone:** multi-tester detector validation. `pace_median_mps` now saves on
  every walk, so tester walks self-label by pace.
- Field logs in `docs/fielddata/`: A7a, C6a, C7a, B4, B5B, B5.

## 📨 Notification dedupe seed

Carried over from `pick-state.json` (Drive) when it was retired on 2026-08-24. The
scheduled run has no other memory of what it has already reported, so these Gmail
message ids were already surfaced to Jake and must not be re-notified:

`1a015d04ff471bff` · `19ffbfce53fed803` · `19ffc305705336fc` · `1a02f83b25bbfe64` (the DPLA acceptance)

Gmail was scanned through **2026-08-24T00:00:00Z**. Append ids here as runs notify on them.

> **Drive memory retired 2026-08-24.** `pick-state.json` and
> `pick-state.NEXT-2026-08-24b.json` were the cloud run's memory, needed only because a
> cloud session could not reach this Mac. The scheduled task is now device-bound, so this
> ledger is the single record. Both files are in Drive's trash (recoverable ~30 days) —
> everything in them that was still live was moved here first. A third,
> `pick-state.NEXT-2026-08-24.json`, had already been trashed.

## Agent run log

| Run | Moved | Notes |
|---|---|---|
| 2026-08-24 (local, retire Drive memory) | Drive `pick-state*.json` trashed; live content migrated here | Ledger is now the sole record. Migrated before trashing: the outstanding test-walk results (which existed nowhere else), the DPLA evidence message id, and the notification dedupe seed. Dead on arrival and not migrated: the "3s timer redrawing a local cache" caveat (that path does not exist — the watch has no polling timer), the `watch-live-updates` item (already shipped in `WatchSessionModule.swift`), and `routine-goes-local` (done — task `trig_01RvnozDsHJLd5wkQ9jHxFvG`, daily 16:30 ET). |
| 2026-08-24 (local, watch changeset) | Flash mechanism identified; B + D written; `ship-watch.sh` added | Read the watch target end to end. **Jake's second suspect — a 3s timer redrawing a local cache — does not exist:** the watch has no polling timer at all (one 25s one-shot, one 6s disarm) and is already `@Published`-driven. The 3s lives on the *phone*, as a throttle on the clock tick that counts already bypass. **Item 3 (event-driven WatchConnectivity) is already shipped** — `updateApplicationContext` + `sendMessage` are both in `WatchSessionModule.swift`, `transferUserInfo` appears nowhere; dropped as no-op work. Real stale-render path found instead, and fixed by A+B. `tsc --noEmit` clean; lint shows no new findings. **Still no Swift toolchain — A/B/C remain uncompiled, which is now the only gate.** |
| 2026-08-24 (local, reconcile) | EAS → budget line with real counts; PhoneLink re-decided with first field evidence; two-build plan recorded; build naming settled | Cloud run 2026-08-24 could not reach this Mac; reconciled from Jake's briefing. Two briefing items were already true here — EAS reclassified 8/23, DPLA closed 8/23 — so the new detail was added rather than a second correction. One briefing item corrected: `PhoneLink.swift` is implemented in tree, not merely decided. `SHIPPING_PLAN.md` §1 flagged stale alongside §2. Repo hygiene: `main` now matches `origin/main`. |
| 2026-08-23 (local, 4th) | Public link confirmed live; docs committed | Beta is already public — reframes go/no-go as "tighten what's running". Site copy corrected on disk (4 pages) and index trimmed 1168→920 words; **not yet deployed**. Ledger + docs committed in `9c0b778`. **Push still pending — no GitHub credentials reachable from the agent session.** |
| 2026-08-23 (local, 3rd) | Public beta assessed; website scoped | Build 31 is already approved — a public beta needs no new build. LLC deferred by Jake. Two docs added. Open question: whether the TestFlight link is already public. |
| 2026-08-23 (local, 2nd) | PhoneLink resolved in tree | Jake chose the split-response option over commit-as-is / revert. Written, unverified, uncommitted. Opened a Watching section. |
| 2026-08-23 (local) | EAS blocker retired; PhoneLink row corrected | Re-read the 13 Aug Expo email: 80% used, a warning, not a stop — EAS moved out of hard blockers. PhoneLink row said the change "removes" the guard; the diff broadens it. No hard blockers open. `pick-state.json` in Drive still carries both stale facts — see note below. |
| 2026-08-23 | Apple DPLA accepted | Hard blocker closed by Jake. |
| 2026-08-23 seed | — | Ledger created. Four findings surfaced from Gmail + repo state; see hard blockers and repo hygiene. |
