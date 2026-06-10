/**
 * Firebase Configuration
 * Initializes the Firebase app AND auth (with AsyncStorage persistence) in
 * one place, exactly once. Everything else imports { app, auth } from here.
 *
 * Why auth lives here: initializeAuth() must run before ANY getAuth() call,
 * or auth silently falls back to memory-only persistence (the June 3 bug —
 * users logged out on every reload).
 *
 * Note: the web API key below is not a secret — Firebase client keys ship in
 * every app build. Access control is enforced by firestore.rules.
 */

import { initializeApp, getApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, Auth } from 'firebase/auth';
// @ts-ignore — getReactNativePersistence ships in firebase's react-native
// bundle (resolved by Metro) but is missing from the web typings in v10.x
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const firebaseConfig = {
  apiKey: "AIzaSyACxORmC9WH6cIFPcUcgmkhI7-XLVnYWKk",
  authDomain: "pick-app-74c2e.firebaseapp.com",
  projectId: "pick-app-74c2e",
  storageBucket: "pick-app-74c2e.firebasestorage.app",
  messagingSenderId: "484917564934",
  appId: "1:484917564934:web:654235d5d99bcc1a91d587"
};

// Initialize Firebase app exactly once
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
console.log('✅ Firebase app initialized');

// Initialize Auth with AsyncStorage persistence exactly once.
// initializeAuth throws if called twice (e.g., Fast Refresh) — fall back to
// the existing instance.
//
// NOTE: getReactNativePersistence only exists in firebase's React Native
// bundle. metro.config.js (unstable_enablePackageExports = false) is what
// makes Metro load that bundle — if it's missing/removed, we degrade to
// memory persistence (logins won't survive restarts) instead of crashing.
let firebaseAuth: Auth;
try {
  if (typeof getReactNativePersistence === 'function') {
    firebaseAuth = initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    console.log('✅ Firebase Auth initialized with AsyncStorage persistence');
  } else {
    firebaseAuth = initializeAuth(firebaseApp);
    console.warn('⚠️ RN persistence unavailable (wrong firebase bundle?) — auth will NOT survive app restarts. Check metro.config.js.');
  }
} catch {
  // Already initialized (Fast Refresh re-evaluation)
  firebaseAuth = getAuth(firebaseApp);
  console.log('✅ Firebase Auth already initialized — reusing instance');
}

export const app = firebaseApp;
export const auth = firebaseAuth;
