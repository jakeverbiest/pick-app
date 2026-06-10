// Metro config — required for Firebase Auth on React Native.
//
// The Firebase JS SDK ships its React Native auth bundle behind the legacy
// "react-native" main field, but its modern package "exports" map only lists
// node/browser conditions. Expo SDK 53+ enables Metro's exports resolution by
// default, which therefore loads the BROWSER auth bundle on the phone →
// "Component auth has not been registered yet" + no getReactNativePersistence.
//
// Disabling exports resolution falls back to main-field resolution, which
// correctly picks @firebase/auth's dist/rn bundle.
//
// If you ever remove this, re-test login on a real device before shipping.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
