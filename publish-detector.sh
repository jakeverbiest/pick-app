#!/usr/bin/env bash
#
# publish-detector.sh — ship ONLY the detector changes as an OTA update.
#
#   ./publish-detector.sh "detector: adaptive cooldown (striding 2500 / stationary 800)"
#
# Why this script exists (three failed publishes taught us):
#
#  1. `eas update` MUST run from apps/companion. There is no package.json at
#     the monorepo root, so EAS walks up the tree, finds ~/package.json, and
#     dies with "package.json is outside of the current git repository".
#
#  2. `eas update` bundles the WORKING TREE, not the last commit — unlike
#     `eas build`, which uses committed state. There are ~1,000 lines of
#     unrelated in-progress work sitting uncommitted (map.tsx, neighborhoods.ts
#     and friends). Publishing with those present ships them to every external
#     tester and muddies field-test results, because map.tsx and
#     backgroundSession.ts both touch the location pipeline the detector reads.
#     So they get stashed for the duration of the publish and restored after.
#
#  3. The restore must happen even when the publish FAILS. That is why the
#     stash pop is chained with `;` rather than `&&`, and why the cd into
#     apps/companion happens inside a subshell — so a failure can never strand
#     your work in a stash you have forgotten about.
#
# NOTE: when the Aug 12-13 batch (the OSM neighborhood-boundary work in
# neighborhoods.ts + its call site in map.tsx) is finally committed and
# shipped, delete it from STASH_PATHS below or it will keep being held back.

set -uo pipefail

REPO=~/Desktop/pick-app
APP="$REPO/apps/companion"
MESSAGE="${1:-}"

if [ -z "$MESSAGE" ]; then
  echo "usage: $(basename "$0") \"update message\"" >&2
  exit 2
fi

# Unrelated in-progress work to hold back. Detector files are deliberately
# absent — they are the point of the publish.
# NOTE (17 Aug): map.tsx and neighborhoods.ts were briefly removed from this
# list and shipping them CRASHED THE APP in production. They carry ~280 lines of
# Aug 12-13 work that had never executed on any device (every build came from the
# Aug 6 commit; every OTA stashed them). Do NOT ship them via OTA until they have
# been run and verified locally in Metro first. Original reasons they were pulled:
# Two reasons. (1) MIN_CLEANUP_SECONDS lives in map.tsx, so stashing it silently
# discarded a detector-testing change and shipped a build that looked updated but
# wasn't. (2) They carry the OSM admin-boundary fallback (getOsmHoodsInBounds +
# its call site) that removes the generic "Your area" circle outside NYC/Atlanta,
# which is wanted live and only works if BOTH ship together.
# The genuinely risky in-progress files stay held back: backgroundSession.ts
# touches the location pipeline the detector reads, and the auth/legal work is
# unrelated to any of this.
STASH_PATHS=(
  "apps/companion/app/(tabs)/map.tsx"
  "apps/companion/src/services/neighborhoods.ts"
  "apps/companion/app/auth/signup.tsx"
  "apps/companion/src/services/authService.ts"
  "apps/companion/src/services/backgroundSession.ts"
  "apps/companion/src/services/crashRecorder.ts"
  "apps/companion/src/services/streetSegments.ts"
  "apps/companion/src/constants/legal.ts"
)

cd "$REPO" || { echo "cannot cd to $REPO" >&2; exit 1; }

echo "==> Stashing unrelated work-in-progress"
STASHED=0
if git stash push -m "publish-detector: unrelated wip" -- "${STASH_PATHS[@]}" 2>&1 | grep -q "Saved working directory"; then
  STASHED=1
  echo "    stashed (will restore afterwards)"
else
  echo "    nothing to stash — continuing"
fi

echo "==> Publishing from apps/companion"
( cd "$APP" && npx eas update --branch production --message "$MESSAGE" )
PUBLISH_STATUS=$?

# Restore unconditionally — a failed publish must never strand your work.
if [ "$STASHED" -eq 1 ]; then
  echo "==> Restoring stashed work"
  git stash pop || {
    echo "!! stash pop failed — your work is safe but still stashed." >&2
    echo "!! recover it with: cd $REPO && git stash list && git stash pop" >&2
    exit 1
  }
fi

if [ "$PUBLISH_STATUS" -ne 0 ]; then
  echo "!! publish FAILED (exit $PUBLISH_STATUS). Working tree has been restored." >&2
  exit "$PUBLISH_STATUS"
fi

echo
echo "==> Published. On the phone: force-quit PICK, reopen, wait ~10s,"
echo "    force-quit and reopen again, then check Settings — the build stamp"
echo "    should have changed. If it hasn't, the new bundle isn't running yet."
