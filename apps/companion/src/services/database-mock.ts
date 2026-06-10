// Mock database for testing - uses in-memory storage with AsyncStorage persistence
// No SQLite dependency
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'pick_app_cleanups';

export interface Cleanup {
  id: string;
  timestamp: number;
  location_lat: number;
  location_lon: number;
  items_count: number;
  bag_qty: number;
  bag_size: string;
  weight_lb: number;
  duration_seconds: number;
  team: string;
  fitness_tracked: boolean;
  notes?: string;
  route_points?: string; // JSON array of [lat, lon] pairs
}

export interface UserSettings {
  id: string;
  display_name: string;
  neighborhood: string;
  weight_unit: string;
  fitness_apps: string;
  team_name?: string;
  team_id?: string;
  created_at: number;
  updated_at: number;
}

export interface Badge {
  id: string;
  user_id: string;
  badge_type: string;
  location?: string;
  unlocked_at: number;
  metadata?: string;
}

// In-memory storage
const cleanups: Cleanup[] = [];
const userSettings: Map<string, UserSettings> = new Map();
const badges: Badge[] = [];
const sessionLocations: Array<{ lat: number; lon: number; timestamp: number }> = [];
const pickupLocations: Array<{ lat: number; lon: number; timestamp: number }> = [];

class MockDatabaseService {
  async initialize() {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        cleanups.splice(0, cleanups.length, ...parsed);
        console.log(`✅ Loaded ${cleanups.length} cleanups from storage`);
      }
    } catch (error) {
      console.error('Failed to load cleanups:', error);
    }
    console.log('✅ Mock database initialized (persistent)');
  }

  private async saveCleanups() {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleanups));
    } catch (error) {
      console.error('Failed to save cleanups:', error);
    }
  }

  async addCleanup(cleanup: Omit<Cleanup, 'id'>) {
    const id = `cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullCleanup: Cleanup = { ...cleanup, id };
    cleanups.unshift(fullCleanup);
    await this.saveCleanups();
    console.log(`✅ Cleanup logged: ${id}`, fullCleanup);
    return id;
  }

  async getCleanups(limit: number = 50) {
    return cleanups.slice(0, limit);
  }

  async getCleanupsByTeam(team: string, limit: number = 50) {
    return cleanups.filter(c => c.team === team).slice(0, limit);
  }

  async getCleanupStats() {
    const total = cleanups.length;
    const totalWeight = cleanups.reduce((sum, c) => sum + c.weight_lb, 0);
    const avgWeight = total > 0 ? totalWeight / total : 0;
    const totalTime = cleanups.reduce((sum, c) => sum + c.duration_seconds, 0);
    const days = new Set(cleanups.map(c => new Date(c.timestamp * 1000).toDateString())).size;

    return {
      total_cleanups: total,
      total_weight: totalWeight,
      avg_weight: avgWeight,
      total_time: totalTime,
      cleanup_days: days,
    };
  }

  async getUserSettings(userId: string) {
    return userSettings.get(userId) || null;
  }

  async initializeUserSettings(userId: string, displayName: string, neighborhood: string) {
    const newSettings: UserSettings = {
      id: userId,
      display_name: displayName,
      neighborhood,
      weight_unit: 'lb',
      fitness_apps: '[]',
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    userSettings.set(userId, newSettings);
    console.log(`✅ User settings initialized for ${userId}`);
    return newSettings;
  }

  async updateUserSettings(userId: string, settings: Partial<UserSettings>) {
    const existing = userSettings.get(userId) || {
      id: userId,
      display_name: 'User',
      neighborhood: 'Unknown',
      weight_unit: 'lb',
      fitness_apps: '[]',
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    const updated = { ...existing, ...settings, updated_at: Date.now() };
    userSettings.set(userId, updated as UserSettings);
    return updated;
  }

  async getBadges(userId: string) {
    return badges.filter(b => b.user_id === userId);
  }

  async addBadge(badge: Omit<Badge, 'id'>) {
    const id = `badge_${Date.now()}`;
    const fullBadge: Badge = { ...badge, id };
    badges.push(fullBadge);
    return id;
  }

  async clearAllData() {
    cleanups.length = 0;
    userSettings.clear();
    badges.length = 0;
    sessionLocations.length = 0;
    pickupLocations.length = 0;
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear storage:', error);
    }
    console.log('✅ All data cleared');
  }

  // Location tracking
  async addLocationPoint(lat: number, lon: number) {
    sessionLocations.push({
      lat,
      lon,
      timestamp: Date.now(),
    });
  }

  async addPickupLocation(lat: number, lon: number) {
    pickupLocations.push({
      lat,
      lon,
      timestamp: Date.now(),
    });
  }

  async getSessionRoute() {
    return sessionLocations;
  }

  async getPickupHeatmap() {
    return pickupLocations;
  }

  async clearSessionData() {
    sessionLocations.length = 0;
    pickupLocations.length = 0;
  }
}

let instance: MockDatabaseService | null = null;

export async function getDatabase() {
  if (!instance) {
    instance = new MockDatabaseService();
    await instance.initialize();
  }
  return instance;
}

export default MockDatabaseService;
