/**
 * Milestone ladder for the Impact tab.
 *
 * The old screen hardcoded a single MILESTONE = 50, so anyone past 50 cleanups
 * saw nonsense ("94 / 50 cleanups · 0 more cleanups to your next milestone").
 * A ladder fixes that: we always report the next rung above the current count,
 * and once every rung is cleared we switch to a repeating "every 250th cleanup"
 * rung so the card keeps saying something true forever.
 */

import { C } from '../pick/theme';

/**
 * Placeholder tier art until real illustrated badges exist — escalating
 * theme colors stand in for bronze/silver/gold-style artwork per level.
 * Shared by every surface that shows a picker's current level (Impact tab,
 * leaderboard, share cards) so they always agree on what a tier "looks like".
 */
export const LEVEL_TIER_COLORS = [C.muted, C.accent, C.mustard, C.rust, C.deepRust, C.primary];

export function levelTierColor(earned: number): string {
  return LEVEL_TIER_COLORS[earned % LEVEL_TIER_COLORS.length];
}

export interface MilestoneTier {
  /** Cleanups needed to reach this tier. */
  at: number;
  /** Short name shown on the card. */
  name: string;
}

export const MILESTONE_TIERS: MilestoneTier[] = [
  { at: 1, name: 'First pick' },
  { at: 5, name: 'Getting started' },
  { at: 10, name: 'Regular' },
  { at: 25, name: 'Block captain' },
  { at: 50, name: 'Neighborhood fixture' },
  { at: 100, name: 'Century' },
  { at: 200, name: 'Double century' },
  { at: 365, name: 'A year of blocks' },
  { at: 500, name: 'Quincentenary' },
  { at: 750, name: 'Relentless' },
  { at: 1000, name: 'Thousand club' },
];

/** After the last named tier, keep generating rungs at this interval. */
const ROLLING_STEP = 250;

export interface MilestoneProgress {
  /** The rung being worked toward. */
  target: number;
  /** Name of that rung. */
  name: string;
  /** The rung already cleared (0 before the first one). */
  previous: number;
  /** Name of the last cleared rung, if any. */
  previousName: string | null;
  /** Cleanups still needed — always >= 1. */
  remaining: number;
  /** 0–1 progress from `previous` to `target`. */
  pct: number;
  /** How many named tiers have been earned. */
  earned: number;
}

/** Where `count` sits on the ladder. */
export function milestoneProgress(count: number): MilestoneProgress {
  const n = Math.max(0, Math.floor(count || 0));

  const cleared = MILESTONE_TIERS.filter((t) => n >= t.at);
  const next = MILESTONE_TIERS.find((t) => n < t.at);

  if (next) {
    const prevTier = cleared[cleared.length - 1];
    const previous = prevTier?.at ?? 0;
    const span = Math.max(1, next.at - previous);
    return {
      target: next.at,
      name: next.name,
      previous,
      previousName: prevTier?.name ?? null,
      remaining: next.at - n,
      pct: Math.max(0, Math.min(1, (n - previous) / span)),
      earned: cleared.length,
    };
  }

  // Past the named ladder — roll forward in fixed steps so the card never
  // shows "0 more to go".
  const top = MILESTONE_TIERS[MILESTONE_TIERS.length - 1].at;
  const stepsDone = Math.floor((n - top) / ROLLING_STEP);
  const previous = top + stepsDone * ROLLING_STEP;
  const target = previous + ROLLING_STEP;
  return {
    target,
    name: `${target.toLocaleString()} cleanups`,
    previous,
    previousName: stepsDone === 0 ? MILESTONE_TIERS[MILESTONE_TIERS.length - 1].name : `${previous.toLocaleString()} cleanups`,
    remaining: target - n,
    pct: Math.max(0, Math.min(1, (n - previous) / ROLLING_STEP)),
    earned: MILESTONE_TIERS.length + stepsDone,
  };
}
