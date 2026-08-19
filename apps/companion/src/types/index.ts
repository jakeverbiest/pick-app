/**
 * Pick App - Type Definitions
 * Central location for all TypeScript interfaces and types
 */

// User & Auth
export interface CurrentUser {
  id: string;
  displayName: string;
  neighborhood: string;
  email?: string;
  createdAt: number;
}

export interface UserSettings {
  id: string;
  display_name: string;
  neighborhood: string;
  weight_unit?: string; // legacy — weight was removed from the product
  fitness_apps: string; // JSON array
  created_at: number;
  updated_at: number;
}

// Cleanup Session
export interface Cleanup {
  id: string;
  timestamp: number; // unix timestamp
  location_lat: number;
  location_lon: number;
  items_count: number;
  bag_qty: number;
  /** How full the reported bags were, 0-100. Added 17 Aug: before this only
   *  the derived `bags_est` was kept, so an edit screen had to back fullness
   *  out of it. Older records still take that path (see storedFullness). */
  bag_fullness?: number;
  bag_size: string; // '13', '30', '39', '55'
  /** Bags for this session: user's end-of-session report, else derived from items. */
  bags_est?: number;
  /**
   * What the motion detector counted, before any user correction.
   * `items_count` is the truth users see and what totals use; this is kept
   * alongside it purely as detector training data. Field walks show the
   * detector runs well over on a slow stroll, and every threshold today is
   * fitted to a single tester — real (detected, corrected) pairs are the only
   * route to tuning against actual users. Never displayed.
   */
  items_detected?: number;
  /** Median GPS speed over the walk's motion events, m/s. -1 = unknown. */
  pace_median_mps?: number;
  /** Share of speed samples below PACE_CONTEXT.strollMps, 0-1. -1 = unknown. */
  pace_slow_share?: number;
  /** True when the walk was mostly a stroll, so the count needs human review. */
  pace_low_confidence?: boolean;
  /** @deprecated legacy — weight was dropped in favor of bags. */
  weight_lb?: number;
  duration_seconds: number;
  team: string; // 'solo', 'neighborhood', 'challenge'
  fitness_tracked: boolean;
  notes?: string;
  created_at?: number;
}

export interface CleanupStats {
  total_cleanups: number;
  total_pickups: number;
  total_bags: number;
  total_time: number;
  cleanup_days: number;
}

// Badges & Achievements
export type BadgeType =
  | 'pioneer' // First to clean in new location
  | 'explorer' // 3+ neighborhoods
  | 'city_mapper' // 5+ cities
  | 'collector' // 1+ bags
  | 'heavy_lifter' // 5+ bags
  | 'king_queen' // 50+ bags
  | 'consistent' // 7-day streak
  | 'dedicated' // 30-day streak
  | 'unstoppable'; // 90-day streak

export interface Badge {
  id: string;
  user_id: string;
  badge_type: BadgeType;
  location?: string; // For pioneer badges
  unlocked_at: number;
  metadata?: string; // JSON for extra info
  created_at?: number;
}

export interface BadgeDefinition {
  type: BadgeType;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

// Leaderboard
export type LeaderboardMetric = 'cleanups' | 'bags' | 'badges';

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  cleanups_count: number;
  total_bags: number;
  cities_count: number;
  badges_count: number;
  updated_at: number;
}

export interface UserRankEntry extends LeaderboardEntry {
  rank: number;
  isCurrentUser?: boolean;
}

// Fitness Tracking
export type FitnessApp = 'apple_health' | 'strava' | 'adidas_running' | 'google_health';

export interface FitnessAppConfig {
  app: FitnessApp;
  enabled: boolean;
  lastSyncAt?: number;
}

export interface FitnessWorkout {
  duration_seconds: number;
  distance_km: number;
  activity_type: 'walking' | 'running' | 'cycling';
  calories_burned: number;
  items_collected: number;
}

// Locations & Routes
export interface LocationCoord {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface CleanupZone {
  zone_id: string;
  name: string;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  center: LocationCoord;
}

export type ZoneCleanlinessStatus = 'clean' | 'getting_dirty' | 'needs_cleaning' | 'urgent' | 'never_cleaned';

export interface ZoneStatus {
  zone_id: string;
  status: ZoneCleanlinessStatus;
  last_cleanup_date?: number;
  last_cleanup_trash_lb?: number;
  days_since_cleanup?: number;
  accumulation_rate_lb_per_day?: number;
  recommended_frequency?: string;
}

// Motion Detection (for reference from existing code)
export interface PickupEvent {
  timestamp: number;
  magnitude: number;
  confidence: number;
  latitude?: number;
  longitude?: number;
  duration?: number;
}

// UI State
export interface CleanupSessionState {
  pickupCount: number;
  isListening: boolean;
  lastLocation: LocationCoord | null;
  bagSize: string;
  bagQty: number;
  selectedTeam: string;
  fitnessTracking: boolean;
  sessionStartTime: number | null;
  elapsedSeconds: number;
}

export interface AppState {
  user: CurrentUser | null;
  isInitialized: boolean;
  error: string | null;
}

// Statistics & Reports
export interface PersonalStats {
  totalCleanups: number;
  totalWeightLb: number;
  averageWeightPerCleanup: number;
  totalTimeSeconds: number;
  averageTimePerCleanup: number;
  cleanupDaysCount: number;
  citiesCleaned: number;
  badgesEarned: number;
  currentStreak: number;
}

export interface CommunityStats {
  totalCleanups: number;
  totalWeightLb: number;
  activeUsers: number;
  totalBadgesAwarded: number;
}

// API/Sync (for future backend integration)
export interface SyncRequest {
  user_id: string;
  cleanups: Cleanup[];
  badges: Badge[];
  timestamp: number;
}

export interface SyncResponse {
  success: boolean;
  leaderboard?: LeaderboardEntry[];
  community_stats?: CommunityStats;
  error?: string;
}
