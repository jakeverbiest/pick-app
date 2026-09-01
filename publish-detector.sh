#!/usr/bin/env bash
#
# publish-detector.sh — ship the current tree as an OTA update.
#
#   ./publish-detector.sh "detector: adaptive cooldown"
#
# THIS SCRIPT NO LONGER STASHES ANYTHING, AND THAT IS THE WHOLE POINT.
#
# It used to hold back unrelated in-progress files so field tests had a clean
# surface. On 17 Aug that stashing crashed the app on launch for every tester:
# `map.tsx` and `neighborhoods.ts` were published while `streetSegments.ts`,
# `backgroundSession.ts` and `crashRecorder.ts` were held back, so the shipped
# bundle imported three functions that did not exist in it. The map tab is the
# initial route, so it threw before anything rendered.
#
# The code was fine. Splitting it was the bug. `eas update` bundles the working
# tree, and a working tree is not a menu — interdependent files must ship
# together. So: commit what you want live, then publish everything.
#
# Two things this still does, because both have bitten:
#   1. Runs from apps/companion. There is no package.json at the repo root, so
#      EAS walks up to ~/package.json and dies with a git-root mismatch.
#   2. Warns loudly about uncommitted files, since those ship too and are the
#      most likely thing to surprise you afterwards.

set -uo pipefail

REPO=~/Desktop/pick-app
APP="$REPO/apps/companion"
MESSAGE="${1:-}"

if [ -z "$MESSAGE" ]; then
  echo "usage: $(basename "$0") \"update message\"" >&2
  exit 2
fi

cd "$REPO" || { echo "cannot cd to $REPO" >&2; exit 1; }

# eas update bundles the working tree LOCALLY via Metro, which inlines
# EXPO_PUBLIC_* vars from the SHELL's own process.env at bundle time — a
# completely separate mechanism from EAS's registered "production" env vars
# (those only apply to `eas build`, run on EAS's cloud servers). This has
# shipped a broken CARTO key three times (31 Aug native build, 1 Sep OTA x2)
# because the operator forgot to source .env into the shell first. Do it here
# instead of relying on memory.
if [ -f "$APP/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP/.env"
  set +a
elif [ -f "$REPO/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env"
  set +a
fi
if [ -z "${EXPO_PUBLIC_CARTO_API_KEY:-}" ]; then
  echo "⚠️  EXPO_PUBLIC_CARTO_API_KEY is not set (checked $APP/.env and $REPO/.env)." >&2
  echo "    The map will ship with the API-key-required watermark. Fix .env or set it" >&2
  echo "    in the shell before publishing." >&2
  printf "    Continue anyway? [y/N] "
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "    aborted."; exit 1;; esac
fi

# Scan the whole app package, not just app/ and src/. The narrow version
# missed app.json and assets/, so a splash change reported "clean" and then
# shipped anyway. Anything under apps/companion goes into the bundle.
DIRTY=$(git status --porcelain -- 'apps/companion' | grep -v '^??' || true)
# Untracked files ship too — `eas update` bundles the working tree, so Metro
# picks up a brand-new component whether or not git knows about it. They are
# called out separately because they are the ones that bite LATER: `eas build`
# uses committed state, so an uncommitted new file builds fine over OTA and
# then fails the next native build.
UNTRACKED=$(git status --porcelain -- 'apps/companion' | grep '^??' || true)
if [ -n "$UNTRACKED" ]; then
  echo "📄 Untracked files — these WILL ship in the bundle but are NOT in git:"
  echo "$UNTRACKED" | sed 's/^/      /'
  echo "    Commit them before the next native build or it won't compile."
  echo
fi
if [ -n "$DIRTY" ]; then
  echo "⚠️  Uncommitted app code — this WILL be published:"
  echo "$DIRTY" | sed 's/^/      /'
  echo
  echo "    Fine for a field-test build. If it's meant to be permanent, commit"
  echo "    it first so the shipped bundle matches a known revision."
  echo
  printf "    Continue? [y/N] "
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "    aborted."; exit 1;; esac
fi

echo "==> Publishing from apps/companion"
( cd "$APP" && npx eas update --branch production --message "$MESSAGE" )
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "!! publish FAILED (exit $STATUS)." >&2
  exit "$STATUS"
fi

echo
echo "==> Published. On the phone: force-quit PICK, reopen, wait ~10s,"
echo "    force-quit and reopen again, then check Settings — the build stamp"
echo "    should have changed. If it hasn't, the new bundle isn't running yet."
