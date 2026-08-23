# Public beta — go / no-go

Written 23 Aug 2026. Decision doc, not a plan. Every line is either a check
you can tick today or a call only you can make.

---

## The headline

**You do not need build 32, and you do not need Apple.** Build 31 already
cleared TestFlight App Review on 12–13 Aug, and a public link requires only an
*approved* build. Turning on a public beta is a switch in App Store Connect plus
two text fields.

So this is not an engineering decision. It's a "how many strangers do I want,
and what breaks when they arrive" decision.

## ANSWERED 23 Aug — the beta is already public

`testflight.apple.com/join/6753UhuM` is a live public link and it is published
on `download.html`. **This document is not a go/no-go any more.** Everything
below is a description of a beta that is already running, and every gate in it
is current exposure rather than a future decision. Read it that way.

Two things to check in App Store Connect right now, because both may be
unset and both are live:

1. **Tester limit.** If none was set, the link runs to the 10,000 ceiling.
2. **Beta App Description.** It is the first thing a stranger reads, and it may
   still describe the pre-19-August detector — or be empty.

<details><summary>Original "check first" section, kept for the record</summary>

### Check first — you may already be public

`download.html` links to `testflight.apple.com/join/6753UhuM`.

That `/join/` form **is** the public-link format. Private external invites go
out by email and don't produce a URL you can put on a website. Meanwhile the
ledger describes the external group as friends-and-family.

**Both cannot be true.** Open App Store Connect → PICK → TestFlight → External
Testing → your group → Testers → look for "Public Link". Two minutes, and it
changes the whole question:

- **Already public** → you are running a public beta and the rest of this doc is
  about tightening it, not starting it.
- **Not public** → the site has been promising an open beta behind a link that
  can't deliver one, and that's the first thing to fix either way.

</details>

## Mechanics — the whole list

| # | Item | Where | State |
|---|---|---|---|
| 1 | Approved build | TestFlight → Builds | ✅ Build 31, approved 12–13 Aug |
| 2 | Internal group exists | TestFlight → Internal Testing | Required before an external group; you have external groups, so yes |
| 3 | **Beta App Description** | TestFlight → Test Information | Required. Draft below |
| 4 | **Feedback email** | TestFlight → Test Information | Required. `hello@pickglobal.org` |
| 5 | Public link created | External group → Testers → Create Public Link | The switch |
| 6 | **Tester limit** | Same dialog, "Set Limit" | 1–10,000, editable later. **This is your main lever — see Support** |
| 7 | Device / OS filter | Same dialog | Optional. Consider iOS floor matching your deployment target |

The link can be disabled at any time. The limit can be changed at any time.
Nothing here is one-way.

**One consequence to know:** testers who join by public link show as
**anonymous** in App Store Connect — no name, no email. You get install date,
sessions and crashes, not identities. That is fine for crash data and fatal for
detector data, which is why the export function matters more the moment you
open this up.

## Draft Beta App Description

> PICK turns a walk into a measurable cleanup. Start a cleanup, put your phone
> in your pocket, and walk — PICK counts pickups from your phone's motion and
> paints the streets you cover green on a map you share with your neighbours.
>
> What to test: start a cleanup and walk a normal route with the phone in your
> front pocket, screen off. At the end you'll see a count. **Tell us whether it
> matched what you actually picked up** — the end-of-walk screen lets you
> correct it, and that correction is the single most useful thing you can send
> us.
>
> Known: automatic detection is still being calibrated. Requires an account.
> iPhone only; Apple Watch companion optional.

Edit freely — but keep the "tell us whether it matched" ask, because it is the
only instruction that produces data.

---

## The four gates that aren't mechanical

### 1. Developer name — DEFERRED 23 Aug (Jake)

The TestFlight listing shows your developer name. Holding off on the LLC means
launching under your personal Apple Developer name. That's a normal thing for a
solo beta and reversible later, but be aware it's public the moment the link is.

**Status: deliberately deferred. Not a blocker for beta. Revisit before App Store
release or any EU distribution.**

### 2. Detector export — becomes urgent here

Today you cannot read any tester's `items_detected`. At friends-and-family scale
the workaround is a screenshot you can ask for by name. **With anonymous public
testers there is nobody to ask.** Every walk becomes data you own, stored
correctly, and cannot see.

The Cloud Function reads it retroactively, so it never has to exist *before* a
walk — but it has to exist before the data is worth anything.

**Call: build it before the link goes public, or accept that the public beta
produces zero detector evidence.**

### 3. No guest mode — this is now a funnel number

Account required before anyone sees a single screen. On a private invite that's
friction among friends. On a public link it's your drop-off rate, and you won't
be able to see who bounced.

`CHALLENGE_GUEST_MODE_SPEC.md` exists and is unbuilt. Not a blocker; just know
that "how many installed" and "how many walked" will diverge and you won't know
why.

### 4. Support load — see below

---

## Support load

**The lever is the tester limit, not more support infrastructure.** Set it to a
number where the promises already on your site stay true. Everything else
follows from that.

### Two promises that stop being true at scale

Both are currently in writing on `support.html`:

| Promise | Risk |
|---|---|
| "every message is read" | Fine at 50 testers. A commitment you'll break at 500. |
| reports "reviewed within 24 hours" | A **moderation SLA in writing**. With a public link and user-generated impact posts, this is the line most likely to be quoted back at you. |

Either cap the beta so both stay true, or soften them now. Don't leave them
standing and hope.

### Route feedback where it costs you least

TestFlight's built-in feedback (screenshot + tester note, and crash reports)
lands in App Store Connect with device model, OS version and app version
attached automatically. Your email path asks testers to supply all three by
hand, and they won't.

**Make TestFlight feedback the primary channel** — say so in the Beta App
Description and on the site — and keep `hello@pickglobal.org` for account
problems, moderation, and anything human.

### One stale line, three places

`support.html`, `index.html` and `about.html` all still say detection
over-counts on a slow stroll. That was true on 17 Aug. The relative pause gate
shipped 19 Aug and B5 came back 20/20. **Fix this before you invite strangers**
— it's the first thing a new tester reads about the core feature, and it's
apologising for a bug you fixed.

---

## Recommendation

**Go — with a capped limit.** Nothing here is one-way, the build is approved,
and the cap makes the support promises honest instead of aspirational.

Order:

1. Check whether the link is already public. Everything below depends on it.
2. Fix the stale detector claim on all three pages.
3. Build the detector export Cloud Function.
4. Set Test Information: description + feedback email.
5. Create or re-limit the public link with a cap you can actually support.

Steps 1, 2 and 4 are today. Step 3 is the one worth waiting for.
