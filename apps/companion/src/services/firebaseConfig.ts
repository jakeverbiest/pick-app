/**
 * Firebase Configuration
 * Contains API credentials and initialization settings
 * Keep this file secure and never commit credentials to version control
 */

import { initializeApp, getApp } from 'firebase/app';

export const firebaseConfig = {
  apiKey: "AIzaSyACxORmC9WH6cIFPcUcgmkhI7-XLVnYWKk",
  authDomain: "pick-app-74c2e.firebaseapp.com",
  projectId: "pick-app-74c2e",
  storageBucket: "pick-app-74c2e.firebasestorage.app",
  messagingSenderId: "484917564934",
  appId: "1:484917564934:web:654235d5d99bcc1a91d587"
};

// Initialize Firebase app
let firebaseApp: any = null;

try {
  firebaseApp = getApp();
  console.log('✅ Firebase app already initialized');
} catch (error) {
  firebaseApp = initializeApp(firebaseConfig);
  console.log('✅ Firebase app initialized');
}

export const app = firebaseApp;
