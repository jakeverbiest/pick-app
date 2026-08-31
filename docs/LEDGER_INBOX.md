# Ledger inbox — interactive sessions → scheduled reconciliation

**`docs/LAUNCH_LEDGER.md` has one writer: the daily `pick-ledger-reconciliation` scheduled
task.** Interactive sessions (Claude Code or otherwise) read the ledger freely but do not edit
it directly — that was the point of moving to a single writer: no more collisions between a live
session and the scheduled run on the same file (this repo has hit that class of bug before —
duplicate commits 72s apart, a stranded `.git/index.lock`).

If you're in an interactive session and learn something that should update the ledger — a fix
landed, a blocker cleared, a new open item — append a dated bullet here instead. The scheduled
task reads this file first, folds entries into the ledger, and clears it on each run.

- 2026-08-31 — Civic-org sponsor dashboard: backend (`7b33ce2`) and website page (`51213d3`,
  `~/pick-app`) committed and deployed/shipped. **Real bug found and fixed during manual
  end-to-end testing, not caught by the earlier synthetic-data verification**: `createSponsorTeam`
  accepted `area.type: "anywhere"` (a valid Challenge area, meaning "no restriction on a
  participant") without noticing it has no meaning for a *district-scoped* sponsor dashboard —
  `cleanupInArea` has no bound to check against an unbounded area, so it silently matched every
  cleanup on the platform. A live test team created with `anywhere` returned ~11,301 pickups,
  i.e. Pick's entire all-time total, not a district's. Fixed (`a95bb63`, deployed): sponsor teams
  now require `neighborhood` or `custom` — an actual boundary — `anywhere` is rejected with a
  clear error. Re-tested with a bounded custom area post-fix: returned 1 cleanup / 10 pickups,
  correctly scoped. Both test teams and their tokens were deleted after verification — nothing
  live remains from testing. **Also added `create-sponsor-team.js`** (repo root, alongside
  `publish-detector.sh`/`ota-tonight.sh`) — the spec only scoped backend + website page, so there
  was no way to actually onboard a sponsor; this is a one-off CLI tool for Jake to run by hand
  when a real sponsor is ready, not automated. Tested end-to-end against the live deployment.
  **Still open**: the website page (`web/org.html`) needs a manual Netlify drop to actually go
  live at pickglobal.org — Jake was doing this in parallel; not confirmed live from this session.

Format: one dated bullet per item, plainly stated — the scheduled task will reconcile it into
the ledger's actual structure, not paste it verbatim.

- 2026-08-31 — Three things shipped this session, all committed and live:
  1. **Both-sides-cleaned street bug** — committed `b6a0e57`, shipped OTA (update group
     `eb296336-6e4c-4a27-a3e3-0cdaf2587396`, production, runtime 1.2.2).
  2. **`team_stats` real bag counts** — committed `3f6661d`, deployed
     (`onCleanupWrite`/`rebuildTeamStats`), backfilled and verified against Firestore.
  3. **New "request my city" feature** — committed `0224b04`. Deployed: Firestore rules, plus
     three new Cloud Functions (`requestCity`, `scheduledCityRequestsDigest` — weekly Monday
     09:00, `runCityRequestsDigest` — key-gated HTTP digest endpoint). Shipped OTA (update group
     `8280f70f-a778-4893-bfc6-8a4168d11628`). A new weekly Claude Code scheduled task
     (`pick-city-requests-digest`, Mondays ~09:04) pulls the digest into
     `~/pick-app/docs/CITY_REQUESTS.md` for review — first real run will be next Monday.
  Unrelated side note from today: an unrelated stray git repo (`nanoclaw-v2`, Jake's own
  accidental `npm`/install mistake, unrelated to Pick) briefly sat inside `apps/companion/` and
  was moved out to `~/Desktop/nanoclaw-v2` before any publish — never part of a shipped bundle.

<!-- Example:
- 2026-08-26 — PhoneLink.swift split-response fix committed as 7b19cd8, xcodebuild clean. No
  longer an open item.
-->

- 2026-08-31 — Signup-flow build (5 items from a fresh investigation). **Implemented and
  type-checked (`tsc --noEmit` clean, existing `npm test` suites unaffected), NOT committed and
  NOT shipped** — working tree only, per explicit instruction not to deploy this pass.
  1. **Deferred deep link for challenge invites** — new `web/join.html` (~pick-app repo) +
     `apps/companion/src/services/pendingChallenge.ts`. No Associated Domains/Universal Links
     (that needs a new native entitlement); landed on a clipboard-marker handoff instead — cheap,
     OTA-able, but a known-imperfect fallback (see file's doc comment for the tradeoffs, incl. the
     iOS "Pasted from Safari" toast). `challengeInviteMessage()` in `challenges.ts` now points at
     `pickglobal.org/join?challenge={id}` alongside the existing `pickapp://` line. **Removed the
     old `/join -> /download` redirect** in `web/_redirects` since `/join` is now a real page —
     worth a look before any next Netlify drop.
  2. **Sign in with Apple** — `expo-apple-authentication` installed (`npx expo install`), plugin
     added to `app.json`, `authService.loginWithApple()` + UI on both login.tsx and signup.tsx.
     **NATIVE BUILD REQUIRED — cannot ship via `eas update`.** The plugin writes the
     `com.apple.developer.applesignin` entitlement at prebuild time; only a fresh `eas build`
     picks that up. Ready in code for whenever Build 32 (or the next native batch) is cut, not
     shippable before then.
  3. **Auto-join on invite arrival** — `autoJoin=1` param read by `challenge/[id].tsx`, wired
     through signup/login's post-auth routing. Depended on (1) landing first, per plan. Leave
     affordance is the existing "Leave challenge" button (already becomes the primary CTA once
     joined) — no new UI needed there.
  4. **One-line explainer before the location OS prompt** — `map.tsx`, first "Start cleanup" tap
     only, gated on `Location.getForegroundPermissionsAsync()` being `UNDETERMINED` so it never
     shows after the OS has already recorded a decision. Small, OTA-able, independent of the rest.
  5. **Auth guard on `challenge/[id].tsx`** — unauthenticated deep-link visitors now redirect to
     `/auth/signup?pendingChallenge={id}` instead of landing on a screen where "Join challenge"
     silently no-opped on an empty uid. OTA-able.
  Items 1, 3, 4, 5 are OTA-shippable (JS/TS only). Item 2 is the one native-build dependency in
  this batch — flagging here so it isn't missed when the next native batch gets planned.

- 2026-08-31 — **Investigated Jake's own "terrible battery drain after switching Location to
  Always" report.** Diagnosis, not a fix — flagging for the ledger since it's a real field report
  on a native-build day, not a hypothetical. Read `apps/companion/src/services/backgroundSession.ts`,
  `apps/companion/src/hooks/useAppInitialization.ts`, `apps/companion/src/services/crashRecorder.ts`,
  and the `stopCleanup`/`finishCleanup` path in `map.tsx`.
  - The "Always" prompt is expected and correctly attributed to `afaed31` (screen no longer
    force-stays-on during a walk) — not user error.
  - Normal walk-end paths (phone "Stop & save" confirm, watch End button, and the Settings →
    "Force-stop background tracking" escape hatch) all reliably call `stopBackgroundSession()` —
    confirmed by reading every call site of `startBackgroundSession`/`stopBackgroundSession`.
  - **Real, known, already-partially-mitigated gap: a crash or uncontrolled JS-thread death
    mid-walk does not call `stopBackgroundSession()`.** `crashRecorder.ts` (commit `4026ae3`, "Add
    crash black box + fix orphaned background-location tracker") already anticipated this exact
    failure mode and added a black-box sentinel + cleanup — but the cleanup only runs in
    `useAppInitialization` on the *next cold app launch*, gated on the sentinel's heartbeat being
    >3 min stale (`STALE_SESSION_MS`). Between a crash and the next time the app is reopened,
    `Location.startLocationUpdatesAsync` (continuous, `Accuracy.High`, 5s/5m interval,
    `pausesUpdatesAutomatically: false`) is an OS-level registration that keeps running/relaunching
    the app in the background to deliver fixes, independent of the dead JS thread — the iOS
    location arrow stays on and battery drains until the app is reopened (or the user manually
    force-quits, which — per standard iOS background-location behavior — does stop it since the
    app wasn't registered for significant-change wake). A deliberate user force-quit is *not* the
    risk; an uncontrolled crash mid-walk is.
  - This exactly matches `QA_TEST_PLAN.md`'s P0 "Phantom tracker check" item, which is still
    **unchecked** — never confirmed on-device — and the "Force-stop background tracking" P1 item,
    also unchecked (the escape hatch exists and reads correctly in code, just never field-verified).
  - Separately, not a bug but worth a line: `startLocationUpdatesAsync` uses `Accuracy.High` (not
    `Balanced`) with `pausesUpdatesAutomatically: false` — a deliberate, in-code-documented
    tradeoff (Balanced was mis-mapping pickups across the street) that disables iOS's own
    battery-saving auto-pause during any stationary stretch mid-walk. Real, ongoing battery cost
    of an *active* walk, not a leak — expected, not a bug.
  - **Net: this is very likely the mechanism behind the drain Jake saw**, if a walk of his ended
    other than via a clean Stop recently (crash, JS exception, etc.) and he didn't immediately
    reopen the app afterward — not something present on every walk. Urgency judgment left to Jake;
    diagnosis only, no fix written. The QA_TEST_PLAN P0 phantom-tracker item is the natural place
    to close the loop before trusting this further.
