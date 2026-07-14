// Firebase Realtime Database
// Uses Firestore for cloud persistence with AsyncStorage caching for offline support

export {
  getDatabase,
  Cleanup,
  UserSettings,
  Badge,
} from './firebaseDatabase';

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  cleanups_count: number;
  total_bags: number;
  cities_count: number;
  badges_count: number;
  updated_at: number;
}
