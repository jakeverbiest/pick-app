# Pick App — Guided Testing Session

**Date:** 2026-06-15
**Build under test:** `apps/companion` (the live merged app on Jake's phone — sensor backend + Trail reskin). Git HEAD `4026ae3`.
**Focus:** Bugs / crashes — log + fix as we go
**Tester:** Jake (iPhone, via Expo/Metro dev build)

App entry routing: no user → `/auth/login`; first run → `/safety`; else → `/(tabs)/map`.
Visible tabs: Map · Activity · Leaderboard · Goals · Settings.

---

## Issues found

| # | Flow | Severity | Status | Symptom | Notes / Fix |
|---|------|----------|--------|---------|-------------|
| 1 | Launch | Info / not-a-bug | Observed | Launch warning: "🛑 Recovered an unclean session: survived 80s, 10 route pts, 7 pickups, 29 motion events (dead 76735s before launch)" | Crash black box working as designed — recovered a ~21h-old unclean session (80s walk, force-quit/crash) and tore down the orphaned background tracker. Only shows as a yellow LogBox warning in dev; absent in production. OPEN LEAD: why did that 80s session die? Read report in Settings → Diagnostics. Possible polish: downgrade `console.warn` so it doesn't trip the dev overlay. |
| 2 | Cold launch / restore / real sign-in / map | — | ✅ Pass | Session restored, signed in, landed on Map, "looks great." | Working. |
| 3 | Signup screen | Visual | ✅ Fixed | Account-creation screen still showed old `logo-mark.png` PICK logo | Replaced with the Trail brand tile (green rounded square + leaf `Icon`) to match login. Typecheck clean. Reload to see. `app/auth/signup.tsx`. |
| 4 | Password-reset email | Production-blocker (branding) | Open / advice | Reset email from `noreply@pick-app-74c2e.firebaseapp.com`, app name shows the raw Firebase project ID — looks unprofessional | Not a code bug. Fix via Firebase public-facing name + email templates (free), then custom domain/email + landing page for production. See advice below. |
| 5 | Map — active walk coverage | UX / behavior | ✅ Fixed | Prior cleanup routes vanished when a cleanup started, and the show/hide toggle was hidden during a session (`{!isListening && ...}`). Also historical routes raced the WebView load at mount. | Per Jake's choice (fresh-street shading + dimmed routes, default on): added `window.setCoverageVisible()` to the map JS, redraw past routes on `mapReady` (fixes race + post-background remount), `bringToBack()` so the live green route stays on top, and an in-walk coverage toggle (route icon) in the active-session top bar. `app/(tabs)/map.tsx`. Typecheck clean. |
| 6 | Pocket Mode → pull phone out | Info / dev-only | Observed | Got "React Native Dev Menu (Bridgeless)" alert after yanking phone out of pocket | NOT a bug. The abrupt motion = a shake gesture, which RN opens the dev menu on in `__DEV__` builds only. Absent in TestFlight/production. Pocket mode + pickup counting worked — that's the real signal. Optional: disable shake-to-open during testing. |
| 7 | Stop → Save & log | — | ✅ Pass | Log shows: cleanup saved to Firestore, 1 street segment marked cleaned, Apple Health workout synced, stats reloaded, coverage refreshed. Motion detector healthy (rejects walking/handling, accepts pickups 65–80% confidence). | Save flow works end-to-end. |
| 8 | Cleanup cache cross-account bleed | Privacy / data (HIGH) | ✅ Fixed (2 parts) | Logged in as claire, but Activity "You" showed Jake's pickups. Root cause: device-global cache key + `getCleanups` merges the cache's "unsynced" items with no user filter, and the offline fallback returns the whole cache. (Firestore query IS user-scoped — no server leak; the leak is the local cache.) | (1) `getCleanupCache()` now filters to `currentUserId` (every cached cleanup carries userId) — fixes display + stats immediately, even offline; added `getCleanupCacheRaw()` for storage merges so other accounts' offline data isn't clobbered. (2) `initialize()` clears stale caches when the cache owner uid changes. `src/services/firebaseDatabase.ts`. Typecheck clean. **Reload to verify: claire should now see only claire's pickups.** |
| 9 | Apple Health sync | Minor | Open | "🍎 Workout synced to Apple Health: 0.16 km, 7 kcal, **0 items**" — pickup count not carried into the health workout metadata | Not yet fixed. Low priority; flag for a follow-up pass on the fitness sync payload. |
| 10 | Signed-in account | Resolved | ✅ | Session running as `claire.hite@gmail.com` | Confirmed: a second account Jake also owns. So the 25-vs-4 cache bleed was between Jake's two accounts on one device — exactly the scenario fix #8 addresses. No unexpected session restore. |
| – | GPS during test | Info | Observed | All pickups logged at identical coords (40.678413, -73.995053) | Expected — testing stationary. Route/pickup markers will spread on a real walk; worth re-confirming markers persist when actually moving. |

---

| 11 | Teams leaderboard — solo bucket | UX / product | ✅ Fixed (client) + backend follow-up | Logged in as claire (team "solo"), Teams tab showed "YOU — 486 pickups / 22 cleanups". Not a leak: `getTeamLeaderboard()` reads `team_stats` TEAM aggregates; "solo" is the catch-all team, so 486/22 = ALL solo users combined. "YOU" marked the team row but read as a personal stat. | Jake chose "personal rank for solo users." Implemented in `app/(tabs)/leaderboard.tsx`: "Solo" is now excluded from team rankings; solo users see a **personal-impact card** (their own pickups/weight/active-days, user-scoped via getCleanups) with a "Join a team to compete" CTA → Settings. Real teams still rank. Typecheck clean. **FOLLOW-UP:** a true numeric rank *among all solo pickers* needs a backend aggregate (`user_stats` collection via Cloud Function) — no per-user public stats exist today; deferred. |

## Feature: unified Leaderboard (You · Teams · Challenges)
Decisions (Jake): one Leaderboard tab merging individuals + teams + challenges; individual board **public with opt-out**.

Built:
- **Data layer** (`firebaseDatabase.ts`): new public `user_stats/{uid}` aggregate (display name, team, totals, `hidden` — no routes). `updateUserStats()` recomputes from the user's own cleanups and writes on cleanup-save + settings-change. `getIndividualLeaderboard(metric)` reads it, filters opted-out, sorts in-memory (no composite index). Added `leaderboard_hidden` to UserSettings. Client-written (owner) — no Cloud Functions deploy needed.
- **Rules** (`firebase/firestore.rules`): `user_stats` readable by any signed-in user, writable only by owner. ⚠️ **ACTION REQUIRED — project is NOT in test mode; deployed rules enforce.** On 2026-06-15 the app threw repeated `FirebaseError: Missing or insufficient permissions` on user_stats read/write because the rule existed only locally. Fix = deploy: `cd ~/Desktop/pick-app && firebase deploy --only firestore:rules` (firebase.json → firebase/firestore.rules, which has the rule). After deploy, errors clear and the You board populates. (Note: a second stale copy exists at `apps/companion/firestore.rules` — not used by the root deploy.)
- **Leaderboard tab** (`leaderboard.tsx`): segmented You · Teams · Challenges, with pickups/weight/active-days metric toggle for You & Teams. You = personal card + cross-user rank; Teams = team_stats (Solo excluded); Challenges = the old Goals content (Earth Day etc.).
- **Nav**: Goals removed from the tab bar (`TrailTabBar`, `_layout`), folded into Leaderboard. Bottom tabs now Map · Impact · Leaderboard · You (4). `goals` route hidden but still registered.
- **Settings**: "Show me on the leaderboard" opt-out toggle (immediate-apply), `app/(tabs)/settings.tsx`.

Typecheck clean. **Verify on reload.** Note: the individual board populates as each account opens Leaderboard / saves a cleanup (creates their `user_stats` doc).

## Feature: Community photo feed + 5th tab
Decisions (Jake): bring back 5 tabs; add a Community photo feed. Posting = **opt-in with delete**; posts show **neighborhood + caption + likes** (no precise location, no impact/name shown).

Where photos live: **Firebase Storage** (`cleanup_photos/{uid}/…`) for the image; Firestore **`posts`** collection for metadata (image URL, caption, neighborhood, display_name, liked_by[], created_at). Storage was configured but previously unused.

Built:
- **Data layer** (`firebaseDatabase.ts`): `Post` model; `createPost` (uploads local photo → Storage → posts doc), `getPosts`, `toggleLikePost` (arrayUnion/Remove), `deletePost` (doc + Storage file). Added `getStorage`.
- **Rules**: `posts` (read all signed-in; create/delete owner; like-only update via `diff().hasOnly(['liked_by'])`) in `firebase/firestore.rules`. New `firebase/storage.rules` (cleanup_photos: owner-write, image-only, <8MB; all read). Added `storage` block to `firebase.json`.
- **Feed** (`community.tsx`): rebuilt as Trail photo feed — photo, caption, neighborhood pill + time, leaf "kudos" like (toggle), delete on own posts. Empty state.
- **Composer** (`map.tsx` results screen): opt-in "Share to community" (only when a photo was added) → caption sheet → `createPost`. Loads neighborhood from settings.
- **Nav**: 5 tabs restored — Map · Impact · **Ranks** · **Community** · You (`TrailTabBar`, `_layout`). Goals still folded into Ranks.

Typecheck clean. ⚠️ **DEPLOY BOTH rule sets before testing:** `cd ~/Desktop/pick-app && firebase deploy --only firestore:rules,storage` (Storage must be enabled in the Firebase console first — done 2026-06-15; bucket `pick-app-74c2e.firebasestorage.app`).

Post-build fixes (2026-06-15):
- **Posting did nothing** → two causes: (1) Storage upload silently denied because the Expo photo blob had an empty content-type vs the `image/.*` rule → now `uploadBytes(..., { contentType: 'image/jpeg' })`. (2) The composer was a separate Modal stacked behind the results Modal (iOS won't layer sibling modals), so its Post taps never registered and it only appeared after "Done" → composer is now rendered as an in-place overlay INSIDE the results modal (absolute fill, KeyboardAvoidingView, tap-backdrop-to-dismiss). Working.
- **Community sharing toggle** (Jake request): Settings → Community → "Share cleanups to community" (default on, immediate-apply, `community_sharing_enabled`). Gates the "Share to community" button on the results screen. Never auto-posts.
- ⚠️ Spotted but not yet fixed: `Failed to get teams: Missing or insufficient permissions` — the `teams` collection has no deployed Firestore rule. Needs a rule (team directory read/create) + deploy.

## Shakedown of new features (2026-06-15)
- ✅ Community feed: post, new post, kudos all work.
- ✅ Teams: leaving a team correctly shows solo state on Ranks → Teams.
- 🐛→✅ Ranks → You showed only the previously-active account, not the current user. Cause: `leaderboard.tsx` load fired `updateUserStats` fire-and-forget, racing the individual-board read, so the current user's just-written stats doc wasn't included on first open. Fix: `await db.updateUserStats(uid)` before the board read. Typecheck clean.

## Crash report investigation (2026-06-15)
Three recovered reports (50s, 80s, 6m51s; battery saver ON; build "unknown"). Load at death tiny (≤43 route pts / ≤134 motion events) → **NOT memory crashes**. Jake's usage: phone pocketed, **screen ON, no Pocket Mode**. Diagnosis: stray pocket touches background the app → in a foreground-only build the OS suspends it → the walk's GPS heartbeat stops and it dies at a random second. Pocket Mode is a band-aid for screen-on-in-pocket.

Fix (per Jake — wants no Pocket Mode):
- `map.tsx` keep-awake is now **conditional on `sessionMode`**: when `startBackgroundSession()` returns `'background'` (real build + "Always" location), the screen is allowed to lock in the pocket — walk survives via the OS, nothing to touch, no Pocket Mode. Foreground-only / unknown → keep screen on (unchanged from before, so current Expo dev testing is unaffected).
- Crash traces now carry a real build label (`dev|release / executionEnvironment / version`) instead of "unknown".
- **Decisive next test:** start a walk and check the log for `🌙 Background session active` vs `💡 Foreground-only`. If background → test a real pocket walk (lock screen, pocket, walk, stop) and confirm pickups count + no crash report. That settles whether Pocket Mode can be deleted. Likely needs "Always" location granted; Apple Health working implies a custom dev build (not Expo Go), so background may be one permission away. Full path in `TESTFLIGHT_GUIDE.md` if a fresh build is needed.

## Security pass (2026-06-15)
Feedback (Jake): rate-limit account/email creation per IP; email verification; don't expose secret keys.

Audit result: **no secret keys leaked.** Only the Firebase web `apiKey` is in the frontend (`firebaseConfig.ts`) — public by design; security boundary is the rules (hardened today). No OpenAI/Stripe/SendGrid/etc. keys anywhere. Real gap = no App Check / no rate limiting.

Implemented now — **email verification** (`authService.ts`, `map.tsx`, `community.tsx`):
- Signup sends a verification email (`sendEmailVerification`), non-blocking.
- `AuthUser.emailVerified` tracked; `resendVerification()`, `refreshEmailVerified()`, `isEmailVerified()` added.
- Community posting is **gated on a verified email** (alert + resend if not).
- Community screen shows a "Verify your email to post" banner with Resend / "I verified" actions.
- Doesn't block general app use (onboarding intact). Typecheck clean.

Still TODO (need Jake's console / Blaze deploy — higher-value abuse defense):
- **Firebase App Check** (App Attest / Play Integrity) — the real shield against scripted abuse of the public Firebase key. Highest priority.
- **Restrict the Firebase API key** in Google Cloud Console (iOS/Android app restrictions).
- **`beforeUserCreated` blocking Cloud Function** for per-IP account-creation rate limiting.
- Enable reCAPTCHA / email-enumeration protection in Firebase Auth.
- The verification + reset emails still use Firebase's default sender (raw project id) — fix via public-facing name + templates.

## Notes
- Originally connected to a stale standalone Trail prototype at `~/pick-app`; corrected to `~/Desktop/pick-app/apps/companion` (the real merged app).

## Domain check (2026-06-15) — DECISION DEFERRED (Jake not sold on names yet)
Verified open via DNS (NXDOMAIN; confirm price at registrar, some .app/.eco may be premium):
- **picktrail** — open on .app, .org, .eco (only .com parked at GoDaddy). Strongest: keeps "Pick", names the Trail redesign.
- **pickwalk.com** — only genuine .com available.
- Other open .app: pickpath, pickwalk, pickloop, pickquest, picklitter, litterly, tidytrail, cleantrail, pickearth, blockclean, streetsweep, joinpick, keeppicking.
- Open .org: picktrail, pickpath, picklitter. Open .eco: picktrail, pickup, pickr, gopick, pickly.
- Revisit when naming is decided; then: set Firebase public-facing name + reset-email template, stand up landing + privacy/terms pages (App Store requires privacy + support URLs).
