/**
 * In-app legal text — condensed from the canonical, published policies at
 * pickglobal.org/privacy and pickglobal.org/terms (source: ~/pick-app/web/privacy.html and
 * web/terms.html). Keep in sync with those, not with legal/*.md, which are superseded stubs.
 */

// Separate dates, not a shared constant — Privacy and Terms don't necessarily
// change on the same day (2026-09-01: a privacy-only reconciliation once
// used a shared LEGAL_LAST_UPDATED and it silently back-dated the Terms
// copy's claimed update date to a day nothing in the Terms actually changed).
export const PRIVACY_LAST_UPDATED = 'September 6, 2026';
export const TERMS_LAST_UPDATED = 'June 11, 2026'; // matches web/terms.html — no substantive Terms change since

export const PRIVACY_POLICY_TEXT = `PICK Privacy Policy
Last updated: ${PRIVACY_LAST_UPDATED}
Operated by John Larkin Verbiest, known publicly as Jake Verbiest ("we", "us").

WHAT WE COLLECT
• Account info: display name, email, neighborhood, optional team or event name.
• Cleanup sessions: pickup counts, duration, estimated/reported weight, date/time, and GPS data — your walking route and approximate pickup locations. Stored in our cloud database (Google Firebase) so history, maps, and leaderboards work.
• Motion sensors: raw accelerometer/gyroscope samples are processed on your device in real time and never transmitted anywhere — only a compact summary of each detected motion event (strength, duration, accepted as a pickup or not) is kept, alongside the session data above.
• Device and carry position: each cleanup records which iPhone model and iOS version the walk was recorded on (e.g. "iPhone14,3 (iPhone 13 Pro) / iOS 18.5") and, where the app could tell, whether the phone rode in a pocket or in your hand — worked out from the same motion sensors above, and left off entirely when it isn't confident. Both are kept only to make the detection-accuracy work below meaningful: detection performance depends heavily on which phone it runs on and where that phone rides. A hardware model string — never your device's name, which you set yourself.
• Weight calibration entries stay on your device only.
• Apple Health: if you enable it, we write each cleanup as a walking workout so it counts toward your activity rings and exercise minutes. We never read anything from Health — the read permission is only requested because Apple requires it alongside the write permission.
• Photos: you can attach a photo to a cleanup post. It's stored in our cloud storage; if you post it, it's visible on the community feed or wherever you share it. Attaching a photo is always optional.
• Feedback: if you use "Send feedback," we collect your message, display name, email, app version, and timestamp — read internally to fix problems, never shown publicly.
• Crash reports: we use Sentry to catch crashes and errors. It receives device/app version and a technical stack trace — no cleanup content or location history.

WHAT WE DON'T DO
No contacts, microphone, or ad identifiers. No data sales. No ads. No location tracking outside active cleanup sessions.

HOW WE USE IT
To run the app: maps, stats, streaks, badges, team totals, leaderboards, challenges. Your display name and aggregate stats may appear on leaderboards visible to other users. Street-cleaning status (which sidewalk segments were cleaned, and when) is shared across all users to power the community coverage map.
To improve pickup detection: we analyze session data — the motion-event summaries above, how many pickups the app detected vs. the total you confirm at the end of a cleanup, your walking pace, and the device model and carry position above — to measure and improve detection accuracy. Internal engineering work only: never shown to other users, never used to profile you or make decisions about you. Email hello@pickglobal.org to have your account excluded.

LEGAL BASIS (EU/UK/EEA users)
• Contract necessity: core account and cleanup-session data (email, GPS route, pickup counts, motion-detection summaries, timestamps) — needed to provide the app's core service.
• Consent: optional features you turn on yourself (Apple Health, photo attachment, community sharing, Bluesky auto-post) — withdraw anytime in Settings.
• Legitimate interests: the public aggregate map/stats, leaderboards, profile pages, the shared street-cleaning map, Sentry diagnostics, and the pickup-detection accuracy analysis above — each user-facing one has its own opt-out, and detection analysis can be opted out of by email. We don't process any special category (health/biometric/genetic) data under GDPR Art. 9; motion-sensor data only detects a pickup motion, it doesn't identify or profile you.

INTERNATIONAL TRANSFERS
This app's Firebase database runs in the US (us-central1). Google's Cloud Data Processing Addendum for Firebase/Google Cloud Platform — which applies automatically to this project — incorporates the EU Standard Contractual Clauses as the safeguard for this transfer.

YOUR CHOICES
• Delete data: Settings → Danger Zone → Clear All Data.
• Account deletion: Settings → Danger Zone → Delete Account — immediate, in the app, no email required.
• Location: deny/revoke in phone settings (pickups still count; no route maps).
• Leaderboards: opt in or out at any time in Settings.
• Export: "Export session" on a walk's summary screen, or "Export" on any past cleanup in Activity, copies that cleanup's full data to your clipboard.

YOUR RIGHTS (EU/UK/EEA users)
• Erasure: Account deletion above — immediate, in-app, no email required.
• Portability: the Export feature above — copies a cleanup's full data to your clipboard; no single "export everything" yet, but every logged cleanup can be pulled out this way.
• Access/rectification: most data is visible/editable in the app; email hello@pickglobal.org for anything else.
• Restriction/objection: turn off a feature in Settings, or contact us to request broader restriction.
• Complaint: to your local data protection supervisory authority.

CHILDREN
Not directed at children under 13; we don't knowingly collect their data.

CONTACT
hello@pickglobal.org`;

export const TERMS_OF_SERVICE_TEXT = `PICK Terms of Service
Last updated: ${TERMS_LAST_UPDATED}
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
