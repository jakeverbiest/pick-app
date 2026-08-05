/**
 * Challenge Recap — the "group Wrapped" card for a challenge that just
 * finished. Extends the Challenges backend (challenges.ts) and reuses the
 * "My Path" recap's proven capture → close modal → share pipeline
 * (GroupRecapCard/GroupRecapModal mirror RecapCard/RecapModal) rather than
 * building a new renderer. See docs/CHALLENGE_RECAP_SPEC.md.
 *
 * Unlike a personal recap, this runs on data the challenge screen has
 * already fetched (contributions are public per-participant totals, see
 * challenges.ts) — no new Firestore reads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Challenge, Contribution } from './challenges';
import { totalFor } from './challenges';
import { formatKitchenBags } from './impactMetrics';
import { TESTFLIGHT_URL } from './recap';

export interface ChallengeRecapData {
  totalPickups: number;
  totalBags: number;
  totalCleanups: number;
  /** People who logged something (contributions.length). */
  participantCount: number;
  /** People who joined, whether or not they logged anything. */
  joinedCount: number;
  goalReached: boolean;
  pctOfGoal: number;
  /** Whoever logged the most pickups — null if nobody contributed anything. */
  topContributorName: string | null;
  daysRun: number;
}

/** Pure — turns a challenge + its published contributions into recap stats. */
export function buildChallengeRecap(challenge: Challenge, contributions: Contribution[]): ChallengeRecapData {
  const totalPickups = totalFor('pickups', contributions);
  const totalBags = Number(contributions.reduce((s, c) => s + (c.bags || 0), 0).toFixed(2));
  const totalCleanups = contributions.reduce((s, c) => s + (c.cleanups || 0), 0);
  const goalTotal = totalFor(challenge.goal_type, contributions);
  const pctOfGoal = challenge.goal_value > 0 ? goalTotal / challenge.goal_value : 0;
  // contributions is already sorted by pickups descending (see getContributions).
  const top = contributions[0];

  return {
    totalPickups,
    totalBags,
    totalCleanups,
    participantCount: contributions.length,
    joinedCount: challenge.participants.length,
    goalReached: pctOfGoal >= 1,
    pctOfGoal,
    topContributorName: top && top.pickups > 0 ? top.display_name || 'Picker' : null,
    daysRun: Math.max(1, Math.round((challenge.end_date - challenge.start_date) / 86400)),
  };
}

/** Caption for the share sheet / community post — mirrors buildRecapCaption's pattern. */
export function buildChallengeRecapCaption(recap: ChallengeRecapData, challenge: Challenge): string {
  const bagsText = formatKitchenBags(recap.totalBags);
  const pickers = `${recap.participantCount} picker${recap.participantCount === 1 ? '' : 's'}`;
  const days = `${recap.daysRun} day${recap.daysRun === 1 ? '' : 's'}`;
  return (
    `We hit ${recap.totalPickups.toLocaleString()} pickups (${bagsText}) together in "${challenge.name}" — ` +
    `${pickers}, ${days}. Join us on Pick: ${TESTFLIGHT_URL}`
  );
}

// ------------------------------------------------------------- "seen" state

const SEEN_KEY = '@pick_challenge_recap_seen_v1';

async function readSeen(): Promise<Record<string, true>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Has this just-completed challenge's recap already been auto-presented once? */
export async function getUnseenChallengeRecap(challengeId: string): Promise<boolean> {
  const seen = await readSeen();
  return !seen[challengeId];
}

export async function markChallengeRecapSeen(challengeId: string): Promise<void> {
  try {
    const seen = await readSeen();
    seen[challengeId] = true;
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {}
}
