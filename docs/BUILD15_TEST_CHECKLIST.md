# Build 15 — On-device test checklist

Everything new since the last TestFlight build: walk accuracy, the follow/social layer, impact posts, live presence, streaks, push, the redesigned end-of-walk page, per-walk timestamps, and the Apple Watch companion.

## Prerequisites (do these first, or half the list won't work)
- [ ] `firebase deploy --only firestore:rules,functions` — enables the `live_walks` presence rule + follow/like push senders + the adoption-confirmation email function.
- [ ] Confirm the Trigger Email extension (`us-central1`) is installed and live.
- [ ] Have a **second account** (or a friend on the build) — follow, push, and live presence all need two users.
- [ ] Grant **Notifications** permission when the app asks (needed for push).

## Walk accuracy (the core fix — test outside, not from your apartment)
- [ ] Start a cleanup, then **stand still for ~30s before walking** → confirm **no false pickups** log before you actually start moving (the walking-onset gate).
- [ ] Walk normally and pick up → real pickups still count and the haptic/counter fires.
- [ ] Move fast (jog or a few seconds on a bike if safe) → the **"too fast" pill** appears and pickups are **not** counted (3.3 m/s cap).
- [ ] Walk **one side** of a street the whole way → only **that side** turns fresh, not both.
- [ ] Confirm a block you covered actually **turns green** (coverage threshold lowered to 0.6).

## End-of-walk / Session summary (redesigned)
- [ ] Stop the walk → summary shows the four amount chips (**Handful / Half a bag / A full bag / 2+**) and a single clear primary button.
- [ ] The logged walk shows a **timestamp**.
- [ ] Select a past walk → **share/export** works and walks are distinguishable by time.

## Follow system + profiles
- [ ] Set your **@handle**.
- [ ] Find the other account by **@handle** and by **exact email**; follow, then unfollow.
- [ ] Tap a **post author** and a **People-search result** → opens their public profile.
- [ ] Profile shows name / @handle / neighborhood, follower & following counts, opt-in stats, and their posts.
- [ ] Community feed **Following / Everyone** toggle filters correctly.

## Impact posts
- [ ] Create an **impact post** (map snapshot + stats: blocks adopted, cleanups, % green).
- [ ] It appears in the feed; **like** it and confirm the like sticks.

## Live "who's cleaning now"
- [ ] Start a walk on the second account → the first account's feed shows the **live banner** with a count and neighborhood name.
- [ ] **Privacy check:** the banner shows only the **neighborhood name — never coordinates**.
- [ ] Stop the walk → the banner clears (ages out within a couple minutes on a crash).

## Streaks + charts (Impact tab)
- [ ] **Streak card** shows current/best day-streak and the "clean today to keep it going" prompt.
- [ ] **Weekly goal** bar (3/week) reflects your cleanups.
- [ ] **8-week bar chart** renders your pickups.

## Push notifications (real device only)
- [ ] Follow the first account from the second → first account gets a **"new follower"** push; tapping opens the follower's profile.
- [ ] Like the first account's post → they get a **like** push; tapping opens the feed.

## Email
- [ ] **Adopt a block** → you receive the **"you adopted X" confirmation email** (needs Trigger Email live + `onAdoptionCreated` deployed).

## Apple Watch companion
- [ ] Start / end a walk **from the wrist**; Pickups shows as the hero number with Time below.
- [ ] **Haptic tick** on each pickup; **End-with-confirm** swipe works.
- [ ] Phone stays source of truth — stats **mirror** to the watch every few seconds.
- [ ] Watch app label reads **"PICK Watch"** on the watch.

## Notes
- Live Activity (lock-screen "cleanup in progress" card) is **not** in this build — deferred.
- JS-only issues you spot can ship over-the-air via `eas update`; native issues (push, watch) need a new build.
