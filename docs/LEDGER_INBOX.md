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
