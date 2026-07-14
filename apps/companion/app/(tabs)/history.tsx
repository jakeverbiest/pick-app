import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { getDatabase } from '../../src/services/database';
import { cleanupBags, formatBagsShort } from '../../src/services/impactMetrics';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';

const teamIcons: Record<string, string> = {
  solo: '👤',
  neighborhood: '👥',
  challenge: '🏁',
};

export default function HistoryScreen() {
  const [cleanups, setCleanups] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all'); // all, solo, neighborhood, challenge
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCleanups();
  }, [filter]);

  const loadCleanups = async () => {
    try {
      const db = await getDatabase();

      let data;
      if (filter === 'all') {
        data = await db.getCleanups(100);
      } else {
        data = await db.getCleanupsByTeam(filter, 100);
      }

      setCleanups(data);
    } catch (error) {
      console.error('Failed to load cleanups:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>📋 History</Text>
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
          <Text style={styles.title}>📋 Cleanup History</Text>
          <Text style={styles.subtitle}>{cleanups.length} cleanups logged</Text>
        </View>

        {/* Filter Buttons */}
        <View style={styles.filterButtons}>
          {['all', 'solo', 'neighborhood', 'challenge'].map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterButton, filter === f && styles.filterButtonActive]}
              onPress={() => setFilter(f)}
            >
              <Text
                style={[styles.filterButtonText, filter === f && styles.filterButtonTextActive]}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cleanup List */}
        {cleanups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No cleanups recorded yet.</Text>
            <Text style={styles.emptySubtext}>Start a cleanup session to see your history!</Text>
          </View>
        ) : (
          <View style={styles.cleanupList}>
            {cleanups.map((cleanup, index) => (
              <View key={cleanup.id} style={styles.cleanupCard}>
                {/* Date */}
                <View style={styles.cardHeader}>
                  <Text style={styles.dateText}>{formatDate(cleanup.timestamp)}</Text>
                  <View style={styles.teamBadge}>
                    <Text style={styles.teamIcon}>{teamIcons[cleanup.team] || '📍'}</Text>
                    <Text style={styles.teamLabel}>{cleanup.team}</Text>
                  </View>
                </View>

                {/* Stats Grid */}
                <View style={styles.statsRow}>
                  <View style={styles.statCell}>
                    <Text style={styles.statValue}>{cleanup.items_count}</Text>
                    <Text style={styles.statLabel}>Items</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statValue}>{formatBagsShort(cleanupBags(cleanup))}</Text>
                    <Text style={styles.statLabel}>Bags</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statValue}>{formatTime(cleanup.duration_seconds)}</Text>
                    <Text style={styles.statLabel}>Duration</Text>
                  </View>
                  {cleanup.bag_qty > 0 && (
                    <View style={styles.statCell}>
                      <Text style={styles.statValue}>{cleanup.bag_qty}</Text>
                      <Text style={styles.statLabel}>Bags</Text>
                    </View>
                  )}
                </View>

                {/* Location */}
                <View style={styles.cardFooter}>
                  <Text style={styles.locationIcon}>📍</Text>
                  <Text style={styles.locationText} numberOfLines={1}>
                    {cleanup.location_lat.toFixed(4)}, {cleanup.location_lon.toFixed(4)}
                  </Text>
                  {cleanup.fitness_tracked && <Text style={styles.fitnessIcon}>📱</Text>}
                </View>
              </View>
            ))}
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
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#999',
  },
  filterButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  filterButtonActive: {
    backgroundColor: COLORS.accent,
    borderColor: '#34C759',
  },
  filterButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#999',
  },
  cleanupList: {
    gap: 12,
  },
  cleanupCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  teamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.light,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  teamIcon: {
    fontSize: 12,
  },
  teamLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#666',
    textTransform: 'capitalize',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
    backgroundColor: COLORS.cream,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34C759',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: '#999',
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationIcon: {
    fontSize: 12,
  },
  locationText: {
    flex: 1,
    fontSize: 11,
    color: '#666',
    fontFamily: 'Courier',
  },
  fitnessIcon: {
    fontSize: 12,
  },
});
