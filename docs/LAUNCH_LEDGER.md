# Pick — Launch Ledger

**Machine-maintained.** The Pick Chief of Staff agent reads and updates this file
twice a day (07:00 and 18:00 ET). Edit it freely by hand — the agent reconciles
rather than overwrites, and it never deletes a line you added.

- `SHIPPING_PLAN.md` = the narrative. `LAUNCH_BUGLIST.md` = the item-level record.
- **This file = the live status of what is open, on whom, and for how long.**

Last agent run: `2026-08-23` (local run on Jake's Mac; the 15:00Z cloud run could not reach this machine)
Ledger opened: 2026-08-23

---

## ⛔ Hard blockers

| Item | Owner | Open since | Status |
|---|---|---|---|
| _(none open)_ | — | — | Both prior hard blockers cleared 2026-08-23 — see Closed. |

## 🟠 Build 32 — assembled, waiting

| Item | File | Open since | Status |
|---|---|---|---|
| **`PhoneLink.swift`** | `targets/watch/PhoneLink.swift` | 2026-08-17 | **Decided 2026-08-23 (Jake): split the response.** The earlier "removes the guard" summary was wrong — the 17 Aug diff *broadened* it, and reset the whole session on every stale payload. Now in tree: the staleness **check** covers both paths; the **response** splits — `resetToIdle()` on the activation snapshot or on an explicit `state: 'idle'`, drop-and-keep on an unverifiable stale *active* payload. Out-of-order check moved ahead of the staleness check. **Still uncommitted. ⚠️ NOT verified — no `xcodebuild` run; no Swift toolchain reachable from this session.** |
| Watch End confirm hardening | `targets/watch/ContentView.swift` | 2026-08-19 | Uncommitted. 6s auto-disarm + "Keep Going" promoted. Needs `xcodebuild` verification. |
| Splash transparency | `app.json` @ `4c64a0f` | 2026-08-17 | Committed, stranded — `app.json` cannot ship OTA. |
| EAS iOS build quota | Expo Free plan | 2026-08-13 | **Warning, not a stop.** The 13 Aug Expo email is a courtesy notice: *"has used 80% of the iOS build limit included with your Free plan."* The subject line and preheader say "limit reached" — the body does not. Headroom remains this billing period; confirm the exact count at expo.dev/accounts/jakeverbiest/settings/billing before cutting. Corrected 2026-08-23 from the original email. |

## 🟡 Launch gates

| Item | Type | Open since | Status |
|---|---|---|---|
| `MIN_CLEANUP_SECONDS` 20 → 120 | code | 2026-08-17 | Lowered for short test walks; comment says RESTORE BEFORE LAUNCH. Note it does not guard the pocket-stop case. |
| Keep-awake while `sessionMode` is null | decision | 2026-08-19 | Root enabler of the pocket-stop bug. Needs a deliberate call, not a drive-by fix. |
| Long-walk crash / map memory | field test | — | Fixed long ago, never confirmed on a real multi-hour walk. Needs one long walk. |
| In-app rebrand to Pick Global | code | 2026-08-01 | Name and domain locked; rebrand reportedly hasn't reached all in-app screens. Audit pass. |
| Bundle ID / LLC / developer name | business | — | **DEFERRED 2026-08-23 (Jake) — not a beta blocker.** A public TestFlight beta ships under the personal Apple Developer name, which is public the moment the link is. Reversible. Revisit before App Store release or EU distribution. |

## 🟢 OTA-able, not done

| Item | Open since | Status |
|---|---|---|
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
| **Watch stale-payload handling** | 2026-08-23 | Neither failure mode has ever been observed in the field — not the resurrected count (narrow guard, builds 28–31), not the mid-walk drop-out (broad guard, never shipped). The in-tree fix is reasoned from code, not measured. **Watch for, once build 32 is in testers' hands:** (a) watch showing "Start cleanup" or 0 during a walk the phone is still tracking; (b) watch stuck showing an active walk after the phone finished one; (c) a wrist-raise mid-walk landing on the clock face instead of the walk screen — that would mean the WorkoutSession ended. Any of the three is this code. |

## 🔵 Repo hygiene

| Item | As of | Status |
|---|---|---|
| **29 commits unpushed on `main`** | 2026-08-23 | Includes all the 19 Aug detector evidence — the field data behind every threshold — on one machine. |
| 3 untracked helper scripts | 2026-08-23 | `ship-cleanup.sh`, `ship-fixes.sh`, `ship-gate.sh`. `ota-tonight.sh` was flagged as worth committing. |
| `test:hoods` unrunnable | since 2026-07-14 | Flow syntax under tsx. `polygonStats()` covered only by the typechecker. |
| `aggregationFlow.test.ts` wired to no npm script | — | Never part of `npm test`. Unknown whether it passes. |

## ✅ Closed

| Item | Opened | Closed | Notes |
|---|---|---|---|
| Apple Developer Program License Agreement — Attachment 14 | 2026-08-18 | 2026-08-23 | Accepted by Jake in App Store Connect. Releases no longer blocked by an unsigned agreement. |
| “EAS build limit reached / Build 32 cannot be cut” | 2026-08-13 | 2026-08-23 | **Closed as misread, not as resolved.** The 13 Aug email body says 80% of the Free-plan iOS limit used. Build 32 was never quota-blocked. Live quota row moved to Build 32 above. |

---

## Testers & field data

- **TestFlight:** build 31 (`1.2.2`) live since 2026-08-13. Builds 27–31 all cleared 12–13 Aug.
- **Detector validation:** B5 result was 20 counted / 20 real, 1.00x — **validated on one tester.**
- **Next milestone:** multi-tester detector validation. `pace_median_mps` now saves on
  every walk, so tester walks self-label by pace.
- Field logs in `docs/fielddata/`: A7a, C6a, C7a, B4, B5B, B5.

## Agent run log

| Run | Moved | Notes |
|---|---|---|
| 2026-08-23 (local, 4th) | Public link confirmed live; docs committed | Beta is already public — reframes go/no-go as "tighten what's running". Site copy corrected on disk (4 pages) and index trimmed 1168→920 words; **not yet deployed**. Ledger + docs committed in `9c0b778`. **Push still pending — no GitHub credentials reachable from the agent session.** |
| 2026-08-23 (local, 3rd) | Public beta assessed; website scoped | Build 31 is already approved — a public beta needs no new build. LLC deferred by Jake. Two docs added. Open question: whether the TestFlight link is already public. |
| 2026-08-23 (local, 2nd) | PhoneLink resolved in tree | Jake chose the split-response option over commit-as-is / revert. Written, unverified, uncommitted. Opened a Watching section. |
| 2026-08-23 (local) | EAS blocker retired; PhoneLink row corrected | Re-read the 13 Aug Expo email: 80% used, a warning, not a stop — EAS moved out of hard blockers. PhoneLink row said the change "removes" the guard; the diff broadens it. No hard blockers open. `pick-state.json` in Drive still carries both stale facts — see note below. |
| 2026-08-23 | Apple DPLA accepted | Hard blocker closed by Jake. |
| 2026-08-23 seed | — | Ledger created. Four findings surfaced from Gmail + repo state; see hard blockers and repo hygiene. |
