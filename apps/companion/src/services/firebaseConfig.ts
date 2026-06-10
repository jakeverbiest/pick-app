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
let firebaseAuth: Auth;
try {
  firebaseAuth = initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  console.log('✅ Firebase Auth initialized with AsyncStorage persistence');
} catch {
  firebaseAuth = getAuth(firebaseApp);
  console.log('✅ Firebase Auth already initialized — reusing instance');
}

export const app = firebaseApp;
export const auth = firebaseAuth;
