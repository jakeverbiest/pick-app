#!/usr/bin/env bash
#
# ship-fixes.sh — commit the 19 Aug fixes, then test + publish them.
#
#   ~/Desktop/pick-app/ship-fixes.sh
#
# Commits the six app files that are real, permanent work (so the shipped
# bundle matches a known revision), then hands off to ota-tonight.sh which
# typechecks, runs the suites, shows what's live, and publishes.
#
# Deliberately does NOT commit:
#   targets/watch/PhoneLink.swift  — your pending call on the watch stale-snapshot
#                                    guard. Native, so it can't ship OTA anyway.

set -uo pipefail
REPO=~/Desktop/pick-app
cd "$REPO" || { echo "cannot cd to $REPO"; exit 1; }

echo "==> Staging the 19 Aug fixes"
git add \
  "apps/companion/app/(tabs)/activity.tsx" \
  "apps/companion/app/(tabs)/map.tsx" \
  "apps/companion/package.json" \
  "apps/companion/src/services/motionEvaluation.ts" \
  "apps/companion/src/services/firebaseDatabase.ts" \
  "apps/companion/src/types/index.ts" \
  "apps/companion/src/services/__tests__/detectorRegression.ts" || exit 1

echo
echo "==> Staged:"
git diff --cached --stat
echo

git commit -q -F - <<'MSG'
Pace context on every walk, plus two counter fixes

A7a vs C6a (19 Aug, same tester, same phone, 90 min apart) showed pace is the
dominant variable in pickup overcounting: 0.73 m/s produced 9.7 false
positives/min, 1.19 m/s produced 2.0. The filter stack keys on stride vigor and
a stroll has none — countDistinctPeaks rejected 48 events as rhythmic motion on
C6a and ZERO on A7a.

walkPaceProfile() summarises a walk's pace and flags it when more than half its
speed samples fall below 1.0 m/s (A7a measured 92%, C6a 18%, so the threshold
sits mid-gap). Stored on every cleanup as pace_median_mps / pace_slow_share /
pace_low_confidence so future tuning never has to reconstruct pace by hand.

Deliberately NOT a filter: it separates those two walks perfectly only because
one is a stroll, and it cannot tell a stroll with picking from a stroll without.
A continuous slow walk is the stated normal technique, so this only ever invites
a correction — it never suppresses a count.

Also fixed:
- pickupCounterRef was never reset between walks. It feeds the challenge live
  counter and the crash heartbeat, so the 2nd+ walk in one app lifetime
  over-reported both.
- exportCleanup() emitted `items_detected: cleanup.items_count`, hiding the raw
  detector figure on every corrected walk — the one number that field exists for.
  Now emits both. Stored data was never affected.
- Dropped the phantom test:calibration npm script; it pointed at a file that has
  never existed in this repo, and `npm test` chains with && so it hid every
  suite after it.
MSG

echo "==> Committed:"
git log -1 --oneline
echo
echo "==> Handing off to ota-tonight.sh"
echo
exec "$REPO/ota-tonight.sh"
