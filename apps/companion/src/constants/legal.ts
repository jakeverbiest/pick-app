/**
 * In-app legal text (condensed from /legal/*.md — keep in sync!).
 * App stores require these to be reachable inside the app.
 * Full versions: legal/PRIVACY_POLICY.md, legal/TERMS_OF_SERVICE.md
 */

export const LEGAL_LAST_UPDATED = 'June 10, 2026';

export const PRIVACY_POLICY_TEXT = `PICK Privacy Policy (Draft)
Last updated: ${LEGAL_LAST_UPDATED}

WHAT WE COLLECT
• Account info: display name, email, neighborhood, optional team name.
• Cleanup sessions: pickup counts, duration, estimated/reported weight, date/time, and GPS data — your walking route and approximate pickup locations. Stored in our cloud database (Google Firebase) so history, maps, and leaderboards work.
• Motion sensors: accelerometer/gyroscope readings are processed on your device in real time and never transmitted — only detection events are kept.
• Weight calibration entries stay on your device only.

WHAT WE DON'T DO
No contacts, photos, microphone, or ad identifiers. No data sales. No ads. No location tracking outside active cleanup sessions.

HOW WE USE IT
To run the app: maps, stats, streaks, badges, team totals, leaderboards, challenges. Your display name and aggregate stats may appear on leaderboards visible to other users.

YOUR CHOICES
• Delete data: Settings → Danger Zone → Clear All Data.
• Account deletion: email jlverbie@gmail.com.
• Location: deny/revoke in phone settings (pickups still count; no route maps).

CHILDREN
Not directed at children under 13; we don't knowingly collect their data.

CONTACT
Jake Verbiest — jlverbie@gmail.com`;

export const TERMS_OF_SERVICE_TEXT = `PICK Terms of Service (Draft)
Last updated: ${LEGAL_LAST_UPDATED}

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
jlverbie@gmail.com`;
