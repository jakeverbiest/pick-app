/**
 * Streak + weekly-goal math, derived from a user's cleanup timestamps.
 * Pure function (no I/O) so it's easy to reason about and test.
 *
 * A "day" is a local calendar day. The current streak counts consecutive days
 * with at least one cleanup, ending today OR yesterday — so missing today
 * doesn't snap the streak until the day actually rolls over (that's the nudge:
 * "clean today to keep it going").
 */
export interface StreakInfo {
  current: number;      // consecutive days ending today/yesterday
  longest: number;      // best consecutive-day run ever
  thisWeek: number;     // cleanups in the last 7 days (rolling)
  /** Cleanups since Monday 00:00 local — what the weekly goal is measured against. */
  thisCalendarWeek: number;
  /** Days left in the calendar week, including today (Mon = 7 … Sun = 1). */
  daysLeftInWeek: number;
  activeToday: boolean; // did they clean today
}

const DAY = 86400000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Monday 00:00 local of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7; // Mon = 0 … Sun = 6
  return d.getTime() - dow * DAY;
}

/** @param timestampsSec cleanup timestamps in SECONDS (as stored). */
export function computeStreak(timestampsSec: number[]): StreakInfo {
  const daysLeftInWeek = 7 - ((new Date().getDay() + 6) % 7);
  if (!timestampsSec.length) {
    return { current: 0, longest: 0, thisWeek: 0, thisCalendarWeek: 0, daysLeftInWeek, activeToday: false };
  }

  const daySet = new Set<number>(timestampsSec.map((s) => startOfDay(s * 1000)));
  const days = Array.from(daySet).sort((a, b) => a - b);

  // Longest consecutive-day run.
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] === DAY) { run++; if (run > longest) longest = run; }
    else run = 1;
  }

  // Current streak: start at today (or yesterday if nothing today) and walk back.
  const today = startOfDay(Date.now());
  const activeToday = daySet.has(today);
  let cursor = activeToday ? today : today - DAY;
  let current = 0;
  while (daySet.has(cursor)) { current++; cursor -= DAY; }

  const weekAgo = Date.now() - 7 * DAY;
  const thisWeek = timestampsSec.filter((s) => s * 1000 >= weekAgo).length;

  const weekStart = startOfWeek(Date.now());
  const thisCalendarWeek = timestampsSec.filter((s) => s * 1000 >= weekStart).length;

  return { current, longest, thisWeek, thisCalendarWeek, daysLeftInWeek, activeToday };
}
