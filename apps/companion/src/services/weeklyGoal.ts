/**
 * The weekly cleanup goal — the number behind "This week 2 / 3 · goal met" on
 * the Impact tab.
 *
 * Before this it was a hardcoded constant with no way to change it, which made
 * "goal met" read like the app had decided on the user's behalf. Now it's a
 * per-user setting, editable from Settings or by tapping the streak card.
 *
 * Storage: AsyncStorage is the fast local source of truth (the card renders
 * before any network call resolves); the value is mirrored into the user's
 * Firestore settings doc so it follows them to a new device.
 *
 * Reminders are LOCAL notifications computed on-device — no server, no push
 * token needed, and nothing fires if the user has never granted permission.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

const KEY = '@pick_weekly_goal_v1';

export const DEFAULT_WEEKLY_GOAL = 3;
/** The values offered in the picker. Small numbers only — this is a habit, not a quota. */
export const WEEKLY_GOAL_CHOICES = [1, 3, 5, 7] as const;

const REMINDER_ID_KEY = '@pick_weekly_goal_reminder_id_v1';

function clampGoal(n: unknown): number {
  const v = Math.round(Number(n));
  if (!isFinite(v)) return DEFAULT_WEEKLY_GOAL;
  return Math.max(1, Math.min(14, v));
}

/** Read the user's goal. Never throws — falls back to the default. */
export async function getWeeklyGoal(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw == null) return DEFAULT_WEEKLY_GOAL;
    return clampGoal(raw);
  } catch {
    return DEFAULT_WEEKLY_GOAL;
  }
}

/** Persist locally. Returns the value actually stored (clamped). */
export async function setWeeklyGoal(goal: number): Promise<number> {
  const v = clampGoal(goal);
  try {
    await AsyncStorage.setItem(KEY, String(v));
  } catch {}
  return v;
}

/** Seed the local value from the synced settings doc on sign-in. */
export async function hydrateWeeklyGoal(remote: number | undefined | null): Promise<number> {
  if (remote == null) return getWeeklyGoal();
  return setWeeklyGoal(remote);
}

// ---------------------------------------------------------------- reminders

/**
 * Keep exactly one "you're about to miss your weekly goal" local notification
 * scheduled, or none if the goal is already met.
 *
 * Timing: Saturday 10:00 local, i.e. with a weekend still left to fix it. If
 * it's already past that point in the week we fall back to Sunday 10:00, and
 * if that's gone too we skip this week rather than firing something useless.
 *
 * Call this whenever the goal or the week's count changes (Impact tab focus,
 * saving a cleanup, changing the goal in Settings). It cancels the previous
 * one first, so repeated calls are safe.
 */
export async function syncWeeklyGoalReminder(opts: {
  done: number;
  goal: number;
  enabled?: boolean;
}): Promise<void> {
  const { done, goal, enabled = true } = opts;
  try {
    // Always clear the old one — the count may have changed since we scheduled.
    const prev = await AsyncStorage.getItem(REMINDER_ID_KEY);
    if (prev) {
      try { await Notifications.cancelScheduledNotificationAsync(prev); } catch {}
      await AsyncStorage.removeItem(REMINDER_ID_KEY);
    }

    if (!enabled) return;
    const remaining = goal - done;
    if (remaining <= 0) return; // goal already met — nothing to nag about

    // Don't prompt for permission here; only schedule if it's already granted.
    const perm: any = await Notifications.getPermissionsAsync();
    const granted = perm?.granted ?? perm?.status === 'granted';
    if (!granted) return;

    const when = nextReminderDate();
    if (!when) return;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: remaining === 1 ? 'One cleanup to go' : `${remaining} cleanups to go`,
        body:
          remaining === 1
            ? 'One more this weekend and you hit your weekly goal.'
            : `You're at ${done} of ${goal} this week. A short walk would do it.`,
        data: { type: 'weeklyGoal' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when } as any,
    });
    await AsyncStorage.setItem(REMINDER_ID_KEY, id);
  } catch (e) {
    console.warn('syncWeeklyGoalReminder failed (non-fatal):', e);
  }
}

/** Saturday 10:00 this week, else Sunday 10:00, else null. */
function nextReminderDate(now: Date = new Date()): Date | null {
  for (const targetDow of [6, 0]) { // Sat, then Sun
    const d = new Date(now);
    const delta = (targetDow - now.getDay() + 7) % 7;
    d.setDate(now.getDate() + delta);
    d.setHours(10, 0, 0, 0);
    // Sunday belongs to the END of the current Mon-start week, so a Sunday
    // target must not roll into next week.
    if (targetDow === 0 && delta === 0 && d <= now) continue;
    if (d > now) return d;
  }
  return null;
}

/** Cancel any pending reminder (used when notifications are turned off). */
export async function clearWeeklyGoalReminder(): Promise<void> {
  try {
    const prev = await AsyncStorage.getItem(REMINDER_ID_KEY);
    if (prev) await Notifications.cancelScheduledNotificationAsync(prev);
    await AsyncStorage.removeItem(REMINDER_ID_KEY);
  } catch {}
}
