# PICK group walk — tester brief, 18 Aug 2026

Four pickers, independent walks, ~5-minute no-pickup opening leg.
Nothing happens the night before — everything below starts tomorrow morning.

---

## Send this first thing in the morning, before anyone leaves home

The download and account setup are the one thing that can eat the morning, and
there is **no guest mode** — no app, no data. Get this out early enough that
they install on home wifi rather than on cell signal at the meeting point.

> Hey — thanks for testing PICK today. **Before you head out:** install it from
> the TestFlight invite and create an account, ideally at home on wifi. It's a
> chunky download and I don't want to burn twenty minutes on it when we meet.
>
> Then three things on the walk, that's it:
>
> **1. Phone in your front pocket, screen off, the whole time.** The app detects
> pickups from motion, so carrying it in your hand changes what it sees.
>
> **2. First 5 minutes, don't pick anything up.** Just walk with us. I'm
> measuring how often it *thinks* you picked something up when you didn't.
>
> **3. When you finish and save, you'll get a summary with your pickup count.
> Screenshot it BEFORE you change anything.** Then correct the numbers to what
> actually happened, and screenshot it again. Send me both.
>
> Fair warning: the count will probably be way too high. That's the exact thing
> I'm testing — it's not broken, just correct it and tell me what you saw.
>
> One question for after: what went through your head when you first saw your
> number?

That's the whole tester ask. Everything below is yours, not theirs.

---

## Why screenshot #1 is non-negotiable

The app stores the raw detector count in `items_detected` and the corrected
number in `items_count` — the exact (detected, corrected) pair you need. But:

- `cleanups` is **owner-only read** in the Firestore rules, by design, because
  routes reveal home addresses. **You cannot read their walk data.**
- `items_detected` is **never displayed** anywhere in the UI.

So the pre-correction screenshot is the *only* path that number has to reach
you. Miss it and the walk still produces a nice social outing and no dataset.

(The proper fix is a Cloud Function export running with admin credentials, so
future rounds don't depend on people remembering. Queued in `SHIPPING_PLAN.md`.)

---

## Your morning, in order

**Before you leave (~5 min, from bed if you like):**

- [ ] App Store Connect → TestFlight → external group. Is build 31 **Approved**,
      and is it what the group would install? This is the one open unknown, and
      it's the only thing that can cancel the walk outright.
- [ ] Send the message above + the TestFlight invites.

**At the meeting point, per phone (~2 min each):**

- [ ] App installed, signed in, account created
- [ ] Location permission = **Always** (not "While Using")
- [ ] Motion & Fitness = **on**
- [ ] **Low Power Mode OFF** — it throttles background location
- [ ] Battery > 50%
- [ ] Write down: name, phone model, iOS version, build number + OTA stamp from
      Settings, watch paired y/n
- [ ] Everyone taps Start at the same moment, so the timelines line up

---

## The two legs

**Leg 1 — control, ~5 min.** Walk together, pick up nothing. Truth is zero by
construction, so nobody has to count anything. Stop and save. This is your
A-series test (A5/A6) run on four devices at once — you have never had more
than one tester's worth of it.

**Leg 1 doubles as your smoke test.** The correction panel has never run on a
real walk. The moment you save leg 1, drive it yourself end to end — edit the
piece count, change bag size, quantity and fullness, back out and reopen the
walk from Activity to confirm it persisted. You'll know at minute six, with leg
2 still ahead, instead of discovering it from four people at the end.

*If it's broken:* tell everyone **"screenshot only, don't bother correcting"**
and ask each person for a verbal estimate at the end instead. You keep the raw
detected counts, which is the half you can't reconstruct.

**Leg 2 — real cleanup.** Normal behavior, natural pace, phones stay pocketed.
Stop and save. Screenshot before correcting, correct, screenshot after.

Two separate walks, not one — a single blended walk can't tell a false positive
from a real pick.

---

## What you're collecting

Per person, per leg:

| Field | Where it comes from |
|---|---|
| Duration | summary screen |
| Detected count | **screenshot #1** (before any edit) |
| Corrected count | screenshot #2 |
| Bags: size / qty / fullness | screenshot #2 |
| Phone model, iOS, build stamp | you, at the meeting point |
| One-line reaction | ask them |

Leg 1's detected count against a known truth of zero gives you a clean
false-positives-per-minute figure on four different devices and gaits. That
comparison — same route, same pace, four bodies — is the thing you have never
been able to run.

---

## Not being tested today (deliberate)

You chose independent walks, so challenge contrib totals and the watch team bar
stay unexercised. Those need their own session with a real shared challenge —
worth booking while the group is still willing.

One freebie to watch for anyway: with four people walking simultaneously, the
**"who's cleaning now"** banner on Community may populate on its own — it keys
off `live_walks`, not challenges. If you see it, that's a real multi-user signal
for free. Don't task anyone with it; just look.
