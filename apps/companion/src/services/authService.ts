/**
 * Firebase Authentication Service
 * Handles user signup, login, logout, and password reset
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  getAuth,
} from 'firebase/auth';
import { app } from './firebaseConfig';
import { getDatabase } from './database';

// Get auth instance
const getAuthInstance = () => {
  console.log('🔐 Getting Firebase Auth instance...');
  return getAuth(app);
};

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

class AuthService {
  private currentUser: AuthUser | null = null;
  private authStateListeners: Array<(user: AuthUser | null) => void> = [];

  /**
   * Initialize auth state listener
   * This sets up the listener but doesn't throw if auth isn't ready
   */
  initialize() {
    return new Promise<void>((resolve) => {
      try {
        const unsubscribe = onAuthStateChanged(getAuthInstance(), async (user) => {
          if (user) {
            this.currentUser = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
            };
            console.log(`✅ Auth user loaded: ${user.email}`);
          } else {
            this.currentUser = null;
            console.log('✅ No auth user');
          }

          // Notify all listeners
          this.authStateListeners.forEach((listener) => listener(this.currentUser));
        });

        // Resolve immediately after setting up listener
        resolve();
      } catch (error) {
        console.warn('⚠️ Auth listener setup deferred:', error);
        // Don't fail initialization - auth will be set up when login happens
        resolve();
      }
    });
  }

  /**
   * Subscribe to auth state changes
   */
  onAuthStateChanged(callback: (user: AuthUser | null) => void) {
    this.authStateListeners.push(callback);
    // Immediately call with current state
    callback(this.currentUser);
  }

  /**
   * Sign up with email and password
   */
  async signup(email: string, password: string, displayName: string, neighborhood: string) {
    try {
      console.log(`🚀 Signing up: ${email}`);

      // Create Firebase auth user
      const userCredential = await createUserWithEmailAndPassword(getAuthInstance(), email, password);
      const user = userCredential.user;

      // Initialize database with user data
      const db = await getDatabase();
      await db.initialize(user.uid);
      await db.initializeUserSettings(user.uid, displayName, neighborhood);

      this.currentUser = {
        uid: user.uid,
        email: user.email,
        displayName,
      };

      console.log(`✅ Signup successful: ${email}`);
      return this.currentUser;
    } catch (error: any) {
      const errorMessage = this.getErrorMessage(error.code);
      console.error('❌ Signup failed:', errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string) {
    try {
      console.log(`🚀 Logging in: ${email}`);

      const userCredential = await signInWithEmailAndPassword(getAuthInstance(), email, password);
      const user = userCredential.user;

      // Initialize database for this user
      const db = await getDatabase();
      await db.initialize(user.uid);

      this.currentUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      };

      console.log(`✅ Login successful: ${email}`);
      return this.currentUser;
    } catch (error: any) {
      const errorMessage = this.getErrorMessage(error.code);
      console.error('❌ Login failed:', errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Logout
   */
  async logout() {
    try {
      console.log('🚀 Logging out...');
      await signOut(getAuthInstance());
      this.currentUser = null;
      console.log('✅ Logout successful');
    } catch (error) {
      console.error('❌ Logout failed:', error);
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(email: string) {
    try {
      console.log(`🚀 Sending password reset email to: ${email}`);
      await sendPasswordResetEmail(getAuthInstance(), email);
      console.log('✅ Password reset email sent');
    } catch (error: any) {
      const errorMessage = this.getErrorMessage(error.code);
      console.error('❌ Password reset failed:', errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Get current user
   */
  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Convert Firebase error codes to user-friendly messages
   */
  private getErrorMessage(code: string): string {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Email already registered. Try logging in or use a different email.';
      case 'auth/invalid-email':
        return 'Invalid email address.';
      case 'auth/weak-password':
        return 'Password too weak. Use at least 6 characters.';
      case 'auth/user-not-found':
        return 'Email not found. Try signing up first.';
      case 'auth/wrong-password':
        return 'Incorrect password.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Try again later.';
      case 'auth/operation-not-allowed':
        return 'Email/password signup is disabled.';
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
