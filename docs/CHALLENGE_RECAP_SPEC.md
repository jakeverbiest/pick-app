# Spec — Challenge Recap (group impact statement)

Status: proposal for review. Extends the Challenges backend (`src/services/challenges.ts`) and reuses the "My Path" personal recap card (`src/services/recap.ts`, `RecapCard.tsx`, `RecapModal.tsx`) rather than building a new renderer.

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
