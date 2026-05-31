# Decision Log

Document all major decisions with context, options considered, reasoning, and alternatives if wrong.

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
