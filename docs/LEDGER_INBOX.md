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

- **2026-09-10 — city search was silently overridden by the idle-recenter effect; fixed, likely
  broken since launch, not a recent regression.** Jake: typed "Amsterdam," selected it, map stayed
  on Brooklyn. Root cause: the idle-recenter effect (`6094187`, 2026-07-14) fires on every
  `currentLocation` change while not mid-walk, unconditionally re-centering the map AND
  re-resolving the area name to the real GPS fix. It shipped ONE DAY before the city switcher
  (`712b12c`, 2026-07-15) and has no awareness `goToCity()` exists — the next location tick after
  any city selection eased the map straight back and overwrote `currentArea.city`, often within
  seconds. **This has likely been broken since the city switcher launched two months ago**, not
  something that recently broke — a latent conflict between two features nobody happened to test
  against each other in exactly this timing window.

  Confirmed scope before fixing rather than assumed: the city switcher only renders `!isListening`
  (the header's own condition), and the idle-recenter effect carries the identical guard, so the
  fix only needed to touch that one effect. Checked the other two `window.updateLocation` call
  sites — one is `isListening`-gated (walk-time route drawing; city switcher isn't reachable during
  a walk anyway) and one fires only once on initial WebView load (a legitimate default, not part of
  the repeating symptom) — neither needed to change.

  **Fix:** `viewingOtherCityRef`, set `true` in `goToCity()`, checked as an early-return guard in
  the idle-recenter effect, cleared only by `recenter()` — the one explicit "snap back to me"
  action. A ref rather than state since nothing needs to re-render when it flips. A fresh mount
  resets it to `false` automatically. Published OTA, update group
  `ab272758-de2e-40ef-b618-138476584fdc`. `tsc --noEmit` clean. **Not yet tested live** — static
  analysis only, no simulator/device run before shipping; worth a real check on the next
  city-search attempt.

- **2026-09-10 — the ACTUAL root cause of city search doing nothing, found after the first fix
  didn't resolve it: `map.setView` doesn't exist on MapLibre GL. Three silently-broken calls
  fixed, verified against the real library before shipping.** Jake's answer to "did it move at all
  vs. never moved" — never moved — ruled out the earlier `viewingOtherCityRef` fix (real, still
  correct, but irrelevant here) and pointed at the map command itself never taking effect.

  **Verified, not assumed:** loaded real `maplibre-gl 4.7.1` (the exact CDN version pinned in this
  app) in a browser and called `map.setView` directly. `typeof map.setView` is `"undefined"`;
  calling it throws `"map.setView is not a function"`. `jumpTo`/`easeTo` both exist.

  **Root cause:** the 2026-09-08 MapLibre port (`1929786`) replaced the WebView's OWN Leaflet
  initialization and internal calls, but missed three places OUTSIDE the WebView's script —
  `exitLevel()`, `goToCity()`, `recenter()` — that inject `map.setView(...)` as a JS string from the
  React Native side at runtime. **All three have silently done nothing for two days**: each sits
  inside an EMPTY `try {} catch (e) {}`, so the thrown error was swallowed with no log, no crash,
  nothing visible — exactly "didn't move at all." **`recenter()` — the "snap back to me" button,
  used far more than city search — has also been silently broken since the port**, and so has
  exitLevel's recenter-after-leaving-a-neighborhood.

  **Fixed all three:** `jumpTo` (instant, matching Leaflet's `setView` semantics — not an animation
  change) and `[lon, lat]` order (MapLibre's convention, matching `window.updateLocation`'s own
  `easeTo` already inside the WebView, which already had this right). Every catch block now logs
  instead of swallowing, so a failure like this can't hide silently again.

  **Re-verified before shipping, learning from the first fix's failure:** loaded the exact new call
  shape (`map.jumpTo({center:[lon,lat], zoom})`) against the real library — center moved from
  `40.7128,-74.006` to `52.3730796,4.8924534` at zoom 13, matching `goToCity`'s Amsterdam call
  precisely, zero errors. Published OTA, update group `671eca98-42a3-4d19-9f68-c19f445f924e`.

  **This morning's `viewingOtherCityRef` fix (previous entry) was real and is still correct** — the
  idle-recenter effect really did conflict with `goToCity`, and that fix stops it from fighting a
  future `easeTo`/`jumpTo` call. It just never got the chance to matter, since the map was never
  moving in the first place. Both fixes are needed together, not either instead of the other.

- **2026-09-10 — CONFIRMED by Jake: city search works after the setView -> jumpTo fix
  (`671eca98`).** Closes the loop from the two prior entries. `recenter()` and `exitLevel()` share
  the identical fix and were shipped in the same commit, but neither has been explicitly confirmed
  by Jake yet — flagged so a future session doesn't assume they're verified just because city
  search is.

- **2026-09-10 — recenter() partially confirmed by Jake (map correctly snaps to Brooklyn), and the
  half he flagged as still off is real: the header kept the browsed-away city ("Hickory") instead
  of showing Brooklyn immediately.** Root cause: `goToCity()` has always optimistically set the
  city label the instant a city is picked, then refines it via an async geocode — its own comment
  says as much. `recenter()` never had the matching optimistic half, only the async `refreshArea()`
  call. That gap predates today — it was invisible while the map itself wasn't moving at all (the
  `setView` bug), so there was no instant snap to look wrong against. Now that `jumpTo` is instant,
  the stale label is the visible symptom.

  **Fixed:** `homeAreaRef` stashes the real-location `{city, neighborhood}` the moment `goToCity()`
  is about to overwrite it, guarded on `!viewingOtherCityRef` so hopping between multiple other
  cities (Amsterdam, then Hickory) only ever captures the true home value once. `recenter()`
  restores it instantly alongside the map jump, then still calls `refreshArea()` to refine/confirm
  it — same pattern `goToCity` already uses safely. `tsc --noEmit` clean. Published OTA, update
  group `74304d42-8b1d-455e-820f-dbc95ab1cd5a`. **Not yet confirmed by Jake** — this is a fix for
  what he just reported, not something he's seen live yet.

  **`exitLevel()` remains entirely unconfirmed** — same three-way fix landed together, but neither
  the map-jump half nor a label-restore half (it doesn't have this gap; it doesn't touch
  `currentArea` at all, only re-centers) has been tested.

- **2026-09-10 — CONFIRMED by Jake: recenter()'s label-restore fix (`74304d42`) works — text
  correctly returns to Brooklyn.** Tested from the overview, NOT from inside a neighborhood level —
  Jake explicitly flagged this distinction, correctly, since that's a different code path.
  `exitLevel()` (triggered by backing OUT of a neighborhood level, not by the recenter button)
  remains completely unconfirmed — same map.setView -> jumpTo fix, never tested.

- **2026-09-10 — recenter() from inside a neighborhood level: dimming stayed stuck, confirmed by
  precise repro before touching code, and fixed.** Jake followed exact steps (tap into a
  neighborhood, don't back out, open tools, tap Recenter) and confirmed the dimmed veil + its %
  stat stayed locked on the original neighborhood even though the camera moved. This matched a
  prediction made from reading the code BEFORE asking Jake to test — only `exitLevel()` (the
  explicit back button) ever cleared `activeLevel`; `recenter()` never did, and the tools menu's
  Recenter option is deliberately reachable from inside a level (gated on `!isListening &&
  !activating`, unlike the header/city switcher which hide there) — a real, directly reachable path,
  not a theoretical edge case.

  **Fix:** extracted the React-state half of `exitLevel()`'s teardown into a shared
  `teardownLevelState()` (activation token bump, `activeLevel`/`activating`/`selectedHood`/
  `liveNowCount`/`activationError` cleared, `levelSegmentsRef` reset), so `exitLevel()` and
  `recenter()` share one sequence instead of risking drift between two copies. `recenter()` now
  calls it when `activeLevel` is set, and its injected JS also calls `window.exitLevel()` (tears
  down the visual veil) before the `jumpTo` — the same call `exitLevel()` already makes
  unconditionally, so this follows existing precedent. `tsc --noEmit` clean. Published OTA, update
  group `62024161-9a4e-436f-9a10-2b28c2003078`. **Not yet re-tested by Jake** — same repro steps as
  before should now show the dimming clearing.

  **This is now the fourth real bug found from one original report** ("map doesn't change when I
  enter a new city"): the setView/jumpTo API mismatch (3 call sites), the idle-recenter-effect
  conflict with goToCity, the missing optimistic label restore on recenter, and now this
  level-mode teardown gap. Each was found by testing the PREVIOUS fix rather than assuming it was
  complete — worth keeping as the model for how this class of bug gets fully closed out rather than
  declared fixed after the first plausible cause.
