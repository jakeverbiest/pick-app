/**
 * In-app legal text — condensed from the canonical, published policies at
 * pickglobal.org/privacy and pickglobal.org/terms (source: ~/pick-app/web/privacy.html and
 * web/terms.html). Keep in sync with those, not with legal/*.md, which are superseded stubs.
 */

// Separate dates, not a shared constant — Privacy and Terms don't necessarily
// change on the same day (2026-09-01: a privacy-only reconciliation once
// used a shared LEGAL_LAST_UPDATED and it silently back-dated the Terms
// copy's claimed update date to a day nothing in the Terms actually changed).
export const PRIVACY_LAST_UPDATED = 'September 25, 2026';
export const TERMS_LAST_UPDATED = 'June 11, 2026'; // matches web/terms.html — no substantive Terms change since

/**
 * Detector-telemetry disclosure shown at account creation — the HOOK, not the copy.
 *
 * Jake approved (2026-09-09) widening the detector telemetry export from his own
 * account to NEW SIGNUPS ONLY, gated on a disclosure shown at account creation.
 * Existing users and every pre-disclosure walk stay excluded.
 *
 * The user-facing copy is the `safety` agent's to write, not this file's author's.
 * Both constants are DELIBERATELY EMPTY until that copy lands, and the whole
 * pipeline is fail-closed on that emptiness:
 *
 *   - `app/auth/signup.tsx` renders the disclosure block only when TEXT is non-empty.
 *   - `authService.signup()` / `loginWithApple()` record consent only when a
 *     non-empty VERSION is passed in.
 *   - `functions/detectorExport.js?scope=consented` exports only accounts carrying
 *     a recorded consent, so an account created before this copy ships is simply
 *     not in the corpus.
 *
 * So shipping this file as-is records NO consent from anyone — it cannot claim
 * consent for a disclosure nobody was shown. To go live, `safety` fills in both
 * constants; no other code change is needed.
 *
 * VERSION is stored verbatim on `users/{uid}.detector_telemetry_disclosure_version`,
 * so it must change whenever the TEXT materially changes — that string is the only
 * record of WHAT a given account actually agreed to. Suggested form: 'YYYY-MM-DD'.
 */
export const DETECTOR_DISCLOSURE_VERSION = '2026-09-19';

/**
 * Draft A ("notice", not a checkbox), approved by Jake 2026-09-09.
 *
 * This is the BODY only. Draft A as written also carried a link row
 * ([What gets analyzed] · [Privacy Policy] · [Terms]) and a Terms-acceptance
 * line. Neither is here, because signup.tsx renders this constant as a single
 * flat <Text> — links would show up as literal bracketed text, and the Terms
 * line is a separate decision (there is no contract-acceptance moment anywhere
 * in the app yet). Add them to the constant only once there is UI behind them.
 *
 * The full approved draft, including the "What gets analyzed" sheet copy this
 * summarizes, is in ~/pick-app/docs/DETECTOR_TELEMETRY_CONSENT_COPY.md §3.
 * Bump VERSION whenever this text materially changes — it is the only record
 * of what a given account was actually shown.
 */
export const DETECTOR_DISCLOSURE_TEXT =
  "Before you start: PICK estimates your pickups from your phone's motion sensors. " +
  'To make that counting more accurate, we analyze the walks you log: the motion ' +
  'the app recorded, how many pickups it detected against the number you save ' +
  'at the end, your walking pace, how long the walk lasted, and which phone ' +
  'recorded it.\n\n' +
  'This is engineering work on the detector. It is never shown to other users, ' +
  'and it is not used to profile you or to make any decision about you. Your ' +
  'walking routes are not part of it.';

/**
 * The "What gets analyzed" sheet behind the signup disclosure's first link.
 * Draft A §3, approved by Jake 2026-09-09. Written from real export rows, not
 * from the spec — every item here is a field that actually appears in
 * functions/detectorExport.js ALLOWED_TOP_LEVEL_FIELDS.
 *
 * `session_mode` is deliberately ABSENT: it is collected but not exported, so
 * listing it would describe a use that isn't happening. If it is ever added to
 * the export, add "Whether the walk ran in the background or with the screen
 * on." to the first list and bump DETECTOR_DISCLOSURE_VERSION.
 */
export const DETECTOR_DISCLOSURE_DETAIL = `What we analyze from a walk

•  The motion log. For each motion the detector looked at: how strong it was, how long it lasted, how much your phone rotated, how confident the detector was, and whether it was counted as a pickup or rejected — and why.

•  The counts. How many pickups the app detected, and the number you saved at the end.

•  Your pace. Your median walking speed during the cleanup, how much of it was slow, and whether we could measure it reliably.

•  How long the walk lasted.

•  Which phone model and operating-system version recorded it, and whether the phone rode in a pocket or in your hand. Detection accuracy depends heavily on these, so without them one person's results can't be told apart from another's. This is a hardware model string — never your device's name, which you set yourself.

•  The date, to the day. Not the time.

What is never part of it

•  Your name, your email, or any link back to your account

•  Where you walked — no route, no pickup locations, no city or neighborhood

•  Your notes, your photos, or your team

•  The exact time of day`;

export const PRIVACY_POLICY_TEXT = `PICK Privacy Policy
Last updated: ${PRIVACY_LAST_UPDATED}
Operated by John Larkin Verbiest, known publicly as Jake Verbiest ("we", "us").

WHAT WE COLLECT
• Account info: display name, email, neighborhood, optional team or event name, and a record of which version of the Terms and Privacy Policy you accepted at signup and when.
• Cleanup sessions: pickup counts, duration, estimated/reported weight, date/time, and GPS data — your walking route and approximate pickup locations. Stored in our cloud database (Google Firebase) so history, maps, and leaderboards work.
• Motion sensors: raw accelerometer/gyroscope samples are processed on your device in real time and never transmitted anywhere — only a compact summary of each detected motion event (strength, duration, accepted as a pickup or not) is kept, alongside the session data above.
• Device and carry position: each cleanup records the phone's hardware model and operating-system version and, where the app could tell, whether the phone rode in a pocket or in your hand — worked out from the same motion sensors above, and left off entirely when it isn't confident. These are kept only to make the detection-accuracy work below meaningful: detection performance depends heavily on which phone it runs on and where that phone rides. A hardware model string — never your device's name, which you set yourself.
• Session power mode: each cleanup also records whether you were using the app in the foreground (screen on) or background (screen off). Background location tracking needs "Always" location access to keep working with the screen off; without it, the app has to keep the screen on instead. Kept only to measure how often that happens, so we know whether it's worth building around.
• Map and place lookups: while the map is open, the app sends location-related requests to three outside map services, none of which receive your name, email, or account ID. (a) OpenStreetMap's Nominatim reverse-geocoding service receives your exact coordinates whenever you open or re-center the map, to look up your neighborhood name; results are cached on your device for about 30 days per roughly 500-meter tile. A city you type into search is sent to Nominatim as text and is not cached. Group Recap sends only a neighborhood name. (b) The CARTO basemap receives the map area you are viewing (tile positions) and your IP address whenever the map is open or panned. (c) Overpass (OpenStreetMap street data) receives coordinates rounded to five decimal places when street data for the area you are viewing is not already cached, on map open or pan at close zoom levels. These services have their own privacy policies.
• Weight calibration entries stay on your device only.
• Apple Health: if you enable it, we write each cleanup as a walking workout so it counts toward your activity rings and exercise minutes. We never read anything from Health — the read permission is only requested because Apple requires it alongside the write permission.
• Photos: you can attach a photo to a cleanup post. It's stored in our cloud storage; if you post it, it's visible on the community feed or wherever you share it. Attaching a photo is always optional.
• Feedback: if you use "Send feedback," we collect your message, display name, email, app version, and timestamp — read internally to fix problems, never shown publicly.
• Push notifications: if you allow notifications, we store an Expo push token linked to your account so we can send them (for example, when someone follows or likes you). The token is handled by Expo's push service and Apple/Google. It is deleted with your account. You can turn notifications off in your phone's settings.
• Crash and error reports: we use Sentry to catch crashes and errors. It receives device/app version and a technical stack trace of what the app was doing when it crashed. For a sample of app launches (about one in five) it also receives performance timing data such as screen load and network request durations, and an anonymous per-install session identifier. Query strings (the part of a web address after the "?") are removed from the addresses in these reports, so coordinates in map requests are not sent to Sentry. No cleanup content, location history, or account details beyond what's needed to diagnose problems.

WHAT WE DON'T DO
No contacts, microphone, or ad identifiers. No data sales. No ads. Location is only tracked and saved during active cleanup sessions; opening the map also sends your location to the map services described above.

HOW WE USE IT
To run the app: maps, stats, streaks, badges, team totals, leaderboards, challenges. Your display name and aggregate stats may appear on leaderboards visible to other users. Street-cleaning status (which sidewalk segments were cleaned, and when) is shared across all users to power the community coverage map.
To improve pickup detection: we analyze session data — the motion-event summaries above, how many pickups the app detected vs. the total you save at the end of a cleanup, your walking pace, and the device model and carry position above — to measure and improve detection accuracy. Internal engineering work only: never shown to other users, never used to profile you or make decisions about you. Email hello@pickglobal.org to have your account excluded.

LEGAL BASIS (EU/UK/EEA users)
• Contract necessity: core account and cleanup-session data (email, GPS route, pickup counts, motion-detection summaries, timestamps) — needed to provide the app's core service.
• Consent: optional features you turn on yourself (Apple Health, photo attachment, community sharing, Bluesky auto-post) — withdraw anytime in Settings. Push notifications are likewise based on the permission you grant at the operating system prompt.
• Legitimate interests: the public aggregate map/stats, leaderboards, profile pages, the shared street-cleaning map, the map lookups (OpenStreetMap, CARTO, Overpass) needed to show the map, Sentry diagnostics and performance monitoring, and the pickup-detection accuracy analysis above — each user-facing one has its own opt-out, and detection analysis can be opted out of by email. We don't process any special category (health/biometric/genetic) data under GDPR Art. 9; motion-sensor data only detects a pickup motion, it doesn't identify or profile you.

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
