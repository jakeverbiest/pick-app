/**
 * Streak + weekly-goal card for the Impact tab. Fetches the user's cleanup
 * history, computes their day-streak and this-week count, and nudges them to
 * keep it alive.
 *
 * The weekly goal is the user's own (Settings, or tap the "This week" row here)
 * — it used to be a hardcoded 3 with no way to change it, so "goal met" read
 * like the app had picked the target for them. Changing it here also re-arms
 * the local end-of-week reminder.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, ProgressBar } from './ui';
import { Icon } from './Icon';
import { C, Fonts, radius } from './theme';
import { getDatabase } from '../services/database';
import { computeStreak, type StreakInfo } from '../services/streaks';
import {
  getWeeklyGoal,
  setWeeklyGoal,
  syncWeeklyGoalReminder,
  WEEKLY_GOAL_CHOICES,
  DEFAULT_WEEKLY_GOAL,
} from '../services/weeklyGoal';

export function StreakCard({ onGoalChange }: { onGoalChange?: (goal: number) => void }) {
  const [info, setInfo] = useState<StreakInfo | null>(null);
  const [goal, setGoal] = useState<number>(DEFAULT_WEEKLY_GOAL);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    (async () => {
      const g = await getWeeklyGoal();
      setGoal(g);
      try {
        const db = await getDatabase();
        const cleanups = await db.getCleanups(500);
        const ts = (cleanups || []).map((c: any) => c.timestamp).filter((n: any) => typeof n === 'number');
        const next = computeStreak(ts);
        setInfo(next);
        syncWeeklyGoalReminder({ done: next.thisCalendarWeek, goal: g });
      } catch {
        setInfo({ current: 0, longest: 0, thisWeek: 0, thisCalendarWeek: 0, daysLeftInWeek: 7, activeToday: false });
      }
    })();
  }, []);

  const chooseGoal = useCallback(
    async (g: number) => {
      const saved = await setWeeklyGoal(g);
      setGoal(saved);
      setPicking(false);
      onGoalChange?.(saved);
      if (info) syncWeeklyGoalReminder({ done: info.thisCalendarWeek, goal: saved });
    },
    [info, onGoalChange]
  );

  if (!info) return null;

  const { current, longest, thisCalendarWeek, daysLeftInWeek, activeToday } = info;
  const remaining = Math.max(0, goal - thisCalendarWeek);
  const goalMet = remaining === 0;

  const nudge = goalMet
    ? `Weekly goal hit — ${thisCalendarWeek} cleanup${thisCalendarWeek === 1 ? '' : 's'} this week.`
    : activeToday
    ? 'You cleaned today — streak safe.'
    : current > 0
    ? 'Clean today to keep your streak going.'
    : 'Do a cleanup today to start a streak.';

  // Only warn when the week is actually running out on them.
  const atRisk = !goalMet && remaining >= daysLeftInWeek;

  return (
    <>
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

        <Pressable style={styles.goalRow} onPress={() => setPicking(true)} hitSlop={8}>
          <View style={styles.goalLabelWrap}>
            <Text style={styles.goalLabel}>This week</Text>
            <Icon name="chevron" size={13} color={C.muted} sw={2} />
          </View>
          <Text style={[styles.goalCount, goalMet && { color: C.accent }]} numberOfLines={1}>
            {thisCalendarWeek} / {goal}
            {goalMet ? ' · goal met' : ''}
          </Text>
        </Pressable>
        <ProgressBar pct={Math.max(0.01, Math.min(1, thisCalendarWeek / goal))} height={8} color="green" />
        <Text style={styles.goalHint}>
          {goalMet
            ? 'Tap to raise your goal.'
            : atRisk
            ? `${remaining} to go and ${daysLeftInWeek} day${daysLeftInWeek === 1 ? '' : 's'} left — we'll remind you.`
            : `${remaining} to go · tap to change your goal`}
        </Text>
      </Card>

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.overlay} onPress={() => setPicking(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Weekly goal</Text>
            <Text style={styles.sheetSub}>How many cleanups do you want to do each week?</Text>
            <View style={styles.choices}>
              {WEEKLY_GOAL_CHOICES.map((g) => {
                const on = g === goal;
                return (
                  <Pressable key={g} style={[styles.choice, on && styles.choiceOn]} onPress={() => chooseGoal(g)}>
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{g}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.sheetFoot}>
              We'll send one reminder on the weekend if you're short — nothing else.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  well: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  streakNum: { fontFamily: Fonts.displayBold, fontSize: 26, color: C.dark, letterSpacing: -0.5 },
  streakUnit: { fontFamily: Fonts.bodySemibold, fontSize: 15, color: C.muted },
  streakLabel: { fontSize: 13, color: C.text3, marginTop: 1 },
  bestPill: { backgroundColor: C.tint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  bestText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: C.primary },
  nudge: { fontSize: 13.5, color: C.text3, marginTop: 12, lineHeight: 18 },
  divider: { height: 1, backgroundColor: C.border2, marginVertical: 14 },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
  goalLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  goalLabel: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: C.dark },
  goalCount: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.muted, flexShrink: 1 },
  goalHint: { fontSize: 12, color: C.muted, marginTop: 8 },

  overlay: { flex: 1, backgroundColor: 'rgba(27,46,26,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: { width: '100%', backgroundColor: C.cream, borderRadius: 22, padding: 22 },
  sheetTitle: { fontFamily: Fonts.headlineBold, fontSize: 19, color: C.dark },
  sheetSub: { fontSize: 13, color: C.text3, marginTop: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  choice: {
    minWidth: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.border3,
    alignItems: 'center',
  },
  choiceOn: { backgroundColor: C.primary, borderColor: C.primary },
  choiceText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: C.dark },
  choiceTextOn: { color: '#fff' },
  sheetFoot: { fontSize: 11.5, color: C.muted, marginTop: 16, lineHeight: 16 },
});
