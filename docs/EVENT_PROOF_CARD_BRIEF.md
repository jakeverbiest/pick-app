# Event Proof Card — design and acceptance brief

Status: **draft for Jake’s review; no new implementation approved.**

## The decision this brief makes

Pick’s first corporate-facing impact artifact is a **one-day event proof card**. It is a challenge-scoped, token-gated web page and one 4:5 downloadable social image. The organization is the hero; Pick is the credit.

This builds on the already-deployed Group Impact Map infrastructure. It does not replace the in-app Challenge Recap, which serves participants. The Event Proof Card serves the organizer and creates the image a prospective partner can understand in seconds.

## User problem

After a cleanup, an organizer needs credible, beautiful proof of what their group did that they can share internally, post publicly, and use in a future partnership conversation. Current challenge recap and organization pages do not yet provide that finished organizer flow: the map can be reached by infrastructure, but it lacks event framing, export, and the visual discipline needed to travel as a social post.

## Recommended composition

**Default asset:** 1080 × 1350 logical pixels, rendered at 3× for a 4:5 feed image.

1. **Map — about 70% of the image.** Muted streets form the base. Event boundary is a Civic Blueprint navy outline. Covered streets are visible but quiet. Semi-transparent, grid-coarsened pickup markers sit above them. The map crop favors the event boundary, then event geometry, with padding; it must never zoom out to a few stray points until the activity looks tiny.
2. **Identity and proof band.** Organization or event name, place, and one date read before any metric. Example: “Litter Legion · Astoria · September 12, 2026.”
3. **Four supporting metrics.** Volunteer hours, bags, participants, and pickups. Lead verbally with hours and bags; pickups are supporting evidence while detector accuracy is still being improved.
4. **Attribution band.** “Powered by PICK · pickglobal.org” spans the full bottom edge so ordinary cropping is less likely to remove it.
5. **Optional photo strip.** Up to three photos a participant explicitly contributed to the event. The zero-photo layout must remain complete and intentional.

The map is the emotional proof; numbers explain its scale. Do not use a heat map, per-person marker colors, individual routes, ranking, or a dashboard-like grid.

## Goals

- An organizer can open one link after an event and understand the event’s place, scale, and collective work without explanation.
- The default export is recognizably Pick at feed-thumbnail size while giving the organization the visual credit.
- The artifact remains privacy-safe: group aggregates, gridded markers, and covered streets only; no individual routes or attribution.
- A real three-or-more-person event can produce a shareable case study without manual design work.

## P0 acceptance criteria

### Organizer flow

- [ ] A challenge organizer can find the event’s share link in the app after an eligible event begins or ends; the current backend-only token flow is not sufficient.
- [ ] The organizer can use the link to open the challenge-scoped web artifact.
- [ ] The organizer can share or download the 4:5 image without needing a social-platform connection.
- [ ] The bearer-link behavior and a revoke/rotate route are documented before an external pilot.

### Map and data correctness

- [ ] The public view includes only joined, consented participants and only cleanup data inside the challenge’s time window **and area**.
- [ ] Street coverage applies the same roster, time, and area filters as totals and markers.
- [ ] Pickup markers appear only at the established privacy floor of three contributors; they are grid-coarsened and never identify a person.
- [ ] The event boundary renders for custom and neighborhood areas. `anywhere` uses an intentional map-free treatment rather than invented contributor geometry.
- [ ] The crop keeps the boundary or main activity visually dominant. A distant outlier cannot make a dense event read as a tiny scatter.

### Export and visual quality

- [ ] Export is 4:5 and keeps the map dominant at thumbnail size.
- [ ] Organization/event name and place/date remain readable at a phone-feed preview size.
- [ ] The four metrics use consistent terms and definitions: hours are collective time; bags follow Pick’s existing bag estimate; participants means people with a contribution; pickups are labeled as the event’s count.
- [ ] Basemap/OSM attribution survives in the web page and the generated image where licensing requires it.
- [ ] The no-marker (<3 contributors) and no-photo cases look designed, not broken.

## Out of scope for this release

- Week-long or distributed corporate challenges, nudges, and team-versus-team competition.
- Public all-time litter hotspot maps or individual route display.
- Private cleanup-photo access. Only separately opted-in event photos may appear.
- A separate team-reporting system. Reuse the roster-plus-window query later, after the event artifact proves demand.
- Direct posting integrations with Instagram, LinkedIn, or any other platform.

## Narrative modules to test after the core record works

These are **content opportunities, not approved scope**. The record should remain a readable
event story, never expand into a corporate dashboard. Each module needs a direct source and a
clear label for whether it is logged, organizer-reported, or calculated.

1. **Why this place, in the organizer's words.** At challenge setup or closeout, offer one
   optional, moderated sentence: “We chose this route because it connects the school, park, and
   subway.” It turns generic scale into a local story without inventing environmental outcomes.
2. **A collective-effort translation.** Pair the exact 47 collective hours with a plain-language
   restatement such as “more than one full workweek of community care.” Keep the exact number
   next to the translation; this is a framing aid, not a new impact claim.
3. **A place sentence from real geometry.** Once coverage and boundary filters are correct,
   generate a cautious, factual line such as “The group logged six connected blocks around
   Astoria Park.” Never say an area was “fully cleaned” without a defined coverage standard.
4. **Before/after photo pair.** Optional photos explicitly contributed for this event, presented
   as observed moments rather than proof that every block changed. A single strong pair will
   travel farther than a denser metric grid.
5. **The people behind the number.** With opt-in, show organization logos, partner names, or a
   compact acknowledgement line. Do not show individual volunteers by default.
6. **A material destination note.** If the organizer logs it, state what happened after the
   cleanup: “34 bags were collected by the parks department” or “sorted for recycling.” This is
   useful audit context but must never imply recycling or diversion without a real handoff.
7. **A local series.** After several comparable events, add a small “this season” line for the
   same organization or named place. Do not compare different places, durations, or participant
   rules as if the counts were directly comparable.
8. **A methods drawer.** Keep detailed definitions off the share image, but make them one tap
   away on the public record: participant rule, time window, area filter, privacy treatment,
   and which fields were organizer-reported.

### Recommended content hierarchy

The social image should carry one headline, a genuine place visual, and three metrics at most.
The public Impact Record can add the organizer's place statement, acknowledgements, one
collective-effort translation, disposal note, optional photos, and methodology. This separation
keeps the share asset emotionally clear while allowing a corporate reader to inspect the work.

### Real-data design pass — 2026-09-11

An unpublished layout pass used one existing historic cleanup record rather than invented event
figures: **CG Pickers**, June 20, 2026, **433 logged pickups**, **10m 20s**, and **2.5 lb logged**.
It is an individual session, not a group event and not a public case study. Its precise route and
location were deliberately omitted from the visual.

The pass confirmed that the record can tell a compelling, honest session story using only direct
fields. It also made the missing group-event inputs concrete: organizer's reason for the place,
event boundary and coverage, participant rollup, bag handoff, and optional contributed photo.
Do not promote the session as corporate/event proof; use it only to guide the first real
three-or-more-person field test.

With Jake's explicit permission, a second private layout pass overlaid that session's recorded
GPS samples on public OpenStreetMap street geometry. The resulting map is an accurate **logged
cleanup corridor**. It intentionally does not draw a polygon or say a whole enclosed area was
cleaned: the session records where the device travelled, not a verified street-by-street cleanup
audit. This is the required wording and visual model for individual-session maps. A group event
can additionally show covered streets only after the roster, time, area, and privacy filters in
the P0 criteria are all satisfied.

## Dependencies and known gaps

Already implemented: challenge share tokens, challenge-scoped stat rollup, consented marker aggregation, street coverage endpoint, MapLibre event web page, and join consent for new events.

Remaining: organizer-facing link/share controls; event boundary rendering; export-image renderer; area filter on street coverage; crop rule; photo strip; and an organizer-facing revoke/rotate action. Existing map points and coverage can make the event look too broad when an outlier is present; crop behavior must be tested with that case.

## First field test

Run one genuine, consented, one-day event with at least three contributing participants. Before interpreting the artifact, verify the link, roster, boundary, metrics, marker privacy floor, and export. Collect a screenshot at full size and feed-preview size, plus the organizer’s reaction to whether they would post it without edits.

## Decisions still needed from Jake

1. Public bearer link for anyone who receives it, or participant-only access? Recommendation: bearer link for the first pilot, with an organizer-facing revoke/rotate action.
2. Marker grid size. Recommendation: choose it only after viewing a real event render at 4:5 and at feed size.
3. Do the optional event photos ship with this card or follow after the map/export flow is proven? Recommendation: follow; the map and proof band must stand on their own.

## Follow-up sequence

1. Review this layout direction and lock the three decisions above.
2. Build the organizer flow and correctness fixes as one thin vertical slice.
3. Generate the card from the three-person event and review it at social-feed size.
4. Use the real artifact in the corporate partnership workstream as the pilot proof.

### Litchfield private map study — 2026-09-11

Jake confirmed that both historic contributors to **Litchfield Litter Invitational** are his own
accounts and granted permission for a **private prototype** using their data. The study uses
public OpenStreetMap street geometry plus sanitized historical challenge data: 40 cleanups, 793
pickups, 11 bags, two hours, 27 credited coverage corridors, and 321 stored pickup-location cells.
It must not be published from the historic event: the original event had only two contributors and
did not collect the later public-map consent. The fresh permission is limited to this private design
review.

The earlier full-event map was misleading because the `Anywhere` challenge spans roughly 21.6 km
north–south and 15.4 km east–west, including a few remote pickup clusters. A single social-sized
map made neither local streets nor pickup evidence readable. The replacement visual therefore
centers the primary cleanup area, draws actual streets underneath the logged coverage corridors,
and uses orange display bins for pickup locations. It labels the bins accurately: location cells
are a device-side deduplication record, not one dot per individual item, and green corridors are
logged/credited coverage, not proof that every street was fully cleaned. Reuse this core-map-plus-
event-extent approach for future wide-area events.
