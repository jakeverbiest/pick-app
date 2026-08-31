# Pick — Launch Ledger

**Machine-maintained.** Reconciled daily at ~16:30 ET by a scheduled task, currently
two in parallel during a verification period: the original Cowork-based task (bound
to Jake's Mac, set up 2026-08-24) and a Claude Code–native replacement
(`pick-ledger-reconciliation`, added 2026-08-26, local-time cron so it handles DST
without a manual bump). Once the Claude Code version is verified, the Cowork task
gets cancelled and this note updated. It lands 30 minutes before the 17:00 Handoff
block, which already assumed a 16:30 refresh.

**Jake:** edit freely by hand — the agent reconciles rather than overwrites, and
never deletes a line you added. **Interactive Claude Code sessions (the `code`/`qa`
subagents):** don't edit this file directly anymore — append findings to
`docs/LEDGER_INBOX.md` instead, and the scheduled task folds them in. This removes
the collision risk between a live session and the scheduled run editing the same
file at once.

> The 09:00 "Clock in → Pick" calendar block still says its item is chosen
> "by the Chief of Staff at 6:45". There is no 06:45 run: at that hour Jake is
> out on the Movement block and the Mac is not reliably awake, and a
> device-bound task needs the Mac. The morning pick therefore comes from the
> previous afternoon's ledger. Jake's calendar text to change if he wants.

- `SHIPPING_PLAN.md` = the narrative. `LAUNCH_BUGLIST.md` = the item-level record.
- **This file = the live status of what is open, on whom, and for how long.**

Last agent run: `2026-08-31` (see run log — five days elapsed since the last recorded run; substantial engineering activity in between, most of it same-day)
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

**Reconciled 2026-08-26 — what actually produced the 0.83x result.** The pocket
B7 walk above was the *second* B7 run that day; a first, cross-body B7 (10 real
picks -> 2 counted, 0.20x) is what's in the confound table above. Root cause
found between the two runs (`70afe88`): `isNotStriding` accepted `speedMps` and
`speedAgeMs` as arguments and never read them, so it could only recognise a
stop that had already lasted ~10s — five times longer than a real 2s pick-pause
— and every guard built on it (cadence veto, monotony veto, the walking-context
refresh added the day before) silently did nothing throughout every real pick.
Fixed by reading the argument that was already being passed. That fix, not a
protocol change, is why the pocket re-run landed at 10/12 instead of repeating
B6's 1.95x or B7-morning's 0.20x. Separately, `ae3f028` fixed the `session_mode`
field itself — it had read `"unresolved"` on every walk since it was added
(`finishCleanup` cleared it before the summary sheet's Save could read it), so
the keep-awake closed-item's claim that "session_mode is now saved on every
walk" was true in code but not yet in data. The B7 pocket walk is the first
walk where `session_mode` actually recorded a value (`"background"`), which is
the first field confirmation that the screen-off change is doing what it was
meant to.

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
| ~~Adoption/nudge email — needs field verify~~ | 2026-08-12 | **Field-verified 2026-08-26, per a Gmail scan run by the separate cloud-scheduled task (not independently confirmed by this session — no Gmail access this run).** Reported: a PICK nudge email fired 2026-08-20 and the path is live end to end. `LAUNCH_BUGLIST.md`'s "Fixed, needs field verify" row for the redesigned adoption/nudge/signup emails (`emailShell()`, deployed 2026-08-12) had been open on exactly this question — does a real nudge land in a real inbox — for two weeks. Worth a direct look next run rather than taking this secondhand. |

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

## 🚧 In progress, uncommitted (2026-08-31 snapshot)

Working tree was actively changing during this reconciliation run — a live session
appears to be mid-task. Recorded here as a snapshot, not a completed item; re-check
next run rather than trusting this list to still match the tree.

| Item | Files | Status |
|---|---|---|
| "Prioritize my city" — city-requests feature | `firestore.rules`, `functions/index.js` (`requestCity` callable, weekly digest), `map.tsx`, `neighborhoods.ts`, `polygonStats.test.ts` | Uncommitted. A dedup'd per-user tally on the map's fallback-city card (OSM gave only a city outline, no real subdivision) feeding an admin weekly digest of which cities are asking for real neighborhood coverage. |
| Challenge Recap v2 spec | `docs/CHALLENGE_RECAP_SPEC.md` §11 (appended; v1 §1–10 already shipped 2026-08-05) | Drafted 2026-08-31, **not approved to build.** Map-as-centerpiece redesign + Tier-1 photo integration from already-public Community posts; Tier 2 (private cleanup photos) documented as an open decision only. |
| Civic-Org Dashboard spec (new) | `docs/CIVIC_ORG_DASHBOARD_SPEC.md` (untracked) | Drafted 2026-08-31, **not approved to build.** Sponsor/BID-facing dashboard over real `teams`/`team_stats` — Jake's stated top priority per `PROJECT_TIMELINE.md`. Open decisions block build start: district-scoping of team impact, and access control for an org's private view. |
| `CHALLENGE_GUEST_MODE_SPEC.md` edits | `docs/CHALLENGE_GUEST_MODE_SPEC.md` | Small uncommitted diff, untriaged this run. |
| A deleted screenshot | `Screenshot 2026-06-11 at 11.48.19 AM.png` | Marked deleted in the working tree — appears to be repo-hygiene cleanup, not investigated further. |

## 🔵 Repo hygiene

| Item | As of | Status |
|---|---|---|
| ~~29 commits unpushed on `main`~~ | 2026-08-24 | **Appears resolved as of 2026-08-24** (`main`/`origin/main` both `bfd91f6`). **Reopened 2026-08-26, still open 2026-08-31: `main` is now 6 commits ahead of `origin/main`** — the 3 from 8/26 (`3cdf8ca`, `3301751`, `32e1f90`) plus three new same-day commits from 2026-08-31 (`8800f68` CARTO API key, `b6a0e57` both-sides-cleaned coverage fix, `3f6661d` `rebuildTeam()` total_bags fix). Same caveat as before: reads the local remote-tracking ref, no `git fetch` run this session, and this is a read-only reconciliation job so no push was attempted here. |
| **Stale `.git/index.lock`** | 2026-08-26 | **FOUND AND CLEARED 2026-08-26.** An empty, orphaned `.git/index.lock` (mtime 2026-08-25 10:36, no process holding it per `lsof`) was sitting in the repo — the same failure mode `_to_delete/` already has a dozen prior examples of (a plain `git status`/`git diff` without `--no-optional-locks` stranding a lock). Left in place it would have silently blocked Jake's next `git commit`. Moved to `_to_delete/stale-git-index.lock-2026-08-25-1036`, matching the existing convention in that folder — not deleted. |
| ~~3 untracked helper scripts~~ | 2026-08-23 | **RESOLVED 2026-08-25** (`bf947ed`, "track ship scripts; ignore `_to_delete`"). `ship-cleanup.sh`, `ship-fixes.sh`, `ship-gate.sh` are now tracked, alongside a not-previously-listed `ship-watch.sh`. `ota-tonight.sh` was already tracked. `.gitignore` also gained a `_to_delete` entry — see the note added 2026-08-26 below. |
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
| CARTO basemap tiles required an API key | 2026-08-31 (inbox) | 2026-08-31 | CARTO added a fair-use gate to the `light_all` raster tile endpoint; requests without a key showed an "API KEY REQUIRED" watermark. Fixed in all 4 app call sites plus both website copies (`~/pick-app/web/map.html`, `web/city.html`). Reported via `LEDGER_INBOX.md` as shipped-but-uncommitted; **now committed as `8800f68`.** **Correction folded in same run: the first OTA publish (update group `e4de5103…`) actually shipped `?key=undefined` on all 4 URLs** — a stale Metro transform cache serving a cached `undefined` from before the env var existed. Jake confirmed the watermark persisted through two force-quit/reopen cycles. Re-published after `rm -rf .expo/metro-cache` (update group `64c042f5…`), this time verified by grepping the compiled bundle for the real key string, not just a clean CLI exit — that's now the standing lesson for any OTA touching an `EXPO_PUBLIC_` var. Status ladder: fixed + shipped (OTA, corrected + website deploy), field verify inside a running app instance still open. **Unrelated finding surfaced during that publish, not yet triaged:** the build log printed `RN persistence unavailable (wrong firebase bundle?) — auth will NOT survive app restarts`, consistently on the web-bundle build step only — likely web-target noise (`metro.config.js` exists to fix this for iOS/Android) but not independently confirmed on a real device. Worth a qa look. |
| Challenge Recap discovered to be fully built, not a pending spec | 2026-08-31 (inbox) | — (discovery, not a fix) | `docs/CHALLENGE_RECAP_SPEC.md` (drafted 3 Aug) is live in code — confirmed by reading it directly, not the docs. Shipped in `e5436c6`/`6e4f164`: `app/challenge/[id].tsx` shows "Share recap" on a completed challenge, `GroupRecapModal`/`GroupRecapCard.tsx`/`challengeRecap.ts` all match the spec. Two things shipped beyond spec'd v1 scope: a real Leaflet/CARTO street map on `AreaPreview` (spec text still says "SVG shape"), and Community cross-posting (`createChallengeRecapPost`) that the spec's own §6/9 deferred to v1.1. **None of this was previously mentioned anywhere in this ledger, `LAUNCH_BUGLIST.md`, or `PROJECT_TIMELINE.md`** — zero prior grep hits. **Not yet field-verified**: spec Phase 4 (a real 3+-person challenge run to completion) appears to have never happened — nothing in `docs/fielddata/` is a multi-person walk. `neighborhood`/`anywhere` challenges still get the un-upgraded plain-trophy empty state (no map) — likely the common case. This is the v1 that `CHALLENGE_RECAP_SPEC.md §11` (see In-progress table above) now proposes a v2 redesign on top of. |
| Both-sides-cleaned bug: route points crediting the wrong side of the street | 2026-08-31 | 2026-08-31 | `markRouteCleaned()`/`getCoverage()` tested each candidate segment independently against a flat 11m snap distance, so a real (non-synthetic) OSM sidewalk pair close enough together let a route point on one side also credit the opposite side. Fixed by bucketing each route point to its nearest segment first. Committed `b6a0e57`, new regression test added. Also brought the live in-walk map recolor effect onto the same constants the persisted-coverage path uses (was 15m/0.8 hardcoded separately) so what's shown while walking now matches what gets saved. |
| `team_stats` never wrote `total_bags` | 2026-08-31 | 2026-08-31 | `rebuildTeam()` wrote `total_weight` but not `total_bags`, so `getTeamsWithStats()` silently fell back to a client-side estimate instead of a real count, unlike the per-city public dashboard which already computes real bags via `bagsFor()`. Fixed to reuse that helper. Committed `3f6661d`; already deployed (`onCleanupWrite`, `rebuildTeamStats`) and backfilled for all 3 existing teams, verified directly against Firestore. Found while grounding the new Civic-Org Dashboard spec (see below) against real data. |

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
| 2026-08-31 (Claude Code) | CARTO inbox entry folded in and marked committed (`8800f68`); two new committed fixes recorded (`b6a0e57` coverage bug, `3f6661d` team_stats bug); unpushed-commits row updated 3→6 ahead; new "In progress, uncommitted" section added as a snapshot of a live session's in-flight work (city-requests feature, two new specs); `LEDGER_INBOX.md` cleared back to template. Part 2: `OPS_STATUS.md` corrected — its stale-timeline banner on `PROJECT_TIMELINE.md` was itself stale (that file has a real 2026-08-31 entry; not stale since Aug 18), and its "Last updated" date bumped. **Five-day gap since the last run (2026-08-26 → 2026-08-31) — this task did not fire daily as designed; worth checking why with Jake** (see summary). Did not attempt `eas build`/`git push`/`git commit`/Gmail check per the job's read-only mandate; the working tree was changing between reads in this same run (a live session appears to be active), so the "in progress" table above is a snapshot, not a guarantee. |
| 2026-08-26 (Claude Code, manual re-run) | Nothing — clean pass | Re-ran on request, second local pass today. `HEAD` unchanged at `32e1f90` since the prior pass this morning (no new commits, `main` still 3 ahead of `origin/main`), no new files in `docs/fielddata/`, `LAUNCH_BUGLIST.md`/`SHIPPING_PLAN.md` mtimes unchanged. Checked the new `docs/LEDGER_INBOX.md` per the single-writer process that was set up between the two runs — empty, nothing to fold. Also traced down the routine that sent this morning's "ledger did not update" push notification: it's the cloud-hosted `trig_01RvnozDsHJLd5wkQ9jHxFvG` ("Pick — launch ledger refresh"), a second, separately-created cloud routine that fails the same way the original `trig_01AkTNjzshGa6MTbXifjGQvD` ("Pick — Chief of Staff") does — confirmed via its run log, and confirmed the older routine is also still firing twice daily and has resumed writing a `pick-state.json` fallback to Drive, undoing the 2026-08-24 Drive-memory retirement above. Jake was told to delete both at claude.ai/code/routines; neither is deleted as of this run. |
| 2026-08-26 (Claude Code, parallel-verification run) | Repo hygiene: helper scripts confirmed tracked, unpushed-commits row reopened, stale index.lock cleared; detector section given the isNotStriding/session_mode mechanism it was missing | This is a Claude Code session running the same job the local Cowork task runs daily at 16:30 ET, in parallel for a verification period per the task brief — not a replacement yet. Working tree was clean; no uncommitted changes to reconcile. Read `docs/LAUNCH_BUGLIST.md` and `docs/SHIPPING_PLAN.md` for cross-check only, per house rule preferring the ledger/buglist over the shipping plan and newest-mtime-wins on conflicts — did not edit either (out of scope for this job). Did not check Gmail (not part of this job's steps, unlike the retired Drive-memory-era task) — the notification dedupe seed below is unchanged and unverified this run. Did not attempt `eas build`/`git push`/`git commit` per the job's read-only mandate. |
| 2026-08-24 (local, retire Drive memory) | Drive `pick-state*.json` trashed; live content migrated here | Ledger is now the sole record. Migrated before trashing: the outstanding test-walk results (which existed nowhere else), the DPLA evidence message id, and the notification dedupe seed. Dead on arrival and not migrated: the "3s timer redrawing a local cache" caveat (that path does not exist — the watch has no polling timer), the `watch-live-updates` item (already shipped in `WatchSessionModule.swift`), and `routine-goes-local` (done — task `trig_01RvnozDsHJLd5wkQ9jHxFvG`, daily 16:30 ET). |
| 2026-08-24 (local, watch changeset) | Flash mechanism identified; B + D written; `ship-watch.sh` added | Read the watch target end to end. **Jake's second suspect — a 3s timer redrawing a local cache — does not exist:** the watch has no polling timer at all (one 25s one-shot, one 6s disarm) and is already `@Published`-driven. The 3s lives on the *phone*, as a throttle on the clock tick that counts already bypass. **Item 3 (event-driven WatchConnectivity) is already shipped** — `updateApplicationContext` + `sendMessage` are both in `WatchSessionModule.swift`, `transferUserInfo` appears nowhere; dropped as no-op work. Real stale-render path found instead, and fixed by A+B. `tsc --noEmit` clean; lint shows no new findings. **Still no Swift toolchain — A/B/C remain uncompiled, which is now the only gate.** |
| 2026-08-24 (local, reconcile) | EAS → budget line with real counts; PhoneLink re-decided with first field evidence; two-build plan recorded; build naming settled | Cloud run 2026-08-24 could not reach this Mac; reconciled from Jake's briefing. Two briefing items were already true here — EAS reclassified 8/23, DPLA closed 8/23 — so the new detail was added rather than a second correction. One briefing item corrected: `PhoneLink.swift` is implemented in tree, not merely decided. `SHIPPING_PLAN.md` §1 flagged stale alongside §2. Repo hygiene: `main` now matches `origin/main`. |
| 2026-08-23 (local, 4th) | Public link confirmed live; docs committed | Beta is already public — reframes go/no-go as "tighten what's running". Site copy corrected on disk (4 pages) and index trimmed 1168→920 words; **not yet deployed**. Ledger + docs committed in `9c0b778`. **Push still pending — no GitHub credentials reachable from the agent session.** |
| 2026-08-23 (local, 3rd) | Public beta assessed; website scoped | Build 31 is already approved — a public beta needs no new build. LLC deferred by Jake. Two docs added. Open question: whether the TestFlight link is already public. |
| 2026-08-23 (local, 2nd) | PhoneLink resolved in tree | Jake chose the split-response option over commit-as-is / revert. Written, unverified, uncommitted. Opened a Watching section. |
| 2026-08-23 (local) | EAS blocker retired; PhoneLink row corrected | Re-read the 13 Aug Expo email: 80% used, a warning, not a stop — EAS moved out of hard blockers. PhoneLink row said the change "removes" the guard; the diff broadens it. No hard blockers open. `pick-state.json` in Drive still carries both stale facts — see note below. |
| 2026-08-23 | Apple DPLA accepted | Hard blocker closed by Jake. |
| 2026-08-23 seed | — | Ledger created. Four findings surfaced from Gmail + repo state; see hard blockers and repo hygiene. |
