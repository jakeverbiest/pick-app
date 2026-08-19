# Pick — what's left to ship

Rewritten 19 Aug 2026, end of the detector testing day. Supersedes the 18 Aug
version. Companion to `LAUNCH_BUGLIST.md` (the item-level record).

---

## Where things stand

**Everything JS is committed and published.** The only modified files in the
tree are two Swift files. Three OTA updates went out today:

| commit | shipped |
|---|---|
| `c384599` | pace context on every walk, `pickupCounterRef` note, export fix, test-script fix |
| `3eb95f2` | relative pause gate, stop floor, stop confirm, watch `endWalk` routing |

Detector state after B5: **20 counted for 20 real, 1.00x**, validated against a
prediction frozen before the walk. Do not tune further on one tester's data.

---

## 1. Build 32 — the next unit of shipping

Nothing here can go OTA. It needs an EAS build and Apple review, so batch it.

| Item | Source | State |
|---|---|---|
| **Watch End confirm hardening** | `targets/watch/ContentView.swift` | **Uncommitted.** 6s auto-disarm + "Keep Going" promoted above "End Walk". Needs `xcodebuild` first. |
| **`PhoneLink.swift` decision** | `targets/watch/PhoneLink.swift` | **Uncommitted, yours to call.** Removes the watch's stale-snapshot guard (the 28 Jul fix). Commit or revert — it has been pending since 17 Aug. |
| **Splash transparency** | `app.json`, commit `4c64a0f` | Committed but stranded since 17 Aug. `app.json` cannot ship OTA. |

**Trigger:** cut it once the `PhoneLink.swift` call is made. Everything else is
ready.

---

## 2. Still OTA-able, not done

| Item | Why it matters |
|---|---|
| **`pickupCounterRef` never reset between walks** | Real bug. Cumulative since app launch, feeds `commitSessionPickups()` (the challenge live counter) and the crash heartbeat. Harmless for solo walks; **would corrupt a shared-challenge session**, which is the format proposed for the next group walk. |
| **`exportCleanup()` omits the `pace_*` fields** | The walk stores `pace_median_mps`, `pace_slow_share`, `pace_low_confidence`, but the export doesn't emit them, so pace still has to be reconstructed by hand from per-event speeds. One line. |
| **Motion window not reset on `startListening`** | Produces absurd first events — 40s on B5B, **602s** on the indoor run. Correctly rejected, so harmless, but it is real state carryover between sessions and the first genuine event of a walk may be mis-measured. |

None are urgent. They'd make a tidy batch with whatever the next field round surfaces.

---

## 3. Launch gates

| Item | Type | Note |
|---|---|---|
| **`MIN_CLEANUP_SECONDS` 20 → 120** | code | Still 20, lowered 17 Aug for short test walks. The comment says RESTORE BEFORE LAUNCH. Note it does **not** guard the pocket-stop case — the guard is `elapsed < MIN && pickupCount === 0`. |
| **Keep-awake while `sessionMode` is null** | decision | The root enabler of the pocket-stop bug: the screen is live in a pocket for the whole walk, and with Auto-Lock on "Never" it never sleeps. Narrowing it protects *every* control, not just Stop — but the existing comment warns it exists so a foreground-only session is never silently dropped. **Needs a deliberate call, not a drive-by fix.** |
| **Long-walk crash / map memory** | field test | Fixed long ago, never confirmed on a real multi-hour walk. Needs one long walk, not a code change. |
| **In-app rebrand to Pick Global** | code | Name and domain locked; the rebrand reportedly hasn't reached all in-app screens. Worth an audit pass. |
| **Bundle ID / LLC / developer name** | business | Must be decided before commercial or EU launch. Not engineering. |

---

## 4. Housekeeping

- **Commit today's docs.** Everything in `docs/` from today is untracked:
  `A7a_ANALYSIS.md`, `B5_PREDICTION.md`, `LAUNCH_BUGLIST.md`,
  `PERSONAL_PACE_BASELINE_SCOPE.md`, `SHIPPING_PLAN.md`,
  `GROUP_WALK_2026-08-18.md`, `TESTER_BRIEF_2026-08-18.md`, and `fielddata/`
  (the A7a / C6a / C7a / B4 / B5B / B5 motion logs). The field data especially
  — it is the evidence behind every threshold in the detector.
- **Decide on the junk:** `Pick Images/`, `design-audit/`, `finish-commits.sh`,
  and `assets/images/splash-icon_backup_opaque_05286E.png`. Most look like
  `.gitignore` material. The PNG is referenced nowhere but ships in every OTA
  bundle.
- **The helper scripts** (`ota-tonight.sh`, `ship-fixes.sh`, `ship-gate.sh`) are
  untracked. `ota-tonight.sh` is worth committing — it runs the suites
  individually so one broken harness can't hide a real regression.
- **`test:hoods` has been unrunnable since 14 Jul** — esbuild under tsx can't
  parse the Flow syntax in `react-native/index.js`, reached via
  `neighborhoods.ts` → AsyncStorage. `polygonStats()` is covered only by the
  typechecker.
- **`aggregationFlow.test.ts` is wired into no npm script** and has never been
  part of `npm test`. Unknown whether it passes.

---

## 5. What actually comes next

1. **Multi-tester validation of the detector.** The gate is validated on one
   person. `pace_median_mps` now saves on every walk, so tester walks label
   themselves by pace with no manual reconstruction — the thing that made
   today's analysis slow.
2. **The keep-awake decision**, because it is the root enabler of the only
   launch blocker found today.
3. **Build 32**, once `PhoneLink.swift` is resolved.
