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
  arrayUnion,
  arrayRemove,
  Timestamp,
} from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { app } from './firebaseConfig';
import { aggregateBags, itemsToBags } from './impactMetrics';

const CLEANUPS_CACHE_KEY = 'pick_app_cleanups_cache';
const USER_SETTINGS_CACHE_KEY = 'pick_app_user_settings_cache';
const BADGES_CACHE_KEY = 'pick_app_badges_cache';
const MOCK_CLEANUPS_CACHE_KEY = 'pick_app_cleanups'; // Old mock database key
const CACHE_OWNER_KEY = 'pick_app_cache_owner_uid'; // which user the device-global caches belong to

export interface Cleanup {
  id: string;
  userId: string;
  timestamp: number;
  location_lat: number;
  location_lon: number;
  items_count: number;
  bag_qty: number;
  bag_size: string;
  /** Bags for this session: the user's end-of-session report, else derived from items. */
  bags_est?: number;
  /** @deprecated legacy — weight was dropped from the product in favor of bags. */
  weight_lb?: number;
  duration_seconds: number;
  team: string;
  fitness_tracked: boolean;
  notes?: string;
  city?: string; // geo-derived (reverse-geocoded at save) — for city/global rollups
  neighborhood?: string; // geo-derived — the local board this walk counts toward
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
  leaderboard_hidden?: boolean; // opted out of the public individual leaderboard
  profile_hidden?: boolean; // name isn't tappable; profile page is private (mirrored to profiles/{uid}.hidden)
  weekly_goal?: number; // cleanups/week target behind "goal met" on Impact
  community_sharing_enabled?: boolean; // show the "Share to community" option (default on)
  community_auto_post?: boolean; // auto-post a cleanup's photo to community on save (default off)
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
  /** Bags (derived). Server-written team_stats docs may lack this — fall back to total_pickups. */
  total_bags?: number;
  total_days: number;
  member_count: number;
  last_cleanup: number;
  avg_pickups_per_session: number;
}

/** A community feed post: a cleanup photo + caption. No precise location. */
/** Numbers shown on an impact post's stat summary. */
export interface ImpactStats {
  pctGreen?: number;   // % of the area cleaned ("green")
  adopted: number;     // adopted blocks
  toGo?: number;       // blocks left to reach the goal
  cleanups?: number;
  bags?: number;
  pickups?: number;    // pieces of litter picked up — the headline share stat
}

/** Compact, re-renderable "map snapshot" — drawn as SVG from coords (no image
 *  file). Kept small: cap the block count before saving. */
export interface ImpactCoverage {
  bbox: [number, number, number, number]; // [minLat, minLon, maxLat, maxLon]
  blocks: [number, number][][];            // adopted/cleaned block polylines
  tiles?: [number, number][];              // optional cleaned-tile centers
}

export interface Post {
  id: string;
  uid: string;
  display_name: string;
  neighborhood: string;
  caption: string;
  image_url: string;
  storage_path: string;
  liked_by: string[];
  created_at: number;
  /** 'photo' (default, legacy) or 'impact' (map snapshot + stat summary). */
  kind?: 'photo' | 'impact';
  stats?: ImpactStats;
  coverage?: ImpactCoverage;
}

/** Per-user public leaderboard aggregate (no routes — totals + name only). */
export interface UserStats {
  uid: string;
  display_name: string;
  team: string;
  total_pickups: number;
  /** Bags collected (user reports win per session). Older docs may lack this. */
  total_bags?: number;
  total_cleanups: number;
  active_days: number;
  hidden: boolean; // opted out of the public individual leaderboard
  updated_at: number;
}

export interface TeamDir {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

export interface TeamDirWithStats extends TeamDir {
  member_count: number;
  total_pickups: number;
  total_bags: number;
}

// Get Firestore instance
const db = getFirestore(app);
const storage = getStorage(app);

/**
 * Upload an image blob resiliently. Plain uploadBytes() has no timeout and hangs
 * indefinitely if the device switches networks (cellular↔wifi) mid-transfer —
 * the reason community posting only worked with wifi turned off. This uses
 * uploadBytesResumable with a timeout so a stalled attempt is cancelled and
 * retried once on the (now-settled) connection.
 */
async function uploadImageResilient(
  sref: ReturnType<typeof storageRef>,
  blob: Blob,
  { timeoutMs = 20000, retries = 1 }: { timeoutMs?: number; retries?: number } = {},
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(sref, blob, { contentType: 'image/jpeg' });
        const timer = setTimeout(() => {
          try { task.cancel(); } catch {}
          reject(new Error('upload-timeout'));
        }, timeoutMs);
        task.on(
          'state_changed',
          undefined,
          (err) => { clearTimeout(timer); reject(err); },
          () => { clearTimeout(timer); resolve(); },
        );
      });
      return;
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1500)); // brief backoff, then retry
    }
  }
}

class FirebaseDatabase {
  private currentUserId: string | null = null;

  async initialize(userId: string) {
    this.currentUserId = userId;
    console.log('✅ Firebase database initialized for user:', userId);

    // Per-user cache isolation. The offline caches use device-global keys, so a
    // different account signing in on the same device would otherwise inherit
    // the previous user's cached cleanups/badges/settings — visible offline or
    // before Firestore responds (the "25 cached vs 4 in Firestore" mismatch).
    // Drop the stale caches whenever the cache owner changes.
    try {
      const cacheOwner = await AsyncStorage.getItem(CACHE_OWNER_KEY);
      if (cacheOwner && cacheOwner !== userId) {
        console.log(`🧹 Cache owner changed (${cacheOwner} → ${userId}) — clearing stale local caches`);
        await AsyncStorage.multiRemove([
          CLEANUPS_CACHE_KEY,
          USER_SETTINGS_CACHE_KEY,
          BADGES_CACHE_KEY,
        ]);
        this.invalidateCleanupsMemo();
      }
      await AsyncStorage.setItem(CACHE_OWNER_KEY, userId);
    } catch (error) {
      console.error('Cache owner check failed:', error);
    }

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

      // Refresh this user's public leaderboard aggregate (fire-and-forget).
      void this.updateUserStats(this.currentUserId);

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
    // Fetch ONE canonical set and slice per caller. Previously the memo was
    // keyed by limitCount, so getCleanups(50) and getCleanups(1000) each fired
    // their own Firestore read (the duplicate "Loaded N cleanups" in logs).
    // Users have few cleanups, so one fetch covers every caller.
    const CANON = 1000;
    const memo = this.cleanupsMemo.get(CANON);
    if (memo && Date.now() - memo.at < 15000) {
      return memo.data.slice(0, limitCount);
    }
    const inflight = this.cleanupsInflight.get(CANON);
    if (inflight) return inflight.then((d) => d.slice(0, limitCount));

    const promise = this.fetchCleanups(CANON).finally(() => {
      this.cleanupsInflight.delete(CANON);
    });
    this.cleanupsInflight.set(CANON, promise);
    const data = await promise;
    this.cleanupsMemo.set(CANON, { at: Date.now(), data });
    return data.slice(0, limitCount);
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
   * Edit a saved cleanup — e.g., correct the bag count later from Activity.
   * Updates Firestore + the offline cache and refreshes the leaderboard aggregate.
   */
  async updateCleanup(
    cleanupId: string,
    fields: Partial<Pick<Cleanup, 'bags_est' | 'items_count'>>
  ): Promise<boolean> {
    try {
      this.invalidateCleanupsMemo();
      if (!cleanupId.startsWith('offline_')) {
        await updateDoc(doc(db, 'cleanups', cleanupId), fields as any);
      }
      try {
        const cached = await AsyncStorage.getItem(CLEANUPS_CACHE_KEY);
        if (cached) {
          const list = JSON.parse(cached).map((c: any) => (c.id === cleanupId ? { ...c, ...fields } : c));
          await AsyncStorage.setItem(CLEANUPS_CACHE_KEY, JSON.stringify(list));
        }
      } catch {}
      void this.updateUserStats(this.currentUserId || undefined);
      console.log(`✏️ Cleanup updated: ${cleanupId}`);
      return true;
    } catch (error) {
      console.error('Failed to update cleanup:', error);
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
        total_pickups: 0,
        total_bags: 0,
        total_time: 0,
        cleanup_days: 0,
      };
    }

    try {
      const cleanups = await this.getCleanups(1000);
      const total = cleanups.length;
      const totalPickups = cleanups.reduce((sum, c) => sum + (c.items_count || 0), 0);
      const totalBags = aggregateBags(cleanups);
      const totalTime = cleanups.reduce((sum, c) => sum + c.duration_seconds, 0);
      const days = new Set(cleanups.map((c) => new Date(c.timestamp * 1000).toDateString())).size;

      return {
        total_cleanups: total,
        total_pickups: totalPickups,
        total_bags: totalBags,
        total_time: totalTime,
        cleanup_days: days,
      };
    } catch (error) {
      console.error('Failed to get stats:', error);
      return {
        total_cleanups: 0,
        total_pickups: 0,
        total_bags: 0,
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
      // Propagate name / team / opt-out changes to the public leaderboard doc.
      void this.updateUserStats(userId);
      return updated;
    } catch (error) {
      console.error('Failed to update user settings:', error);
      return null;
    }
  }

  // ---------- Teams ----------

  /** Slug used as a team's document id (stable for a given name). */
  private teamSlug(name: string): string {
    return (
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'team'
    );
  }

  /** All teams in the shared directory. */
  async getTeams(): Promise<TeamDir[]> {
    try {
      const snap = await getDocs(collection(db, 'teams'));
      return snap.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          name: String(v.name ?? d.id),
          created_by: String(v.created_by ?? ''),
          created_at: Number(v.created_at ?? 0),
        };
      });
    } catch (error) {
      console.error('Failed to get teams:', error);
      return [];
    }
  }

  /**
   * Teams merged with their leaderboard stats (member / activity counts).
   * Teams with no cleanups yet show zeros. Sorted by members, then pickups.
   */
  async getTeamsWithStats(): Promise<TeamDirWithStats[]> {
    const [teams, stats] = await Promise.all([this.getTeams(), this.getTeamLeaderboard()]);
    const byName = new Map(stats.map((s) => [s.team, s]));
    return teams
      .map((t) => {
        const s = byName.get(t.name);
        return {
          ...t,
          member_count: s?.member_count ?? 0,
          total_pickups: s?.total_pickups ?? 0,
          total_bags: s?.total_bags ?? itemsToBags(s?.total_pickups ?? 0),
        };
      })
      .sort((a, b) => b.member_count - a.member_count || b.total_pickups - a.total_pickups);
  }

  /**
   * Join an existing team, or create it if it doesn't exist yet. Records the
   * team in the user's settings so future cleanups count toward it.
   * Returns the joined team's { id, name }.
   */
  async joinOrCreateTeam(userId: string, name: string): Promise<{ id: string; name: string }> {
    const clean = name.trim();
    if (!clean) throw new Error('Enter a team name.');
    const id = this.teamSlug(clean);
    const ref = doc(db, 'teams', id);
    const existing = await getDoc(ref);
    const teamName = existing.exists() ? String((existing.data() as any).name ?? clean) : clean;
    if (!existing.exists()) {
      await setDoc(ref, { name: clean, created_by: userId, created_at: Date.now() });
    }
    await this.updateUserSettings(userId, { team_name: teamName, team_id: id } as Partial<UserSettings>);
    return { id, name: teamName };
  }

  /** Join an existing team (chosen from the directory). */
  async joinTeam(userId: string, team: { id: string; name: string }): Promise<void> {
    await this.updateUserSettings(userId, { team_name: team.name, team_id: team.id } as Partial<UserSettings>);
  }

  /** Leave the current team (back to solo). */
  async leaveTeam(userId: string): Promise<void> {
    await this.updateUserSettings(userId, { team_name: '', team_id: '' } as Partial<UserSettings>);
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
   * Delete every trace of the account's cloud data. Used by account deletion
   * (App Store Guideline 5.1.1). Unlike clearAllData, this THROWS on failure —
   * the caller must NOT delete the Firebase Auth user if this fails, or the
   * data becomes permanently orphaned (owner-only security rules mean nobody
   * can delete it once the auth user is gone).
   *
   * Covers, beyond clearAllData: the public leaderboard aggregate
   * (user_stats/{uid}), the user's community posts (Firestore docs + Storage
   * images), and the uid's likes on other users' posts.
   *
   * NOT covered (rules forbid client deletes): `feedback` docs — purge those
   * manually from the Firebase console on deletion requests.
   */
  async deleteAccountData(): Promise<void> {
    const uid = this.currentUserId;
    if (!uid) throw new Error('No signed-in user.');

    // Own community posts, including their Storage images.
    const postsSnap = await getDocs(
      query(collection(db, 'posts'), where('uid', '==', uid))
    );
    for (const postDoc of postsSnap.docs) {
      const storagePath = (postDoc.data() as any).storage_path;
      await deleteDoc(postDoc.ref);
      if (storagePath) {
        try {
          await deleteObject(storageRef(storage, storagePath));
        } catch {
          // image already gone — ignore
        }
      }
    }

    // Remove this uid from liked_by arrays on other users' posts.
    const likedSnap = await getDocs(
      query(collection(db, 'posts'), where('liked_by', 'array-contains', uid))
    );
    for (const likedDoc of likedSnap.docs) {
      await updateDoc(likedDoc.ref, { liked_by: arrayRemove(uid) });
    }

    // Cleanups.
    const cleanupsSnap = await getDocs(
      query(collection(db, 'cleanups'), where('userId', '==', uid))
    );
    for (const cleanupDoc of cleanupsSnap.docs) {
      await deleteDoc(cleanupDoc.ref);
    }

    // Badges.
    const badgesSnap = await getDocs(
      query(collection(db, 'badges'), where('userId', '==', uid))
    );
    for (const badgeDoc of badgesSnap.docs) {
      await deleteDoc(badgeDoc.ref);
    }

    // Public leaderboard aggregate + profile document.
    await deleteDoc(doc(db, 'user_stats', uid));
    await deleteDoc(doc(db, 'users', uid));

    // Local caches.
    await AsyncStorage.multiRemove([
      CLEANUPS_CACHE_KEY,
      USER_SETTINGS_CACHE_KEY,
      BADGES_CACHE_KEY,
      CACHE_OWNER_KEY,
    ]);

    console.log('🗑️ Account cloud data deleted');
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
          total_bags: 0,
          total_days: 0,
          member_count: 0,
          last_cleanup: 0,
          avg_pickups_per_session: 0,
        };
      }

      const unique_users = new Set(cleanups.map((c) => c.userId));
      const total_pickups = cleanups.reduce((sum, c) => sum + c.items_count, 0);
      const total_bags = aggregateBags(cleanups);
      const unique_days = new Set(
        cleanups.map((c) => new Date(c.timestamp * 1000).toDateString())
      );

      return {
        team,
        total_cleanups: cleanups.length,
        total_pickups,
        total_bags,
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
        total_bags: 0,
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
   * Privacy-safe team leaderboard.
   * Reads the `team_stats` aggregate maintained by the Cloud Functions
   * (onCleanupWrite / rebuildTeamStats) instead of other users' raw cleanups,
   * so it works cross-user without exposing cleanup routes.
   */
  async getTeamLeaderboard(): Promise<TeamStats[]> {
    try {
      const snapshot = await getDocs(collection(db, 'team_stats'));
      const teams = snapshot.docs.map((d) => d.data() as TeamStats);
      teams.sort((a, b) => b.total_pickups - a.total_pickups);
      return teams;
    } catch (error) {
      console.error('Failed to get team leaderboard:', error);
      return [];
    }
  }

  /**
   * Recompute this user's public leaderboard aggregate from their own cleanups
   * and write it to `user_stats/{uid}` (owner-writable, all-readable). Holds
   * totals + display name + team only — never routes. Call after a cleanup is
   * saved and whenever the display name / team / opt-out changes. Fire-and-forget.
   */
  async updateUserStats(userId?: string): Promise<void> {
    const uid = userId || this.currentUserId;
    if (!uid) return;
    try {
      const mine = await this.getCleanups(1000);
      const settings = await this.getUserSettings(uid);
      const stats: UserStats = {
        uid,
        display_name: settings?.display_name || 'Picker',
        team: settings?.team_name || 'Solo',
        total_pickups: mine.reduce((s, c) => s + (c.items_count || 0), 0),
        total_bags: aggregateBags(mine),
        total_cleanups: mine.length,
        active_days: new Set(mine.map((c) => new Date((c.timestamp || 0) * 1000).toDateString())).size,
        hidden: !!settings?.leaderboard_hidden,
        updated_at: Date.now(),
      };
      await setDoc(doc(db, 'user_stats', uid), stats, { merge: true });
    } catch (error) {
      console.error('Failed to update user_stats:', error);
    }
  }

  /**
   * Public stats for one user (their profile page). Reads the privacy-safe
   * `user_stats/{uid}` aggregate; returns null if the user opted out (hidden)
   * or has no aggregate yet. Rules allow the read only when hidden == false.
   */
  async getUserStats(uid: string): Promise<UserStats | null> {
    if (!uid) return null;
    try {
      const snap = await getDoc(doc(db, 'user_stats', uid));
      if (!snap.exists()) return null;
      const s = snap.data() as UserStats;
      return s.hidden ? null : s;
    } catch {
      return null; // read denied (hidden) or offline
    }
  }

  /**
   * Cross-user individual leaderboard. Reads the privacy-safe `user_stats`
   * aggregate; opted-out users (hidden) are filtered out. Sorted in-memory by
   * the chosen metric to avoid composite-index setup.
   */
  async getIndividualLeaderboard(
    metric: 'pickups' | 'bags' | 'days' = 'pickups'
  ): Promise<UserStats[]> {
    try {
      const snapshot = await getDocs(query(collection(db, 'user_stats'), where('hidden', '==', false)));
      const users = snapshot.docs.map((d) => d.data() as UserStats);
      // Older user_stats docs predate total_bags — derive from pickups for them.
      const value = (u: UserStats): number =>
        metric === 'pickups' ? u.total_pickups || 0
        : metric === 'bags' ? (u.total_bags ?? itemsToBags(u.total_pickups || 0))
        : u.active_days || 0;
      users.sort((a, b) => value(b) - value(a));
      return users;
    } catch (error) {
      console.error('Failed to get individual leaderboard:', error);
      return [];
    }
  }

  // ── Community feed ──────────────────────────────────────────────────────

  /**
   * Share a cleanup photo to the community feed. Uploads the local image to
   * Firebase Storage (cleanup_photos/{uid}/...), then writes a `posts` doc with
   * the download URL + caption + neighborhood. No precise location is stored.
   */
  async createPost(input: { caption: string; neighborhood: string; photoUri: string }): Promise<Post | null> {
    const uid = this.currentUserId;
    if (!uid) return null;
    try {
      const settings = await this.getUserSettings(uid);
      const path = `cleanup_photos/${uid}/${Date.now()}.jpg`;
      const resp = await fetch(input.photoUri);
      const blob = await resp.blob();
      const sref = storageRef(storage, path);
      // Declare contentType explicitly: Expo file blobs often have an empty
      // type, which fails the Storage rule's `image/.*` check (silent denial).
      await uploadImageResilient(sref, blob);
      const image_url = await getDownloadURL(sref);
      const post = {
        uid,
        display_name: settings?.display_name || 'Picker',
        neighborhood: input.neighborhood || settings?.neighborhood || '',
        caption: (input.caption || '').slice(0, 280),
        image_url,
        storage_path: path,
        liked_by: [] as string[],
        created_at: Date.now(),
      };
      const docRef = await addDoc(collection(db, 'posts'), post);
      console.log(`✅ Community post created: ${docRef.id}`);
      return { id: docRef.id, ...post };
    } catch (error) {
      console.error('Failed to create post:', error);
      return null;
    }
  }

  /** Newest community posts first. */
  async getPosts(limitCount = 50): Promise<Post[]> {
    try {
      const snapshot = await getDocs(query(collection(db, 'posts'), orderBy('created_at', 'desc'), limit(limitCount)));
      return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Post[];
    } catch (error) {
      console.error('Failed to get posts:', error);
      return [];
    }
  }

  /**
   * Share your impact: a map snapshot (re-rendered from `coverage` coords, no
   * photo upload) plus a stat summary. Stored in the same `posts` feed, tagged
   * kind:'impact' so the feed renders it differently.
   */
  async createImpactPost(input: {
    caption?: string;
    neighborhood?: string;
    stats: ImpactStats;
    coverage: ImpactCoverage;
  }): Promise<Post | null> {
    const uid = this.currentUserId;
    if (!uid) return null;
    try {
      const settings = await this.getUserSettings(uid);
      // Trim coverage so a doc can't blow past Firestore's 1 MB limit.
      const blocks = (input.coverage.blocks || []).slice(0, 400);
      const tiles = (input.coverage.tiles || []).slice(0, 600);
      const post = {
        uid,
        display_name: settings?.display_name || 'Picker',
        neighborhood: input.neighborhood || settings?.neighborhood || '',
        caption: (input.caption || '').slice(0, 280),
        image_url: '',
        storage_path: '',
        liked_by: [] as string[],
        kind: 'impact' as const,
        stats: input.stats,
        coverage: { bbox: input.coverage.bbox, blocks, tiles },
        created_at: Date.now(),
      };
      const docRef = await addDoc(collection(db, 'posts'), post);
      console.log(`✅ Impact post created: ${docRef.id}`);
      return { id: docRef.id, ...post };
    } catch (error) {
      console.error('Failed to create impact post:', error);
      return null;
    }
  }

  /**
   * Posts from a specific set of authors, newest first — powers the "Following"
   * feed. Firestore `in` allows ≤10 values, so we chunk and merge.
   */
  async getPostsByUsers(uids: string[], limitCount = 50): Promise<Post[]> {
    const ids = Array.from(new Set(uids)).filter(Boolean);
    if (ids.length === 0) return [];
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
      // No orderBy here on purpose: an `in` filter + orderBy would require a
      // composite index. We over-fetch by equality (index-free) and sort +
      // trim client-side below, so the Following feed works with no index setup.
      const results = await Promise.all(
        chunks.map((chunk) =>
          getDocs(query(collection(db, 'posts'), where('uid', 'in', chunk), limit(limitCount)))
        )
      );
      const merged: Post[] = [];
      for (const snap of results) snap.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) } as Post));
      return merged.sort((a, b) => b.created_at - a.created_at).slice(0, limitCount);
    } catch (error) {
      console.error('Failed to get posts by users:', error);
      return [];
    }
  }

  /** Add or remove the current user's like on a post. */
  async toggleLikePost(postId: string, liked: boolean): Promise<void> {
    const uid = this.currentUserId;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'posts', postId), {
        liked_by: liked ? arrayUnion(uid) : arrayRemove(uid),
      });
    } catch (error) {
      console.error('Failed to like post:', error);
    }
  }

  /** Delete one of the current user's own posts (Firestore doc + Storage file). */
  async deletePost(post: Post): Promise<boolean> {
    try {
      await deleteDoc(doc(db, 'posts', post.id));
      if (post.storage_path) {
        try {
          await deleteObject(storageRef(storage, post.storage_path));
        } catch {
          // image already gone — ignore
        }
      }
      console.log(`🗑️ Post deleted: ${post.id}`);
      return true;
    } catch (error) {
      console.error('Failed to delete post:', error);
      return false;
    }
  }

  // ── Feedback ────────────────────────────────────────────────────────────

  /**
   * In-app tester feedback → `feedback` collection (read in the Firebase
   * console). Stamps who/when/build so it's actionable. Create-only from clients.
   */
  async submitFeedback(payload: {
    message: string;
    email?: string;
    displayName?: string;
    appVersion?: string;
  }): Promise<boolean> {
    try {
      await addDoc(collection(db, 'feedback'), {
        uid: this.currentUserId || 'anon',
        message: (payload.message || '').slice(0, 2000),
        email: payload.email || '',
        display_name: payload.displayName || '',
        app_version: payload.appVersion || '',
        created_at: Date.now(),
      });
      console.log('📨 Feedback submitted');
      return true;
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      return false;
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
      // Merge against the RAW cache (all users) so writing the current user's
      // data never evicts another account's offline cleanups from storage.
      const existing = await this.getCleanupCacheRaw();
      const merged = [...cleanups, ...existing.filter((e) => !cleanups.find((c) => c.id === e.id))];
      await AsyncStorage.setItem(CLEANUPS_CACHE_KEY, JSON.stringify(merged));
    } catch (error) {
      console.error('Failed to update cache:', error);
    }
  }

  /** Raw cache contents (ALL users on this device). Use only for storage merges. */
  private async getCleanupCacheRaw(): Promise<Cleanup[]> {
    try {
      const cached = await AsyncStorage.getItem(CLEANUPS_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch (error) {
      console.error('Failed to get cache:', error);
      return [];
    }
  }

  private async getCleanupCache(): Promise<Cleanup[]> {
    const list = await this.getCleanupCacheRaw();
    // Scope cached reads to the signed-in user. The cache key is device-global,
    // so without this a previous account's cleanups — including unsynced ones the
    // user-scoped Firestore query can't filter out — would surface in the current
    // user's Activity/stats. Every cached cleanup carries userId (set on
    // add/migrate/fetch), so this filter is exact.
    if (this.currentUserId) {
      return list.filter((c) => c.userId === this.currentUserId);
    }
    return list;
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
