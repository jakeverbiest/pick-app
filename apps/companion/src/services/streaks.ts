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
  thisWeek: number;     // cleanups in the last 7 days
  activeToday: boolean; // did they clean today
}

const DAY = 86400000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** @param timestampsSec cleanup timestamps in SECONDS (as stored). */
export function computeStreak(timestampsSec: number[]): StreakInfo {
  if (!timestampsSec.length) return { current: 0, longest: 0, thisWeek: 0, activeToday: false };

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

  return { current, longest, thisWeek, activeToday };
}
