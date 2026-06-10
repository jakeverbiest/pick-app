import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getDatabase } from '../../src/services/firebaseDatabase';
import { getAuthService } from '../../src/services/simpleAuthService';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';

interface Challenge {
  id: string;
  name: string;
  description?: string;
  goal_type: 'pickups' | 'weight' | 'distance' | 'days';
  goal_value: number;
  status: 'active' | 'completed' | 'upcoming';
  start_date: number;
  end_date: number;
  participants: string[];
}

interface Post {
  id: string;
  user: string;
  image?: string;
  caption: string;
  weight?: number;
  timestamp: number;
  likes: number;
}

export default function CommunityScreen() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    loadChallenges();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadChallenges();
    }, [])
  );

  const loadChallenges = async () => {
    try {
      setLoading(true);
      const db = await getDatabase();
      const authService = getAuthService();
      const user = authService.getCurrentUser();
      setCurrentUser(user);

      const activeChallenges = await db.getChallenges('active');
      setChallenges(activeChallenges);
    } catch (error) {
      console.error('Failed to load challenges:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinChallenge = async (challengeId: string) => {
    try {
      if (!currentUser) {
        Alert.alert('Error', 'You must be logged in to join a challenge');
        return;
      }

      const db = await getDatabase();
      await db.joinChallenge(challengeId, currentUser.uid);
      Alert.alert('✅ Joined', 'You\'ve successfully joined the challenge!');
      loadChallenges();
    } catch (error) {
      Alert.alert('Error', 'Failed to join challenge');
      console.error('Failed to join challenge:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (timestamp: number) => {
    const hours = Math.floor((Date.now() - timestamp) / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>🎯 Challenges</Text>
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
          <Text style={styles.title}>🎯 Active Challenges</Text>
          <Text style={styles.subtitle}>Join teams and earn badges</Text>
        </View>

        {/* Challenges Section */}
        {challenges.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No active challenges yet. Check back soon!</Text>
          </View>
        ) : (
          <View style={styles.section}>
            {challenges.map((challenge) => {
              const isJoined = challenge.participants.includes(currentUser?.uid || '');
              const daysLeft = Math.ceil((challenge.end_date - Date.now() / 1000) / 86400);

              const goalIcon = {
                pickups: '🧹',
                weight: '⚖️',
                distance: '📍',
                days: '📅',
              }[challenge.goal_type] || '🎯';

              return (
                <View key={challenge.id} style={styles.challengeCard}>
                  <View style={styles.challengeHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.challengeName}>{goalIcon} {challenge.name}</Text>
                      <Text style={styles.challengeDescription}>{challenge.description}</Text>
                    </View>
                    <View style={styles.challengeStatus}>
                      <Text style={styles.daysLeft}>{daysLeft} days</Text>
                    </View>
                  </View>

                  <View style={styles.challengeGoal}>
                    <View style={styles.goalBar}>
                      <View
                        style={[
                          styles.goalFill,
                          { width: `${Math.min(100, (challenge.participants.length / Math.max(challenge.goal_value, 5)) * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.goalText}>
                      Goal: {challenge.goal_value} {challenge.goal_type} •{' '}
                      {challenge.participants.length} joined
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.joinButton, isJoined && styles.joinedButton]}
                    onPress={() => handleJoinChallenge(challenge.id)}
                    disabled={isJoined}
                  >
                    <Text style={[styles.joinButtonText, isJoined && styles.joinedButtonText]}>
                      {isJoined ? '✓ Joined' : '+ Join Challenge'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
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
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mutedSage,
  },
  section: {
    marginBottom: 24,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  challengeCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  challengeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  challengeName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  challengeDescription: {
    fontSize: 13,
    color: COLORS.mutedSage,
  },
  challengeStatus: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 70,
    alignItems: 'center',
  },
  daysLeft: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  challengeGoal: {
    marginBottom: 12,
  },
  goalBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  goalFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  goalText: {
    fontSize: 12,
    color: COLORS.mutedSage,
    fontWeight: '500',
  },
  joinButton: {
    backgroundColor: COLORS.sage,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  joinedButton: {
    backgroundColor: '#e0e0e0',
  },
  joinButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  joinedButtonText: {
    color: COLORS.mutedSage,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkSage,
  },
  shareButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  shareButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  viewMoreText: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '600',
  },
  announcementCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  announcementIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  announcementContent: {
    flex: 1,
  },
  announcementTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  announcementMessage: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    marginBottom: 4,
  },
  announcementTime: {
    fontSize: 11,
    color: '#999',
  },
  postCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  postHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  postUser: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
  },
  postTime: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  weightBadge: {
    backgroundColor: COLORS.light,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  weightText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#34C759',
  },
  postImage: {
    height: 200,
    backgroundColor: COLORS.light,
    borderRadius: 8,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
  },
  placeholderText: {
    fontSize: 32,
  },
  postCaption: {
    fontSize: 13,
    color: COLORS.darkSage,
    lineHeight: 18,
    marginBottom: 8,
  },
  postActions: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  actionButton: {
    flex: 1,
  },
  actionText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptyButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  emptyButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  leaderboardBox: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  leaderboardRank: {
    fontSize: 20,
    marginRight: 12,
    minWidth: 30,
  },
  leaderboardInfo: {
    flex: 1,
  },
  leaderboardName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
  },
  leaderboardStat: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  leaderboardBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#34C759',
  },
});
