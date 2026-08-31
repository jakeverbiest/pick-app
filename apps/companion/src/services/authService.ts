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
  signInWithCredential,
  OAuthProvider,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
  reload,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { auth } from './firebaseConfig';
import { getDatabase } from './database';

const LEGACY_AUTH_KEY = 'pick_auth_user'; // simpleAuthService's storage key
const LEGACY_USERS_KEY = 'pick_users'; // simpleAuthService stored PLAINTEXT passwords here — purge on sight
const MIGRATION_DONE_KEY = 'pick_auth_migrated_v1';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  neighborhood: string;
  emailVerified: boolean;
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

    // Security hygiene: the pre-Firebase local auth stored plaintext
    // passwords on-device. Remove that key permanently, every launch.
    AsyncStorage.removeItem(LEGACY_USERS_KEY).catch(() => {});

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
            emailVerified: user.emailVerified,
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

  async signup(email: string, password: string, displayName: string, neighborhood: string = ''): Promise<AuthUser> {
    try {
      console.log(`🚀 Signing up: ${email}`);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });

      // Send a verification email so accounts can't be made with someone
      // else's address. Never block signup if the email send fails.
      try {
        await sendEmailVerification(cred.user);
        console.log(`✉️ Verification email sent to ${email}`);
      } catch (e) {
        console.warn('Could not send verification email:', e);
      }

      const db = await getDatabase();
      await db.initialize(cred.user.uid);
      await db.initializeUserSettings(cred.user.uid, displayName, neighborhood);

      this.currentUser = { uid: cred.user.uid, email, displayName, neighborhood, emailVerified: cred.user.emailVerified };
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
        emailVerified: cred.user.emailVerified,
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

  /**
   * Sign in (or, on first use, silently create an account) with Apple.
   *
   * NATIVE BUILD REQUIRED — not OTA-shippable. `expo-apple-authentication`'s
   * config plugin (added to app.json's `plugins`) writes the
   * `com.apple.developer.applesignin` entitlement into the native
   * entitlements file at prebuild time; that only takes effect in a fresh
   * `eas build`, never via `eas update`. Calling this on a build that
   * predates that entitlement will reject with `AppleAuthenticationError` /
   * a missing-capability error from Apple, not throw here — this method
   * itself is plain JS and could ship OTA once a build already carries the
   * entitlement, but it can't be the thing that adds the capability.
   *
   * Apple only ever hands back `fullName` on the FIRST authorization for a
   * given user+app pair — a returning user (or a re-install) gets `null`
   * there even though it's the same Apple ID, so `displayName` is only set
   * from it when present; otherwise it's left for the user to set later
   * (Settings), same as the deferred-neighborhood pattern signup.tsx uses.
   */
  async loginWithApple(): Promise<AuthUser> {
    try {
      console.log('🍎 Starting Sign in with Apple');

      // Firebase's Apple credential verification requires a nonce round-trip:
      // generate a random raw value, send its SHA256 hash to Apple (which
      // signs it into the identity token), then hand Firebase the ORIGINAL
      // raw value to verify against that signed hash. Skipping this produces
      // auth/invalid-credential — Apple's own auth succeeds either way, only
      // Firebase's verification fails, which is exactly what was seen in the
      // field (confirmed 2026-08-31, real device, 4 repros before the fix).
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!appleCredential.identityToken) {
        throw new Error('Apple did not return an identity token.');
      }

      const provider = new OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: appleCredential.identityToken,
        rawNonce,
      });

      const cred = await signInWithCredential(auth, firebaseCredential);
      const isNewUser = cred.user.metadata.creationTime === cred.user.metadata.lastSignInTime;

      const fullName = appleCredential.fullName;
      const derivedName = fullName
        ? [fullName.givenName, fullName.familyName].filter(Boolean).join(' ').trim()
        : '';
      if (derivedName && !cred.user.displayName) {
        await updateProfile(cred.user, { displayName: derivedName });
      }

      const db = await getDatabase();
      await db.initialize(cred.user.uid);
      if (isNewUser) {
        // Mirrors signup(): neighborhood deferred, same as email signup.
        await db.initializeUserSettings(cred.user.uid, derivedName, '');
      }
      const neighborhood = await this.loadNeighborhood(cred.user.uid);

      this.currentUser = {
        uid: cred.user.uid,
        email: cred.user.email ?? appleCredential.email ?? '',
        displayName: cred.user.displayName ?? derivedName,
        neighborhood,
        emailVerified: cred.user.emailVerified,
      };
      await this.migrateLegacyAccount(cred.user.uid);
      this.notifyListeners();
      console.log(`✅ Sign in with Apple successful (${isNewUser ? 'new' : 'returning'} user)`);
      return this.currentUser;
    } catch (error: any) {
      // ERR_REQUEST_CANCELED is the user backing out of the Apple sheet —
      // not a failure worth an error alert.
      if (error?.code === 'ERR_REQUEST_CANCELED') {
        throw new Error('__CANCELED__');
      }
      const reason = error?.code || error?.message || 'unknown error';
      console.error('❌ Sign in with Apple failed:', reason);
      throw new Error(`Sign in with Apple failed (${reason}). Please try again, or use email instead.`);
    }
  }

  async logout(): Promise<void> {
    await signOut(auth);
    this.currentUser = null;
    this.notifyListeners();
    console.log('✅ Logout successful');
  }

  /**
   * A stale/invalid session, in whatever form Firebase reports it as, needs
   * the same fix: log out and back in. Returns a user-facing message for
   * that family of error codes, or null if this isn't one of them (so the
   * caller can fall back to the original error).
   */
  private recentLoginMessage(error: any): string | null {
    const staleSessionCodes = [
      'auth/requires-recent-login',
      'auth/user-token-expired',
      'auth/invalid-user-token',
      'auth/user-mismatch',
    ];
    if (staleSessionCodes.includes(error?.code)) {
      return 'Your session has expired. Log out, log back in, then try again.';
    }
    return null;
  }

  /**
   * Permanently delete the account: all cloud data, then the auth user.
   * (App Store requires in-app account deletion for apps with sign-in.)
   *
   * deleteAccountData() is resilient — it tries every cleanup step even if
   * one fails, and never throws for an individual step failing (see its own
   * doc comment). It only throws here for a genuine precondition failure
   * (no signed-in user), which is treated as fatal. Any other outcome — full
   * success or partial — still proceeds to delete the Auth user: refusing to
   * do so over one failed step is exactly what leaves an account stuck
   * half-deleted with no way to retry cleanly. The step report is returned
   * so the caller can tell the user if anything needs a manual follow-up.
   */
  async deleteAccount(): Promise<{ steps: Record<string, boolean> }> {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in.');

    // Fail fast on a stale session BEFORE running the whole (resilient, but
    // not free) cleanup pass — deleting the Auth user requires a fresh ID
    // token, and a session that's sat open a while can have a stale one.
    // Deleting cloud data first only to then discover the Auth deletion is
    // going to fail the same way is wasted work and a confusing error.
    try {
      await user.getIdToken(true);
    } catch (error: any) {
      throw new Error(this.recentLoginMessage(error) ?? 'Could not verify your session. Please try again.');
    }

    const db = await getDatabase();
    const { steps } = await (db as any).deleteAccountData();

    try {
      await deleteUser(user);
    } catch (error: any) {
      // Observed in the wild: deleteUser() can throw auth/user-token-expired
      // even though the account WAS actually deleted server-side a moment
      // earlier — some internal post-delete step (e.g. a token refresh)
      // fails because the account is already gone, and that failure
      // surfaces as if the whole call failed. Telling the user to "log
      // back in and retry" for an account that no longer exists is a dead
      // end, so check reality before deciding this is a real failure:
      // reload() throws auth/user-not-found (or similar) if the account is
      // actually gone, in which case this is a false negative — proceed as
      // a success instead of surfacing an error.
      const stillExists = await user.reload().then(
        () => true,
        () => false
      );
      if (stillExists) {
        const message = this.recentLoginMessage(error);
        if (message) throw new Error(message);
        throw error;
      }
      console.log('🗑️ Account was actually deleted despite a client-side error on deleteUser():', error?.code);
    }

    this.currentUser = null;
    this.notifyListeners();
    console.log('🗑️ Account deleted. Cleanup steps:', steps);
    return { steps };
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

  /** Resend the verification email to the signed-in user. */
  async resendVerification(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Not signed in.');
    await sendEmailVerification(user);
    console.log('✉️ Verification email re-sent');
  }

  /**
   * Re-check verification from Firebase. `emailVerified` is cached on the token,
   * so we reload the user to pick up a verification that happened in the browser.
   */
  async refreshEmailVerified(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;
    await reload(user);
    if (this.currentUser) {
      this.currentUser.emailVerified = user.emailVerified;
      this.notifyListeners();
    }
    return user.emailVerified;
  }

  isEmailVerified(): boolean {
    return !!this.currentUser?.emailVerified;
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
