# Tester messages — 23/24 Aug sessions

Copy-paste. Two sessions, two different asks.

---

## 1. SEND NOW — pre-install, this afternoon's tester

The install is the one thing that can kill the session, and there is no guest
mode: no app, no account, no data. Send before they leave home.

> Hey — can I borrow you for about 15 minutes this afternoon? I'm testing the
> pickup detector in Pick and I need a second person's data; right now every
> number I have is from me, which is worth much less than it sounds.
>
> **Before you head over:** install it from the TestFlight invite and create an
> account, ideally at home on wifi. It's a chunky download and I don't want to
> spend twenty minutes on it at the meeting point.
>
> That's all for now — I'll explain the walk when you get here. It's four
> minutes of walking and picking up litter, nothing weird.

---

## 2. AT THE START — this afternoon, in person

Say it out loud, don't text it. The pace instruction is the one that matters and
it's the one people get wrong.

> Four minutes. Three things:
>
> **1. Phone in your front pocket, screen off, the whole time.** It detects
> pickups from motion, so holding it changes what it sees.
>
> **2. Walk slowly — slower than feels natural.** Ambling. If you feel slightly
> silly, that's about right. This is the part people get wrong and it's the part
> that decides whether the test is usable.
>
> **3. Come to a full stop for each pickup.** Stop, pick it up, then start
> walking again. Twenty pickups total — I'll count out loud so we agree on the
> number.
>
> At the end you'll get a summary with a pickup count. **Screenshot it before
> you change anything.** Then correct it to twenty and screenshot it again.
>
> The count will probably be wrong. That's the thing I'm measuring — it's not
> broken, just tell me what you saw.

**Your checklist, not theirs:**

- [ ] Their phone is on the new bundle — have them tap Stop and confirm the
      dialog appears. No dialog = old bundle = **void walk**. (19 Aug lesson.)
- [ ] You count the twenty out loud together. B5's value comes from the ground
      truth being certain, not approximate.
- [ ] Note the start time — you'll want it to line up the log.
- [ ] Both screenshots actually sent before they leave.

---

## 3. TOMORROW MORNING — after the Pick meeting, group

Different shape: several bodies, cruder protocol, one measurement that cannot be
corrupted by miscounting.

> Two quick legs, about fifteen minutes total.
>
> **Leg 1 — five minutes, don't pick anything up.** At all. Just walk with us at
> whatever pace is normal for you, phone in your front pocket, screen off. I'm
> measuring how often it thinks you picked something up when you definitely
> didn't — so the answer should be zero and it won't be.
>
> **Leg 2 — walk normally and pick up whatever you see.** Don't stop for it,
> don't count it, don't change how you'd normally move. Just walk and pick.
>
> Then save, **screenshot the summary before changing anything**, correct it to
> roughly what you actually picked up, screenshot again. Send me both.

**Why leg 1 is the important one:** ground truth is exactly zero. It is the only
measurement in either session that cannot be corrupted by a tester
mis-remembering their count. Everything else depends on people counting
honestly; this doesn't.

**Your checklist:**

- [ ] Everyone installed and signed in **before** the meeting, not after.
- [ ] Everyone starts their walk at the same time — say "start" out loud.
- [ ] Bundle check on each phone (Stop → dialog) before leg 1.
- [ ] Leg 1 and leg 2 saved as **separate walks**, or the zero-truth leg is lost
      inside the second one.
