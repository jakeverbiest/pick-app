# Pick — Sending builds to testers (no cable)

Two ways to get the app onto testers' iPhones without plugging in. Your `eas.json`
profiles are already set up for both.

| | Internal distribution (`preview`) | TestFlight (`production`) |
|---|---|---|
| Who it's for | A few known devices you control | Any tester with an email |
| Per-device registration | Yes — each iPhone's UDID | No |
| Apple review | None | Light beta review (external testers only) |
| Needs Metro? | No (standalone) | No (standalone) |
| Speed | Fastest | ~30–60 min for first build + review |

---

## One-time setup (do these once)

1. **Install EAS CLI and log in** (use your Expo account — make one free if needed):
   ```bash
   npm install -g eas-cli
   eas login
   ```
2. **Link this app to an EAS project** (writes the project ID into app config):
   ```bash
   cd ~/Desktop/pick-app/apps/companion
   eas init
   ```
3. **EAS manages your iOS signing** — on the first build it'll offer to create the
   distribution certificate and provisioning profile for you. Say **yes**. (Uses your
   Apple Developer account; it'll ask you to log in to Apple.)

---

## Option A — Internal distribution (quickest, for known iPhones)

1. **Register each tester iPhone** (one-time per device — scan a QR on that phone):
   ```bash
   eas device:create
   ```
2. **Build it:**
   ```bash
   eas build --platform ios --profile preview
   ```
3. When it finishes, EAS gives a **build page with a QR code / link**. Open that link
   **on the registered iPhone** → Install. It runs standalone — no Mac, no Metro.

Note: ad-hoc internal distribution is capped at 100 devices, and a device must be
registered *before* the build to be included.

---

## Option B — TestFlight (best for handing to testers)

**One-time, in App Store Connect** (https://appstoreconnect.apple.com):
- Go to **Apps → + → New App**. Platform iOS, pick the bundle ID
  **com.jakeverbiest.pickapp**, set the app name and your primary language.
  (This creates the app record TestFlight needs.)

**Each build:**
1. **Build for the store:**
   ```bash
   eas build --platform ios --profile production
   ```
2. **Upload to App Store Connect / TestFlight:**
   ```bash
   eas submit --platform ios --profile production
   ```
   EAS asks for your Apple ID, your App Store Connect **App ID**, and **Apple Team ID**
   the first time, then offers to save them. The build appears in **TestFlight** in App
   Store Connect after Apple finishes processing (~5–15 min).
3. **Add testers** in App Store Connect → your app → **TestFlight**:
   - **Internal testers** (up to 100, must be in your team): get builds immediately, no review.
   - **External testers** (anyone, by email or a public link): the *first* build needs a
     quick **Beta App Review** (usually hours). After that, new builds go out fast.
4. **Testers install** the free **TestFlight** app from the App Store, accept your invite
   (email or link), and tap Install. No cable, no Mac, no registration.

---

## Tips
- Bump the build each time: the `production` and `preview` profiles already
  `autoIncrement`, so build numbers won't collide.
- For the **first-run / section-1 QA** (fresh install, onboarding, auth, session
  persistence), TestFlight on a clean device is the realest test — it behaves exactly
  like a store install.
- JS-only fixes can be shipped to existing TestFlight/dev builds over-the-air with
  `eas update` (no new build) once you set up EAS Update — ask me when you want that.
