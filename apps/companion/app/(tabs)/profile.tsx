import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getBadgeService } from '../../src/services/badgeService';
import { formatBags, formatBagsShort } from '../../src/services/impactMetrics';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';

export default function ProfileScreen() {
  const [stats, setStats] = useState<any>(null);
  const [badges, setBadges] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfileData();
  }, []);

  const loadProfileData = async () => {
    try {
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();
      setUser(currentUser);

      if (currentUser) {
        const db = await getDatabase();
        const cleanupStats = await db.getCleanupStats();
        setStats(cleanupStats);

        const badgeService = getBadgeService();
        const userBadges = await badgeService.getUserBadges(currentUser.uid);
        setBadges(userBadges);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>👤 Profile</Text>
          <Text style={styles.subtitle}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>👤 {user?.displayName || 'Picker'}</Text>
          <Text style={styles.zone}>{user?.neighborhood || 'My Zone'}</Text>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.total_cleanups || 0}</Text>
            <Text style={styles.statLabel}>Cleanups</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{(stats?.total_pickups || 0) as number}</Text>
            <Text style={styles.statLabel}>Pickups</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{badges.length}</Text>
            <Text style={styles.statLabel}>Badges</Text>
          </View>
        </View>

        {/* Detailed Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 Statistics</Text>
          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Bags Collected</Text>
            <Text style={styles.statRowValue}>
              {formatBags((stats?.total_bags || 0) as number)}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Total Pickups</Text>
            <Text style={styles.statRowValue}>
              {(stats?.total_pickups || 0) as number}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Total Time</Text>
            <Text style={styles.statRowValue}>
              {Math.floor(((stats?.total_time || 0) as number) / 3600)}h{' '}
              {Math.floor((((stats?.total_time || 0) as number) % 3600) / 60)}m
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statRowLabel}>Cleanup Days</Text>
            <Text style={styles.statRowValue}>{stats?.cleanup_days || 0} days</Text>
          </View>
        </View>

        {/* Badges */}
        {badges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🏆 Badges ({badges.length})</Text>
            <View style={styles.badgesGrid}>
              {badges.map((badge) => (
                <View key={badge.id} style={styles.badgeItem}>
                  <Text style={styles.badgeIcon}>{badge.definition?.icon}</Text>
                  <Text style={styles.badgeName}>{badge.definition?.name}</Text>
                  <Text style={styles.badgeDesc} numberOfLines={2}>
                    {badge.definition?.description}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {badges.length === 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🏆 Badges</Text>
            <Text style={styles.emptyText}>
              No badges yet. Keep cleaning to unlock achievements!
            </Text>
          </View>
        )}
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
    color: '#333',
    marginBottom: 4,
  },
  zone: {
    fontSize: 14,
    color: '#999',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#34C759',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  statRowLabel: {
    fontSize: 13,
    color: '#666',
  },
  statRowValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  badgeItem: {
    width: '48%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  badgeIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  badgeName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  badgeDesc: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
    lineHeight: 14,
  },
  emptyText: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});
