# Spec — Civic-Org / Sponsor Impact Dashboard

Status: **proposal for review, not yet built.** Written Aug 31, 2026, Jake's stated top current
priority. Grounded against the app as it exists today in `~/Desktop/pick-app`; corrects an earlier,
wrong scoping pass that treated `Challenge.team` as a disconnected ad hoc field — it genuinely
references the real `teams/{teamId}` collection (see §2).

## 1. Why this, and for whom

Pick's own stated business model (`~/pick-app/PICK_one_pager.md`) names this artifact directly:

> **Cities & Business Improvement Districts** — cleaner streets, resident engagement, and a
> shareable impact dashboard + street-level data. Pilot → annual contract.

and the 6/12-month goals are "first paid city/BID pilot" and "2–3 civic contracts or sponsorships."
This dashboard is plausibly **the actual sales/reporting artifact for that pitch** — the thing a BID
or city partner looks at mid-pilot to decide whether to renew or expand. Write and design this with
that audience in mind: a partner org deciding whether to sign an annual contract, not a casual
end user browsing their own stats. That framing should drive tone, level of polish, and what gets
prioritized below — a partner deciding on a contract renewal cares about a defensible number over a
season, not a cute animation.

## 2. What already exists — reuse, don't rebuild

- **`teams/{teamId}`** — a real Firestore collection (`TeamDir`: `id`, `name`, `created_by`,
  `created_at`). Rules (`firestore.rules`, `/teams/{teamId}`): any signed-in user can read or create
  a team; team docs are **immutable after creation** (`allow update, delete: if false`). Team doc id
  is a slug of the name (`teamSlug()`, `firebaseDatabase.ts`); membership itself lives on each user's
  own settings (`team_name`, `team_id`), not on the team doc.
- **`team_stats/{teamId}`** — a Cloud-Function-maintained rollup (`functions/index.js`,
  `rebuildTeam()`), recomputed on every `cleanups` write via `onCleanupWrite`, or in bulk via the
  callable `rebuildTeamStats`. Same aggregation *pattern* as the existing public per-city dashboard
  (`rebuildPublicStats()` in the same file) — recompute-from-source on each change, not incremental
  deltas, so it can't drift. **Field-level note, worth getting right before building on it:** the
  function currently writes `total_cleanups`, `total_pickups`, `total_weight` (not `total_bags`),
  `total_days`, `member_count`, `last_cleanup`, `avg_pickups_per_session`. The app's own
  `TeamDirWithStats.total_bags` is *not* read from this doc — `getTeamsWithStats()` falls back to
  `itemsToBags(total_pickups)`, an estimate, because `team_stats` never actually contains a bags
  figure. `rebuildPublicStats()`'s per-city version *does* compute a real `bagsFor(d)` per cleanup
  already — team_stats just never adopted the same helper. Cheap, low-risk fix, worth doing regardless
  of anything else in this spec: bring `team_stats` up to parity with the per-city rollup's field set.
- **`Challenge.team?: string`** — genuinely wired, not decorative: `visibility: 'team'` challenges are
  gated to `c.created_by === uid || (!!opts?.team && c.team === opts.team)` in `listChallenges()`. So
  a sponsor could already run a challenge scoped to their own team's roster today, independent of
  anything new in this spec.
- **Existing area/geofence machinery on `Challenge`** — `ChallengeArea` (`type: 'anywhere' |
  'neighborhood' | 'custom'`, flat `ring`), `cleanupInArea()`, `flattenRing`/`ringBbox`/`pointInRing`
  in `challenges.ts`. This is real, tested geometry-matching code and the natural thing to reuse if
  district-scoping (§3.2) is wanted, rather than inventing new polygon math.
- **`rebuildPublicStats()`** — the existing anonymous public city dashboard, same file. Worth reading
  before designing the sponsor UI: it already computes weekly vs. all-time aggregates, city-level
  rollups, and hotspot binning at two resolutions. A sponsor dashboard is a gated, org-scoped sibling
  of this, not a new invention.

## 3. The real gaps — what actually needs deciding and building

### 3.1 "Our members' total impact" vs. "impact within our sponsored area" — decision, not default

`team_stats` today rolls up **everything a team's members ever did, anywhere** — it's `cleanups.where
('team', '==', team)`, with no location or time-window filter beyond what the caller supplies. That's
a real, already-computable number: "our members collectively picked up X, cleaned Y bags, across Z
cleanups." It is **not** the same number as "impact within the BID's district" — a member could join a
sponsor's team and then do all their actual walking somewhere else entirely, and today's rollup would
still count it.

These produce genuinely different, non-interchangeable numbers, and the choice has contract
implications (a BID paying for a district pilot presumably wants the second one, or at least wants to
know which one they're being shown). **This needs to be presented to Jake as an explicit choice, not
silently defaulted to whichever is easier to ship first:**

- **"Members' total impact"** — buildable today with zero new data model changes, just a dashboard UI
  over the existing `team_stats` doc (plus the `total_bags` fix in §2). Fast, but arguably answers the
  wrong question for a district-scoped sponsorship.
- **"Impact within the sponsored area"** — requires §3.2 (an area on the Team doc) and a new
  aggregation that intersects cleanups against that area (reusing `cleanupInArea()`), independent of
  which team a picker belongs to, or filtered to team members *within* the area — a further sub-choice
  worth surfacing at the same time (does a member's cleanup count if they're a team member but picked
  outside the district? Probably not, but say so explicitly rather than assuming).

### 3.2 No area/geofence on the `Team` doc itself

Only `Challenge.area` has a stored polygon today — `TeamDir` has no geographic field at all. If
district-scoping (the second option in §3.1) is wanted, `TeamDir` needs an optional `area` field,
structurally identical to `ChallengeArea` (reuse the type, the flat-ring encoding, and
`cleanupInArea()`/`ringBbox()` rather than inventing parallel geometry code). Given `teams/{teamId}`
docs are immutable post-creation (`allow update, delete: if false` in rules), adding an area either
means capturing it at team-creation time (fine for a *new* sponsor team created specifically for a
pilot) or **loosening the immutability rule** for an org-admin-gated update path (a real rules change,
not just an app change — flag this explicitly since "team docs are immutable" is a deliberate existing
decision, not an oversight, per the rules' own comment).

### 3.3 No dashboard UI exists that presents `team_stats` in sponsor-presentable detail

Today `team_stats` likely only feeds a basic team leaderboard (`getTeamsWithStats()`,
`getTeamLeaderboard()`) — current totals, ranked against other teams, no season view, no goal
comparison, nothing built for handing to a partner. This needs real design, informed by what a BID or
city partner is actually trying to answer mid-contract:

- **Time-series over a season**, not just a current-totals snapshot — `team_stats` as it exists today
  is a point-in-time rollup with no history; showing a trend line means either storing periodic
  snapshots (e.g. a scheduled function writing a dated copy, mirroring the existing `onSchedule`
  pattern already used elsewhere in `functions/index.js`) or computing week-by-week from raw
  `cleanups` at read time (more expensive, no new write path, but the aggregation pattern this whole
  system is built on is explicitly "recompute from source" — an approach that already handles this
  file's own team_stats and citywide rollup, so it's not a foreign approach here).
- **Comparison to the org's own goal** — nothing today captures "the BID's target for this pilot."
  Would need a place to store a target (on the `Team` doc, if extended per §3.2, or a lightweight
  sibling doc).
- **Exportable/printable for a report** — a BID renewing a contract plausibly wants something to put
  in front of their own board, not just a live webpage. Worth deciding whether "exportable" means
  PDF export, a shareable static snapshot (same pattern as the challenge recap's PNG capture, which
  this codebase already has proven infrastructure for via `react-native-view-shot` — though that's a
  mobile-app pattern and this dashboard, per §4, likely needs to be viewable outside the app), or
  simply a screenshot-friendly web layout with no special export feature at all.

None of these are hard problems individually, but together they're a real design pass, not a
formatting tweak on the existing leaderboard screen.

### 3.4 No org identity/branding — real, but lower priority

No logo, no org display name distinct from the team name, no reporting-period selector UI. Flag as
genuine polish a sponsor would want (their own logo on their own dashboard reads as "this is ours," not
"this is Pick's product with our name typed in") — but not a blocker for a first working version, and
should not compete for build time against §3.1–3.3.

## 4. Access control — needs a decision, not left unaddressed

Unlike the existing anonymous public city dashboard (`rebuildPublicStats()`, no auth gate, meant to be
public by design), a sponsor dashboard is showing an org's specific numbers to a specific audience —
this is privacy-sensitive and gated by nature, and there's no existing pattern in this codebase to
copy wholesale:

- **Team members** — the closest existing notion of "belongs to this org" (`team_name`/`team_id` on
  user settings), but membership today is self-serve (anyone can join a team by name, per
  `joinOrCreateTeam`) — not a trusted signal that someone should see a sponsor's private reporting
  view. Using raw team membership as the access gate would mean anyone who joins the team by name
  (which requires no approval) gets dashboard access.
- **A separate "org admin" role** — more correct, but net-new: no role/permission system exists on
  `TeamDir` or anywhere else in the app today (Firestore rules check `isOwner`/`created_by`
  comparisons, not a roles list). Would need a new field (e.g. `TeamDir.admins: string[]`) and rule
  changes, on top of the immutability question already raised in §3.2.
- **A public link with a token** — the pattern some analytics tools use (e.g. a long unguessable URL
  standing in for auth), plausible for a sponsor-facing report that non-app-users (a city council
  member, a BID board) need to open without a Pick account at all. This also sidesteps §3's "does this
  need to be inside the mobile app or a web view" question — a token link is naturally a web page, which
  fits "hand a report to a partner" better than a screen buried in the consumer app.

**This needs a decision from Jake — it is not resolvable from an existing pattern in the codebase**,
and the choice affects both the access-control build and whether this dashboard lives inside the
Expo app or as a new page on `pickglobal.org` (the latter has real precedent: the public map/city
pages already port dashboard logic into the website, per `PROJECT_TIMELINE.md`'s Aug 17 website entry
— a token-gated sibling page there is a smaller lift than a new authenticated screen inside the app).

## 5. Build order (rough, pending the §3.1/§4 decisions)

| Phase | Work | Depends on |
|---|---|---|
| 1 | Fix `team_stats` to compute real `total_bags` (reuse `bagsFor()`), matching the per-city rollup | nothing — do this regardless of the rest |
| 2 | Decide "members' total" vs. "district-scoped" (§3.1) and, if district-scoped, add `TeamDir.area` + rules change (§3.2) | Jake's decision |
| 3 | Decide access model (§4) and, if web-based, decide whether it's a `pickglobal.org` page or in-app screen | Jake's decision |
| 4 | Time-series storage (periodic snapshot function or read-time aggregation) | phase 2 |
| 5 | Dashboard UI — season view, goal comparison, org branding, export | phases 1–4 |

Not estimated in days — phases 2–3 are decisions that materially change phases 4–5's scope, so an
estimate before those land would be a guess dressed up as a number.

## 6. Decisions (resolved 2026-08-31)

All six open questions decided by Jake in one pass:

1. **District-scoped**, not members'-total. The dashboard measures impact *within the sponsor's
   area*, not wherever the team's members happen to wander. Requires §3.2 (an area on `TeamDir`).
2. **Out-of-district cleanups don't count.** Pure geographic filter — any cleanup within the
   sponsored area counts, regardless of who did it or what team they're on. This is the most
   honest answer to "did this district get cleaner," which is what a BID is actually paying to
   see. (A "our volunteers' impact" secondary stat is a plausible later addition, not v1.)
3. **Access control: token-gated public link.** Not team membership (too weak — joining a team
   today needs no approval) and not a new org-admin role (real, but a whole new permission system
   this app doesn't have anywhere else, for one feature). A token link fits the actual audience —
   a BID board member or city council contact with no Pick account — and sidesteps building auth
   infrastructure that doesn't exist yet.
4. **Web page on `pickglobal.org`, not an in-app screen.** Follows directly from #3 — a token link
   is naturally a web destination, and there's already real precedent (the public map/city pages
   already port dashboard logic to the website).
5. **Don't loosen `teams/{teamId}` immutability.** Area scoping is only supported for
   newly-created sponsor teams, captured once at creation time. The three existing teams are
   casual, not BID sponsorships, so nothing needs upgrading. Revisit only if an existing team
   later needs to convert into a sponsored one.
6. **Export: screenshot-friendly web layout for v1, no dedicated export feature.** Same "ship the
   free/simple version first" logic already used for the Guest Mode map-matching decision — add
   PDF/snapshot export later if it turns out to actually matter to a sponsor.

Also settled while deciding #1-2: the org's own goal/target (§3.3) is stored alongside the new
area field on `TeamDir` — cheap to add at the same time. Time-series (§3.3) uses periodic
snapshots via a scheduled function, mirroring the pattern already used elsewhere in this file,
rather than computing trends at read time.

Ready to build — see §5 for phase order, now unblocked.
7. **Priority of org branding/logo (§3.4) relative to the above** — flagged as real but explicitly
   lower-stakes; confirm it should stay deprioritized rather than being assumed.
