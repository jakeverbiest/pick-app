#!/usr/bin/env bash
#
# ship-gate.sh — commit the relative pause gate + the pocket-stop fixes, then
# test and publish.
#
#   ~/Desktop/pick-app/ship-gate.sh
#
# Does NOT commit targets/watch/PhoneLink.swift — still your call, and native
# anyway so it can't ship over OTA.

set -uo pipefail
REPO=~/Desktop/pick-app
cd "$REPO" || { echo "cannot cd to $REPO"; exit 1; }

echo "==> Staging"
git add \
  "apps/companion/app/(tabs)/map.tsx" \
  "apps/companion/src/services/motionDetection.ts" \
  "apps/companion/src/services/motionEvaluation.ts" \
  "apps/companion/src/services/__tests__/detectorRegression.ts" || exit 1

echo
git diff --cached --stat
echo

git commit -q -F - <<'MSG'
Relative pause gate, plus stop walks ending themselves in a pocket

LAUNCH BLOCKER FIRST: three walks on 19 Aug ended on their own in a pocket. One
died at 22s with a single pickup and saved itself. `Stop & save` was one
unguarded tap at the bottom of the screen, and the summary Modal's Save button
lands in roughly the same region, so a single sustained fabric contact can land
both. MIN_CLEANUP_SECONDS does not cover this — its guard is
`elapsed < MIN && pickupCount === 0`, so any walk with one stray pickup saves
regardless of length. Stop now raises a hard confirm. Chosen over a pocket or
short-walk heuristic because a miscount is recoverable in the correction panel
and a walk that ends itself is not.

The watch's endWalk command invokes the same ref. Routing it through the new
phone-side confirm would pop an Alert on a pocketed phone and the walk would
never end — the same failure with a new cause. The ref now points at
finishCleanup; the watch's own two-tap End is the confirmation.

RELATIVE PAUSE GATE. The absolute gate asks "are you above 1.3 m/s?". On B4 (20
picks, full stop for each, ambling between) that fired 3 times in 4 minutes,
while the walking segments threw 31 false positives — 48 counted for 20 real.
The contrast was in the data (stops 0.03-0.30 vs walking 0.5-1.15), just below
the threshold. isStillAtOwnPace() compares each event to the walker's own
trailing 30s median instead. Inert when that median is at or above
PACE_CONTEXT.strollMps, so picking without stopping (C6a) is untouched.

B5B (brisk walk, full stop per pick): 19 counted for 20 real, 0.95x. 14 at
stops, 4 while walking; the gate fired 24 times, 21 correctly.

STOP FLOOR (RELATIVE_PACE.minStopMps = 0.35), found on B5B. During a long stop
the trailing median collapses toward zero and ordinary sway starts reading as
"still at your own pace" — real cases at 0.28 vs 0.15, 0.26 vs 0.14, 0.17 vs
0.14. That inverts the gate and threatens the standing rule that back-to-back
picks in one spot must all count, since a cigarette pile IS a long stationary
stretch. Costs nothing: all 21 correct suppressions were above 0.5 m/s.

Not the cross-user pace baseline killed by C7a — this is within-walk, GPS only,
no HealthKit, no native change, works on Android.

Regression tests use the measured A7a / C6a / B4 / B5B numbers, including the
three stop-floor cases and one asserting the absolute gate catches none of them.
MSG

echo "==> Committed:"
git log -1 --oneline
echo
exec "$REPO/ota-tonight.sh"
