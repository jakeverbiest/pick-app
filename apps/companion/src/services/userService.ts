import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from './database';

const CURRENT_USER_KEY = 'pick_current_user';
const USER_ID_KEY = 'pick_user_id';

export interface CurrentUser {
  id: string;
  displayName: string;
  neighborhood: string;
  email?: string;
  createdAt: number;
}

class UserService {
  private currentUser: CurrentUser | null = null;

  /**
   * Initialize user on app launch
   * Creates new user if none exists, loads existing user otherwise
   */
  async initializeUser(): Promise<CurrentUser> {
    try {
      // Check if user already exists
      const storedUser = await AsyncStorage.getItem(CURRENT_USER_KEY);

      if (storedUser) {
        const parsed: CurrentUser = JSON.parse(storedUser);
        this.currentUser = parsed;
        console.log(`✅ Loaded existing user: ${parsed.displayName}`);
        return parsed;
      }

      // Create new user
      const newUser = await this.createNewUser();
      console.log(`✅ Created new user: ${newUser.displayName}`);
      return newUser;
    } catch (error) {
      console.error('❌ User initialization failed:', error);
      throw error;
    }
  }

  private async createNewUser(): Promise<CurrentUser> {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const newUser: CurrentUser = {
      id: userId,
      displayName: 'Picker', // Default name
      neighborhood: 'My Zone',
      email: '', // set when the user signs in with a real account
      createdAt: Date.now(),
    };

    // Save to AsyncStorage
    await AsyncStorage.setItem(CURRENT_USER_KEY, JSON.stringify(newUser));
    await AsyncStorage.setItem(USER_ID_KEY, newUser.id);

    // Initialize in database
    const db = await getDatabase();
    await db.initializeUserSettings(
      newUser.id,
      newUser.displayName,
      newUser.neighborhood
    );

    this.currentUser = newUser;
    return newUser;
  }

  /**
   * Get current user
   */
  getCurrentUser(): CurrentUser | null {
    return this.currentUser;
  }

  /**
   * Update user profile
   */
  async updateUser(updates: Partial<CurrentUser>): Promise<CurrentUser> {
    if (!this.currentUser) {
      throw new Error('No user initialized');
    }

    this.currentUser = { ...this.currentUser, ...updates };

    // Save to AsyncStorage
    await AsyncStorage.setItem(CURRENT_USER_KEY, JSON.stringify(this.currentUser));

    // Update in database
    const db = await getDatabase();
    await db.updateUserSettings(this.currentUser.id, {
      display_name: this.currentUser.displayName,
      neighborhood: this.currentUser.neighborhood,
    } as any);

    console.log(`✅ User updated: ${this.currentUser.displayName}`);
    return this.currentUser;
  }

  /**
   * Get user ID
   */
  getUserId(): string {
    if (!this.currentUser) {
      throw new Error('No user initialized');
    }
    return this.currentUser.id;
  }

  /**
   * Check if user is initialized
   */
  isInitialized(): boolean {
    return this.currentUser !== null;
  }

  /**
   * Clear user data (logout)
   */
  async clearUser(): Promise<void> {
    await AsyncStorage.removeItem(CURRENT_USER_KEY);
    await AsyncStorage.removeItem(USER_ID_KEY);
    this.currentUser = null;
    console.log('🚀 User cleared');
  }
}

// Singleton instance
let instance: UserService | null = null;

export function getUserService(): UserService {
  if (!instance) {
    instance = new UserService();
  }
  return instance;
}

export default UserService;
