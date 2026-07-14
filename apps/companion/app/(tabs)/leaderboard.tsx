import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAuthService } from '../../src/services/authService';
import { getDatabase } from '../../src/services/firebaseDatabase';
import type { UserStats, Challenge } from '../../src/services/firebaseDatabase';
import { formatBags, itemsToBags, aggregateBags } from '../../src/services/impactMetrics';
import { Icon, IconName } from '../../src/pick/Icon';
import { C, radius, shadow } from '../../src/pick/theme';
import { ProgressBar } from '../../src/pick/ui';

type Board = 'you' | 'teams' | 'challenges';
type SortMetric = 'pickups' | 'bags' | 'days';

const BOARDS: { key: Board; label: string }[] = [
  { key: 'you', label: 'You' },
  { key: 'teams', label: 'Teams' },
  { key: 'challenges', label: 'Challenges' },
];

const METRICS: { key: SortMetric; label: string; unit: string }[] = [
  { key: 'pickups', label: 'Pickups', unit: 'pickups' },
  { key: 'bags', label: 'Bags', unit: 'bags' },
  { key: 'days', label: 'Active days', unit: 'days' },
];

const GOAL_ICON: Record<string, IconName> = {
  pickups: 'bag',
  weight: 'leaf',
  distance: 'route',
  days: 'clock',
};

type Personal = { pickups: number; bags: number; days: number; cleanups: number };

export default function LeaderboardScreen() {
  const [board, setBoard] = useState<Board>('you');
  const [metric, setMetric] = useState<SortMetric>('pickups');
  const [teams, setTeams] = useState<any[]>([]);
  const [individuals, setIndividuals] = useState<UserStats[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [userTeam, setUserTeam] = useState<string>('solo');
  const [me, setMe] = useState<{ uid: string; hidden: boolean } | null>(null);
  const [personal, setPersonal] = useState<Personal>({ pickups: 0, bags: 0, days: 0, cleanups: 0 });
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const db = await getDatabase();
      const currentUser = getAuthService().getCurrentUser();
      if (currentUser) {
        const settings = await db.getUserSettings(currentUser.uid);
        setUserTeam(settings?.team_name || 'solo');
        setMe({ uid: currentUser.uid, hidden: !!settings?.leaderboard_hidden });
        // Write this account's public stats doc and WAIT for it, so the
        // individual board read below includes the current user on first open
        // (a fire-and-forget write here races the read and omits you).
        await db.updateUserStats(currentUser.uid);
      }
      const mine = await db.getCleanups(1000);
      setPersonal({
        pickups: mine.reduce((s, c) => s + (c.items_count || 0), 0),
        bags: aggregateBags(mine),
        days: new Set(mine.map((c) => new Date((c.timestamp || 0) * 1000).toDateString())).size,
        cleanups: mine.length,
      });
      const [indiv, teamData, active] = await Promise.all([
        db.getIndividualLeaderboard(metric),
        db.getTeamLeaderboard(),
        db.getChallenges('active'),
      ]);
      setIndividuals(indiv || []);
      setTeams(teamData || []);
      setChallenges((active as Challenge[]) || []);
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const joinChallenge = async (challengeId: string) => {
    if (!me) {
      Alert.alert('Sign in required', 'You must be logged in to join a challenge.');
      return;
    }
    try {
      const db = await getDatabase();
      await db.joinChallenge(challengeId, me.uid);
      load();
    } catch (error) {
      Alert.alert('Error', 'Failed to join challenge');
      console.error('Failed to join challenge:', error);
    }
  };

  const unit = METRICS.find((m) => m.key === metric)!.unit;

  const userValue = (u: UserStats): number =>
    metric === 'pickups' ? u.total_pickups || 0
    : metric === 'bags' ? (u.total_bags ?? itemsToBags(u.total_pickups || 0))
    : u.active_days || 0;
  const teamValue = (t: any): number =>
    metric === 'pickups' ? t.total_pickups || 0
    : metric === 'bags' ? (t.total_bags ?? itemsToBags(t.total_pickups || 0))
    : t.total_days || 0;
  const show = (v: number): string => (metric === 'bags' ? formatBags(v) : String(v));

  const indivRanked = [...individuals].sort((a, b) => userValue(b) - userValue(a));
  const myIndex = me && !me.hidden ? indivRanked.findIndex((u) => u.uid === me.uid) : -1;
  const myRank = myIndex >= 0 ? myIndex + 1 : null;

  const isSolo = !userTeam || userTeam.toLowerCase() === 'solo';
  const teamRanked = [...teams]
    .filter((t) => (t.team || '').toLowerCase() !== 'solo')
    .sort((a, b) => teamValue(b) - teamValue(a));
  const teamIndex = isSolo ? -1 : teamRanked.findIndex((t) => t.team === userTeam);
  const teamRank = teamIndex >= 0 ? teamIndex + 1 : null;
  const teamGap = teamIndex > 0 ? teamValue(teamRanked[teamIndex - 1]) - teamValue(teamRanked[teamIndex]) : 0;

  const personalShown = metric === 'bags' ? formatBags(personal.bags) : metric === 'days' ? String(personal.days) : String(personal.pickups);

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
        <Text style={styles.h1}>Leaderboard</Text>
        <Text style={styles.sub}>Your impact, your team, the challenges.</Text>

        {/* board switch: You · Teams · Challenges */}
        <View style={styles.segment}>
          {BOARDS.map((b) => {
            const active = board === b.key;
            return (
              <Pressable key={b.key} style={[styles.segBtn, active && styles.segBtnActive]} onPress={() => setBoard(b.key)}>
                <Text style={[styles.segText, active && styles.segTextActive]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* metric switch — only for the ranked boards */}
        {board !== 'challenges' && (
          <View style={[styles.segment, styles.metricSegment]}>
            {METRICS.map((m) => {
              const active = metric === m.key;
              return (
                <Pressable key={m.key} style={[styles.segBtnSm, active && styles.segBtnActive]} onPress={() => setMetric(m.key)}>
                  <Text style={[styles.segTextSm, active && styles.segTextActive]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ============================ YOU ============================ */}
        {board === 'you' && (
          <View style={{ marginTop: 16 }}>
            <View style={styles.personalCard}>
              <View style={styles.personalTop}>
                <Icon name="activity" size={20} color={C.primary} sw={1.8} />
                <Text style={styles.personalLabel}>Your impact</Text>
              </View>
              <Text style={styles.personalValue}>
                {personalShown} <Text style={styles.personalUnit}>{unit}</Text>
              </Text>
              <Text style={styles.personalSub}>
                {me?.hidden
                  ? "You're hidden from the leaderboard — only you can see this."
                  : myRank
                    ? `Ranked #${myRank} of ${indivRanked.length} ${indivRanked.length === 1 ? 'picker' : 'pickers'}`
                    : `${personal.cleanups} cleanup${personal.cleanups === 1 ? '' : 's'} logged`}
              </Text>
              {me?.hidden && (
                <Pressable style={styles.joinBtn} onPress={() => router.push('/(tabs)/settings')}>
                  <Text style={styles.joinBtnText}>Show me on the leaderboard</Text>
                </Pressable>
              )}
            </View>

            {indivRanked.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>The leaderboard is just getting started. Log a cleanup to appear here.</Text>
              </View>
            ) : (
              <View style={{ gap: 10, marginTop: 14 }}>
                {indivRanked.map((u, i) => {
                  const you = me && u.uid === me.uid;
                  const top = i < 3;
                  return (
                    <View key={u.uid} style={[styles.row, you && styles.rowYou]}>
                      <View style={[styles.rank, top ? styles.rankTop : styles.rankPlain]}>
                        <Text style={[styles.rankText, top && { color: '#fff' }]}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.teamName} numberOfLines={1}>
                          {u.display_name || 'Picker'}
                          {you ? '  ·  You' : ''}
                        </Text>
                        <Text style={styles.teamMembers}>{u.team || 'Solo'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.value}>{show(userValue(u))}</Text>
                        <Text style={styles.unit}>{unit}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ============================ TEAMS ============================ */}
        {board === 'teams' && (
          <View style={{ marginTop: 16 }}>
            {teamRanked.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No teams yet — be the first to start one.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {teamRanked.map((entry, i) => {
                  const you = entry.team === userTeam;
                  const top = i < 3;
                  return (
                    <View key={entry.team} style={[styles.row, you && styles.rowYou]}>
                      <View style={[styles.rank, top ? styles.rankTop : styles.rankPlain]}>
                        <Text style={[styles.rankText, top && { color: '#fff' }]}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.teamName} numberOfLines={1}>
                          {entry.team}
                          {you ? '  ·  You' : ''}
                        </Text>
                        <Text style={styles.teamMembers}>
                          {entry.member_count} members · {entry.total_cleanups} cleanups
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.value}>{show(teamValue(entry))}</Text>
                        <Text style={styles.unit}>{unit}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {isSolo ? (
              <View style={styles.callout}>
                <Icon name="trophy" size={26} color={C.primary} sw={1.7} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.calloutTitle}>You're flying solo</Text>
                  <Text style={styles.calloutSub}>Join a team to climb the team board.</Text>
                </View>
                <Pressable style={styles.calloutBtn} onPress={() => router.push('/(tabs)/settings')}>
                  <Text style={styles.calloutBtnText}>Join</Text>
                </Pressable>
              </View>
            ) : teamRank ? (
              <View style={styles.callout}>
                <Icon name="trophy" size={26} color={C.primary} sw={1.7} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.calloutTitle}>{userTeam} is #{teamRank}</Text>
                  <Text style={styles.calloutSub}>
                    {teamRank === 1 ? "You're in the lead — keep it up." : `${teamGap.toLocaleString()} ${unit} from the next spot.`}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* ========================= CHALLENGES ========================= */}
        {board === 'challenges' && (
          <View style={{ marginTop: 16 }}>
            {challenges.length === 0 ? (
              <View style={styles.chEmptyCard}>
                <Text style={styles.emptyText}>No active challenges yet. Check back soon.</Text>
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                {challenges.map((c) => {
                  const joined = c.participants?.includes(me?.uid || '');
                  const daysLeft = Math.max(0, Math.ceil((c.end_date - Date.now() / 1000) / 86400));
                  const joinedCount = c.participants?.length || 0;
                  const pct = Math.min(1, joinedCount / Math.max(c.goal_value, 5));
                  return (
                    <View key={c.id} style={styles.chCard}>
                      <View style={styles.chHeadRow}>
                        <View style={styles.chWell}>
                          <Icon name={GOAL_ICON[c.goal_type] ?? 'flag'} size={22} color={C.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.chName}>{c.name}</Text>
                          {!!c.description && <Text style={styles.chDesc}>{c.description}</Text>}
                        </View>
                      </View>

                      <View style={styles.chMetaRow}>
                        <Text style={styles.chProgressText}>
                          Goal: <Text style={styles.chProgressStrong}>{c.goal_value.toLocaleString()}</Text> {c.goal_type} · {joinedCount} joined
                        </Text>
                        <View style={styles.chDaysPill}>
                          <Icon name="clock" size={12} color={C.warning} sw={1.8} />
                          <Text style={styles.chDaysText}>{daysLeft}d left</Text>
                        </View>
                      </View>

                      <View style={{ marginTop: 12 }}>
                        <ProgressBar pct={pct} height={8} />
                      </View>

                      <Pressable
                        disabled={joined}
                        style={({ pressed }) => [styles.chJoinBtn, joined ? styles.chJoinedBtn : styles.chJoinBtnIdle, pressed && !joined && { opacity: 0.9 }]}
                        onPress={() => joinChallenge(c.id)}
                      >
                        {joined && <Icon name="check" size={16} color={C.primary} sw={2.2} />}
                        <Text style={[styles.chJoinText, joined ? styles.chJoinedText : styles.chJoinTextIdle]}>
                          {joined ? 'Joined' : 'Join challenge'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
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

  segment: { flexDirection: 'row', gap: 6, backgroundColor: '#EAEBE4', borderRadius: 12, padding: 4 },
  metricSegment: { marginTop: 10 },
  segBtn: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: 'center' },
  segBtnSm: { flex: 1, borderRadius: 8, paddingVertical: 7, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#fff', ...shadow.card },
  segText: { fontSize: 13, fontWeight: '700', color: C.muted },
  segTextSm: { fontSize: 12, fontWeight: '600', color: C.muted },
  segTextActive: { color: C.primary },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 15,
    ...shadow.card,
  },
  rowYou: { borderLeftWidth: 4, borderLeftColor: C.accent },
  rank: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rankTop: { backgroundColor: C.primary },
  rankPlain: { backgroundColor: C.tint },
  rankText: { fontSize: 14, fontWeight: '700', color: C.primary },
  teamName: { fontSize: 15, fontWeight: '700', color: C.dark },
  teamMembers: { fontSize: 12, color: C.muted, marginTop: 1 },
  value: { fontSize: 17, fontWeight: '700', color: C.primary },
  unit: { fontSize: 11, color: C.muted, fontWeight: '600' },

  callout: { backgroundColor: C.tint, borderRadius: radius.card, padding: 16, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  calloutTitle: { fontSize: 14, fontWeight: '700', color: C.dark },
  calloutSub: { fontSize: 12, color: C.text2, marginTop: 2 },
  calloutBtn: { backgroundColor: C.primary, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 14 },
  calloutBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, color: C.muted, textAlign: 'center' },

  personalCard: {
    backgroundColor: '#fff',
    borderRadius: radius.card,
    padding: 18,
    borderLeftWidth: 4,
    borderLeftColor: C.accent,
    ...shadow.card,
  },
  personalTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  personalLabel: { fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  personalValue: { fontSize: 30, fontWeight: '700', color: C.primary, letterSpacing: -0.5 },
  personalUnit: { fontSize: 14, fontWeight: '600', color: C.muted },
  personalSub: { fontSize: 13, color: C.text2, marginTop: 4 },
  joinBtn: { marginTop: 14, backgroundColor: C.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  joinBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // challenges
  chCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, ...shadow.card },
  chHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  chWell: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  chName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, color: C.dark },
  chDesc: { fontSize: 12, color: C.muted, marginTop: 1 },
  chMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  chProgressText: { fontSize: 13, color: C.text2, fontWeight: '500', flex: 1 },
  chProgressStrong: { fontWeight: '700', color: C.dark },
  chDaysPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.warnBg, paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.pill },
  chDaysText: { color: C.warning, fontSize: 12, fontWeight: '700' },
  chJoinBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  chJoinBtnIdle: { backgroundColor: C.primary },
  chJoinedBtn: { backgroundColor: C.tint },
  chJoinText: { fontSize: 14, fontWeight: '700' },
  chJoinTextIdle: { color: '#fff' },
  chJoinedText: { color: C.primary },
  chEmptyCard: { backgroundColor: '#fff', borderRadius: radius.card, padding: 20, ...shadow.card },
});
