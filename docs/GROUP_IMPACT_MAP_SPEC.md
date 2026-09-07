# Spec — Group Impact Map

Status: **draft for review, nothing built.** Written 2026-09-07.

## 1. Why this exists

Jake's framing, 2026-09-07: the shareable output *is* the product. Not the app, not the
detector, not the leaderboard — those are the machinery that produces it. Two things
depend on it directly:

- **Organic reach.** A group finishes a cleanup, gets something genuinely worth posting,
  posts it, and people who have never heard of PICK see it. That loop is the cheapest
  acquisition channel available and it costs nothing per use.
- **Partnerships.** The pitch to an organization is one sentence: *"Here's a simple app.
  All your people download it and press start. You get a beautiful impact map of your
  collective work."* That promise is what an org either donates against or pays a fee for.
  Nothing else in the product carries that weight.

This spec defines that artifact as its own thing rather than as a variation on something
else, because it has been getting bolted onto specs scoped for smaller jobs.

## 2. What this supersedes

**`CHALLENGE_RECAP_SPEC.md` §11.4 (Tier 2 photo integration) is superseded and should be
closed, not built as written.** §11.4 framed the question as "should a server-side process
surface users' private cleanup photos," and both the spec and the 2026-09-06 Safety review
correctly answered *no* on those terms.

That framing was wrong for the actual use case. Photos contributed to a group event that a
participant deliberately joined are not private photos being published — they are the
participant's contribution to a shared deliverable, which is the whole reason they joined.
The privacy question is real but it is answered by **consent at join** (§6), not by a
server-side access argument.

§11's Tier 1 work — shipped 2026-09-04 — remains the foundation and is not superseded.

## 3. The artifact

One page, one link, built to be screenshotted or shared as-is. Hierarchy, most to least
prominent:

1. **The map.** Full bleed, the hero. Streets the group covered, plus **individual pickup
   spot markers** (§5). This is the emotional payload — the visible proof that a specific
   group did specific work in a specific place.
2. **Identity line.** Group name, place, date or date range. "Litter Legion · Astoria ·
   September 12, 2026."
3. **Headline totals.** Pickups, bags, hours, participants.
4. **Photo strip.** Contributed event photos (§6).
5. **Attribution.** A small, tasteful PICK mark and link — this is the acquisition
   mechanism, so it must survive a screenshot, but it must not look like an ad.

## 4. Event shape: a challenge, not a team

**Recommendation: the event is a challenge.** A corporate volunteer day is time-boxed, has
people who join it, and often has a goal — that is exactly what `challenges` already models.
Teams are the wrong primitive because a team is a *persistent roster*, and an organization
will typically run several events a year with different attendees each time. Forcing that
into one long-lived team makes every event's numbers bleed into the next.

**But the deliverable machinery currently hangs off teams, and that is the gap.** Today:

| capability | lives on | notes |
|---|---|---|
| token-gated shareable web link | teams | `createSponsorTeam` → `team_tokens` / `team_token_index` |
| maintained stat rollup | teams | `org_stats/{teamId}`, incremental |
| public web renderer | teams | `web/org.html` → `orgDashboard` |
| time-boxed participation | challenges | `challenges/{id}`, `contrib/{uid}` |
| photo tagging | challenges | `challengeId` on posts, shipped 2026-09-04 |

So the work is not "build a new system." It is **porting the token + rollup + renderer
pattern from team scope to challenge scope**, and pointing the already-shipped photo
plumbing at it.

**A second, important reason not to use the existing org dashboard for this:** `org_stats`
is a *geographic* rollup. `web/org.html` says so on screen — *"Every cleanup logged inside
this area counts, whoever did it — not just this sponsor's own roster."* That is correct
for a BID or council district measuring their neighborhood. It is wrong for a company
volunteer day, which wants *our people, our day*, not everyone who happened to walk through
Astoria that week. The district dashboard and the group impact map answer different
questions and both should exist.

## 4a. Scope: build for the one-day event first

`Challenge.kind` is already `'day' | 'range'`, so both shapes are first-class in the data
model. This is a go-to-market sequencing decision, not a fork in the code.

**Build and pitch the one-day event first — and the reason is the artifact, not the sale.**
A one-day event puts everyone in one place at one time, which produces a dense marker
cluster in a bounded area: a map that looks impressive regardless of turnout. A week-long
distributed challenge produces a map whose quality depends entirely on participation rate,
which nobody can control. Twelve of eighty employees walking produces a sparse scatter
across six neighborhoods that reads as thin rather than impressive. **The one-day event has
a floor under how bad the output can look. The week-long does not.**

It also lands on an existing budget line — companies already run CSR volunteer days, already
staff someone to organize them, and already expect a recap. That is a better first sale than
creating a new category.

**The week-long challenge is the bigger prize** — the corporate step-challenge format is
proven, recurring, funded from wellness budgets, and includes remote employees a one-day
event structurally cannot reach. It needs two things that do not exist yet:

1. **Nudges.** A week-long challenge dies on day two without reminders. Push notifications
   exist but cover follows and likes only.
2. **Team-versus-team inside the organization.** This is the actual engine of corporate step
   challenges — Marketing versus Engineering is what drives participation. Today `contrib`
   records are per-individual (`uid`, `display_name`, `pickups`, `bags`, `cleanups`), and
   `Challenge.team` scopes a challenge *to* a single team rather than splitting it across
   competing sub-teams. That mechanic is a real build, and it is the thing that unlocks the
   week-long format.

Sequence: land one-day events, use the maps they produce as proof, then pitch week-long with
evidence rather than a promise.

## 4b. What the one-day map should look like

A one-day event has properties a distributed challenge lacks, and the artifact should exploit
them: a single date, a start and end time, one bounded area, and everyone present together.

**The map.**
- **Uniform markers, one brand color, semi-transparent.** Do not encode per-person color —
  it fragments a collective story into individual attribution and reintroduces the privacy
  problem §5 avoids. Do not encode density as heat either; heat maps read as analytical,
  individual dots read as human effort. Let transparency handle overlap so density emerges
  naturally — 400 dots across six blocks *should* darken into something that looks like work.
- **Show the event boundary.** Containment is what makes it read as "we did this area"
  rather than "some dots happened." Civic Blueprint navy outline.
- **Streets covered underneath the markers**, from `segment_status`, muted. The CARTO
  `light_all` basemap is already desaturated, which is why the markers will pop.

**The numbers, chosen for who reads them.** A CSR team has reporting obligations, so include
what they actually file:
- **Volunteer hours (collective).** "47 volunteer hours" is literally a line item companies
  report. This may matter more to the buyer than pickups do.
- **Bags.** More tangible than a raw count, and the existing definition ("a standard
  13-gallon kitchen bag — roughly 200 pieces of litter") doubles as a credibility note.
- **Blocks or streets covered.** GPS-derived, so credible independent of detector accuracy.
- **Participants.** Meaningful here specifically because they were all there together.
- Pickups, as a supporting stat rather than the headline — see §7.

**Identity line.** Organization name, place, and the specific date. A single date reads
better than a range: "Litter Legion · Astoria · September 12, 2026."

**The export is not the web page** — see §4c, which is the decided approach.

**Worth considering, not yet specified: a time-lapse.** A one-day event has a natural time
axis, and markers appearing in sequence across the morning is far more shareable than a
static image. **Data caveat that has to be checked before promising it:** the `pickups`
field stores coordinates only — `[[lat, lon], …]` — with no per-pickup timestamp. Each
*cleanup* has a timestamp and duration, so pickups could be distributed across their
session's window as an approximation. That is honest as an animation but should not be
presented as precise timing.

## 4c. The export image — decided 2026-09-07

**Export a full-size image built for social posting. Do not integrate with any social
platform.** No OAuth, no posting APIs, no per-platform accounts. Generate the image, hand it
to the native share sheet on iOS or a download on web, and let the person post it themselves.

The reasoning is maintenance, not capability: each platform integration is an ongoing
obligation — token refresh, API deprecations, policy changes — that breaks while nobody is
watching. That directly contradicts the "stays a fun project" constraint. An image works on
every platform, forever, with no upkeep. (The existing Bluesky auto-post is a deliberate
one-off and is not a precedent for adding more.)

**Attribution: "Powered by PICK" and the website must be visible in the export.** This is
the acquisition mechanism — the image travels where the app cannot.

**The design tension, and how it resolves:** attribution has to be prominent enough to drive
traffic but subtle enough that the organization is happy to post it. If the card reads as
PICK advertising, the company will not share it, and then the attribution is worth nothing.

**Resolution: the organization is the hero, PICK is the credit.** Their name large, their
place, their date, their numbers. "Powered by PICK · pickglobal.org" small and clean along
the base. The org gets the glory, PICK gets the byline — and that trade is precisely what
makes them want to post it in the first place.

**Specifications:**
- **Aspect ratio 4:5, 1080×1350 logical**, rendered at 3× (3240×4050) so it survives platform
  recompression without going soft. 4:5 takes maximum feed real estate on Instagram and
  renders correctly on LinkedIn, which makes it the best single default. Add a 9:16 story
  variant later only if asked for; do not ship two formats on day one.
- **Composition:** map occupies roughly the top 70%; identity line, stats, and attribution
  stack in the lower band.
- **The exported map is a purpose-composed render, not a screenshot** of the live view.
  Strip zoom controls, UI chrome, and the in-app attribution bar; keep the basemap credit
  that CARTO and OpenStreetMap licensing requires.
- **Legible at thumbnail.** Feed previews are small. The organization name and the shape of
  the marker cluster must read at a glance; stats can be secondary.
- **Attribution must survive cropping.** People crop. Do not place it in a single corner that
  a careless crop removes — a full-width base band is safer than a corner mark.

**Implementation note:** `react-native-view-shot` is already a project dependency and the app
already produces share cards, so in-app capture has both tooling and precedent. The web
renderer would need its own path (server-side render or canvas); in-app export is the cheaper
first version and the organizer is the person who needs it.

## 5. Pickup spot markers

Jake specifically asked for individual pickup indicators back, and they are what make the
map feel earned — a route line says *we walked here*, a field of markers says *we did this
four hundred times*.

**The data already exists.** Every cleanup document stores a `pickups` field: a JSON string
of `[lat, lon]` pairs. Nothing new needs capturing. This is an aggregation and rendering
problem, not an instrumentation one.

**Scope is what makes this safe, and the distinction is load-bearing.** On 2026-09-06 the
public all-time "Litter hotspots" heatmap was removed from `web/map.html` and
`web/city.html` at Jake's request. That was correct and this does not reverse it. An
always-on, all-time, city-wide public map of where individuals log pickups is a genuine
privacy problem — it is the pattern that scored Strava 32/100 in the benchmark review, and
it is why `cleanups` is owner-only at the Firestore rules level.

An event-scoped marker map is a different object:

- **bounded in time** — the event window, not all history
- **bounded in space** — the event area
- **bounded in participation** — people who deliberately joined this event
- **aggregated** — markers are group output, never attributed to an individual in the
  artifact

Same underlying coordinates, materially different exposure. Do not let the two be confused
in future work.

**Rendering note:** for the publicly shareable version, snap markers to a small grid or
apply light jitter so no marker is a precise doorstep. The organizer's own view can be
exact. Decide the grid size deliberately; do not inherit the ~1km public-tile coarseness,
which would destroy the visual entirely.

## 6. Consent, and where it lives

**At join, not retroactively, and not buried in a settings toggle.** The screen where
someone joins an event carries one plain sentence: *your pickups and any photos you add
become part of this group's impact map.* That is the entire privacy design, and it is far
easier to defend than any server-side reasoning.

Consequences that follow from putting it there:
- Only walks logged **inside the event window, by joined participants** are eligible.
- A participant who never joined contributes nothing, even if they walked the same block.
- No backfill. Events that ended before this ships have no consented participants.
- Photos are opt-in per photo, on top of event membership — joining an event is not blanket
  permission to publish someone's camera roll.

## 7. Map first, count second — and why that is a design decision

The count is the only number on this artifact that depends on the detector, which is still
validated against exactly one person (`DETECTOR_VALIDATION_PLAN.md`). If a company's thirty
employees see visibly inconsistent counts, they will question the whole page.

Coverage and pickup locations are GPS-derived and do not depend on the detector at all. So
making the map the hero and the count a supporting stat is not only better design, it makes
the artifact **robust to detector error** during exactly the period when detection accuracy
is still being established. Group Recap v2 arrived at map-first for unrelated reasons; this
is a second, independent argument for the same choice, and it should be made deliberately
rather than inherited.

## 8. Build order

1. **Event token + shareable link at challenge scope.** Port the `team_tokens` /
   `team_token_index` pattern to challenges. Reuse `createSponsorTeam`'s server-side
   `crypto.randomBytes` approach — the token must never round-trip through a client-writable
   field.
2. **Event stats rollup.** A challenge-scoped equivalent of `org_stats`, maintained
   incrementally by the existing `onCleanupWrite` path rather than by full scans — the
   2026-09-01 cost work established why that matters.
3. **Marker aggregation.** A Cloud Function that reads participants' `pickups` arrays
   (admin-side; `cleanups` stays owner-only) and emits the event's marker set, gridded per
   §5.
4. **The web renderer.** A new page following `web/org.html`'s shape. **Set
   `Access-Control-Allow-Origin` on the endpoint** — the identical omission silently broke
   the sponsor dashboard from 2026-08-31 to 2026-09-03 and returned HTTP 200 the entire
   time.
5. **Photo strip**, reusing `getPostsForChallenge` from the shipped Tier 1 work, with the
   event-scoped destination from §6 rather than the public Community feed.
6. **Consent copy** on the join screen.

## 9. Open decisions for Jake

1. **Marker grid size** (§5) — the tradeoff is visual richness against precision. Needs a
   number, and it should be picked by looking at a real rendered map, not in the abstract.
2. **Who can open the link.** Anyone with it (like the sponsor dashboard today), or
   participants only? "Anyone with the link" is what makes it shareable and is probably
   right, but it means the link *is* the credential.
3. **Does the organizer get a private, exact-precision view** distinct from the public
   shareable one?
4. **Pricing posture.** Free for the first cohort as case-study generation, or priced from
   the start? Per the 2026-09-06 commercial-model discussion, the bar is "pays for itself"
   at roughly $150–250/year, which one sponsor clears — so free-for-now remains viable and
   deferring pricing infrastructure is probably correct.

## 10. What this is not

- Not a replacement for the district sponsor dashboard (`web/org.html`). Both should exist;
  they answer different questions (§4).
- Not a reopening of the public all-time hotspot layer (§5).
- Not a personal impact artifact. Individual share cards already exist and are unaffected.
- Not a backfill. Only events that run after this ships can produce one.
