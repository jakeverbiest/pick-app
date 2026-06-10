/**
 * Impact Metrics
 *
 * One canonical, aggregatable impact metric for PICK.
 *
 * The problem: users won't carry scales, and "pickups" alone doesn't
 * communicate impact ("4,000 pickups" means nothing to a city official;
 * "120 trash bags" does).
 *
 * The model (three layers, each derived from the one below):
 *
 *   1. ITEMS (atomic unit)   — pickups detected by motion. Tracked
 *      automatically, zero user effort. This is what we store.
 *   2. WEIGHT (internal)     — items × calibrated lb/pickup factor
 *      (weightCalibration.ts). The few users who weigh, or who give a
 *      5-second bag-size report, tune the factor for everyone.
 *   3. BAGS (headline)       — weight ÷ STANDARD_BAG_LB. The public,
 *      aggregatable metric: "Lower East Side: 124 bags this month."
 *
 * Everything aggregates in pounds internally, displays as bags.
 */

import weightCalibration from './weightCalibration';

/**
 * Standard bag = 13-gallon kitchen bag of mixed street litter.
 * Full weight ranges ~8-12 lb depending on contents; 10 lb is the
 * standardization constant. Changing it rescales all displayed bag
 * counts but never the stored data (items + lb are what's persisted).
 */
export const STANDARD_BAG_LB = 10;

export interface ImpactSummary {
  items: number;
  estWeightLb: number;
  bagsEquivalent: number;
  display: string; // human-readable, e.g. "23 items · ≈1.2 lb · 0.1 bags"
}

/** Impact for a single session, using the live calibrated factor. */
export function sessionImpact(itemsDetected: number, knownWeightLb?: number): ImpactSummary {
  const weight = knownWeightLb && knownWeightLb > 0
    ? knownWeightLb
    : weightCalibration.estimateWeight(itemsDetected);
  return buildSummary(itemsDetected, weight);
}

/**
 * Aggregate impact across sessions (user totals, team totals, zone totals).
 * Pass stored weights when available; they already encode the best estimate
 * at the time each session was saved.
 */
export function aggregateImpact(
  sessions: Array<{ items_count: number; weight_lb: number }>
): ImpactSummary {
  const items = sessions.reduce((sum, s) => sum + (s.items_count || 0), 0);
  const weight = sessions.reduce((sum, s) => sum + (s.weight_lb || 0), 0);
  return buildSummary(items, weight);
}

export function weightToBags(weightLb: number): number {
  return weightLb / STANDARD_BAG_LB;
}

export function formatBags(bags: number): string {
  if (bags >= 10) return `${Math.round(bags)} bags`;
  if (bags >= 1) return `${bags.toFixed(1)} bags`;
  return `${bags.toFixed(2)} bags`;
}

function buildSummary(items: number, weightLb: number): ImpactSummary {
  const bags = weightToBags(weightLb);
  return {
    items,
    estWeightLb: weightLb,
    bagsEquivalent: bags,
    display: `${items} items · ≈${weightLb.toFixed(1)} lb · ${formatBags(bags)}`,
  };
}
