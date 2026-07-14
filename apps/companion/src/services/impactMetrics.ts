/**
 * Impact Metrics
 *
 * One canonical, aggregatable impact metric for PICK: BAGS.
 *
 * The problem: users won't carry scales, and "pickups" alone doesn't
 * communicate impact ("4,000 pickups" means nothing to a city official;
 * "20 trash bags" does). Weight was worse — a guessed constant dressed up
 * with decimal precision — so it's gone from the product entirely.
 *
 * The model (two layers):
 *
 *   1. PICKUPS (atomic unit) — detected by motion, counted for real,
 *      zero user effort. This is what we store and what we trust.
 *   2. BAGS (headline)       — pickups ÷ PICKUPS_PER_BAG, displayed
 *      fuzzily ("about ½ a bag"). If the user files a bag report at the
 *      end of a session (size + fullness), their report wins for that
 *      session and is stored as `bags_est`.
 *
 * Aggregates sum per-session bags: stored `bags_est` when present,
 * otherwise derived from `items_count`. Old sessions saved before this
 * model simply fall back to the derivation — no migration needed.
 */

/**
 * Standard bag = 13-gallon kitchen bag. ~200 pieces of typical street
 * litter (wrappers, butts, caps, receipts) fills one. Changing this
 * rescales displayed bag counts but never the stored data (pickups and
 * per-session bag reports are what's persisted).
 */
export const PICKUPS_PER_BAG = 200;

/** Bag-report sizes, in standard-bag (13-gal) volume equivalents. */
export const BAG_SIZE_FACTORS: Record<string, number> = {
  small: 1, // 13-15 gal — the standard bag
  medium: 2.3, // 30-35 gal
  large: 4, // 45-60 gal
  xl: 5, // 60+ gal
};

export interface ImpactSummary {
  items: number;
  bags: number;
  display: string; // human-readable, e.g. "230 pickups · about 1 bag"
}

/** Estimated bags from the motion-detected pickup count. */
export function itemsToBags(items: number): number {
  return items / PICKUPS_PER_BAG;
}

/** Bags from an end-of-session bag report (size + fullness %). */
export function reportedBags(size: string, fullnessPct: number): number {
  const factor = BAG_SIZE_FACTORS[size] ?? BAG_SIZE_FACTORS.large;
  return factor * (Math.max(0, Math.min(100, fullnessPct)) / 100);
}

/** Bags for one stored cleanup: the user's report wins, else derive. */
export function cleanupBags(c: { items_count?: number; bags_est?: number | null }): number {
  if (typeof c.bags_est === 'number' && c.bags_est > 0) return c.bags_est;
  return itemsToBags(c.items_count || 0);
}

/** Total bags across stored cleanups (user totals, team totals, zones). */
export function aggregateBags(
  sessions: { items_count?: number; bags_est?: number | null }[]
): number {
  return sessions.reduce((sum, s) => sum + cleanupBags(s), 0);
}

/**
 * Fuzzy, honest display. We never counted grams, so we never show
 * decimals that pretend we did.
 */
export function formatBags(bags: number): string {
  if (bags <= 0) return '0 bags';
  if (bags < 0.2) return 'a handful';
  if (bags < 0.4) return 'about ¼ bag';
  if (bags < 0.75) return 'about ½ a bag';
  if (bags < 1.25) return 'about 1 bag';
  if (bags >= 10) return `${Math.round(bags)} bags`;
  // 1.25–10: nearest half-bag ("2½ bags")
  const halves = Math.round(bags * 2) / 2;
  const whole = Math.floor(halves);
  const frac = halves - whole > 0 ? '½' : '';
  return `about ${whole > 0 ? whole : ''}${frac} bag${halves > 1 ? 's' : ''}`;
}

/** Spelled-out variant for headline/share moments — names the standard unit
 *  ("about ½ a kitchen trash bag") so anyone can picture it. */
export function formatKitchenBags(bags: number): string {
  return formatBags(bags).replace(/bag(s?)$/, 'kitchen trash bag$1');
}

/** Compact variant for tight UI slots (live stat bar): "<¼", "½", "1½", "12". */
export function formatBagsShort(bags: number): string {
  if (bags <= 0) return '0';
  if (bags < 0.25) return '<¼';
  if (bags >= 10) return String(Math.round(bags));
  const quarters = Math.round(bags * 4) / 4;
  const whole = Math.floor(quarters);
  const fracMap: Record<number, string> = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' };
  const frac = fracMap[Math.round((quarters - whole) * 100) / 100] ?? '';
  return `${whole > 0 ? whole : ''}${frac}` || '0';
}

/** Impact for a single session (reported bags win when present). */
export function sessionImpact(itemsDetected: number, bagsReported?: number): ImpactSummary {
  const bags = bagsReported && bagsReported > 0 ? bagsReported : itemsToBags(itemsDetected);
  return {
    items: itemsDetected,
    bags,
    display: `${itemsDetected} pickups · ${formatBags(bags)}`,
  };
}
