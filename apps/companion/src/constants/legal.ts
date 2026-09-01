/**
 * In-app legal text — condensed from the canonical, published policies at
 * pickglobal.org/privacy and pickglobal.org/terms (source: ~/pick-app/web/privacy.html and
 * web/terms.html). Keep in sync with those, not with legal/*.md, which are superseded stubs.
 */

export const LEGAL_LAST_UPDATED = 'September 1, 2026';

export const PRIVACY_POLICY_TEXT = `PICK Privacy Policy
Last updated: ${LEGAL_LAST_UPDATED}
Operated by John Larkin Verbiest, known publicly as Jake Verbiest ("we", "us").

WHAT WE COLLECT
• Account info: display name, email, neighborhood, optional team name.
• Cleanup sessions: pickup counts, duration, estimated/reported weight, date/time, and GPS data — your walking route and approximate pickup locations. Stored in our cloud database (Google Firebase) so history, maps, and leaderboards work.
• Motion sensors: raw accelerometer/gyroscope samples are processed on your device in real time and never transmitted anywhere — only a compact summary of each detected motion event (strength, duration, accepted as a pickup or not) is kept, alongside the session data above.
• Weight calibration entries stay on your device only.
• Apple Health: if you enable it, we write each cleanup as a walking workout so it counts toward your activity rings and exercise minutes. We never read anything from Health — the read permission is only requested because Apple requires it alongside the write permission.
• Photos: you can attach a photo to a cleanup post. It's stored in our cloud storage; if you post it, it's visible on the community feed or wherever you share it. Attaching a photo is always optional.
• Feedback: if you use "Send feedback," we collect your message, display name, email, app version, and timestamp — read internally to fix problems, never shown publicly.
• Crash reports: we use Sentry to catch crashes and errors. It receives device/app version and a technical stack trace — no cleanup content or location history.

WHAT WE DON'T DO
No contacts, microphone, or ad identifiers. No data sales. No ads. No location tracking outside active cleanup sessions.

HOW WE USE IT
To run the app: maps, stats, streaks, badges, team totals, leaderboards, challenges. Your display name and aggregate stats may appear on leaderboards visible to other users.

YOUR CHOICES
• Delete data: Settings → Danger Zone → Clear All Data.
• Account deletion: Settings → Danger Zone → Delete Account — immediate, in the app, no email required.
• Location: deny/revoke in phone settings (pickups still count; no route maps).

CHILDREN
Not directed at children under 13; we don't knowingly collect their data.

CONTACT
hello@pickglobal.org`;

export const TERMS_OF_SERVICE_TEXT = `PICK Terms of Service
Last updated: ${LEGAL_LAST_UPDATED}
Operated by John Larkin Verbiest, known publicly as Jake Verbiest ("we", "us").

WHAT PICK IS
A litter-cleanup tracker using motion sensors and GPS. Pickup counts and weights are ESTIMATES; accuracy isn't guaranteed.

YOUR ACCOUNT
Provide accurate info, keep credentials secure, be at least 13.

ACCEPTABLE USE
No falsifying cleanup data (e.g., faking pickup motions to inflate scores), harassing users, reverse engineering, or unlawful use.

SAFETY — IMPORTANT
Cleanup involves real-world risk. You participate at your own risk: watch traffic, wear gloves, never handle hazardous items (needles, chemicals, glass, biological waste), respect property and local laws. PICK is a tracking tool only and doesn't assess safety of any location or item.

SCORES & DATA
You own your data; we process it to run the app. Leaderboards show your display name and stats. Scores/badges have no monetary value and may be recalculated or reset.

BETA SOFTWARE
Features may change or break; data may be lost despite our efforts. Accounts violating these Terms may be suspended.

DISCLAIMER
THE APP IS PROVIDED "AS IS" WITHOUT WARRANTIES. LIABILITY LIMITED TO AMOUNTS PAID (CURRENTLY $0). Governed by New York law.

CONTACT
hello@pickglobal.org`;
