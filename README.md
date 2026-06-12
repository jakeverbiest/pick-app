# PICK 🛍️

Autonomous trash-pickup tracking. Phone in pocket, motion sensors count each pickup, GPS tracks the route, and the neighborhood's sidewalks turn green on a shared map.

**Items → pounds → bags.** Detected pickups convert to weight via scale-calibrated factors, displayed as standard trash bags — the impact metric a city official actually understands.

## Stack

- **App:** React Native + Expo SDK 54 (TypeScript), `apps/companion/`
- **Backend:** Firebase Auth + Firestore (rules in `firebase/firestore.rules`, deployed)
- **Maps:** Leaflet in WebView, Carto Positron tiles, OpenStreetMap sidewalk geometry via Overpass
- **Detection:** accelerometer/gyroscope shape analysis — thresholds live in `src/services/motionEvaluation.ts` ONLY

## Development

```bash
cd apps/companion
npm install
npx expo start            # JS dev server; app must be a dev build on-device
```

Native changes (new modules, app.json, icons):

```bash
npx expo prebuild -p ios
open ios/PICK.xcworkspace # re-check signing team, then ▶ Run
```

## Before committing

```bash
npx tsc --noEmit          # must be 0 errors
npm run test:detector     # detector + route regression suite — REQUIRED for any threshold change
```

The detector is tuned exclusively from field data: every session stores a flight-recorder motion log (exportable from the Activity tab). Never tune thresholds from intuition — replay logs, add a regression case, then change the number.

## Project docs

- `PROJECT/CONTEXT.md` — current state, read first in any new session
- `PROJECT/APP_STORE_LISTING.md` — store copy
- `docs/privacy.html`, `docs/terms.html` — legal (host via GitHub Pages: repo Settings → Pages → main branch, `/docs` folder)
- `docs/ARCHITECTURE.md` — original product vision

## License

All rights reserved. © Jake Verbiest
