# Spec — Challenge Recap (group impact statement)

Status: **§1–10 below (v1) shipped Aug 5, 2026** — see `PROJECT_TIMELINE.md`. `GroupRecapCard.tsx`,
`GroupRecapModal.tsx`, `src/services/challengeRecap.ts` are real and live in `app/challenge/[id].tsx`.
**§11 (v2 — map-as-centerpiece redesign) is a new proposal for review, added Aug 31, 2026** — nothing
in §11 is built yet. Everything below §11 is the original v1 spec, left as-is for history; where v2
supersedes a v1 decision, §11 says so explicitly rather than editing the v1 text in place.

Extends the Challenges backend (`src/services/challenges.ts`) and reuses the "My Path" personal recap card (`src/services/recap.ts`, `RecapCard.tsx`, `RecapModal.tsx`) rather than building a new renderer.

## 1. The gap

Challenges have a live contributor board (`app/challenge/[id].tsx`) and, once a challenge's `status` flips to `completed`, the footer button just goes inert ("Challenge finished") and the group's collective story evaporates into the Firestore doc. There's nothing a team can point to, screenshot, or hand to an event organizer or sponsor that says "we did this, together." Individual impact already has this — the "My Path" week/month/year recap ships a real shareable card. Challenges don't have the equivalent for a *group*.

## 2. What already exists (reuse, don't rebuild)

- **`Contribution` docs** — `challenges/{id}/contrib/{uid}`, one per participant, each `{ display_name, pickups, bags, cleanups, updated_at }`. Already public, already privacy-safe (see [[pick-app-challenges]] in memory — no Cloud Function needed because these are self-published totals, not raw cleanup reads).
- **`getContributions(challengeId)` / `totalFor(goal, contributions)`** in `challenges.ts` — already sum one metric across everyone.
- **`RecapCard` / `RecapModal` / `shareCard()`** in `src/pick/` — a proven capture → close modal → `Share.share()` pipeline via `react-native-view-shot`, already handling the iOS "can't share while a Modal is open" bug and the "view-shot not linked yet" fallback to text-only share.
- **`buildRecapCaption()`** in `recap.ts` — the pattern for turning stats into a caption string; a group version follows the same shape.
- **`AreaPreview`** in `src/pick/AreaPreview.tsx` — already renders a challenge's drawn (`custom`) boundary as a small SVG shape, used today on the live challenge screen.
- **The completed-state branch** already exists in `challenge/[id].tsx` (`challenge.status === 'completed'`) — the hook point for a recap CTA already exists, it just does nothing yet.

## 3. Data model — aggregate stats (new, pure)

Add `buildChallengeRecap(challenge, contributions)` alongside `computeContribution` in `challenges.ts` (or a sibling `challengeRecap.ts`, matching how `recap.ts` sits next to `impactShare.ts`). Pure function, easy to unit test:

```
{
  totalPickups, totalBags, totalCleanups,
  participantCount,       // contributions.length, i.e. people who logged something
  joinedCount,             // challenge.participants.length, for "N joined, M contributed"
  goalReached: boolean,    // totalFor(goal_type, contributions) >= goal_value
  pctOfGoal: number,
  topContributor: Contribution | null,   // contributions[0], already sorted by pickups
  daysRun: number,         // (end_date - start_date) / 86400
}
```

No new Firestore reads — this runs on data the challenge screen already fetches.

## 4. The map problem (and why it's not a bug to "fix" later)

Personal recaps draw a path from `route_points` on the user's own cleanups. A *group* recap can't do that: cleanups are owner-only reads by design (routes reveal home addresses — same constraint that makes `contrib` a client-published sum instead of a server tally). There is no privacy-safe way to composite five people's routes into one image without either a Cloud Function reading everyone's raw locations (breaks the existing privacy model) or each person separately opting in to publish coarse geometry (new surface, real scope).

v1 answer: **don't try to draw people's paths — draw the challenge's own area instead.**
- `area.type === 'custom'` → reuse `AreaPreview` as-is (ring already stored flat on the challenge doc).
- `area.type === 'neighborhood'` → no polygon is stored today, just a label. v1 falls back to the same ornamental empty-state `RecapCard` already uses when `hasPath: false` (icon-only placeholder) rather than fetching a neighborhood polygon just for this card. Fetching/caching the real polygon is a reasonable v1.1 if the placeholder feels thin.
- `area.type === 'anywhere'` → same ornamental fallback; there's no shape to draw and manufacturing one (e.g. a heatmap of contributors' neighborhoods) is out of scope (see §8).

## 5. UI

New `GroupRecapCard` component, sibling to `RecapCard`, same visual language (kicker / area art / hero number / stat tiles / footer) so it reads as the same product feature, not a bolt-on:

- **Kicker:** challenge name, not a date range.
- **Area art:** `AreaPreview` for custom boundaries, ornamental placeholder otherwise (§4).
- **Hero:** `totalPickups` (or whichever `goal_type` the challenge used) `/ goal_value`, with a "GOAL REACHED" badge when `pctOfGoal >= 1` — mirrors the hero already on the live challenge screen, so it feels continuous rather than a different number.
- **Tiles:** BAGS / CLEANUPS / PICKERS (`participantCount`) — swaps "DAYS" (personal recap) for "PICKERS" (group recap), since headcount is the group-relevant stat.
- **Callout line:** "Led by {topContributor.display_name}" where `bestDay` sits on the personal card — optional, skip if it feels like it undercuts the "together" framing (flagged in §9).
- **Footer:** challenge subtitle (`challengeSubtitle(c)` — area + dates) instead of a person's name.

**Trigger points:**
1. On `challenge/[id].tsx`, when `status === 'completed'`, replace the now-dead "Challenge finished" footer button with **"Share recap."** Opens `GroupRecapModal` (a thin wrapper around the existing `RecapModal` capture/share plumbing, parameterized with `GroupRecapCard` instead of `RecapCard`).
2. Passive surfacing, mirroring `getUnseenRecap`: add `getUnseenChallengeRecap(challengeId)` using the same AsyncStorage seen-map pattern (keyed by challenge id instead of period key), so the first participant to open a just-completed challenge gets the recap auto-presented once, instead of relying on someone remembering to tap in.

## 6. Sharing

Reuse `shareCard()` unmodified — it already takes a `ViewShotRef` + caption and handles the modal-close-then-share sequencing. Add `buildChallengeRecapCaption(recap, challenge)` next to `buildRecapCaption`, same idea: "We hit 340 pickups (34 bags) together in {challenge.name} — {participantCount} pickers, {daysRun} days. Join us on Pick: {TESTFLIGHT_URL}".

Cross-posting to the Community feed as a `kind:'impact'` post (like individual impact posts) is a natural extension but raises an attribution question — see §9 — so it's scoped as v1.1, not a v1 blocker. v1 ships as an OS share-sheet card only, same distribution model "My Path" already validated.

## 7. Build order

| Phase | Work | Est. |
|---|---|---|
| 1 | `buildChallengeRecap()` + `buildChallengeRecapCaption()`, pure, unit tested | 0.5 day |
| 2 | `GroupRecapCard` (visual reuse of `RecapCard`/`AreaPreview`/`ImpactMap` patterns) | 0.5–1 day |
| 3 | `GroupRecapModal` wiring + "Share recap" CTA in `challenge/[id].tsx` + auto-surface-once | 0.5 day |
| 4 | Field test on a real challenge run to completion with 3+ people | 0.5 day, gated on the multi-person live test already on the roadmap |

**Total: roughly 2–2.5 days**, almost entirely reuse — the expensive parts (capture, share, iOS modal timing, caption pattern) are already solved by "My Path."

## 8. Out of scope (v1)

- Cross-user path/heatmap art — would require either a privacy-model change or a new opt-in geometry-publishing surface.
- Auto-posting to Community on behalf of the whole group (attribution question, §9).
- Print/PDF export for handing to a corporate sponsor or event organizer — the shared PNG is enough for v1; revisit if a real event asks for more.
- Recap for challenges that completed *before* this ships (no retroactive backfill).

## 9. Open questions for Jake

- **One shared card, or "led by You" personalization per viewer?** Simpler to ship one card everyone sees identically; personalizing "You contributed X" per viewer is a nice touch but doubles the card's states.
- **Cross-post to Community feed, or share-sheet only for v1?** If cross-posting: on whose behalf does it post — the challenge creator, whoever taps share, or does the app avoid attributing it to a single person and post as the challenge itself (would need a new post shape)?
- **Show the top-contributor callout on the card, or keep the card to pure group numbers** and leave individual ranking to the in-app leaderboard (avoids "who gets credit" friction on something meant to read as collective)?

## 10. A caveat worth remembering (ties to the multi-person concurrency test)

Contribution totals are only as fresh as each participant's last app-open (see [[pick-app-challenges]] — eventually consistent by design). A recap generated the moment a challenge's `end_date` passes may under-count anyone who did their last cleanup and didn't reopen the app afterward. Worth deciding alongside the planned multi-person live test: either nudge participants once at `end_date` to open the app (a push notification, reusing the existing Expo push plumbing), or hold the "recap ready" prompt for a short grace window (a few hours) after completion so totals have a chance to settle before the card gets shared externally.

---

## 11. v2 — Map as the centerpiece, photo integration, and the neighborhood/anywhere empty state

**Status: proposal for review, not yet built.** Written Aug 31, 2026 against the app as it exists
today (v1 above, live since Aug 5). This section is additive to v1's data model and sharing pipeline
— it changes `GroupRecapCard`'s layout and adds new inputs, it does not replace `buildChallengeRecap`,
`GroupRecapModal`'s share/post actions, or the `challenge_recap` post kind.

### 11.1 What prompted this

Jake's explicit direction: the challenge's completed street map should be **the visual centerpiece of
the card** — "the star of the show." Today (`GroupRecapCard.tsx` §5, lines ~52–60) the map is a fixed
150px `mapWrap` sitting above the hero number, the same visual weight as a header image, not the point
of the card. Two more findings feed into the same redesign:

- **The "no persistent recap entry point" gap assumed at kickoff is not accurate — verify before
  building on it.** `app/challenge/[id].tsx` already has a footer button that reads "Share recap" and
  stays that way permanently once `challenge.status === 'completed'` (line ~317, `onPress={... ()
  => setRecapOpen(true) : toggleJoin}`), *in addition to* the original v1 auto-surface-once behavior
  (`getUnseenChallengeRecap`, still fires the first time). **Revisiting a recap already works today** —
  this redesign is about what the card looks like and what it can show, not about adding a missing
  entry point. Drop this from scope.
- **The empty state is real and worth fixing here.** `GroupRecapCard.tsx`'s `mapEmpty` branch (no
  `hasArea`, i.e. `area.type !== 'custom'`) renders a bare trophy icon on a flat tint background —
  no map at all. Per `challenges.ts`, `ChallengeAreaType` is `'anywhere' | 'neighborhood' | 'custom'`;
  only `'custom'` has a stored `ring`. That means **two of the three challenge area types get the weak,
  map-less card today.** Since this redesign is explicitly about making the map the star, it should
  also close (or at least visibly improve) the case where there's no map to star.

### 11.2 Map as centerpiece — redesign direction

- Promote the map from a capped 150px strip to the card's dominant visual element — full card width,
  most of the card's vertical space, hero number and stat tiles becoming an overlay/footer treatment
  on top of or below the map rather than the map being one component among equals. Exact layout
  (map-behind-stats overlay vs. map-on-top-full-bleed vs. map-as-hero-then-stats-below) is a design
  pass, not dictated here — but the map should read first, not third.
- For `area.type === 'custom'`: still `AreaPreview` (the ring is already stored flat on the challenge
  doc, per v1 §4) — just re-laid-out and enlarged, not re-sourced.
- For `area.type === 'neighborhood'`: **new work.** No polygon is stored on the challenge doc today —
  only a label (v1 §4 explicitly deferred this: "fetching/caching the real polygon is a reasonable
  v1.1 if the placeholder feels thin"). That v1.1 is now in scope: fetch the neighborhood's OSM
  boundary the same way the map tab already does for city/neighborhood shapes, cache it, and render it
  the same way `AreaPreview` renders a custom ring. This is the highest-value part of closing the
  empty-state gap, since `neighborhood` is a common challenge type.
- For `area.type === 'anywhere'`: there is still no shape to draw and manufacturing one (e.g. a
  synthetic heatmap of contributors' walk locations) was explicitly ruled out of scope in v1 §8 and
  stays out of scope here — compositing contributor geometry without consent is the same privacy
  question as §4/§8 and Tier 2 below. For `anywhere`, keep an ornamental placeholder, but make it a
  better one than a bare trophy on flat tint — e.g. a full-bleed decorative treatment (gradient, icon
  pattern) sized and positioned the same as the real-map cards, so the card family still reads as one
  design even when the centerpiece isn't a real map.

### 11.3 Photo integration — Tier 1 (approved to spec and build)

**Source: Community posts people already chose to share during the challenge window.** This is the
cheap tier because it needs no new privacy boundary — `posts` are already readable by any signed-in
user (`firestore.rules`, posts collection — not owner-only like `cleanups`), unlike raw cleanup/route
data. The work is entirely about making those existing posts *queryable per challenge* and then laying
them into the card.

**Data model change.** `Post.challenge_id` already exists on the `Post` interface
(`firebaseDatabase.ts` line ~194) and is already written by `createChallengeRecapPost` — but that's
the recap card's own auto-generated post, not a tag on a person's own photo post. The gap is in
**`createPost`** (`firebaseDatabase.ts` line ~1267), which today takes
`{ caption, neighborhood, photoUri }` — no challenge linkage at all, so a photo shared while a
challenge is live has no way to be found later by that challenge's recap. Add an optional
`challengeId?: string` to `createPost`'s input, stamp it onto the post doc when present. The composer
UI that calls `createPost` (wherever "share a photo" is triggered from the cleanup-finish flow) needs
to know it's inside an active challenge — likely by passing the joined-and-live challenge's id down
from wherever that context is already known (the challenge screen, or the cleanup-finish flow if it
already tracks "you're in an active challenge" for other purposes — needs a source check, not assumed
here).

**Query.** A new `getPostsForChallenge(challengeId, limit)` (sibling to `getPosts`/`getPostsByUsers`)
— `where('challenge_id', '==', challengeId)`, ordered newest-first, capped (e.g. 12–20) since this is
for card thumbnails, not a full gallery. No rules change needed: posts are already signed-in-readable.

**UI.** New thumbnail layout in `GroupRecapCard` alongside/around the now-centerpiece map — e.g. a
strip or grid of 3–6 photo thumbnails below or beside the map, with a "+N more" affordance if a
challenge produced more shared photos than fit. Needs a real empty state too: most challenges will
have zero tagged photos at launch (nobody could tag them retroactively, and community_auto_post
defaults off per the timeline's own positioning notes), so the layout must look intentional with zero
photos, not like a broken slot.

**Retroactivity.** Only posts created *after* this ships will carry `challenge_id`. No backfill —
existing/in-flight challenges' posts have no way to be tagged after the fact (no reliable way to infer
which challenge a past post belonged to from `created_at` + `neighborhood` alone). Same "no
retroactive backfill" posture v1 §8 already took for challenges completed before that shipped.

### 11.4 Photo integration — Tier 2 (NOT approved — open decision only, do not build)

**Source: photos captured during a cleanup but never shared to Community** — the common case, since
`community_auto_post` defaults off (per the Aug 17 positioning note in `PROJECT_TIMELINE.md`), meaning
most cleanup photos that exist on a device never become a `posts` doc at all.

This is explicitly **not being spec'd for implementation.** Surfacing these photos reopens the exact
privacy-model question this same spec already closed for routes in **§4 and §8**: cleanup data
(including any photo captured during one) is owner-only by design, for the same reason routes are —
it can reveal home addresses and personal movement patterns, and a group recap compositing everyone's
private cleanup photos without their explicit choice to share is a materially different privacy
posture than Tier 1's "already public, just needs a tag."

**The tradeoff, stated plainly, for Jake to decide:**

- **Option A — Cloud Function reads owner-only cleanup photos for challenge participants.** Works
  without changing the end-user experience of capturing a photo, but means a server-side process reads
  data users were told (per the audited privacy policy — `PROJECT_TIMELINE.md`, Aug 12) stays theirs
  unless *they* choose to share it. Even scoped narrowly (only within a joined challenge's window),
  this is a real privacy-model change, not a formatting tweak, and would need its own audit pass the
  way blocking/deletion did for App Store 1.2/5.1.1.
- **Option B — new opt-in consent UX at capture time.** E.g. a checkbox at the end-of-walk sheet:
  "also share this photo to the challenge recap" — genuinely consensual, but a new UI surface on an
  already-dense end-of-walk sheet (which just went through its own crowding/scroll fix Aug 17), and it
  only helps recaps generated after the opt-in ships — no help for challenges already in flight.
- **Doing nothing** (Tier 1 only) is a legitimate answer, not a placeholder — Tier 1 photos are the
  ones people already wanted to make public, which may be sufficient for "the map is the star, photos
  are a supporting accent" rather than "every photo from the challenge."

No further design work on Tier 2 belongs in this doc until Jake picks a direction (or explicitly
declines to build it).

### 11.5 Build order (v2, Tier 1 scope only)

| Phase | Work | Notes |
|---|---|---|
| 1 | `createPost` gains optional `challengeId`; composer passes it when a challenge is live | needs a source check for how "active challenge" is known at the photo-composer call site |
| 2 | `getPostsForChallenge()` | straightforward, mirrors `getPosts`/`getPostsByUsers` |
| 3 | Neighborhood polygon fetch/cache for `area.type === 'neighborhood'` recap maps | reuses existing OSM boundary fetch used by the map tab, not new infrastructure |
| 4 | `GroupRecapCard` layout redesign — map as centerpiece, thumbnail strip, improved `anywhere` placeholder | the actual design pass; no estimate without a design direction picked |
| 5 | Field test on a real challenge with tagged photos and at least one `neighborhood`-type area | |

Not estimated in days here (unlike v1 §7) — phase 4 is a real design decision, not a known quantity,
and should be sized after a layout direction is picked.

### 11.6 What Jake needs to decide before v2 building starts

1. **Layout direction for "map as centerpiece"** — full-bleed map with stats overlaid, map-on-top/stats-below,
   or another treatment. Affects phase 4's estimate directly.
2. **Tier 2 photos (§11.4): Option A (Cloud Function reads owner-only data), Option B (new opt-in
   consent UX), or explicitly not now.** This is the one open item that changes the app's privacy
   posture if answered yes — everything else in this section is UI/query work inside boundaries
   already established.
3. **Where does the composer learn "a challenge is live" to tag a photo at share time?** Needs a
   one-time source check of the cleanup-finish/photo-share flow before phase 1 is scoped for real —
   flagged here as a build-time unknown, not a product decision.
4. **Does the `anywhere` placeholder redesign (§11.2) ship in the same pass as the real-map cases, or
   can it lag?** Lower stakes than 1–3; included for completeness since it's part of "what the redesign
   touches."
