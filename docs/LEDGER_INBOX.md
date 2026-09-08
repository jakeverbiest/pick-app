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

- 2026-09-08 — Ran the detector telemetry export (`exportDetectorTelemetry`), scoped to Jake's
  own account only (`user=9e34P8xZ8yU4dyVuznXMWanKxT22`), per the 2026-09-07 standing decision
  recorded in `detectorExport.js` (own-account data raises no retroactive-disclosure question;
  the ~24 other-tester pre-disclosure walks stay excluded). Jake reconfirmed this reasoning
  directly in chat 2026-09-08 and separately confirmed no one has walked with detector
  instrumentation since the Sep 6 disclosure date, so this only unlocks pre-existing history, not
  new data. **Result: ok:true, row_count 174** (up from the 138 cited in the 2026-09-07 decision
  comment — some rows lack items_detected/motion_log, e.g. very early walks before that
  instrumentation existed; not every row is equally usable for tuning). No signed download URL
  (same `iam.serviceAccounts.signBlob` gap noted in the function's own code comments) — fetched
  directly from Cloud Storage instead, using the existing admin service-account key
  (`~/.secrets/pick-app/serviceAccountKey.json`, the same one `create-sponsor-team.js` uses) via a
  one-off Node script, same pattern as that existing tool. File: `gs://pick-app-74c2e.firebasestorage.app/detector_exports/2026-09-08T14-07-41-877Z.ndjson`
  (174 lines NDJSON, ~5MB, handed to Jake directly — not committed to this repo). This is now real
  tuning material, though several rows predate `items_detected`/`motion_log` instrumentation
  (17-19 Aug) and are duration/count-only.

- 2026-09-08 — Precache seed-offset fix (`d93873b`) deployed to production (`firebase deploy
  --only functions`, all 25 functions updated clean, including
  `runOverpassPrecacheRefresh`/`scheduledOverpassPrecacheRefresh`/`scheduledOverpassPrecacheDrip`,
  the ones carrying `gridKeysAround`). Future roster rebuilds will no longer reintroduce the
  631m-offset bug. **Note on sequencing: `repair-precache-seeds.js --apply` was actually run
  BEFORE this deploy landed** (a shell got stuck mid-session replaying an old unterminated quote,
  silently swallowing an earlier deploy attempt — caught and redone). Despite running against the
  still-undeployed old code, the repair found **0 of 1,226 tiles** needing recentering and **0 of
  78** `precache_streets` docs to delete — not the ~56/56 the 2026-09-07 bug report described.
  Independently verified the named Fort Greene cell (`40.67_-74.00`) directly against Firestore:
  currently 0m offset from true center. Cause of the discrepancy (roster already correct before
  this session touched it, vs. some other explanation) **not resolved** — the pre-repair state is
  gone (the script recomputes and overwrites in one pass, no snapshot taken first). Not chased
  further since the observable state is correct and the code fix is now deployed either way. One
  real side effect from the repair run: cursor was unconditionally reset 40 → 0 regardless of
  whether anything needed fixing, so the drip is re-warming already-cached Brooklyn tiles instead
  of advancing into new territory — costs ~1.2 days of coverage progress, not itself a bug.

- 2026-09-08 — Checked App Store Connect's External Testing public-link group per the Public-beta
  table's "Tester limit — set?" row: there is no settable per-group tester cap in the UI. The
  10,000 figure is Apple's fixed ceiling for external testing, applied automatically once a public
  link is enabled — not a configurable field. The only real levers to cap testers below that are
  turning the public link off (reverts to invite-only) or manually pulling it at a self-chosen
  count; neither is automatic. Jake confirmed he's fine running uncapped for now. This row's
  "CHECK" framing assumed a settable limit that doesn't exist — should close as N/A, not "set?".

- 2026-09-08 — Beta App Description CLOSED. Jake pasted the Sep 7-rechecked draft from
  `docs/PUBLIC_BETA_GONOGO.md` into App Store Connect (TestFlight → Test Information), along with
  the feedback email (`hello@pickglobal.org`) and privacy policy URL (`pickglobal.org/privacy`,
  the canonical live copy). Live now, no build required. Public-beta table's "Beta App
  Description — current?" row should close.

- 2026-09-08 — **FIRST REAL DETECTOR ACCURACY MEASUREMENT. Cleanup `LIEYG6ezcsDcQpxIIOF2`, an
  outdoor walk with per-pick watch ground truth: 35 real picks, 15 detected. Recall 0.43x, and
  ZERO false positives.** 6.6 min, pace median 1.27 m/s, slow share 0.23, carry `pocket`,
  iPhone14,7. First walk in PICK's history that can score the detector against what actually
  happened rather than against a bare total.
  **The two headline numbers point opposite ways and both matter.**
  (1) **No false positives at any window** — plus/minus 3s, 5s and 8s all give 0 counted events
  without a tap nearby. All 15 counted events correspond to a real pick. The detector never
  invented a pickup. That is a defensible property to put in front of an organization.
  (2) **It missed 20 of 35 real picks, and the misses are NOT sensor blindness** — for all 20 the
  sensor recorded motion within 5s; zero misses had no nearby event. The filters rejected real
  picks. Grouped over all 161 events: **"rhythmic motion (walking?)" 58%**, **"still at own pace"
  20%**, "ok" 9%, "walking context" 6%, cooldown 3%, low rotation 2%.
  **Mechanism: the detector is tuned for stop-bend-pick-resume, and Jake was grabbing on the
  move.** 35 picks in 6.6 min is one every 11 seconds — at that rate you do not break stride, and
  both dominant rejection reasons are exactly the ones that fire when you don't. Same
  PACE-is-dominant finding as the A7/C6/C7 group walk, from the other end: invisible at a stroll,
  invisible again at a brisk working pace.
  **Tap-confound hypothesis is dead and the protocol is validated.** All 15 matched events land
  **0-3s AFTER the tap, median +2s** — consistent with tapping before the bend and the detector
  firing on the bend. A tap-generated detection would cluster at ~0s and would also appear on taps
  that weren't picks. Neither happens. The 2026-09-07 3-of-4 observation was chance, as suspected.
  **SECOND, LARGER PROBLEM in the same record: `items_count` == `items_detected` == 15 while the
  truth was 35.** The user-confirmed count inherited the detector's number because it was not
  corrected at save. So "confirmed" totals across the corpus are NOT independent ground truth —
  they are detector output unless someone actively edited them. Any analysis treating
  `items_count` as truth (including the 8.8 picks/min median used for content planning on
  2026-09-07) is measuring the detector, not reality.
  **Why this is now the top launch risk rather than a tuning detail:** the shareable output
  artifact is the product. A card reporting 15 when a crew picked 35 undercounts a corporate event
  by more than half, and the org will know — they carried the bags. Under-reporting is safer
  reputationally than over-reporting; it is not safe commercially.
  Still n=1: one walk, one person, one phone, one carry position.

- 2026-09-08 — **Content pipeline built: real walk data to MP4, no screen recording.**
  `tools/render/render-video.mjs` (headless Chrome over CDP, no puppeteer) +
  `tools/pngs-to-mp4.swift` (AVFoundation, no ffmpeg) + `tools/render/frame-template.html`.
  Zero npm dependencies deliberately — this Mac has no ffmpeg, ImageMagick or node-canvas, but
  Chrome and swiftc are already here for other reasons. Verified end to end on
  `7NtmH6qcvc4wBUSGDGrI`: 1080x1350, 360 frames at ~86 ms/frame (~31s), 4.1 MB.
  **Why not a screen recording, recorded so it isn't re-proposed:** capturing the live map means
  holding the phone screen-awake for the whole walk, flipping `carry_mode` from `pocket` to
  `hand` — the mode with no detector tuning behind it — and filming someone using the app wrong.
  Rendering from the stored track is deterministic, re-renderable at any speed or aspect ratio,
  and is the actual recorded data.
  Two honesty decisions baked in: the route is **broken at GPS gaps rather than bridged** (six gaps
  up to 1,992 m on that walk; bridging draws invented lines and implies 11.07 km at 2.80 m/s,
  running speed for a walking cleanup), and **no distance figure is shown** because the thinned
  track cannot support one. Framing uses the 4th-96th percentile of lat/lon, not full extent —
  fitting to extent is the documented `GROUP_IMPACT_MAP_SPEC` failure where strays waste the
  frame, and it reproduced exactly here until fixed.
  Also published as an artifact ("Sidewalk Ledger"). Multi-crew is the same renderer with N tracks
  over one shared street layer; the limiter is track density, not the renderer — 86 m median
  sampling makes any single route coarse.

- 2026-09-08 — **I shipped a regression to production and caught it only after publishing.**
  While investigating a CARTO "API KEY REQUIRED" watermark on the monthly recap, I centralised the
  four hand-copied tile URLs into `src/pick/basemap.ts` — a good change — but wrote it as
  `const KEY = process.env.EXPO_PUBLIC_CARTO_API_KEY` followed by a ternary. **Expo inlines
  EXPO_PUBLIC_* by TEXTUAL SUBSTITUTION of the literal expression at build time; it is not a
  runtime lookup.** Behind a variable it is never substituted, so KEY was undefined, the ternary
  took the empty branch, and the published bundle carried a URL ending at `.png` with no key
  parameter — removing the key from **all four maps at once**, in an OTA, while trying to fix a
  watermark on one of them. Fixed and republished within ~10 minutes
  (`f51f2589-bf22-4223-8ac8-c728cb9c1538`). The trap is now documented in the file itself.
  **Two verification lessons, both mine, both worth keeping:**
  (1) **Never grep a Hermes bundle for `key=undefined`.** An un-substituted env var becomes the
  `undefined` KEYWORD, not that text, so the search returns zero whether or not the key is present.
  I cited that non-result as proof twice.
  (2) **`strings` output boundaries are arbitrary** — Hermes packs the string table so unrelated
  constants run together, and template literals are split into fragments. A grep for a whole
  interpolated log line, or for the key adjacent to the URL, returns nothing either way. The
  reliable checks are: does `light_all/{z}/{x}/{y}.png?key=` exist as a constant, and does the key
  appear anywhere in the bundle. Both must be 1.
  **The original watermark is still unexplained.** The key is valid (a direct tile fetch with it
  returns a clean PNG at both z5 and z16; without it, the watermarked one). `ImpactMap`'s exact
  tile config rendered headless makes 6 tile requests, all keyed, and produces a clean map. The
  code and the bundle both look right, yet build 81fb showed the watermark on the August recap.
  Cache is the remaining hypothesis and is untested.
  **Separately, visible in the same screenshot and arguably the bigger problem:** the August recap
  map spans Brooklyn to South Carolina, so the "map" is the whole US East Coast with four dots on
  it. That is the documented `GROUP_IMPACT_MAP_SPEC` failure — strays blow out the bounding box and
  waste the frame — now occurring in the app's own recap, not just the renderer. A month with
  travel in it produces an unusable impact visual.

- 2026-09-08 — **RESOLVED: the recap watermark is gone after the shared-basemap fix**
  (`f51f2589-bf22-4223-8ac8-c728cb9c1538`), confirmed by Jake on device.
  **Honest gap: I cannot fully explain why the old code failed.** `ImpactMap.tsx` already had
  `?key=${process.env.EXPO_PUBLIC_CARTO_API_KEY}` inline inside a proper template literal, the
  same form `map.tsx` uses — and `map.tsx` was rendering keyed tiles correctly the whole time.
  Rendering `ImpactMap`'s exact tile config headless produced six keyed requests and a clean map.
  Code, bundle and standalone render all looked correct, yet the device showed the watermark on
  that one surface until the URL moved into `src/pick/basemap.ts`. The most likely explanation is
  that the substitution was not being applied in that module and the standalone test could not
  reproduce it because it hard-coded the key rather than exercising the module — but that is a
  hypothesis, not a verified cause. Recorded as such: the symptom is fixed, the mechanism is not
  proven, and if a fifth map is ever added the safe move is to import BASEMAP_URL rather than
  assume the inline form works everywhere.
  Cost of getting there: a ~10-minute production regression that stripped the key from all four
  maps (logged above), caused by putting the env expression behind a variable.
