#!/usr/bin/env bash
#
# ota-tonight.sh — pre-flight + OTA publish for the 18 Aug group walk.
#
#   ~/Desktop/pick-app/ota-tonight.sh
#
# Suites run INDIVIDUALLY on purpose: `npm test` chains with && , so the first
# failure hides every suite after it. That masked two unrelated problems on
# 17 Aug. Real assertion failures still block the publish; the one suite with a
# known harness limitation is skipped loudly rather than silently.
#
# Logged to ~/Desktop/pick-app/ota-run.log.

set -uo pipefail

REPO=~/Desktop/pick-app
APP="$REPO/apps/companion"
LOG="$REPO/ota-run.log"
# Publish message. Pass it as $1; the default is only a fallback so an
# argument-less run still works. It used to be hardcoded, which meant every
# later run published under the 18 Aug message.
MESSAGE="${1:-Pick OTA update}"

exec > >(tee "$LOG") 2>&1

echo "=============================================="
echo " Pick OTA pre-flight — $(date)"
echo "=============================================="
echo

cd "$APP" || { echo "!! cannot cd to $APP"; exit 1; }

echo "--- 1/4  Typecheck ---------------------------"
if ./node_modules/.bin/tsc --noEmit; then
  echo "    OK — tree typechecks clean."
else
  echo
  echo "!! TYPECHECK FAILED. Not publishing."
  exit 1
fi
echo

echo "--- 2/4  Unit tests --------------------------"
FAILED=""
for suite in detector geometry impact tiles recap; do
  echo
  echo ">>> test:$suite"
  if npm run --silent "test:$suite"; then
    :
  else
    FAILED="$FAILED $suite"
  fi
done

echo
echo ">>> test:hoods — SKIPPED, known harness limitation (not app code)"
echo "    polygonStats.test.ts -> neighborhoods.ts -> AsyncStorage -> "
echo "    react-native/index.js, which uses Flow syntax esbuild cannot parse."
echo "    Broken since commit 6094187 (14 Jul 2026), when AsyncStorage was"
echo "    added to neighborhoods.ts. Metro strips Flow, so the shipped bundle"
echo "    is unaffected, and tsc --noEmit already covers that same file."
echo

if [ -n "$FAILED" ]; then
  echo "!! REAL TEST FAILURES:$FAILED"
  echo "   Not publishing."
  exit 1
fi
echo "    OK — every runnable suite passed."
echo

echo "--- 3/4  What is live right now --------------"
echo "    (the top entry is what testers currently have)"
npx eas update:list --branch production --limit 5
echo

echo "--- 4/4  Publish -----------------------------"
echo "    Message: $MESSAGE"
echo
echo "    Reminder: eas update ships the WORKING TREE."
echo "    Uncommitted right now (these ship too — read the list, do not assume):"
git -C "$REPO" status --short || true
echo
echo "    Swift files in that list are harmless: native code cannot enter an"
echo "    OTA bundle at all. Anything under apps/companion that is JS/TS WILL"
echo "    ship. Do not stash to exclude it — see publish-detector.sh."
echo
"$REPO/publish-detector.sh" "$MESSAGE"
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  echo "=============================================="
  echo " PUBLISHED. Now verify on the phone:"
  echo "   1. Force-quit PICK, reopen, wait ~10s"
  echo "   2. Force-quit and reopen AGAIN  (fetch-then-apply is a two-launch"
  echo "      cycle — a 19 Aug 'failure' was void because of exactly this)"
  echo "   3. Exercise whatever this update changed, and confirm it functionally"
  echo
  echo " Check it functionally, not by the build-stamp hex —"
  echo " consecutive EAS update IDs share long prefixes."
  echo "=============================================="
else
  echo "!! PUBLISH FAILED (exit $STATUS). Nothing shipped."
  echo "   Log: $LOG"
fi
exit "$STATUS"
