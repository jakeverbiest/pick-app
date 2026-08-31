# Challenge Guest Mode — technical scope

> **RECONSIDERED 2026-08-31 — parked, not building this.** Full scope below is preserved (all 6
> open questions were resolved 2026-08-31 and it's real, buildable work) in case this gets
> revisited, but Jake's call is to not build it. Reasoning: guest mode gives up the product's core
> differentiator — a guest can't get real automatic tracking in a browser, so it hands the most
> casual, first-touch users the exact manual-estimation experience Pick exists to replace (bags,
> weight, streets, all self-reported after the fact). The friction math doesn't clearly favor it
> either — a real download is a one-time cost paid at a captive, socially-primed moment (an
> organized event), versus guest self-reporting friction that recurs every time for anyone who
> never converts. Redirecting the same underlying goal (maximize walk-up-event participation
> counted) into making the real signup/download/join flow as fast as possible instead — that
> helps every new user, not just event guests, and protects the "it just works automatically"
> story instead of undermining it.

Status: draft, scoped 2026-08-04, all open questions resolved 2026-08-31. Not building — see
above. Related: `docs/CHALLENGE_RECAP_SPEC.md`, `src/services/challenges.ts` (existing challenges backend).

## Problem

Every guest who wants to join a community cleanup today has to install the app, create an account, and find the right challenge before they can do anything. That funnel loses most of a walk-up group (school class, corporate volunteer day, park cleanup crowd) before they ever get counted. This spec scopes a QR-driven, no-download way for a guest to participate in a specific challenge and contribute to its collective total.

Primary goal, per product direction: maximize total participation and impact counted, not app installs. Guest mode is a permanent, first-class way to take part — not a funnel toward downloading the app.

## Product framing

Two tiers, not one degraded into the other:

- **Pick Prime** — the existing native app. Continuous sensor-detected pickups (accelerometer + gyroscope), real GPS path, full account, full social features.
- **Challenge Guest Mode** — QR-driven, browser-only, single end-of-session submission. Self-reported bag count + a hand-drawn path. No account, no download, no continuous tracking.

These produce different data (sensor-verified vs. self-reported) and should stay clearly labeled wherever shown together, not silently blended into one number.

## Why not sensor tracking or live GPS in the browser

Ruled out during scoping, kept here so it isn't re-litigated:

- **Passive pickup detection** (accelerometer + gyroscope, phone in pocket) is a native capability. Mobile browsers don't expose background motion sensors, and foreground access needs a fresh permission prompt every session on iOS.
- **Continuous GPS path tracking** (`watchPosition`) only runs while the browser tab is open and in the foreground. iOS Safari suspends the tab the moment the phone locks or the user switches apps, silently breaking the trail. A homescreen PWA doesn't fix this on iOS — there's no background-location entitlement outside a native app.
- **Manual tap-per-pickup** was scoped and rejected: real-world pickup volume makes per-item tapping unrealistic, and it doesn't solve the path problem either.

## User flow

1. Organizer creates a challenge (existing flow). A short join code and QR are auto-generated at creation time — no extra step for the organizer.
2. Guest scans the QR (or types the short code). Lands on a web page that silently signs them in via Firebase Anonymous Auth and auto-joins them to that specific challenge — no challenge browsing, no signup screen.
3. Guest sees the challenge name/goal and two controls: **Start** and a map.
4. Guest taps **Start**. Session start timestamp is recorded, and a one-shot GPS read captures the start point. This is the only location-permission prompt in the flow.
5. Guest taps points on the map as they go, placing waypoints that connect into a line representing their route, filling in the gap between the start point and wherever they end up. Still a deliberate drawing action, not passive tracking — nothing breaks if the phone locks between taps.
6. Guest taps **Stop**. Session end timestamp is recorded, and a second one-shot GPS read captures the end point (same permission grant as step 4, no re-prompt expected).
7. Guest enters bags picked up: a count, plus a bag size (small / medium / large — see Bag size below).
8. Guest optionally adds a display name (defaults to an auto-generated guest label, e.g. "Guest 47", if skipped).
9. Submit sends the raw drawn path plus the two GPS anchors to a lightweight Cloud Function, which snaps the path to the street network (see Snap-to-road below) and writes the contribution. Guest sees their count folded into the challenge's live total.
10. On the confirmation screen only — after the contribution is already recorded, never before — a low-emphasis "Get the full experience" link to download Pick Prime. Not a gate, not a modal, no repeat nagging on a second visit. See App download CTA below.

If the guest denies the location prompt at step 4, degrade gracefully: proceed without start/end anchors, path stays fully freehand. Never block participation on a permission grant.

## Data model

Extends the existing `challenges/{id}/contrib/{uid}` pattern (client-published totals, same privacy rationale as the rest of the challenges feature — see `src/services/challenges.ts`). For a guest, `{uid}` is the anonymous-auth uid.

Proposed fields on the contrib doc for guest submissions:

- `bagsReported: number`
- `bagSize: 'wastebasket' | 'kitchen' | 'yard'`
- `sessionStart: Timestamp`
- `sessionEnd: Timestamp`
- `startPoint: [number, number]` — `[lat, lon]` from the one-shot GPS read at Start, if permission was granted.
- `endPoint: [number, number]` — `[lat, lon]` from the one-shot GPS read at Stop, if permission was granted.
- `path: number[]` — the raw guest-drawn line, flat `[lat, lon, lat, lon, ...]`. **Do not store as an array of coordinate pairs** — this codebase has already hit the Firestore nested-array rejection bug on polyline data elsewhere; flat storage is required.
- `snappedPath: number[]` — the same flat format, after the submit-time map-matching pass. Keep both: if matching fails or a vendor call is rate-limited, the raw `path` is still a usable fallback.
- `guestName: string` (optional, defaults to an auto-generated label)
- `isGuest: boolean`

## Bag size

Guests pick from three real, recognizable bag types rather than a size guests won't know offhand ("what's my bag's gallon rating?"). Anchored to the most common retail size for each type (per general trash-bag sizing references — worth spot-checking against whatever bags a specific event actually hands out, since this is a general default, not a measurement):

- **Wastebasket bag** — ~8 gal (bathroom/office bin range is roughly 4–10 gal; 8 is the common middle)
- **Kitchen bag** — ~13 gal (the standard "tall kitchen" bag size, dominant enough it barely needs a range)
- **Yard bag** — ~30 gal (lawn-and-leaf bags run 30–50 gal; 30 is the most commonly marketed size)

Keep the gallon mapping server-side (not hardcoded in the client) so it can be corrected or regionalized later without a client release. Store the raw `bagsReported` + `bagSize` pair rather than pre-converting to a normalized number, so the conversion factor can change later without losing the underlying report. Where a single comparable number is needed (leaderboards, the public dashboard), compute a normalized "standard-bag equivalent" (or straight gallons) at read time from the stored size mapping.

## Snap-to-road (map matching)

Aligning the guest-drawn line to actual streets is a real map-matching problem, not just a rendering one — the app's current map (Leaflet + free CARTO/OSM tiles) only handles display, it doesn't do routing or matching today. This needs a new capability, and it should run once at submit time in a Cloud Function (not client-side), both to keep an API key off the guest's device and because it only needs to happen once per submission, not on every tap.

Three ways to get there, in rough order of effort:

1. **Commercial map-matching API (e.g. Mapbox Map Matching).** Fastest to integrate — send the raw tapped points plus the two GPS anchors, get back a road-aligned line. Free tier likely covers guest-mode volumes, but pricing/limits should be confirmed before committing, since this is a new paid vendor dependency the project doesn't currently have (everything today is Firebase + free-tier Netlify + free map tiles).
2. **Self-hosted OSRM map matching.** Open source and free to run, but the public demo server isn't meant for production use (rate-limited, no uptime guarantee) — real use means standing up and maintaining a server, which is a genuinely new piece of infrastructure outside the current all-serverless setup.
3. **DIY nearest-road snap.** Pull nearby OSM way geometry (e.g. via the Overpass API) and snap each tapped point to the nearest road segment client- or function-side. Avoids a new vendor entirely, but is real engineering effort for what's meant to be a lightweight guest feature.

Leaning toward option 1 for a first version, given the project's existing bias toward managed services over infrastructure to run — but this is an open decision, not yet locked in.

## App download CTA

Resolves open question 3 below: yes, include a click-through to download Pick Prime, but placed and worded carefully so it doesn't turn guest mode into a funnel.

- **Placement:** confirmation screen only, below the fold on their contribution (they see their count landed first). Nothing before submit ever mentions the app — participation can't feel conditional on installing it.
- **Framing:** "Get the full experience" style link, not a modal or interstitial — a tap-through, not a blocker. Something like "Want automatic pickup tracking next time? Download the app" with a link, sitting quietly under the confirmation stats. "Pick Prime" is internal shorthand for this doc, not public-facing copy — the guest-facing CTA should just say "the app," never the tier name.
- **Destination:** App Store link (the app is TestFlight/iOS today). Needs a decision once Android is actually live — until then, a single iOS link is fine; don't build device-detection branching for a platform that doesn't exist yet.
- **What's not in v1:** carrying the guest's contribution into the new app account. The guest's anonymous-auth session lives in their mobile browser and doesn't automatically connect to a fresh native app install — a real "claim my guest contribution" flow (e.g. re-entering the challenge's short code inside the app after signup) would be needed to merge them, and that's a separate, non-trivial feature. For v1, someone who converts just starts fresh in the app; their guest contribution stays as-is on the challenge.

## Goal-type default for guest-joinable challenges

Challenges already support three collective-goal types: pickups, bags, cleanups. A guest can only honestly report bags — there's no sensor to verify pickups, and "cleanups" implies session semantics guests don't have.

Recommendation: guest-joinable challenges default their goal type to **bags**, not pickups. This avoids needing an extrapolation multiplier (bags → estimated pickups) that would blend a guessed number with the sensor-verified pickup counts from Prime users into one total. If an estimated-pickups figure is wanted for display (e.g. on a hotspot map), compute and label it as an estimate, kept visually distinct from sensor-verified counts.

## Integrity and rate limiting

Self-reported bag counts are easier to game than sensor data, but this isn't a new gap — bag counts are self-reported by Prime users too (no sensor can tell when someone decides a bag is "full"). Guardrails to add regardless:

- Cap on bags reported per single submission (reject obviously implausible values).
- One submission per guest (anonymous uid) per challenge.
- Duration from `sessionStart`/`sessionEnd` gives a free plausibility check against the bag count (e.g. flag "12 bags in 4 minutes" for review) without needing active moderation.
- Distance between `startPoint` and `endPoint`, relative to duration, gives a second free plausibility check (e.g. flag "3 miles apart, 2-minute session") — a nice side benefit of capturing real GPS anchors instead of relying on the freehand drawing alone.
- Firestore rules scoped narrowly: an anonymous uid can write only its own `contrib` doc on an active (time-window-open) challenge, nothing else.

## Open questions

1. ~~Does the public impact dashboard's stats rollup need to be extended to include guest `contrib` docs?~~ — **resolved 2026-08-31 (Jake): yes, extend it — but this is a build-time requirement for whenever Guest Mode itself gets built, not standalone work to do now**, since Guest Mode hasn't shipped yet. Mechanical note for whoever builds it: the hourly rollup (`rebuildPublicStats()`) currently counts each authenticated user's saved walk exactly once via their `cleanups` doc. Naively also summing every `contrib` doc would double-count regular in-app participants (already counted via their own `cleanups` doc). The rollup needs a way to distinguish guest-origin `contrib` docs from regular-participant `contrib` docs and only add the guest ones — e.g. a flag written at guest-submit time (guests are anonymous-auth; regular participants aren't, which may already be enough to distinguish them without a new field — worth checking at build time).
2. ~~Does the organizer's live view need real names, or is the auto-generated guest label sufficient for v1?~~ — **resolved 2026-08-31 (Jake): real names.**
3. ~~Should there be any nudge toward downloading Pick Prime after a guest submits~~ — resolved: yes, a low-emphasis link on the confirmation screen only. See App download CTA above.
4. ~~Which map-matching option to use — needs a vendor/cost decision.~~ — **resolved 2026-08-31 (Jake): no map-matching in v1 — no new recurring cost is acceptable right now.** This doesn't degrade the feature to a broken state: line 57's fallback design ("if matching fails... the raw path is still a usable fallback") is promoted from failure-fallback to the actual v1 behavior — guest paths ship as the raw tapped line, un-snapped, permanently, until revisited. Real street-snapping is deferred, not cancelled — see the new business-model note directly below.

### Future: bundling Guest Mode into a paid org tier

Jake's idea, 2026-08-31, worth keeping visible rather than buried in a resolved question: map-matching (and Guest Mode generally) could become part of a paid "Pick for Organizations" tier — the same audience and pricing motion as `CIVIC_ORG_DASHBOARD_SPEC.md`'s BID/civic-org dashboard. Individual app use stays free; an organization running a volunteer event pays for org-facing tools (guest participation + the impact dashboard), and that revenue funds the map-matching vendor cost instead of Pick absorbing it for free on every guest submission. Not scoped — this is a strategic note for whenever pricing for the org tier gets designed, not a v1 requirement.
5. ~~The wastebasket/kitchen/yard-to-gallons mapping above is a general default from typical retail sizing, not a measurement — worth confirming against real bag sizes if organizers hand out specific bags at events, and deciding whether the mapping needs to vary by region or stays fixed for v1.~~ — **Jake's response 2026-08-31: agreed, and flags this as a good candidate for a "challenge intake" / event-setup form** — an organizer setting up a guest-joinable challenge could specify the actual bag size/type being handed out at their event, overriding the generic default for that specific challenge rather than needing a global regional mapping. Not scoped in detail yet — worth its own pass whenever challenge-creation UX for organizers gets designed.
6. ~~Worth a "claim my guest contribution" flow for converts (re-enter the challenge code inside the app post-signup to merge guest data into the new account), or is that scope creep for v1?~~ — **resolved 2026-08-31 (Jake): parked, not v1.** Matches what the App Download CTA section above already stated as the v1 behavior — this question and that section had drifted slightly out of sync; now consistent.
