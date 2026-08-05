# Decision Log

Document all major decisions with context, options considered, reasoning, and alternatives if wrong.

> **Note (2026-08-03):** entries below stop at the original 2026-05-31 planning session. Later major calls were being made narratively inside `docs/PROJECT_TIMELINE.md` (the other connected repo, `~/pick-app/docs/PROJECT_TIMELINE.md`) instead of here — backfilled the big ones below during an Aug 3 doc-consolidation pass. Going forward, prefer logging a real decision here too, not just in the timeline prose.

---

## [2026-07-21] Social interactions: follow + like only — no comments, no DMs

**Context:** Building the engagement/retention layer (profiles, feed, follow system) for an all-ages community app.
**Options:**
1. Follow + like only (our choice)
2. Add comments on posts
3. Add direct messages between users

**Decision:** Follow + like only.
**Reasoning:** Comments and DMs both need real moderation infrastructure to be safe for an all-ages audience, which wasn't going to get built alongside everything else. Cutting them removes the moderation/safety burden entirely rather than under-resourcing it.
**If wrong:** Revisit once there's either a moderation system or evidence the community is small/trusted enough not to need one.

---

## [2026-07-21] Naming: "PicketUp" identified as rebrand front-runner (not finalized)

**Context:** "PICK" collides with the generic English word and other apps; wanted to check a distinctive brand name was still available.
**Options considered:** PicketUp ("pick it up" + picket fence/picket line), and others from a broader availability search.
**Decision:** PicketUp is the front-runner — clean `picketup.app`, free Bluesky handle, open subreddit, no same-vertical app collision, no exact USPTO mark.
**Status:** Not finalized, not purchased. Superseded in practice by the Aug 1 "Pick Global" direction (see the 2026-08-01 timeline entry) — @pickglobalhq secured across 8 platforms and `pickglobal.org` purchased, without PicketUp being revisited. Worth an explicit decision either way rather than letting it happen by default.

---

## [2026-07-27] Challenge progress: client-published contributions, not a server tally

**Context:** Challenges needed a group progress number, but cleanups are owner-only reads by design (routes reveal home addresses) — no Cloud Function can honestly tally someone else's work.
**Options:**
1. Each participant computes their own totals and publishes just the numbers to `challenges/{id}/contrib/{uid}`; the group total is the sum (our choice)
2. A Cloud Function with admin credentials reads everyone's raw cleanups to tally centrally
3. Denormalized running counter on the challenge doc, incremented on write

**Decision:** Client-published per-participant contribution docs.
**Reasoning:** Keeps the existing privacy model intact (no service ever reads another user's location data) at the cost of being eventually consistent — a member's number only updates when they save a cleanup or reopen the app.
**If wrong / revisit:** don't "fix" the staleness with a denormalized counter — it can't be kept honest under these rules without reintroducing the privacy problem. See `docs/CHALLENGE_RECAP_SPEC.md` §10 for how this interacts with end-of-challenge recaps.

---

## [2026-08-01] Brand: "Pick Global" / @pickglobalhq secured across platforms; in-app rebrand not yet done

**Context:** Wanted a distinctive, available handle across social platforms ahead of a public push.
**Decision:** Display name "PICK 🌍 GLOBAL", handle `@pickglobalhq` claimed on Instagram, Threads, Bluesky, Reddit, Facebook, TikTok, X (defensive hold only), YouTube, and Pinterest; domain `pickglobal.org` purchased.
**Status:** Social accounts + domain done. The in-app rebrand (store display name, wordmark, dashboard `<title>`s) is explicitly still a to-do — and the Aug 1 icon/splash asset swap only got partway there (see the 2026-08-01 and 2026-08-03 timeline entries: `logo-mark.png` on the login/signup screens is still the old mark).

---

## [2026-05-31] Product Name: PICK

**Context:** Naming the environmental wellness app  
**Options:**
1. PICK (simple, action-based, trash picking community terminology)
2. Greenify (environmental focus)
3. GreenZone (map/zones focus)
4. CleanScape (visual, branded)

**Decision:** PICK  
**Reasoning:** 
- Simple, memorable, one word
- Built-in action verb ("pick walk", "picking")
- Already resonates in trash picking community
- Domain: pick.eco (available)
- Less corporate than alternatives

**If wrong:** Pivot to Greenify (strong backup with "-ify" app naming pattern)

---

## [2026-05-31] Tech Stack: React Native + Firebase

**Context:** Choosing mobile framework and backend  
**Options:**
1. React Native + Firebase (no DevOps, scales free tier)
2. Flutter + custom backend (more control, requires DevOps)
3. Native iOS + AWS (best performance, highest cost)

**Decision:** React Native + Firebase  
**Reasoning:** 
- Solo dev, no DevOps expertise needed
- Firebase free tier supports 100k+ users
- AI code generation works best with React
- Faster time to market
- Scales automatically

**Trade-off:** Less control over database queries, but gains speed + simplicity

---

## [2026-05-31] Motion Detection: Accelerometer + Gyroscope

**Context:** Detecting when user picks up trash  
**Options:**
1. Motion detection (accel + gyro) + manual tap (our choice)
2. Computer vision (ML Kit) - too expensive, slow
3. Manual tap only - loses gamification appeal

**Decision:** Motion + tap fallback  
**Reasoning:**
- Enables hands-free gameplay
- Tap fallback if motion fails
- Differentiator from Litterati
- Achievable in 2 weeks with field testing

**If fails:** Fall back to tap-only (still works, less sexy)

---

## [2026-05-31] Primary Platform: Phone App (not Display-only)

**Context:** Display glasses expensive ($800), limited market  
**Options:**
1. Display glasses only (100k potential users)
2. Phone app primary, Display optional premium (millions of users)
3. Web-only (no hardware tracking)

**Decision:** Phone primary, Display optional premium  
**Reasoning:**
- Phone app reaches 80-90% of market
- Display adds immersive streamer angle
- Network effects: phone users feed map data for Display users
- Launch phone week 10, Display features week 11-12
- Zero requirement to buy expensive glasses

**If wrong:** Can pivot to phone-only without major rework

---

## [2026-05-31] Revenue Model: Corporate Wellness + Freemium

**Context:** How to monetize  
**Options:**
1. Free app only + data licensing (Litterati model - slow)
2. Premium consumer tier + corporate wellness (our choice)
3. Sponsorships only (unreliable)

**Decision:** Freemium (free app) + Corporate Wellness ($20-50k/year)  
**Reasoning:**
- Free tier gets massive adoption (habit formation)
- Corporate wellness market pays real money (team building + ESG)
- Nonprofits + cities are secondary revenue
- Subscription model less reliable for this category

**Conversion target:** 3-5% of users to premium ($5-10/month)

---

## [2026-05-31] Positioning: Wellness (not Cleanup)

**Context:** How to market the product  
**Options:**
1. "Cleanup app" - niche, hard to monetize, activist-focused
2. "Environmental wellness" - $1.5T market, habit-friendly (our choice)
3. "Citizen science" - Litterati's position, data-focused

**Decision:** Environmental Wellness  
**Reasoning:**
- Wellness market massive and growing
- Mental health angle (outdoor, purposeful, community)
- Better habit formation (streaks matter)
- Corporate wellness teams pay
- Better PR ("mental health meets environment")

**If wrong:** Pivot back to cleanup/citizen science (data still valuable)
