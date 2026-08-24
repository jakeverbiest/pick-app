#!/usr/bin/env bash
#
# ship-watch.sh — gate, commit, and OTA-publish the 24 Aug watch changeset.
#
#   ~/Desktop/pick-app/ship-watch.sh
#
# Ships FOUR files as one changeset:
#   A  targets/watch/PhoneLink.swift    stale-snapshot guard, both delivery paths
#   B  targets/watch/PhoneLink.swift    lastAppliedAt on the stale-reject branch
#   C  targets/watch/ContentView.swift  6s confirm auto-disarm + button swap
#   D  app/(tabs)/map.tsx               wall-clock watch-push throttle  [OTA]
#
# Only D can ship over the air. A/B/C are Swift and ride build 32.
#
# DOES NOT CUT BUILD 32. That build is planned to carry the keep-awake change
# too, and keep-awake is still an open decision. It is also the 14th of 15 EAS
# builds this month, with one held in reserve for an App Review rejection fix.
# The build command is printed at the end for you to run deliberately.
#
# `eas update` publishes the WORKING TREE, not HEAD. That is why xcodebuild and
# the commit both run BEFORE the publish, and why nothing here stashes: a split
# changeset crashed the app on 17 Aug.

set -uo pipefail

REPO=~/Desktop/pick-app
APP="$REPO/apps/companion"
cd "$REPO" || { echo "!! cannot cd to $REPO"; exit 1; }

# A failed commit can leave this behind, and the remote bridge can move but not
# delete files. Clear it so `git add` works.
[ -f .git/index.lock ] && mv .git/index.lock ".git/index.lock.stale.$$" && echo "==> cleared a stale .git/index.lock"

echo "=============================================="
echo " Pick — watch changeset — $(date)"
echo "=============================================="
echo

echo "--- 1/4  Swift compile gate ------------------"
echo "    A, B and C have NEVER been compiled. Neither the 23 Aug session nor"
echo "    the 24 Aug one had a Swift toolchain. This is the real gate."
echo
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "!! xcodebuild not found. Run this on the Mac, not from a remote session."
  exit 1
fi
# -destination, NOT -sdk. `-sdk iphonesimulator` forces that SDK on EVERY
# target in the workspace, including the embedded watch app — and the watch
# AppIcon is tagged "platform": "watchos", so actool finds no icon for iOS and
# CompileAssetCatalogVariant fails. That is a flag bug, not a code bug; it cost
# one run on 24 Aug. -destination lets Xcode pick watchsimulator for PICKWatch
# and iphonesimulator for PICK, which is what a normal build does.
XCLOG="$REPO/xcodebuild-watch.log"
if xcodebuild \
    -workspace "$APP/ios/PICK.xcworkspace" \
    -scheme PICK \
    -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$APP/ios/build_out" \
    build > "$XCLOG" 2>&1; then
  echo "    OK — builds clean, watch target included."
  echo "    Full log: $XCLOG"
  grep -nE "PhoneLink|ContentView" "$XCLOG" | grep -iE "warning|error" && echo "    ^ warnings in OUR files, read them" || true
else
  echo
  echo "!! XCODEBUILD FAILED. Nothing committed, nothing published."
  echo "   Full log: $XCLOG"
  echo
  echo "   --- error lines ---"
  grep -nE "error:|BUILD FAILED|The following build commands failed" -A2 "$XCLOG" | head -40
  echo
  echo "   --- anything in the files this changeset touches ---"
  grep -nE "PhoneLink\.swift|ContentView\.swift" "$XCLOG" | head -20 || echo "   (nothing — the failure is elsewhere)"
  exit 1
fi
echo

echo "--- 2/4  Commit ------------------------------"
git add \
  "apps/companion/app/(tabs)/map.tsx" \
  "apps/companion/targets/watch/PhoneLink.swift" \
  "apps/companion/targets/watch/ContentView.swift" \
  docs/LAUNCH_LEDGER.md \
  ota-tonight.sh \
  ship-watch.sh || exit 1

echo
git diff --cached --stat
echo

git commit -q -F - <<'MSG'
Watch: guard stale snapshots on both delivery paths, and stop starving the clock

FIELD SYMPTOM (24 Aug): the watch intermittently flashes an old pickup count.
First field evidence this thread has had — the failure had only ever been
reasoned from code.

MECHANISM. `receivedApplicationContext` is a one-slot cache the system holds.
On watch app launch, apply() runs it with cached:true, the staleness check
fires, and resetToIdle() paints 0. But resetToIdle() does not touch
lastAppliedAt, so it is still 0 — and when watchOS re-delivers that same queued
context on the ONGOING didReceiveApplicationContext path (cached:false), the
committed staleness check is skipped entirely (it gated on `cached`) and the
out-of-order check passes against a zeroed lastAppliedAt. The old count paints
back over the 0. Intermittent because re-delivery depends on suspension state,
and self-correcting because the next live payload overwrites it: a flash.

Two fixes, either of which alone closes it:

  1. The staleness CHECK now runs on both delivery paths. The RESPONSE splits,
     because age means different things on each: resetToIdle() on the
     activation snapshot or on an explicit state:'idle'; drop-the-payload-and-
     keep-current-state on an unverifiable stale ACTIVE payload. That last
     branch matters — resetToIdle() calls WorkoutSession.end(), which is
     reachable mid-walk on the ongoing path, and killing the workout session
     makes the app MORE suspendable and puts the watch back on the Start screen
     during a live walk. A quiet phone is not the same as a finished walk.

  2. The stale-reject branch now records lastAppliedAt, so a re-delivery is
     rejected by the out-of-order check too, independent of wall-clock age.

Also ContentView: the End confirm auto-disarms after 6s and "Keep Going" is
promoted above "End Walk". Latent bug found 19 Aug while chasing the pocket
stops — ruled out as their cause, kept because one stray tap used to arm the
confirm for the entire rest of the walk.

And map.tsx [OTA]: the watch-stats push was throttled on `elapsedSeconds % 3`,
but this effect is driven by a 1Hz setInterval and iOS throttles JS timers
while backgrounded — every real walk. elapsedSeconds is recomputed from a
wall-clock anchor, so dropped ticks make it JUMP and the %3 test can miss for
long stretches, starving the watch's clock. Now a wall-clock check. Counts were
never throttled and still are not. Same treatment for the Live Activity
heartbeat, on its own timer so it keeps its ~3s cadence instead of inheriting
push-on-every-pickup — ActivityKit budgets updates.

Tooling: ota-tonight.sh took its publish message from a hardcoded 18 Aug
string, so every run since published under the wrong message — it now takes $1.
Its "two files are uncommitted" note was also hardcoded and had gone stale; it
now prints live `git status --short`. ship-watch.sh added, same shape as the
other ship-*.sh scripts, with xcodebuild as a hard gate before any commit.

Does NOT include the keep-awake / sessionMode decision, still open. Build 32 is
deliberately NOT cut here.
MSG
echo "==> Committed:"; git log -1 --oneline
echo

echo "--- 3/4  Typecheck + suites + OTA publish ----"
echo "    Publishing D only in practice: A/B/C are Swift and are not in an OTA"
echo "    bundle. The working tree is clean of other JS, so this update carries"
echo "    exactly the throttle change."
echo
exec "$REPO/ota-tonight.sh" "Watch: guard stale snapshots on both paths; wall-clock watch-push throttle"

# --- 4/4 -------------------------------------------------------------------
# Not reached: ota-tonight.sh execs. Build 32, when keep-awake is decided:
#
#   cd ~/Desktop/pick-app/apps/companion
#   eas build --platform ios --profile production
#
# That is the 14th of 15 EAS builds this month. One left after it.
