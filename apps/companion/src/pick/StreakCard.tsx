/**
 * Streak + weekly-goal card for the Impact tab. Fetches the user's cleanup
 * history, computes their day-streak and this-week count, and nudges them to
 * keep it alive. Pure display — the actual reminder push rides on the
 * notification build later.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, ProgressBar } from './ui';
import { Icon } from './Icon';
import { C } from './theme';
import { getDatabase } from '../services/database';
import { computeStreak, type StreakInfo } from '../services/streaks';

const WEEKLY_GOAL = 3;

export function StreakCard() {
  const [info, setInfo] = useState<StreakInfo | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDatabase();
        const cleanups = await db.getCleanups(500);
        const ts = (cleanups || []).map((c: any) => c.timestamp).filter((n: any) => typeof n === 'number');
        setInfo(computeStreak(ts));
      } catch {
        setInfo({ current: 0, longest: 0, thisWeek: 0, activeToday: false });
      }
    })();
  }, []);

  if (!info) return null;

  const { current, longest, thisWeek, activeToday } = info;
  const nudge = activeToday
    ? 'You cleaned today — streak safe.'
    : current > 0
    ? 'Clean today to keep your streak going.'
    : 'Do a cleanup today to start a streak.';
  const goalMet = thisWeek >= WEEKLY_GOAL;

  return (
    <Card style={{ marginTop: 12 }}>
      <View style={styles.top}>
        <View style={styles.well}>
          <Icon name="bolt" size={22} color={C.primary} sw={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.streakNum}>
            {current} <Text style={styles.streakUnit}>{current === 1 ? 'day' : 'days'}</Text>
          </Text>
          <Text style={styles.streakLabel}>current streak</Text>
        </View>
        {longest > 0 && (
          <View style={styles.bestPill}>
            <Text style={styles.bestText}>best {longest}</Text>
          </View>
        )}
      </View>

      <Text style={styles.nudge}>{nudge}</Text>

      <View style={styles.divider} />

      <View style={styles.goalRow}>
        <Text style={styles.goalLabel}>This week</Text>
        <Text style={[styles.goalCount, goalMet && { color: C.accent }]}>
          {thisWeek} / {WEEKLY_GOAL}{goalMet ? ' · goal met' : ''}
        </Text>
      </View>
      <ProgressBar pct={Math.max(0.01, Math.min(1, thisWeek / WEEKLY_GOAL))} height={8} />
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  well: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  streakNum: { fontSize: 26, fontWeight: '800', color: C.dark, letterSpacing: -0.5 },
  streakUnit: { fontSize: 15, fontWeight: '600', color: C.muted },
  streakLabel: { fontSize: 13, color: C.text3, marginTop: 1 },
  bestPill: { backgroundColor: C.tint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  bestText: { fontSize: 12, fontWeight: '700', color: C.primary },
  nudge: { fontSize: 13.5, color: C.text3, marginTop: 12, lineHeight: 18 },
  divider: { height: 1, backgroundColor: C.border2, marginVertical: 14 },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  goalLabel: { fontSize: 14, fontWeight: '600', color: C.dark },
  goalCount: { fontSize: 13, fontWeight: '700', color: C.muted },
});
