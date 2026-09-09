# Challenge consent copy — DRAFT for Jake's approval

Status: **draft, nothing shipped.** Written 2026-09-08 for `GROUP_IMPACT_MAP_SPEC.md` §6 / §11.10.
User-facing copy is gated on Jake's explicit approval per the standing rule in `AGENTS.md`.

**This is the gating item for the whole group impact map.** §6 says events that ran before this
ships have no consented participants, so no share link may be minted for a real event until this
is live. Steps 1-4 are built and deployed; they are waiting on this, not the other way round.

---

## What §6 asks for

> *"At join, not retroactively, and not buried in a settings toggle. The screen where someone
> joins an event carries one plain sentence: your pickups and any photos you add become part of
> this group's impact map. That is the entire privacy design, and it is far easier to defend than
> any server-side reasoning."*

## The two surfaces

There are **two** ways to join, and only one of them has a screen. Copy on the join button alone
would miss every invited participant — the common path for a group event, and exactly the people
an artifact is built from.

| # | surface | code | today |
|---|---|---|---|
| A | Explicit join button | `toggleJoin`, `app/challenge/[id].tsx:143` | joins silently, no confirmation |
| B | Deep-link auto-join | `app/challenge/[id].tsx:125-141` | joins automatically, then a "You're in" alert |

---

## Draft A — explicit join

A confirmation before joining, not after. Two buttons; joining is the affirmative action.

> **Join "{challenge name}"?**
>
> Your pickups during this event become part of the group's impact map, which the organizer can
> share publicly.
>
> Your walking routes are never shared.
>
> [ Not now ]  [ Join ]

**Why "which the organizer can share publicly."** Under the 2026-09-08 decision the artifact link
opens for anyone holding it, with no expiry. "Part of the group's map" alone would let someone
reasonably assume it stays inside the group. Say the actual exposure.

**Why the routes line.** It is the question people actually have, `cleanups` is owner-only
precisely because routes reveal home addresses, and the artifact genuinely never carries them
(§11.3 — street coverage, not route traces). It is a true reassurance and it costs one line.

## Draft B — deep-link auto-join

Replaces the current "You're in" alert. Same facts; must state what already happened and offer
the way out in the same breath.

> **You've joined "{challenge name}"**
>
> Your pickups during this event become part of the group's impact map, which the organizer can
> share publicly. Your walking routes are never shared.
>
> You can leave any time with the button below.
>
> [ Leave ]  [ Got it ]

**Note the button order.** The existing alert already surfaces the way out because, as the code
comment says, *"silently opting someone in needs an equally obvious way to opt back out."* Leaving
should be a tap in this alert, not a thing to go hunting for afterward.

## Draft C — photos, per photo (§6)

§6 requires photos to be opt-in **per photo**, on top of event membership: *"joining an event is
not blanket permission to publish someone's camera roll."* At the point of adding a photo to a
challenge post:

> ☐ Add this photo to {challenge name}'s impact map
>
> Anyone with the organizer's share link can see it.

Unchecked by default. Blocks step 5 until decided.

---

## Open questions for Jake

1. **Does draft A's confirmation dialog feel like friction on the wrong step?** It adds a tap to
   joining a challenge, which is a growth-sensitive moment. The alternative is inline text above
   the join button with no dialog — lighter, but easier to miss, and "easy to miss" is exactly
   what a consent design cannot afford. **Recommendation: keep the dialog.** It is one tap, once
   per event.
2. **Should joining be revocable retroactively** — i.e. does leaving an event remove your already
   logged pickups from its totals? Currently leaving stops future contribution only. Not
   addressed by §6. **Recommendation: yes, leaving should remove them**, since the alternative is
   consent you cannot withdraw, and the rollup is a full recompute (§11.2) so it costs nothing to
   implement.
3. **Photo opt-in default.** Draft C is unchecked-by-default. Checked-by-default would produce far
   more photos and is defensible given the person is already posting to a shared event — but it
   is the kind of default that reads badly in exactly the situation where it matters.
   **Recommendation: keep it unchecked.**

---

# DECIDED 2026-09-08 — revised copy below supersedes the drafts above

| # | question | decision |
|---|---|---|
| 1 | Dialog or inline on the join button | **Confirmation dialog.** One tap, once per event. |
| 2 | Does leaving remove already-logged pickups | **No — past work stays counted.** Leaving stops future contribution only. |
| 3 | Photo opt-in default | **Unchecked.** Per photo, on top of event membership. |

## ⚠️ Decision 2 changes the copy, and makes precision load-bearing

The earlier drafts leaned on *"You can leave any time"* as the reassurance that balances the
disclosure. **That reassurance is now narrower than it sounds.** Leaving stops future walks from
counting; it does not remove work already logged. Someone who joins, walks, then leaves has
contributed permanently to that event's public totals.

That is a defensible position — a contribution to a group total is not obviously un-makeable, and
it keeps an organizer's shared numbers from silently revising downward after they have shown them
to a funder. **But it means the copy must not imply otherwise.** Saying "leave any time" next to
a consent disclosure invites exactly the wrong inference: that leaving undoes it.

So the consent sentence has to carry the full, accurate shape: **this is a decision made once, at
join, and it sticks for the walks you log.**

## Draft A (revised) — explicit join

> **Join "{challenge name}"?**
>
> Pickups you log during this event become part of the group's impact map, which the organizer
> can share publicly. This applies to walks you log from now on — you can leave the event any
> time to stop contributing.
>
> Your walking routes are never shared.
>
> [ Not now ]  [ Join ]

Changes from the original draft: *"Pickups you log"* rather than "Your pickups" (scopes it to
walks, not to the person); the leaving clause now says what leaving actually does — **stops
contributing**, not undoes.

## Draft B (revised) — deep-link auto-join

Replaces the current "You're in" alert (`app/challenge/[id].tsx:133`). This is the **only** moment
an invited participant sees anything, so it carries the same facts, not a shortened version.

> **You've joined "{challenge name}"**
>
> Pickups you log during this event become part of the group's impact map, which the organizer
> can share publicly. Your walking routes are never shared.
>
> Leave any time to stop contributing — walks already logged stay in the group's total.
>
> [ Leave ]  [ Got it ]

The last line is the one that would be tempting to cut for length. **Don't.** On this path the
person was joined without asking, so the one thing they must not be misled about is what leaving
does. Two buttons, with Leave present, for the reason already in the code: *"silently opting
someone in needs an equally obvious way to opt back out."*

## Draft C (revised) — photos, per photo

Unchecked by default, at the point of adding a photo to a challenge post.

> ☐ **Add this photo to {challenge name}'s impact map**
>   Anyone with the organizer's share link can see it. You can remove it later.

*"You can remove it later"* is included here and deliberately **not** in A/B, because for a photo
it is true and straightforward — removing the post removes it from the strip. Pickup totals are
the case where withdrawal does not work, and the copy should not blur the two.

## Implementation notes

- Draft A goes in `toggleJoin` (`app/challenge/[id].tsx:143`) as a confirm before
  `joinChallenge`, not after.
- Draft B replaces the `Alert.alert("You're in", …)` at line 133.
- Draft C blocks step 5 (photo strip) and should ship with it, not before.
- **All three are prerequisites for minting any real share token** (§11.10). Steps 1-4 are built
  and deployed and are waiting on this.
- These are JS-only changes to existing screens — OTA, no native build.
