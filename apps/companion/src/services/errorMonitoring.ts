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
 * The "@sentry/react-native" Expo config plugin is deliberately NOT in
 * app.json's plugins list yet — its iOS build phase runs sentry-cli to
 * upload dSYMs and hard-fails the build without a real org/project (there's
 * no "skip this" option, only "don't configure it yet"). Once you have a
 * Sentry project, add `["@sentry/react-native", { organization, project }]`
 * back to app.json's plugins and rebuild — JS-level error capture already
 * works without it, that plugin only adds native dSYM upload.
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
  });
  initialized = true;
}
