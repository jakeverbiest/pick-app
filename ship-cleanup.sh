#!/usr/bin/env bash
#
# ship-cleanup.sh — commit today's evidence + the last three OTA fixes, then
# test and publish.
#
#   ~/Desktop/pick-app/ship-cleanup.sh
#
# The code edits are already applied and typecheck clean. This just commits and
# ships them. Does NOT touch the two Swift files — those ride build 32.

set -uo pipefail
REPO=~/Desktop/pick-app
APP="$REPO/apps/companion"
cd "$REPO" || { echo "cannot cd to $REPO"; exit 1; }

# A failed commit earlier in the day can leave this behind, and the remote
# bridge can move but not delete files. Clear it so `git add` works.
[ -f .git/index.lock ] && mv .git/index.lock ".git/index.lock.stale.$$" && echo "==> cleared a stale .git/index.lock"

echo "==> Staging"
git add \
  .gitignore \
  "apps/companion/app/(tabs)/activity.tsx" \
  "apps/companion/src/services/motionDetection.ts" \
  ota-tonight.sh \
  docs/ || exit 1
git add -A docs/fielddata || true

echo
git diff --cached --stat
echo

if git diff --cached --quiet; then
  echo "nothing staged — already committed?"
else
  git commit -q -F - <<'MSG'
Commit the 19 Aug detector evidence, and close the last three OTA items

FIELD DATA. docs/fielddata/ holds the evidence behind every threshold in the
detector and was untracked until now — A7a, C6a, C7a, B4, B5B and B5 motion
logs, each reduced to (t, counted, reason, speed). Without it the reasoning
behind the relative pause gate is unreproducible.

DOCS. A7a_ANALYSIS.md (pace is the dominant variable; the duration hypothesis
tested and killed). B5_PREDICTION.md (a prediction frozen BEFORE the walk, with
the result appended: 20 counted for 20 real, 1.00x, every criterion passed).
PERSONAL_PACE_BASELINE_SCOPE.md (CLOSED — the HealthKit gait idea C7a ruled
out, kept because the findings are reusable if wrist fusion revives it).
SHIPPING_PLAN.md, LAUNCH_BUGLIST.md, and the group-walk brief.

EXPORT. exportCleanup() now emits pace_median_mps / pace_slow_share /
pace_low_confidence. Walks have stored them since c384599 but the export
dropped them, so pace had to be reconstructed by hand from per-event speeds —
most of the manual work in reading a log.

PHANTOM FIRST EVENT. Walks opened with an absurd first motion event (40643ms on
B5B, 602655ms on the indoor run). MotionShapeDetector is a module singleton and
startListening() reset a dozen this.* fields but never called resetRecording(),
so a window opened before the session finalized inside it. Rejected harmlessly
by the 500-5000ms bound, but real state carryover — and the first genuine event
of a walk could be mis-measured.

Also: .gitignore for the untracked junk (Pick Images/, design-audit/,
finish-commits.sh, and the unreferenced splash backup PNG, which was shipping
in every OTA bundle). And a stale buglist row corrected — pickupCounterRef IS
reset (map.tsx:1291, shipped in c384599) but was still listed as Open.

ota-tonight.sh is committed because it runs the test suites individually;
`npm test` chains with && , which hid two unrelated failures on 17 Aug.
MSG
  echo "==> Committed:"; git log -1 --oneline
fi

echo
echo "==> Typecheck"
( cd "$APP" && ./node_modules/.bin/tsc --noEmit ) || { echo "!! TYPECHECK FAILED — not publishing"; exit 1; }
echo "    clean"
echo
exec "$REPO/ota-tonight.sh"
