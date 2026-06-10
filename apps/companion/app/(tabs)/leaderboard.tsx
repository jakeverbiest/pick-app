import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getDatabase } from '../../src/services/firebaseDatabase';
import { getAuthService } from '../../src/services/authService';
import { weightToBags, formatBags } from '../../src/services/impactMetrics';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';

type SortMetric = 'pickups' | 'weight' | 'days';

const medals = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const [metric, setMetric] = useState<SortMetric>('pickups');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [userTeam, setUserTeam] = useState<string>('solo');
  const [userTeamRank, setUserTeamRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeaderboard();
  }, [metric]);

  useFocusEffect(
    useCallback(() => {
      loadLeaderboard();
    }, [metric])
  );

  const loadLeaderboard = async () => {
    try {
      setLoading(true);
      const db = await getDatabase();
      const authService = getAuthService();
      const currentUser = authService.getCurrentUser();

      let userTeamName = 'solo';

      // Get user's team
      if (currentUser) {
        const settings = await db.getUserSettings(currentUser.uid);
        if (settings?.team_name) {
          userTeamName = settings.team_name;
          setUserTeam(userTeamName);
        }
      }

      // Get leaderboard
      const leaderboardData = await db.getLeaderboard();
      setLeaderboard(leaderboardData);

      // Find user's team rank
      if (currentUser) {
        const rank = leaderboardData.findIndex((t) => t.team === userTeamName);
        setUserTeamRank(rank >= 0 ? rank + 1 : null);
      }

      setLoading(false);
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
      setLoading(false);
    }
  };

  const formatMetricValue = (entry: any) => {
    switch (metric) {
      case 'pickups':
        return entry.total_pickups.toString();
      case 'weight':
        return formatBags(weightToBags(entry.total_weight as number));
      case 'days':
        return entry.total_days.toString();
      default:
        return '—';
    }
  };

  const metricLabel = {
    pickups: 'Pickups',
    weight: 'Bags',
    days: 'Active Days',
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>🏆 Team Leaderboard</Text>
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
          <Text style={styles.title}>🏆 Team Leaderboard</Text>
          <Text style={styles.subtitle}>Top teams by {metricLabel[metric].toLowerCase()}</Text>
        </View>

        {/* Metric Selector */}
        <View style={styles.metricButtons}>
          {(['pickups', 'weight', 'days'] as SortMetric[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.metricButton, metric === m && styles.metricButtonActive]}
              onPress={() => setMetric(m)}
            >
              <Text
                style={[styles.metricButtonText, metric === m && styles.metricButtonTextActive]}
              >
                {metricLabel[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Leaderboard List */}
        {leaderboard.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No teams yet. Join a team and start cleaning!</Text>
          </View>
        ) : (
          <View style={styles.leaderboardList}>
            {leaderboard.map((entry, index) => {
              const isUserTeam = entry.team === userTeam;
              const medal = index < 3 ? medals[index] : `#${index + 1}`;

              return (
                <View
                  key={entry.team}
                  style={[styles.leaderboardItem, isUserTeam && styles.leaderboardItemHighlight]}
                >
                  <View style={styles.rankSection}>
                    <Text style={styles.medal}>{medal}</Text>
                  </View>

                  <View style={styles.userSection}>
                    <Text style={styles.userName}>
                      {entry.team} {isUserTeam ? '(Your Team)' : ''}
                    </Text>
                    <Text style={styles.userMeta}>
                      {entry.member_count} members • {entry.total_cleanups} cleanups
                    </Text>
                  </View>

                  <View style={styles.valueSection}>
                    <Text style={styles.value}>{formatMetricValue(entry)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Your Team Rank Info */}
        {userTeamRank && leaderboard.length > 0 && (
          <View style={styles.yourRankBox}>
            <Text style={styles.yourRankLabel}>Your Team's Rank</Text>
            <Text style={styles.yourRankValue}>#{userTeamRank}</Text>
            <Text style={styles.yourRankMeta}>
              {leaderboard.length} teams tracked
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
  metricButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  metricButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  metricButtonActive: {
    backgroundColor: COLORS.accent,
    borderColor: '#007AFF',
  },
  metricButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  metricButtonTextActive: {
    color: '#fff',
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
  },
  leaderboardList: {
    marginBottom: 20,
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  leaderboardItemHighlight: {
    backgroundColor: COLORS.light,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  rankSection: {
    width: 50,
    alignItems: 'center',
  },
  medal: {
    fontSize: 24,
  },
  userSection: {
    flex: 1,
    marginLeft: 8,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  userMeta: {
    fontSize: 11,
    color: '#999',
  },
  valueSection: {
    alignItems: 'flex-end',
    minWidth: 60,
  },
  value: {
    fontSize: 15,
    fontWeight: '700',
    color: '#007AFF',
  },
  yourRankBox: {
    backgroundColor: COLORS.light,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  yourRankLabel: {
    fontSize: 12,
    color: '#558B2F',
    fontWeight: '600',
    marginBottom: 4,
  },
  yourRankValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#34C759',
    marginBottom: 4,
  },
  yourRankMeta: {
    fontSize: 11,
    color: '#999',
  },
});
