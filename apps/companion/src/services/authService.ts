/**
 * Firebase Authentication Service (production)
 *
 * Drop-in replacement for simpleAuthService — same interface
 * (getAuthService, AuthUser with neighborhood, initialize/signup/login/
 * logout/sendPasswordReset/getCurrentUser/onAuthStateChanged) so screens
 * don't change.
 *
 * Key behaviors:
 * - Sessions persist across reloads (AsyncStorage persistence is set up in
 *   firebaseConfig.ts BEFORE anything touches auth).
 * - initialize() resolves only after the FIRST auth state emission, so
 *   routing (app/index.tsx) sees the restored user, not a null flash.
 * - One-time migration: if a legacy local account (simpleAuthService) exists,
 *   its cleanups/settings/badges are re-keyed to the new Firebase uid on
 *   first signup/login.
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from './firebaseConfig';
import { getDatabase } from './database';

const LEGACY_AUTH_KEY = 'pick_auth_user'; // simpleAuthService's storage key
const MIGRATION_DONE_KEY = 'pick_auth_migrated_v1';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  neighborhood: string;
}

class AuthService {
  private currentUser: AuthUser | null = null;
  private authStateListeners: Array<(user: AuthUser | null) => void> = [];
  private firstEmission: Promise<void> | null = null;

  /**
   * Wire the auth listener and wait for the first state emission
   * (persisted session restored, or confirmed logged-out).
   */
  initialize(): Promise<void> {
    if (this.firstEmission) return this.firstEmission;

    this.firstEmission = new Promise<void>((resolve) => {
      let resolved = false;
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          const neighborhood = await this.loadNeighborhood(user.uid);
          this.currentUser = {
            uid: user.uid,
            email: user.email ?? '',
            displayName: user.displayName ?? '',
            neighborhood,
          };
          console.log(`✅ Auth loaded: ${this.currentUser.email}`);
        } else {
          this.currentUser = null;
          console.log('✅ No logged in user');
        }
        this.notifyListeners();
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });
    return this.firstEmission;
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void) {
    this.authStateListeners.push(callback);
    callback(this.currentUser);
  }

  async signup(email: string, password: string, displayName: string, neighborhood: string): Promise<AuthUser> {
    try {
      console.log(`🚀 Signing up: ${email}`);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });

      const db = await getDatabase();
      await db.initialize(cred.user.uid);
      await db.initializeUserSettings(cred.user.uid, displayName, neighborhood);

      this.currentUser = { uid: cred.user.uid, email, displayName, neighborhood };
      await this.migrateLegacyAccount(cred.user.uid);
      this.notifyListeners();
      console.log(`✅ Signup successful: ${email}`);
      return this.currentUser;
    } catch (error: any) {
      const message = this.getErrorMessage(error.code);
      console.error('❌ Signup failed:', error.code || error.message);
      throw new Error(message);
    }
  }

  async login(email: string, password: string): Promise<AuthUser> {
    try {
      console.log(`🚀 Logging in: ${email}`);
      const cred = await signInWithEmailAndPassword(auth, email, password);

      const db = await getDatabase();
      await db.initialize(cred.user.uid);
      const neighborhood = await this.loadNeighborhood(cred.user.uid);

      this.currentUser = {
        uid: cred.user.uid,
        email: cred.user.email ?? email,
        displayName: cred.user.displayName ?? '',
        neighborhood,
      };
      await this.migrateLegacyAccount(cred.user.uid);
      this.notifyListeners();
      console.log(`✅ Login successful: ${email}`);
      return this.currentUser;
    } catch (error: any) {
      const message = this.getErrorMessage(error.code);
      console.error('❌ Login failed:', error.code || error.message);
      throw new Error(message);
    }
  }

  async logout(): Promise<void> {
    await signOut(auth);
    this.currentUser = null;
    this.notifyListeners();
    console.log('✅ Logout successful');
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(auth, email);
      console.log(`✅ Password reset email sent to ${email}`);
    } catch (error: any) {
      throw new Error(this.getErrorMessage(error.code));
    }
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  isLoggedIn(): boolean {
    return this.currentUser !== null;
  }

  /** Refresh cached neighborhood after the user edits it in Settings. */
  async refreshProfile(): Promise<void> {
    if (!this.currentUser) return;
    this.currentUser.neighborhood = await this.loadNeighborhood(this.currentUser.uid);
    this.notifyListeners();
  }

  // ---------- internals ----------

  private async loadNeighborhood(uid: string): Promise<string> {
    try {
      const db = await getDatabase();
      const settings = await db.getUserSettings(uid);
      return settings?.neighborhood ?? '';
    } catch {
      return '';
    }
  }

  /**
   * One-time: re-key data created under the old local-auth uid
   * (e.g. user_1780525754952) to the new Firebase uid.
   */
  private async migrateLegacyAccount(newUid: string): Promise<void> {
    try {
      if (await AsyncStorage.getItem(MIGRATION_DONE_KEY)) return;
      const legacyRaw = await AsyncStorage.getItem(LEGACY_AUTH_KEY);
      if (!legacyRaw) {
        await AsyncStorage.setItem(MIGRATION_DONE_KEY, 'no-legacy-account');
        return;
      }
      const legacy = JSON.parse(legacyRaw);
      if (!legacy?.uid || legacy.uid === newUid) {
        await AsyncStorage.setItem(MIGRATION_DONE_KEY, 'nothing-to-do');
        return;
      }

      console.log(`🔁 Migrating legacy account ${legacy.uid} → ${newUid}...`);
      const db = await getDatabase();
      const migrated = await db.migrateUserData(legacy.uid, newUid);
      await AsyncStorage.setItem(MIGRATION_DONE_KEY, JSON.stringify({ from: legacy.uid, to: newUid, migrated, at: Date.now() }));
      console.log(`✅ Legacy migration complete: ${migrated} records re-keyed`);
    } catch (error) {
      // Never block login on migration — it can retry next login
      console.error('⚠️ Legacy migration failed (will retry next login):', error);
    }
  }

  private notifyListeners() {
    this.authStateListeners.forEach((l) => l(this.currentUser));
  }

  private getErrorMessage(code: string): string {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Email already registered. Try logging in instead.';
      case 'auth/invalid-email':
        return 'Invalid email address.';
      case 'auth/weak-password':
        return 'Password too weak. Use at least 6 characters.';
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
        return 'Email or password incorrect. New here? Sign up first.';
      case 'auth/wrong-password':
        return 'Incorrect password.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Try again in a few minutes.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled in Firebase Console (Authentication → Sign-in method).';
      default:
        return 'Authentication failed. Please try again.';
    }
  }
}

let instance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!instance) {
    instance = new AuthService();
  }
  return instance;
}

export default AuthService;
