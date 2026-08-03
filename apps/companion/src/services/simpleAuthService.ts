/**
 * Simple Local Auth Service
 * Uses AsyncStorage for authentication (no Firebase Auth complexity)
 * This is a temporary solution while we resolve Firebase Auth issues
 * Can be replaced with Firebase Auth later
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEY = 'pick_auth_user';
const USERS_KEY = 'pick_users'; // Store local users

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  neighborhood: string;
}

class SimpleAuthService {
  private currentUser: AuthUser | null = null;
  private authStateListeners: Array<(user: AuthUser | null) => void> = [];

  /**
   * Initialize - check if user is already logged in
   */
  async initialize() {
    try {
      const stored = await AsyncStorage.getItem(AUTH_KEY);
      if (stored) {
        this.currentUser = JSON.parse(stored);
        console.log(`✅ Auth loaded: ${this.currentUser?.email}`);
      } else {
        this.currentUser = null;
        console.log('✅ No logged in user');
      }

      // Notify listeners
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    }
  }

  /**
   * Sign up with email and password
   */
  async signup(email: string, password: string, displayName: string, neighborhood: string): Promise<AuthUser> {
    try {
      console.log(`🚀 Signing up: ${email}`);

      // Check if user already exists
      const users = await this.getStoredUsers();
      if (users.find((u) => u.email === email)) {
        throw new Error('Email already registered');
      }

      // Create new user
      const newUser: AuthUser = {
        uid: `user_${Date.now()}`,
        email,
        displayName,
        neighborhood,
      };

      // Store user in local database
      users.push({
        ...newUser,
        password, // Store hashed in production!
      });
      await AsyncStorage.setItem(USERS_KEY, JSON.stringify(users));

      // Log them in
      this.currentUser = newUser;
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(newUser));

      console.log(`✅ Signup successful: ${email}`);
      this.notifyListeners();
      return newUser;
    } catch (error: any) {
      console.error('❌ Signup failed:', error.message);
      throw error;
    }
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<AuthUser> {
    try {
      console.log(`🚀 Logging in: ${email}`);

      const users = await this.getStoredUsers();
      const user = users.find((u) => u.email === email && u.password === password);

      if (!user) {
        throw new Error('Invalid email or password');
      }

      this.currentUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        neighborhood: user.neighborhood,
      };

      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(this.currentUser));

      console.log(`✅ Login successful: ${email}`);
      this.notifyListeners();
      return this.currentUser;
    } catch (error: any) {
      console.error('❌ Login failed:', error.message);
      throw error;
    }
  }

  /**
   * Logout
   */
  async logout() {
    try {
      console.log('🚀 Logging out...');
      this.currentUser = null;
      await AsyncStorage.removeItem(AUTH_KEY);
      console.log('✅ Logout successful');
      this.notifyListeners();
    } catch (error) {
      console.error('❌ Logout failed:', error);
      throw error;
    }
  }

  /**
   * Get current user
   */
  getCurrentUser(): AuthUser | null {
    return this.currentUser;
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
   * Private helper to notify all listeners
   */
  private notifyListeners() {
    this.authStateListeners.forEach((listener) => listener(this.currentUser));
  }

  /**
   * Password reset — not available with local beta accounts.
   * (Will be real once the app switches to Firebase Auth.)
   */
  async sendPasswordReset(email: string): Promise<void> {
    console.log(`⚠️ Password reset requested for ${email} — not supported with local accounts`);
    throw new Error(
      'Password reset is not available in the beta. Contact hello@pickglobal.org to recover your account.'
    );
  }

  /**
   * Get stored users from AsyncStorage
   */
  private async getStoredUsers(): Promise<Array<AuthUser & { password: string }>> {
    try {
      const stored = await AsyncStorage.getItem(USERS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to get users:', error);
      return [];
    }
  }
}

let instance: SimpleAuthService | null = null;

export function getAuthService(): SimpleAuthService {
  if (!instance) {
    instance = new SimpleAuthService();
  }
  return instance;
}

export default SimpleAuthService;
