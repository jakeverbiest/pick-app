import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAuthService } from '../../src/services/authService';
import { getDatabase } from '../../src/services/firebaseDatabase';
import { Icon, IconName } from '../../src/pick/Icon';
import { C, radius, shadow } from '../../src/pick/theme';
import { ProgressBar } from '../../src/pick/ui';

interface Challenge {
  id: string;
  name: string;
  description?: string;
  goal_type: 'pickups' | 'weight' | 'distance' | 'days';
  goal_value: number;
  status: string;
  start_date: number;
  end_date: number;
  participants: string[];
}

const GOAL_ICON: Record<string, IconName> = {
  pickups: 'bag',
  weight: 'leaf',
  distance: 'route',
  days: 'clock',
};

export default function GoalsScreen() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
      setCurrentUser(getAuthService().getCurrentUser());
      const active = await db.getChallenges('active');
      setChallenges(active as Challenge[]);
    } catch (error) {
      console.error('Failed to load challenges:', error);
    } finally {
      setLoading(false);
    }
  };

  const join = async (challengeId: string) => {
    if (!currentUser) {
      Alert.alert('Sign in required', 'You must be logged in to join a challenge.');
      return;
    }
    try {
      const db = await getDatabase();
      await db.joinChallenge(challengeId, currentUser.uid);
      loadChallenges();
    } catch (error) {
      Alert.alert('Error', 'Failed to join challenge');
      console.error('Failed to join challenge:', error);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.loading}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Goals</Text>
        <Text style={styles.sub}>Community challenges you can join.</Text>

        {challenges.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.empty}>No active challenges yet. Check back soon.</Text>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {challenges.map((c) => {
              const joined = c.participants?.includes(currentUser?.uid || '');
              const daysLeft = Math.max(0, Math.ceil((c.end_date - Date.now() / 1000) / 86400));
              const joinedCount = c.participants?.length || 0;
              const pct = Math.min(1, joinedCount / Math.max(c.goal_value, 5));
              return (
                <View key={c.id} style={styles.card}>
                  <View style={styles.headRow}>
                    <View style={styles.well}>
                      <Icon name={GOAL_ICON[c.goal_type] ?? 'flag'} size={22} color={C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{c.name}</Text>
                      {!!c.description && <Text style={styles.desc}>{c.description}</Text>}
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.progressText}>
                      Goal: <Text style={styles.progressStrong}>{c.goal_value.toLocaleString()}</Text> {c.goal_type} · {joinedCount} joined
                    </Text>
                    <View style={styles.daysPill}>
                      <Icon name="clock" size={12} color={C.warning} sw={1.8} />
                      <Text style={styles.daysText}>{daysLeft}d left</Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <ProgressBar pct={pct} height={8} />
                  </View>

                  <Pressable
                    disabled={joined}
                    style={({ pressed }) => [styles.joinBtn, joined ? styles.joinedBtn : styles.joinBtnIdle, pressed && !joined && { opacity: 0.9 }]}
                    onPress={() => join(c.id)}
                  >
                    {joined && <Icon name="check" size={16} color={C.primary} sw={2.2} />}
                    <Text style={[styles.joinText, joined ? styles.joinedText : styles.joinTextIdle]}>
                      {joined ? 'Joined' : 'Join challenge'}
                    </Text>
                  </Pressable>
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
  root: { flex: 1, backgroundColor: C.cream },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loading: { fontSize: 16, color: C.muted },

  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: C.dark },
  sub: { fontSize: 14, color: C.text3, marginTop: 4, marginBottom: 18 },

  card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, ...shadow.card },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  well: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, color: C.dark },
  desc: { fontSize: 12, color: C.muted, marginTop: 1 },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  progressText: { fontSize: 13, color: C.text2, fontWeight: '500', flex: 1 },
  progressStrong: { fontWeight: '700', color: C.dark },
  daysPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.warnBg, paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.pill },
  daysText: { color: C.warning, fontSize: 12, fontWeight: '700' },

  joinBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  joinBtnIdle: { backgroundColor: C.primary },
  joinedBtn: { backgroundColor: C.tint },
  joinText: { fontSize: 14, fontWeight: '700' },
  joinTextIdle: { color: '#fff' },
  joinedText: { color: C.primary },

  emptyCard: { backgroundColor: '#fff', borderRadius: radius.card, padding: 20, ...shadow.card },
  empty: { fontSize: 14, color: C.muted, textAlign: 'center' },
});
