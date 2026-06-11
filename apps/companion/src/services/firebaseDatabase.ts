/**
 * Firebase Realtime Database Service
 * Replaces mock database with actual Firestore persistence
 * Provides offline-first caching with AsyncStorage
 */

import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { app } from './firebaseConfig';

const CLEANUPS_CACHE_KEY = 'pick_app_cleanups_cache';
const USER_SETTINGS_CACHE_KEY = 'pick_app_user_settings_cache';
const BADGES_CACHE_KEY = 'pick_app_badges_cache';
const MOCK_CLEANUPS_CACHE_KEY = 'pick_app_cleanups'; // Old mock database key

export interface Cleanup {
  id: string;
  userId: string;
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
  motion_log?: string; // JSON flight-recorder events (tuning data, ~100B/event)
  synced?: boolean;
}

export interface UserSettings {
  id: string;
  userId: string;
  display_name: string;
  neighborhood: string;
  weight_unit: string;
  distance_unit: string;
  fitness_apps: string;
  team_name?: string;
  team_id?: string;
  created_at: number;
  updated_at: number;
}

export interface Badge {
  id: string;
  userId: string;
  badge_type: string;
  location?: string;
  unlocked_at: number;
  metadata?: string;
}

export interface Challenge {
  id: string;
  name: string;
  description?: string;
  team?: string;
  status: 'active' | 'completed' | 'upcoming';
  start_date: number;
  end_date: number;
  goal_type: 'pickups' | 'weight' | 'distance' | 'days';
  goal_value: number;
  participants: string[]; // user IDs
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface TeamStats {
  team: string;
  total_cleanups: number;
  total_pickups: number;
  total_weight: number;
  total_days: number;
  member_count: number;
  last_cleanup: number;
  avg_pickups_per_session: number;
}

// Get Firestore instance
const db = getFirestore(app);

class FirebaseDatabase {
  private currentUserId: string | null = null;

  async initialize(userId: string) {
    this.currentUserId = userId;
    console.log('✅ Firebase database initialized for user:', userId);

    // Migrate old mock database cleanups
    await this.migrateFromMockDatabase();

    // Load cleanups from cache
    try {
      const cached = await AsyncStorage.getItem(CLEANUPS_CACHE_KEY);
      if (cached) {
        console.log(`📦 Loaded ${JSON.parse(cached).length} cleanups from cache`);
      }
    } catch (error) {
      console.error('Failed to load cache:', error);
    }

    // Sync with server in background
    this.syncCleanups();
  }

  private async migrateFromMockDatabase() {
    try {
      const oldData = await AsyncStorage.getItem(MOCK_CLEANUPS_CACHE_KEY);
      if (!oldData) return; // No old data

      const oldCleanups = JSON.parse(oldData) as any[];
      if (oldCleanups.length === 0) return;

      console.log(`🔄 Migrating ${oldCleanups.length} old cleanups to Firebase...`);

      // Add user ID to old cleanups and convert to new format
      const migratedCleanups: Cleanup[] = oldCleanups.map((cleanup) => ({
        ...cleanup,
        userId: this.currentUserId!,
        synced: false, // Mark for sync
      }));

      // Save to new cache
      await this.updateCleanupCache(...migratedCleanups);

      console.log(`✅ Migrated ${migratedCleanups.length} cleanups from mock database`);

      // Clear old cache
      await AsyncStorage.removeItem(MOCK_CLEANUPS_CACHE_KEY);
    } catch (error) {
      console.error('Failed to migrate from mock database:', error);
    }
  }

  /**
   * Add a new cleanup session
   */
  async addCleanup(cleanup: Omit<Cleanup, 'id' | 'userId' | 'synced'>) {
    if (!this.currentUserId) {
      console.error('User not initialized');
      return null;
    }

    const tsSeconds = this.toSeconds((cleanup as any).timestamp);
    this.invalidateCleanupsMemo();

    try {
      const docRef = await addDoc(collection(db, 'cleanups'), {
        ...cleanup,
        userId: this.currentUserId,
        timestamp: Timestamp.fromMillis(tsSeconds * 1000),
        synced: true,
      });

      const cleanupWithId: Cleanup = {
        ...cleanup,
        id: docRef.id,
        userId: this.currentUserId,
        timestamp: tsSeconds,
        synced: true,
      };

      // Update cache
      await this.updateCleanupCache(cleanupWithId);

      console.log(`✅ Cleanup saved to Firestore: ${docRef.id}`);
      return cleanupWithId;
    } catch (error) {
      console.error('📴 Cloud save failed — walk saved LOCALLY and will sync automatically:', error);
      const offlineCleanup: Cleanup = {
        ...cleanup,
        id: `offline_${Date.now()}`,
        userId: this.currentUserId,
        timestamp: tsSeconds,
        synced: false,
      };
      await this.updateCleanupCache(offlineCleanup);
      return offlineCleanup;
    }
  }

  // Short-lived memo: every tab refetches on focus, firing the same query
  // 4-6x per app open (visible in session logs). 15s TTL + in-flight dedup.
  private cleanupsMemo = new Map<number, { at: number; data: Cleanup[] }>();
  private cleanupsInflight = new Map<number, Promise<Cleanup[]>>();

  private invalidateCleanupsMemo() {
    this.cleanupsMemo.clear();
    this.cleanupsInflight.clear();
  }

  /**
   * Get cleanups for current user
   */
  async getCleanups(limitCount: number = 50): Promise<Cleanup[]> {
    const memo = this.cleanupsMemo.get(limitCount);
    if (memo && Date.now() - memo.at < 15000) {
      return memo.data;
    }
    const inflight = this.cleanupsInflight.get(limitCount);
    if (inflight) return inflight;

    const promise = this.fetchCleanups(limitCount).finally(() => {
      this.cleanupsInflight.delete(limitCount);
    });
    this.cleanupsInflight.set(limitCount, promise);
    const data = await promise;
    this.cleanupsMemo.set(limitCount, { at: Date.now(), data });
    return data;
  }

  private async fetchCleanups(limitCount: number): Promise<Cleanup[]> {
    // Try Firestore first if user is initialized
    if (this.currentUserId) {
      try {
        const q = query(
          collection(db, 'cleanups'),
          where('userId', '==', this.currentUserId),
          limit(limitCount * 2) // Fetch extra since we'll sort in-memory
        );

        const snapshot = await getDocs(q);
        const cleanups: Cleanup[] = snapshot.docs.map((doc) => ({
          userId: this.currentUserId!,
          ...(doc.data() as any),
          id: doc.id, // real doc id LAST so a stored 'id' field (old mock data) can't override it
          timestamp: doc.data().timestamp.toMillis ? doc.data().timestamp.toMillis() / 1000 : doc.data().timestamp,
          synced: true,
        }));

        // If Firestore has data, use it
        if (cleanups.length > 0) {
          // Sort by timestamp descending (in-memory to avoid composite index)
          cleanups.sort((a, b) => b.timestamp - a.timestamp);
          const sorted = cleanups.slice(0, limitCount);

          // Update cache with Firestore data
          await this.updateCleanupCache(...sorted);

          // Include not-yet-synced local walks so a dead-zone session
          // appears in Activity/maps immediately
          const unsynced = (await this.getCleanupCache()).filter((c) => !c.synced);
          const combined = unsynced.length > 0
            ? [...unsynced, ...sorted].sort((a, b) => b.timestamp - a.timestamp)
            : sorted;

          console.log(`✅ Loaded ${sorted.length} cleanups from Firestore${unsynced.length ? ` (+${unsynced.length} local pending sync)` : ''}`);
          return combined;
        }
      } catch (error) {
        console.error('❌ Failed to get cleanups from Firestore:', error);
      }
    }

    // Fall back to cache (works offline and during initialization)
    console.log('📦 Loading cleanups from cache...');
    return this.getCleanupCache();
  }

  /**
   * Delete a cleanup (used to remove mock/dev data and bad sessions).
   * Removes from Firestore and the offline cache.
   */
  async deleteCleanup(cleanupId: string): Promise<boolean> {
    try {
      this.invalidateCleanupsMemo();
      if (!cleanupId.startsWith('offline_')) {
        await deleteDoc(doc(db, 'cleanups', cleanupId));
      }
      // Scrub from offline cache too (match doc id OR legacy stored id field)
      try {
        const cached = await AsyncStorage.getItem(CLEANUPS_CACHE_KEY);
        if (cached) {
          const list = JSON.parse(cached).filter((c: any) => c.id !== cleanupId);
          await AsyncStorage.setItem(CLEANUPS_CACHE_KEY, JSON.stringify(list));
        }
      } catch {}
      console.log(`🗑️ Cleanup deleted: ${cleanupId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete cleanup:', error);
      return false;
    }
  }

  /**
   * Get cleanups by team
   */
  async getCleanupsByTeam(team: string, limitCount: number = 50) {
    try {
      const q = query(
        collection(db, 'cleanups'),
        where('team', '==', team),
        limit(limitCount * 2)
      );

      const snapshot = await getDocs(q);
      const cleanups: Cleanup[] = snapshot.docs.map((doc) => ({
        userId: doc.data().userId,
        ...(doc.data() as any),
        id: doc.id, // real doc id LAST so a stored 'id' field can't override it
        timestamp: doc.data().timestamp.toMillis ? doc.data().timestamp.toMillis() / 1000 : doc.data().timestamp,
        synced: true,
      }));

      // Sort by timestamp descending (in-memory)
      cleanups.sort((a, b) => b.timestamp - a.timestamp);
      return cleanups.slice(0, limitCount);
    } catch (error) {
      console.error('❌ Failed to get team cleanups:', error);
      return [];
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats() {
    if (!this.currentUserId) {
      return {
        total_cleanups: 0,
        total_weight: 0,
        avg_weight: 0,
        total_time: 0,
        cleanup_days: 0,
      };
    }

    try {
      const cleanups = await this.getCleanups(1000);
      const total = cleanups.length;
      const totalWeight = cleanups.reduce((sum, c) => sum + c.weight_lb, 0);
      const avgWeight = total > 0 ? totalWeight / total : 0;
      const totalTime = cleanups.reduce((sum, c) => sum + c.duration_seconds, 0);
      const days = new Set(cleanups.map((c) => new Date(c.timestamp * 1000).toDateString())).size;

      return {
        total_cleanups: total,
        total_weight: totalWeight,
        avg_weight: avgWeight,
        total_time: totalTime,
        cleanup_days: days,
      };
    } catch (error) {
      console.error('Failed to get stats:', error);
      return {
        total_cleanups: 0,
        total_weight: 0,
        avg_weight: 0,
        total_time: 0,
        cleanup_days: 0,
      };
    }
  }

  /**
   * User settings
   */
  async getUserSettings(userId: string) {
    if (!userId) return null;
    try {
      const docRef = doc(db, 'users', userId);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? (docSnap.data() as UserSettings) : null;
    } catch (error) {
      console.error('Failed to get user settings:', error);
      return null;
    }
  }

  async initializeUserSettings(userId: string, displayName: string, neighborhood: string) {
    const newSettings: UserSettings = {
      id: userId,
      userId,
      display_name: displayName,
      neighborhood,
      weight_unit: 'lb',
      distance_unit: 'mi',
      fitness_apps: '[]',
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    try {
      // setDoc with merge — updateDoc fails when the doc doesn't exist yet
      await setDoc(doc(db, 'users', userId), { ...newSettings }, { merge: true });
      console.log(`✅ User settings initialized for ${userId}`);
      return newSettings;
    } catch (error) {
      console.error('Failed to initialize user settings:', error);
      return newSettings;
    }
  }

  async updateUserSettings(userId: string, settings: Partial<UserSettings>) {
    try {
      const updated = {
        ...settings,
        updated_at: Date.now(),
      };
      await updateDoc(doc(db, 'users', userId), updated);
      console.log(`✅ User settings updated for ${userId}`);
      return updated;
    } catch (error) {
      console.error('Failed to update user settings:', error);
      return null;
    }
  }

  /**
   * Badges
   */
  async getBadges(userId: string) {
    try {
      const q = query(collection(db, 'badges'), where('userId', '==', userId));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({
        ...(doc.data() as Badge),
        id: doc.id,
      }));
    } catch (error) {
      console.error('Failed to get badges:', error);
      return [];
    }
  }

  /**
   * Re-key all data from a legacy local-auth uid to a Firebase uid.
   * Used once during the simpleAuth → Firebase Auth migration.
   * Returns the number of records migrated.
   */
  async migrateUserData(oldUid: string, newUid: string): Promise<number> {
    let migrated = 0;
    try {
      // Cleanups
      const cleanupsSnap = await getDocs(
        query(collection(db, 'cleanups'), where('userId', '==', oldUid))
      );
      // Badges
      const badgesSnap = await getDocs(
        query(collection(db, 'badges'), where('userId', '==', oldUid))
      );

      const batch = writeBatch(db);
      cleanupsSnap.forEach((d) => {
        batch.update(d.ref, { userId: newUid });
        migrated++;
      });
      badgesSnap.forEach((d) => {
        batch.update(d.ref, { userId: newUid });
        migrated++;
      });

      // User settings doc: copy old → new (merge keeps any new-account fields)
      const oldSettings = await getDoc(doc(db, 'users', oldUid));
      if (oldSettings.exists()) {
        batch.set(doc(db, 'users', newUid), { ...oldSettings.data(), userId: newUid }, { merge: true });
        migrated++;
      }

      await batch.commit();

      // Point this database instance at the new uid
      this.currentUserId = newUid;
      console.log(`✅ Migrated ${migrated} records from ${oldUid} to ${newUid}`);
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
    return migrated;
  }

  /** Number of badges of a given type the user has (0 = not yet earned). */
  async getBadgeCount(userId: string, badgeType: string): Promise<number> {
    try {
      const q = query(
        collection(db, 'badges'),
        where('userId', '==', userId),
        where('badge_type', '==', badgeType)
      );
      const snapshot = await getDocs(q);
      return snapshot.size;
    } catch (error) {
      console.error('Failed to get badge count:', error);
      return 0;
    }
  }

  async addBadge(badge: Omit<Badge, 'id'>) {
    try {
      const docRef = await addDoc(collection(db, 'badges'), {
        ...badge,
        unlocked_at: Timestamp.now(),
      });
      console.log(`✅ Badge added: ${docRef.id}`);
      return docRef.id;
    } catch (error) {
      console.error('Failed to add badge:', error);
      return null;
    }
  }

  /**
   * Location tracking (for session routes and heatmaps)
   */
  private sessionLocations: Array<{ lat: number; lon: number; timestamp: number }> = [];
  private pickupLocations: Array<{ lat: number; lon: number; timestamp: number }> = [];

  async addLocationPoint(lat: number, lon: number) {
    this.sessionLocations.push({
      lat,
      lon,
      timestamp: Date.now(),
    });
  }

  async addPickupLocation(lat: number, lon: number) {
    this.pickupLocations.push({
      lat,
      lon,
      timestamp: Date.now(),
    });
  }

  async getSessionRoute() {
    return this.sessionLocations;
  }

  async getPickupHeatmap() {
    return this.pickupLocations;
  }

  async clearSessionData() {
    this.sessionLocations.length = 0;
    this.pickupLocations.length = 0;
  }

  /**
   * Clear all data
   */
  async clearAllData() {
    try {
      if (this.currentUserId) {
        const cleanupQuery = query(
          collection(db, 'cleanups'),
          where('userId', '==', this.currentUserId)
        );
        const cleanups = await getDocs(cleanupQuery);
        for (const doc of cleanups.docs) {
          await deleteDoc(doc.ref);
        }

        await deleteDoc(doc(db, 'users', this.currentUserId));

        const badgesQuery = query(
          collection(db, 'badges'),
          where('userId', '==', this.currentUserId)
        );
        const badges = await getDocs(badgesQuery);
        for (const badgeDoc of badges.docs) {
          await deleteDoc(badgeDoc.ref);
        }
      }

      await AsyncStorage.removeItem(CLEANUPS_CACHE_KEY);
      await AsyncStorage.removeItem(USER_SETTINGS_CACHE_KEY);
      await AsyncStorage.removeItem(BADGES_CACHE_KEY);

      console.log('✅ All data cleared');
    } catch (error) {
      console.error('Failed to clear data:', error);
    }
  }

  /**
   * Get statistics for a team
   */
  async getTeamStats(team: string): Promise<TeamStats> {
    try {
      const cleanups = await this.getCleanupsByTeam(team, 200);

      if (cleanups.length === 0) {
        return {
          team,
          total_cleanups: 0,
          total_pickups: 0,
          total_weight: 0,
          total_days: 0,
          member_count: 0,
          last_cleanup: 0,
          avg_pickups_per_session: 0,
        };
      }

      const unique_users = new Set(cleanups.map((c) => c.userId));
      const total_pickups = cleanups.reduce((sum, c) => sum + c.items_count, 0);
      const total_weight = cleanups.reduce((sum, c) => sum + c.weight_lb, 0);
      const unique_days = new Set(
        cleanups.map((c) => new Date(c.timestamp * 1000).toDateString())
      );

      return {
        team,
        total_cleanups: cleanups.length,
        total_pickups,
        total_weight,
        total_days: unique_days.size,
        member_count: unique_users.size,
        last_cleanup: cleanups[0]?.timestamp || 0,
        avg_pickups_per_session: Math.round(total_pickups / cleanups.length),
      };
    } catch (error) {
      console.error('Failed to get team stats:', error);
      return {
        team,
        total_cleanups: 0,
        total_pickups: 0,
        total_weight: 0,
        total_days: 0,
        member_count: 0,
        last_cleanup: 0,
        avg_pickups_per_session: 0,
      };
    }
  }

  /**
   * Get leaderboard of all teams
   */
  async getLeaderboard(): Promise<TeamStats[]> {
    try {
      const cleanups = await this.getCleanups(500); // Get more to find all teams
      const teamMap = new Map<string, Cleanup[]>();

      // Group by team
      cleanups.forEach((cleanup) => {
        if (!teamMap.has(cleanup.team)) {
          teamMap.set(cleanup.team, []);
        }
        teamMap.get(cleanup.team)!.push(cleanup);
      });

      // Get stats for each team
      const leaderboard: TeamStats[] = [];
      for (const [team] of teamMap) {
        const stats = await this.getTeamStats(team);
        leaderboard.push(stats);
      }

      // Sort by total pickups descending
      leaderboard.sort((a, b) => b.total_pickups - a.total_pickups);
      return leaderboard;
    } catch (error) {
      console.error('Failed to get leaderboard:', error);
      return [];
    }
  }

  /**
   * Create a new challenge
   */
  async createChallenge(challenge: Omit<Challenge, 'id' | 'created_at' | 'updated_at'>) {
    try {
      const docRef = await addDoc(collection(db, 'challenges'), {
        ...challenge,
        created_at: Timestamp.now(),
        updated_at: Timestamp.now(),
      });

      console.log(`✅ Challenge created: ${docRef.id}`);
      return docRef.id;
    } catch (error) {
      console.error('Failed to create challenge:', error);
      return null;
    }
  }

  /**
   * Get active challenges
   */
  async getChallenges(status: 'active' | 'completed' | 'all' = 'active'): Promise<Challenge[]> {
    try {
      let q;
      if (status === 'all') {
        q = query(collection(db, 'challenges'));
      } else {
        q = query(collection(db, 'challenges'), where('status', '==', status));
      }

      const snapshot = await getDocs(q);
      const challenges: Challenge[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as any),
        start_date: doc.data().start_date.toMillis ? doc.data().start_date.toMillis() / 1000 : doc.data().start_date,
        end_date: doc.data().end_date.toMillis ? doc.data().end_date.toMillis() / 1000 : doc.data().end_date,
        created_at: doc.data().created_at.toMillis ? doc.data().created_at.toMillis() / 1000 : doc.data().created_at,
        updated_at: doc.data().updated_at.toMillis ? doc.data().updated_at.toMillis() / 1000 : doc.data().updated_at,
      }));

      return challenges;
    } catch (error) {
      console.error('Failed to get challenges:', error);
      return [];
    }
  }

  /**
   * Join a challenge
   */
  async joinChallenge(challengeId: string, userId: string) {
    try {
      const challengeRef = doc(db, 'challenges', challengeId);
      const challengeDoc = await getDoc(challengeRef);

      if (!challengeDoc.exists()) {
        throw new Error('Challenge not found');
      }

      const current = challengeDoc.data().participants || [];
      if (!current.includes(userId)) {
        current.push(userId);
        await updateDoc(challengeRef, { participants: current });
        console.log(`✅ Joined challenge: ${challengeId}`);
      }
    } catch (error) {
      console.error('Failed to join challenge:', error);
    }
  }

  /**
   * Private helper methods
   */
  private async updateCleanupCache(...cleanups: Cleanup[]) {
    try {
      const existing = await this.getCleanupCache();
      const merged = [...cleanups, ...existing.filter((e) => !cleanups.find((c) => c.id === e.id))];
      await AsyncStorage.setItem(CLEANUPS_CACHE_KEY, JSON.stringify(merged));
    } catch (error) {
      console.error('Failed to update cache:', error);
    }
  }

  private async getCleanupCache(): Promise<Cleanup[]> {
    try {
      const cached = await AsyncStorage.getItem(CLEANUPS_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch (error) {
      console.error('Failed to get cache:', error);
      return [];
    }
  }

  /** Normalize any timestamp (ms or seconds) to SECONDS — the cache/display unit. */
  private toSeconds(ts: any): number {
    if (typeof ts !== 'number' || !isFinite(ts)) return Math.floor(Date.now() / 1000);
    return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
  }

  private syncStarted = false;

  private async syncCleanups() {
    if (this.syncStarted) return; // initialize() runs multiple times — one loop only
    this.syncStarted = true;

    const flush = async () => {
      try {
        const cached = await this.getCleanupCache();
        const offline = cached.filter((c) => !c.synced);
        if (offline.length === 0) return;

        console.log(`🔄 Syncing ${offline.length} offline walk(s) to the cloud...`);
        let remaining = cached;
        for (const cleanup of offline) {
          try {
            const { id, userId, synced, ...data } = cleanup as any;
            const tsSeconds = this.toSeconds(data.timestamp);
            const docRef = await addDoc(collection(db, 'cleanups'), {
              ...data,
              userId: this.currentUserId,
              timestamp: Timestamp.fromMillis(tsSeconds * 1000), // preserve the walk's real time
              synced: true,
            });
            // Replace the local copy with the cloud copy (no duplicates)
            remaining = remaining.filter((c) => c.id !== id);
            remaining.unshift({ ...cleanup, id: docRef.id, timestamp: tsSeconds, synced: true });
            console.log(`✅ Offline walk synced: ${id} → ${docRef.id}`);
          } catch (error) {
            console.log('📴 Still offline — walk stays saved locally, will retry');
          }
        }
        await AsyncStorage.setItem(CLEANUPS_CACHE_KEY, JSON.stringify(remaining));
      } catch (error) {
        console.error('Sync failed:', error);
      }
    };

    flush(); // immediately on startup — don't make a dead-zone walk wait a minute
    setInterval(flush, 60000);
  }
}

let instance: FirebaseDatabase | null = null;

export async function getDatabase() {
  if (!instance) {
    instance = new FirebaseDatabase();
  }
  return instance;
}

export default FirebaseDatabase;
