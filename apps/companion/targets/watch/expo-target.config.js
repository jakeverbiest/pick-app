/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'watch',
  name: 'PICKWatch',
  bundleIdentifier: 'com.jakeverbiest.pickapp.watchkitapp',
  deploymentTarget: '10.0',
  icon: '../../assets/images/icon.png',
  // HealthKit is required to run an HKWorkoutSession, which is what keeps the
  // app frontmost on wrist-raise during a walk (see WorkoutSession.swift).
  // We share only the workout type and read nothing.
  entitlements: {
    'com.apple.developer.healthkit': true,
  },
  frameworks: ['HealthKit'],
  colors: {
    // Civic Blueprint brand green — matches C.accent in the phone app's theme.ts.
    AccentColor: '#4B7A54',
  },
};
