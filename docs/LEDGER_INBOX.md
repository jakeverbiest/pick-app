# Ledger inbox — interactive sessions → scheduled reconciliation

**`docs/LAUNCH_LEDGER.md` has one writer: the daily `pick-ledger-reconciliation` scheduled
task.** Interactive sessions (Claude Code or otherwise) read the ledger freely but do not edit
it directly — that was the point of moving to a single writer: no more collisions between a live
session and the scheduled run on the same file (this repo has hit that class of bug before —
duplicate commits 72s apart, a stranded `.git/index.lock`).

If you're in an interactive session and learn something that should update the ledger — a fix
landed, a blocker cleared, a new open item — append a dated bullet here instead. The scheduled
task reads this file first, folds entries into the ledger's actual structure, and clears it on
each run.

Format: one dated bullet per item, plainly stated — the scheduled task will reconcile it into
the ledger's actual structure, not paste it verbatim.

<!-- Example:
- 2026-08-26 — PhoneLink.swift split-response fix committed as 7b19cd8, xcodebuild clean. No
  longer an open item.
-->

- **2026-09-10 — first walk with `screen_remounts` instrumentation: consistent with the remount
  theory, not yet proof.** Indoor test walk `sBQYJnYXAotRtVqEImYL`, 129s, `session_mode=background`
  (correct test conditions), 13 ground-truth taps. **`screen_remounts=0`, and Jake reports NO watch
  flashing this time** — the first walk since the fix without the symptom.

  **Read honestly, not as confirmation:** this walk is notably shorter than the two that showed the
  bug (129s vs ~290s each). Less time plausibly means less chance for whatever OS-level pressure
  triggers a remount (memory pressure, backgrounding) to occur AT ALL, independent of whether the
  theory is correct — so a clean 0-remounts/no-flash result on a short walk doesn't yet distinguish
  "the theory is right" from "this walk was too quick to hit the trigger conditions either way."
  Needs one more background walk closer to 5 minutes (matching the two problem walks' duration) to
  actually move this from consistent-with to confirmed. If a remount does occur on that walk, check
  whether pickupCount/the displayed count drops at that same timestamp — that would be direct proof
  rather than correlation.

  **Detector-side, as predicted before the walk (see the prior entry's explicit caveat about indoor
  testing):** overcounted more than either outdoor walk (18 raw counted / 13 real ≈ 1.4x) —
  explained, not new. `pace_low_confidence=true`, 13 of 57 motion events (23%) had no or stale GPS
  (`speedAgeMs` -1 or >1800ms), a much higher rate than outdoors. The pace gate depends on real GPS
  speed and stands down when it can't judge, so it caught less overcounting than it would outside.
  5 double-count clusters in 13 real picks (rate between the two outdoor walks) — consistent with
  the existing slow-pace-drives-double-counting finding, not a new anomaly. Indoor testing does not
  meaningfully extend the pace-gate/double-count investigation, exactly as anticipated.

- **2026-09-10 — city search was silently overridden by the idle-recenter effect; fixed, likely
  broken since launch, not a recent regression.** Jake: typed "Amsterdam," selected it, map stayed
  on Brooklyn. Root cause: the idle-recenter effect (`6094187`, 2026-07-14) fires on every
  `currentLocation` change while not mid-walk, unconditionally re-centering the map AND
  re-resolving the area name to the real GPS fix. It shipped ONE DAY before the city switcher
  (`712b12c`, 2026-07-15) and has no awareness `goToCity()` exists — the next location tick after
  any city selection eased the map straight back and overwrote `currentArea.city`, often within
  seconds. **This has likely been broken since the city switcher launched two months ago**, not
  something that recently broke — a latent conflict between two features nobody happened to test
  against each other in exactly this timing window.

  Confirmed scope before fixing rather than assumed: the city switcher only renders `!isListening`
  (the header's own condition), and the idle-recenter effect carries the identical guard, so the
  fix only needed to touch that one effect. Checked the other two `window.updateLocation` call
  sites — one is `isListening`-gated (walk-time route drawing; city switcher isn't reachable during
  a walk anyway) and one fires only once on initial WebView load (a legitimate default, not part of
  the repeating symptom) — neither needed to change.

  **Fix:** `viewingOtherCityRef`, set `true` in `goToCity()`, checked as an early-return guard in
  the idle-recenter effect, cleared only by `recenter()` — the one explicit "snap back to me"
  action. A ref rather than state since nothing needs to re-render when it flips. A fresh mount
  resets it to `false` automatically. Published OTA, update group
  `ab272758-de2e-40ef-b618-138476584fdc`. `tsc --noEmit` clean. **Not yet tested live** — static
  analysis only, no simulator/device run before shipping; worth a real check on the next
  city-search attempt.
