# Build 27 — On-device test checklist

Friends-and-family TestFlight round, week of 2026-08-17. Four app changes
this session (neighborhood load speed, international neighborhood
boundaries, streamlined signup, watch mid-walk fix) plus a reminder pass on
recent fixes that new installs are seeing for the first time. Everything
below is in build 27 (version 1.2.2) — [track it here](https://expo.dev/accounts/jakeverbiest/projects/pick-app/builds/46645c70-e4d7-4b08-a7da-2b58d7eca3a1).

## New this session — needs first-time testing

- [ ] **Neighborhood load speed** — activate a neighborhood you haven't
      visited before (or a fresh install so nothing's cached). Should load
      noticeably faster than prior builds. If it's still slow, note whether
      you eventually saw a "Still loading street detail…" banner instead of
      an indefinite spinner — that's the fallback working as designed, not
      a bug, but worth noting how long it took to appear.
- [ ] **International neighborhood boundaries** — if you're testing outside
      NYC or Atlanta (validated against London specifically, but should work
      broadly), confirm a real named neighborhood boundary shows up and is
      tappable, not just a plain unnamed circle around you.
- [ ] **Streamlined signup** — create a fresh account. Form should only ask
      for Display Name, Email, and one Password field (no Confirm Password,
      no Neighborhood). Confirm the account is created successfully and you
      land on the map afterward.
- [ ] **Watch mid-walk fix** — this is the highest-priority one to actually
      catch in the act. Start a walk with the Apple Watch connected, then
      try to trigger a Map screen remount mid-walk: background the app,
      switch tabs and back, lock the phone for a stretch, let it sit in your
      pocket a while. Watch for the pickup count on the watch face dropping
      to 0 and jumping back — that's the bug this build is meant to fix.
      Also fine to just walk normally and keep an eye out; it doesn't
      reproduce on demand.

## Recently fixed — likely first exposure on a fresh install

These already shipped via OTA update to existing installs, but anyone doing
a clean TestFlight install is seeing them for the first time in build 27:

- [ ] ImpactMap renders real street tiles (not a blank/placeholder map).
- [ ] A short or very localized cleanup shows as a dot on the map instead of
      vanishing entirely.
- [ ] "Share Your Impact" draws from your actual walked routes, not just
      streets you've formally adopted — should show activity even if you've
      never adopted anything.

## Established features — normal-use pass, not a specific hunt

- [ ] Haptic buzz fires on street-segment completion.
- [ ] Map never shows a blank "Null Island" ocean view when you have zero
      adopted blocks — shows the clean placeholder instead.
- [ ] Walking one side of a street only credits that side, not both.
- [ ] Apple Watch shows the navy colorway and the correct on-screen build
      number (should read **27**).

## Not in this build — don't expect these yet

- Adoption/nudge email redesign — ships separately via a Cloud Functions
  deploy, independent of the app binary; not deployed yet.
- GPS route-point sparsity fix — root-caused (background location task
  wasn't being read into the recorded route) but not yet implemented.
- Persistent adopted-street marking, watch-side Swift staleness guard for
  the mid-walk bug — not implemented this pass.

## Reporting back

For anything that doesn't work as expected, the most useful report is:
what you did, what you expected, what happened instead, and (if it's
walk/location related) roughly where and whether the screen was
locked/backgrounded at the time.
