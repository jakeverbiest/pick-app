/**
 * Live Activity widget target — the "cleanup in progress" card on the lock
 * screen and in the Dynamic Island.
 *
 * Declared here (not hand-added in Xcode) so it survives `expo prebuild`, which
 * EAS runs on every build and which regenerates `ios/` from scratch. That's why
 * the earlier hand-added Widget Extension target didn't stick.
 *
 * NOTE: the target `name` must not contain spaces. @bacons/apple-targets
 * sanitizes the name for EAS but names the Xcode target with the display name,
 * so a space makes EAS look for a target it can't find (the build-15 failure).
 * Use `displayName` for anything human-facing.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'widget',
  name: 'PICKCleanupWidget',
  displayName: 'PICK Cleanup',
  // Leading dot = appended to the main app's bundle identifier.
  bundleIdentifier: '.cleanupwidget',
  // ActivityConfiguration requires 16.1; the module falls back to the pre-16.2
  // Activity APIs at runtime, so 16.1 is the real floor.
  deploymentTarget: '16.1',
  colors: {
    // Civic Blueprint palette — matches C.accent / C.primary in the phone app's theme.ts.
    $accent: '#4B7A54',
    $widgetBackground: '#0F2F66',
  },
};
