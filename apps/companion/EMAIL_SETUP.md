# Turning on Pick's emails

All of Pick's outbound email is **already written in code**. Every message
(adoption nudges, the new "you adopted X" confirmation, and owner signup
alerts) is dropped into the Firestore `mail` collection by the Cloud Functions
in `functions/index.js`. Nothing sends until you do the two setup steps below —
this is a configuration gap, not a code gap.

## What sends email today

| Function | Trigger | Recipient |
| --- | --- | --- |
| `onAdoptionCreated` | picker adopts a spot | that picker (instant "You adopted X") |
| `scheduledAdoptionCheck` | every 24h, if a spot went stale | that picker (nudge) |
| `notifyNewSignup` | new user profile created | owner (`hello@pickglobal.org`) |

Each just calls `db.collection('mail').add({ to, message })`. The **Firebase
"Trigger Email" extension** watches that collection and actually delivers via
your SMTP sender.

## Step 1 — Install the Trigger Email extension

From the `apps/companion` folder (project `pick-app-74c2e`):

```bash
firebase ext:install firebase/firestore-send-email --project=pick-app-74c2e
```

During install, set:

- **Email documents collection:** `mail`  ← must match the code
- **SMTP connection URI:** your sender (Gmail example below)
- **Default FROM address:** e.g. `Pick <hello@pickglobal.org>`
- **Default REPLY-TO:** optional

### Gmail as the sender (simplest to start)

1. Enable 2-Step Verification on the Google account.
2. Create an **App Password** (Google Account → Security → App passwords).
3. Use this SMTP URI (URL-encode the 16-char app password, no spaces):

```
smtps://jlverbie%40gmail.com:APP_PASSWORD_HERE@smtp.gmail.com:465
```

Gmail sends fine for low volume. For production/higher volume, swap in
SendGrid, Mailgun, Postmark, or Amazon SES — only the SMTP URI changes.

## Step 2 — Deploy the functions

```bash
cd apps/companion
firebase deploy --only functions --project=pick-app-74c2e
```

This publishes `onAdoptionCreated` (new) alongside the existing functions.

## Verify it works

1. **Confirmation email:** adopt a spot in the app → you should get a
   "You adopted …" email within a minute.
2. **Manual nudge run:** hit the gated test endpoint (no waiting for the daily
   schedule):
   ```
   https://<region>-pick-app-74c2e.cloudfunctions.net/runAdoptionCheck?key=pick-adopt-check-2f7b
   ```
   It returns `{ checked, emailed }`.
3. **Delivery logs:** the extension writes a `delivery` field back onto each
   `mail` doc (`SUCCESS` / `ERROR`). Check there first if an email doesn't
   arrive — usually a bad SMTP URI or an unencoded app password.

## Notes

- The `mail` collection is locked to Cloud Functions only in `firestore.rules`
  (`allow read, write: if false`) — clients can't queue or read email. That's
  why the confirmation is a server-side function, not a client write.
- Change `ADOPTION_TRIGGER_KEY` in `functions/index.js` if the test URL leaks.
