import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getBadgeService } from '../../src/services/badgeService';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';

export default function ActivityScreen() {
  const [stats, setStats] = useState<any>(null);
  const [cleanups, setCleanups] = useState<any[]>([]);
  const [badges, setBadges] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadActivity();
  }, []);

  // Reload activity whenever this tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [])
  );

  const loadActivity = async () => {
    try {
      const db = await getDatabase();
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();

      if (!currentUser) {
        setLoading(false);
        return;
      }

      const userStats = await db.getCleanupStats();
      const userCleanups = await db.getCleanups(20);
      const badgeService = getBadgeService();
      const userBadges = await db.getBadges(currentUser.uid);

      setUser(currentUser);
      setStats(userStats);
      setCleanups(userCleanups || []);
      setBadges(userBadges || []);
    } catch (error) {
      console.error('Failed to load activity:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m`;
    return `${seconds}s`;
  };

  const exportCleanup = async (cleanup: any) => {
    try {
      const exportData = {
        id: cleanup.id,
        date: new Date(cleanup.timestamp * 1000).toISOString(),
        duration: `${formatTime(cleanup.duration_seconds)}`,
        items_detected: cleanup.items_count,
        weight_reported_lb: cleanup.weight_lb,
        team: cleanup.team,
        location: {
          lat: cleanup.location_lat,
          lon: cleanup.location_lon,
        },
        route_points: cleanup.route_points ? JSON.parse(cleanup.route_points) : [],
        motion_log: cleanup.motion_log ? JSON.parse(cleanup.motion_log) : 'not recorded (pre-flight-recorder walk)',
        notes: cleanup.notes || 'N/A',
      };

      const exportText = JSON.stringify(exportData, null, 2);
      await Clipboard.setString(exportText);

      Alert.alert('✅ Exported', 'Cleanup data copied to clipboard!');
    } catch (error) {
      Alert.alert('❌ Error', 'Failed to export cleanup data');
      console.error('Export failed:', error);
    }
  };

  const deleteCleanup = (cleanup: any) => {
    Alert.alert(
      'Delete this cleanup?',
      `${formatDate(cleanup.timestamp)} · ${cleanup.items_count} items. This removes it from your stats and the community map. Cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDatabase();
              const ok = await db.deleteCleanup(cleanup.id);
              if (ok) {
                loadActivity();
              } else {
                Alert.alert('❌ Error', 'Failed to delete cleanup');
              }
            } catch (error) {
              Alert.alert('❌ Error', 'Failed to delete cleanup');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.subtitle}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const progressPercent = stats
    ? Math.min(100, (((stats.total_cleanups as number) || 0) / 50) * 100)
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Stats Overview */}
        <View style={styles.statsBox}>
          <Text style={styles.statsLabel}>Your Impact</Text>

          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{(stats?.total_cleanups as number) || 0}</Text>
              <Text style={styles.statLabel}>Cleanups</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {((stats?.total_weight as number) || 0).toFixed(1)}
              </Text>
              <Text style={styles.statLabel}>lbs</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{(stats?.cleanup_days as number) || 0}</Text>
              <Text style={styles.statLabel}>Days</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progressPercent}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {(stats?.total_cleanups as number) || 0} of 50 cleanups
            </Text>
          </View>
        </View>

        {/* Badges Section */}
        {badges && badges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🏆 Badges Earned ({badges.length})</Text>
            <View style={styles.badgesGrid}>
              {badges.map((badge, index) => (
                <View key={index} style={styles.badgeItem}>
                  <Text style={styles.badgeEmoji}>🏅</Text>
                  <Text style={styles.badgeName}>
                    {badge.badge_type.replace(/_/g, ' ')}
                  </Text>
                  <Text style={styles.badgeDate}>
                    {formatDate(badge.unlocked_at)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Recent Cleanups */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Cleanups</Text>

          {cleanups && cleanups.length > 0 ? (
            cleanups.map((cleanup, index) => (
              <View key={index} style={styles.cleanupCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cleanupDate}>
                    {formatDate(cleanup.timestamp)}
                  </Text>
                  <Text style={styles.detailText}>
                    {cleanup.items_count} items · {formatTime(cleanup.duration_seconds)} · {cleanup.weight_lb.toFixed(1)} lb
                  </Text>
                </View>
                <View style={styles.cleanupActions}>
                  <TouchableOpacity
                    style={styles.exportButton}
                    onPress={() => exportCleanup(cleanup)}
                  >
                    <Text style={styles.exportButtonText}>📤</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.exportButton}
                    onPress={() => deleteCleanup(cleanup)}
                  >
                    <Text style={styles.exportButtonText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noCleanups}>No cleanups logged yet. Start on the Map tab!</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    paddingBottom: 40,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  userName: {
    fontSize: 14,
    color: COLORS.mutedSage,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.mutedSage,
  },
  statsBox: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 28,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  statsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 52,
    fontWeight: '800',
    color: '#34C759',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.mutedSage,
    fontWeight: '600',
  },
  progressContainer: {
    marginTop: 16,
  },
  progressBar: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  progressText: {
    fontSize: 12,
    color: COLORS.mutedSage,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 12,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  badgeItem: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  badgeEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  badgeName: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.darkSage,
    textAlign: 'center',
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  badgeDate: {
    fontSize: 10,
    color: COLORS.mutedSage,
  },
  cleanupCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  cleanupActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  cleanupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cleanupDate: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
  },
  cleanupTeam: {
    fontSize: 12,
    color: COLORS.mutedSage,
    marginTop: 2,
  },
  cleanupStats: {
    alignItems: 'flex-end',
  },
  cleanupWeight: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34C759',
  },
  cleanupDetails: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailText: {
    fontSize: 12,
    color: COLORS.mutedSage,
  },
  noCleanups: {
    fontSize: 14,
    color: COLORS.mutedSage,
    textAlign: 'center',
    paddingVertical: 20,
    fontStyle: 'italic',
  },
  exportButton: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    backgroundColor: COLORS.light,
    borderRadius: 6,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
