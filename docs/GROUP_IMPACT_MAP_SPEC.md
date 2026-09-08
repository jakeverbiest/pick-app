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

---

## 11. Amendment 2026-09-08 — one query, two rosters; and in-app access is settled

Written after a design conversation with Jake. **This amends §4 rather than replacing it.**
§4's core call still stands — a time-boxed event is a challenge, and the district dashboard is
a separate, geographic thing. What §4 does not cover is the case Jake raised: **a team leader
seeing their group's logged work on an ongoing basis**, which is neither a one-day event nor a
geographic district.

### 11.1 The model, in Jake's words

> "I should be able to be on a team AND participate in a specific challenge (upon joining that
> challenge). I should be able to be unaffiliated and join a challenge. A challenge organizer
> should see the full stats and beautiful map of their joined participants. Same with a team
> leader — they should be able to see logged work on a longer basis. The difference is how we
> filter or categorize the data to include all team members or all participants for a specific
> challenge."

**This needs no schema change.** One team per user (`team_id`/`team_name`, singular in user
settings) and many challenges per user is exactly what ships today. An earlier draft of this
conversation claimed many-to-many membership was the load-bearing prerequisite; that was wrong
for this model and is withdrawn.

### 11.2 The generalization

There is **one query**, parameterized by a roster and a window:

| view | roster | window |
|---|---|---|
| challenge / event | joined participants | the challenge's start–end |
| team, ongoing | current team members | all time (or a chosen period) |
| district sponsor (existing, §4) | *everyone* — geographic filter | all time |

The first two are the same code with a different roster. The third stays as-is and stays
honest about being geographic; `web/org.html` already says so on screen.

The practical consequence for build order (§8): **do not build the team view as a second
system.** Build the challenge view as §8 describes, but take the roster as a parameter from
the start rather than reading participants inline. The team view is then a second caller.

### 11.3 The map is street coverage, not routes — and that is already privacy-safe

The blocker on any roster-scoped map is that **`cleanups` is owner-only read**
(`firestore.rules:33`), deliberately: a route traces a walk that usually starts and ends at
home. That is why `contrib` docs carry totals only. An organizer must never see participants'
routes, and this spec does not propose changing that.

**It does not need to.** `segment_status` is readable by any signed-in user
(`firestore.rules:197`) and carries `last_user` and `last_cleaned`. So the map is:

> segments where `last_user` ∈ roster **and** `last_cleaned` ∈ window

That is street *coverage*, not a route trace — privacy-safe by construction, and already the
app's own visual language. §4b's "streets covered underneath the markers, from
`segment_status`" was already reaching for this; §11 makes it the primary mechanism for both
views rather than a background layer.

**Two real caveats, neither blocking but both worth building around:**

1. **`last_user` is last-writer-wins.** Two people clean the same block and only one is
   credited. Fine for "this street got cleaned"; **wrong as a basis for per-person standings.**
   Leaderboard numbers must come from `contrib`/cleanup totals, never from segment counts.
2. **`segment_status` is client-written with weak validation** — any signed-in user can write
   any segment claiming themselves. Acceptable while it drives a visual. **If it ever feeds
   competitive standings in a corporate challenge, that is a live gaming vector** and needs
   server-side validation first.

### 11.4 Access — decided 2026-09-08

**Jake's decision: joining is the permission. Everyone on a team sees their team's
leaderboard; everyone in a challenge sees that challenge's.** No leader or organizer role is
needed for the in-app view, and none should be built.

This is close to a no-op against current rules and mostly a tightening: `contrib` is already
`allow read: if signedIn()`, i.e. readable by *any* signed-in user, not just participants.

**This settles §9 item 2 only for the in-app view. It does not settle the shareable web link**,
which remains "anyone with the link is the credential," matching the sponsor dashboard. Those
are two different surfaces and should not be conflated:

| surface | audience | gate |
|---|---|---|
| in-app leaderboard + map | members / participants | membership (this decision) |
| shareable web link | funders, social, the public | the token in the URL |

**Carried over as still-open:** a team's roster is still joinable by typing the team's name
(`joinOrCreateTeam` writes `team_name`/`team_id` straight into the joiner's own settings, no
approval). Under this decision that is acceptable for a *view* — a stranger who joins sees
group totals, which is low harm. It remains **not** acceptable as the basis of a funder-facing
report, so if a team's numbers are ever exported as an org's official impact, enrollment needs
a real gate first. §9 items 1, 3 and 4 are unaffected.

### 11.5 §9 open decisions — resolved 2026-09-08

Jake decided three of the four §9 items. **§9 should now be read through this section.**

| §9 item | decision |
|---|---|
| 2. Who can open the shareable link | **Anyone with the link.** The token in the URL is the credential, matching the sponsor dashboard. This is what makes the artifact postable, which §1 calls the whole point. Accepted consequence: a forwarded link cannot be withdrawn — see below. |
| 4. Pricing posture | **Free for the first cohort**, as case-study generation. No billing infrastructure is to be built. Revisit once a rendered artifact exists that orgs ask for by name. |
| 1. Marker grid size | **Deferred, not decided.** It cannot be picked in the abstract; it needs a real rendered map to look at. Blocked on §8, not on Jake. |
| 3. Organizer's private exact-precision view | **Still open. Recommendation: don't build it** — one artifact is less to build and less to explain. Not asked, not decided; revisit only if a real organizer asks. |

**The revocation gap is now a known, accepted risk rather than an oversight.** No token in this
system — sponsor or group — can be revoked, rotated, or expired today. Under "anyone with the
link," a shared URL is permanent. That is acceptable for a public impact artifact, which is
meant to travel. It is **not** acceptable for anything carrying data an org would consider
private, so: **no private or member-identifying data may appear behind a link-gated URL** until
revocation exists. Aggregate totals, street coverage and participant display names are fine;
anything more is not.

### 11.6 Marker grid size is a privacy control, not only an aesthetic one — 2026-09-08

§9.1 files marker grid size as a look-and-feel tradeoff to be settled against a rendered map.
That is true and still the right way to pick the exact number, **but it is not the only
constraint, and the aesthetic framing alone would let it be set too fine.**

Markers are derived from individual participants' pickup locations (§5, §8.3). Three facts
combine:

1. A small event may have very few participants — sometimes one person covering one route.
2. §11.5 settled that the shareable page is open to **anyone with the link, permanently, with
   no revocation**.
3. `cleanups` is owner-only read precisely because **a route reveals where someone lives**
   (`firestore.rules:33`).

So a grid fine enough to be visually satisfying on a two-person event can reconstruct an
individual's walk — and publish it on an unrevocable public URL. That is the exact harm the
owner-only rule exists to prevent, reached by a different path.

**Therefore the grid has a floor, independent of how it looks:**

- Pick the number against a rendered map as §9.1 says, **then apply the floor, and never go
  below it because the map looks better.**
- **Suppress the marker layer entirely below a minimum participant count.** The totals, the
  street coverage and the identity line all still work; only the dot layer drops. A
  three-person event still gets a real artifact.
- Street coverage from `segment_status` is **not** subject to this — it is inherently
  aggregate ("this street got cleaned") and carries no per-walk path.

Both numbers — the grid floor and the minimum participant count — are still open and should be
decided together, not separately, and not purely on appearance.

### 11.7 Plan of record — decided 2026-09-08

Three decisions from Jake, plus the resulting sequence. **This is the section to start from.**

**1. v1 is CHALLENGE ONLY.** The team (ongoing-roster) view does not ship in the first release.
§11.2's requirement still holds and is what makes this cheap: **the roster is a parameter from
the first line of code**, not read inline from participants. The team view is then a second
caller, not a rewrite. Do not shortcut this — hardcoding participants into the query is the one
mistake that turns the follow-on into a rebuild.

**2. Sequencing: GREENFIELD FIRST, then migrate.** The new web page is built in MapLibre from
the start rather than in Leaflet and ported later. The reasoning is risk placement: the renderer
patterns (GeoJSON source + style layers, the layer-insertion anchor from
`VECTOR_BASEMAP_MIGRATION_SCOPE.md` §5a, data-driven paint) get worked out on a page with no
users, instead of inside `map.tsx` — the app's primary screen, carrying the follow-cam,
spotlight, tap-to-inspect and live route drawing.

**3. Small events get a map with NO markers**, not a withheld artifact. Below a minimum
participant count the dot layer is suppressed; street coverage, totals, identity line and photo
strip all still render. Rationale in §11.6 — street coverage from `segment_status` is inherently
aggregate and carries no per-walk path, so it is safe at any group size. A three-person cleanup
still gets something worth posting.

**Also decided, by default rather than debate:** §9.3 (an organizer-only exact-precision view) is
**not being built.** One artifact. Revisit only if a real organizer asks.

#### The combined order of work

| # | work | notes |
|---|---|---|
| 1 | Challenge token + shareable link (§8.1) | backend, copies `createSponsorTeam` |
| 2 | Challenge-scoped stats rollup (§8.2) | rides `onCleanupWrite`, no full scans |
| 3 | Marker aggregation (§8.3) | admin-side; **apply the §11.6 floor + suppression here, not in the renderer** |
| 4 | **The new web page, built in MapLibre** (§8.4) | greenfield. **Set `Access-Control-Allow-Origin`** — the identical omission broke `org.html` for three days at HTTP 200 |
| 5 | Photo strip (§8.5) | reuses shipped Tier 1 |
| 6 | Consent copy (§8.6) | user-facing — staged for Jake's approval before it ships |
| 7 | Migrate `web/map.html` + `web/org.html` | web, low-risk, reuses step 4's patterns |
| 8 | Migrate the four app maps | separate effort — see `VECTOR_BASEMAP_MIGRATION_SCOPE.md` §5 |
| 9 | Team-roster view | the second caller of step 2's roster parameter |

Steps 1-3 and 5 are mechanical and need nothing from Jake. Step 6 is gated on his approval as
user-facing copy. **The marker grid floor and the minimum participant count are still open
numbers** (§11.6) and must be picked together against a rendered map — they are the one thing in
step 3/4 that cannot be decided in advance.

### 11.8 A marker is a PLACE, not a pickup — 2026-09-08

Investigated after step 3's dry run showed Litchfield Litter Invitational at **793 pickups but
only 321 stored coordinates**. **This is not a bug and nothing needs fixing in capture.**

`cleanups.pickups` is deduplicated on the device to unique **~11m cells per walk** — 4-decimal
rounding, with the reason stated in `map.tsx`: *"Rounded to ~11m so it maps a block, never a
doorstep."* Several items collected along the same stretch collapse to one stored point. Across
Jake's 217 walks: **7,717 pickups → 1,993 stored points.** (The file also carries scar tissue
worth not repeating: an earlier `slice(0, 60)` truncation was removed for starving spatial
coverage on long walks.)

**Consequence 1 — §3's copy must change.** §3 lists "Pickups, bags, hours, participants" as
headline totals and §5 describes "a field of markers [that] says *we did this four hundred
times*." Those two together imply one dot per pickup, and the artifact would show ~321 dots
beside a "793 pickups" headline. Both numbers are true; the pairing is misleading. **The
renderer must not imply a one-to-one relationship.** `challenge_markers` now carries `points`
alongside `cell_count` so the page can say something accurate — e.g. "793 pickups across 321
spots." Exact wording is a copy decision, not settled here.

**Consequence 2 — the §11.6 privacy floor is stronger than it looked.** Coordinates are already
11m-rounded before they ever leave the device, so the server-side grid is a *second* layer of
coarsening rather than the only one, and `MARKER_GRID_MIN_DEG` (~22m) is coarser still. Good
news, but do not let it become an argument for lowering the floor: the floor protects against
route reconstruction from *many* points, which per-point rounding does not address.

**Consequence 3 — densest-first truncation is meaningful.** Since the dedupe is per *walk*, a
spot worked across many walks accumulates a real count. Measured at grid 0.0003 over Jake's
data: **463 cells, 299 of them with a count above 1, max 88.** So cell counts carry genuine
signal and can drive dot sizing; truncation drops the sparsest rather than an arbitrary slice.

**Still open (§11.6):** the grid size and `MARKER_MIN_PARTICIPANTS`. Note that at the current
value of 3, **every existing challenge is suppressed** — the platform has 5 users who have ever
logged a cleanup and the largest challenge roster is 2. Recommendation is to keep 3 and let the
layer light up at the first real multi-person event rather than weaken a floor that cannot be
un-published; recorded here so that is a decision rather than a surprise.

### 11.9 Correction — revocation is possible today, just not self-serve (2026-09-08)

§11.5 and the `createChallengeToken` header both say there is "no revocation." **That
overstates it and should be read as corrected here.**

Deleting `challenge_token_index/{token}` kills a link **immediately**. `challengeImpact` resolves
every request through that reverse index and returns 403 when the lookup misses — verified
repeatedly while building step 4, where test tokens were minted and torn down several times.
The same is true of `team_token_index/{token}` for sponsor dashboards.

So the accurate statement is:

| | today |
|---|---|
| Can a shared link be killed? | **Yes** — delete the index doc. Takes effect on the next request. |
| Can the organizer do it themselves? | **No.** There is no callable and no UI. |
| Can it be done without Jake? | **No.** Admin SDK access is required. |
| Does killing it break the artifact permanently? | No — minting again issues a *new* token. The old URL stays dead. |

**What actually stands from §11.5 is the constraint, not the impossibility:** no private or
member-identifying data may sit behind a link-gated URL. That still holds, for a different
reason — revocation is manual and reactive, so it cannot be relied on as a control. By the time
anyone asks for a link to be killed, it has already been seen.

**Consequence for the backlog.** "Build revocation" was listed as a hard prerequisite
(`ORG_ONBOARDING_RUNBOOK.md` called it the item most likely to embarrass the project). It should
be re-scoped: the mechanism exists, so the work is a `revokeChallengeToken` / `revokeTeamToken`
callable plus a button — organizer-only, mirroring `getChallengeToken`'s ownership check. That is
a much smaller job than it has been carried as, and it should be sized accordingly rather than
deferred as though it were foundational.
