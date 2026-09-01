/**
 * Remote crash/error monitoring (Sentry).
 *
 * Complements — doesn't replace — the on-device crashRecorder "black box":
 * that one recovers state from a crash that already happened; this one tells
 * us a crash happened at all, without depending on a tester manually copying
 * and sending a report from Settings.
 *
 * No-ops entirely if EXPO_PUBLIC_SENTRY_DSN isn't set, so this is safe to ship
 * before a Sentry project exists — wire one up and set the env var whenever
 * you're ready, no code changes needed.
 *
 * This is the ONLY place that should call Sentry.init() — the setup wizard
 * (run 2026-09-01) also generated its own Sentry.init() call directly in
 * app/_layout.tsx with its default options; that block was removed in favor
 * of routing through here, so there's one source of truth instead of two
 * competing inits on every launch.
 *
 * Deliberately OFF, against the wizard's defaults — reconsider explicitly,
 * don't just re-enable from a future wizard re-run:
 *  - sendDefaultPii: sends IP address and other personal data with every
 *    event. The privacy policy reconciled the same day this was wired up
 *    describes Sentry as collecting only device/app version and stack
 *    trace — turning this on would make that disclosure inaccurate.
 *  - Session Replay: a materially bigger feature than crash reporting
 *    (records/replays user sessions, masked by default) — worth its own
 *    decision later, not a side effect of enabling basic error reporting.
 *  - the feedback-widget integration: the app already has its own feedback
 *    feature (Settings → Send Feedback → Firestore `feedback` collection,
 *    see firebaseDatabase.ts submitFeedback()) — Sentry's widget would be a
 *    second, redundant path writing feedback somewhere else entirely.
 */
import * as Sentry from '@sentry/react-native';

let initialized = false;

export function initErrorMonitoring() {
  if (initialized) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.log('ℹ️ Sentry DSN not set — remote crash reporting disabled.');
    return;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    enabled: !__DEV__,
    sendDefaultPii: false,
  });
  initialized = true;
}
