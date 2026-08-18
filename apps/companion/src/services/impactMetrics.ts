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

/**
 * Bag-report sizes, in standard-bag (13-gal) volume equivalents.
 *
 * The named sizes (17 Aug) are what users actually pick from, and they use the
 * same vocabulary as CHALLENGE_GUEST_MODE_SPEC so guest submissions and app
 * submissions mean the same thing. The legacy small/medium/large/xl keys are
 * KEPT because they are persisted in `bag_size` on existing cleanups — removing
 * them would silently re-scale historical data. New reports write named sizes.
 */
export const BAG_SIZE_FACTORS: Record<string, number> = {
  // Named sizes — what the UI offers.
  wastebasket: 0.3, // ~4 gal — a bathroom/office bin liner
  kitchen: 1, // 13-15 gal — the standard bag, the unit everything is expressed in
  yard: 2.3, // 30-39 gal — a yard/contractor waste bag

  // Legacy keys, still present in stored cleanups. Do not remove.
  small: 1, // == kitchen
  medium: 2.3, // == yard
  large: 4, // 45-60 gal
  xl: 5, // 60+ gal
};

/** The sizes offered in the UI, in order, with human labels. */
export const BAG_SIZE_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'wastebasket', label: 'Wastebasket', hint: '~4 gal' },
  { key: 'kitchen', label: 'Kitchen bag', hint: '13 gal' },
  { key: 'yard', label: 'Yard bag', hint: '30+ gal' },
];

export interface ImpactSummary {
  items: number;
  bags: number;
  display: string; // human-readable, e.g. "230 pickups · about 1 bag"
}

/** Estimated bags from the motion-detected pickup count. */
export function itemsToBags(items: number): number {
  return items / PICKUPS_PER_BAG;
}

/**
 * Bags from an end-of-session bag report.
 *
 * `count` (added 17 Aug) is how many bags of that size — the previous signature
 * could only express one, so "3 yard bags" had no way to be reported. Fullness
 * applies to the whole report, i.e. count=2, fullness=50 means two half-full
 * bags. Defaults to 1 so every existing call site is unchanged.
 */
export function reportedBags(size: string, fullnessPct: number, count: number = 1): number {
  const factor = BAG_SIZE_FACTORS[size] ?? BAG_SIZE_FACTORS.large;
  const safeCount = Math.max(0, Number.isFinite(count) ? count : 1);
  return safeCount * factor * (Math.max(0, Math.min(100, fullnessPct)) / 100);
}

/**
 * Recover "how full" from a stored cleanup, for the edit screen.
 *
 * New records carry `bag_fullness` directly. Older ones only kept the derived
 * `bags_est`, but that is enough to recover it exactly, since
 * `bags_est = qty x sizeFactor x fullness/100`. Returns null when the walk
 * carries no bag report at all (the count-derived estimate stands).
 */
export function storedFullness(c: {
  bag_fullness?: number | null;
  bag_size?: string | null;
  bag_qty?: number | null;
  bags_est?: number | null;
}): number | null {
  if (typeof c.bag_fullness === 'number' && c.bag_fullness > 0) {
    return Math.max(1, Math.min(100, Math.round(c.bag_fullness)));
  }
  const factor = BAG_SIZE_FACTORS[c.bag_size || ''];
  const qty = c.bag_qty || 0;
  if (!factor || qty <= 0 || typeof c.bags_est !== 'number' || c.bags_est <= 0) return null;
  return Math.max(1, Math.min(100, Math.round((c.bags_est / (factor * qty)) * 100)));
}

/**
 * Nearest value the fullness chips can express. Legacy reports used arbitrary
 * percentages (the old "just a handful" preset was 20%), which would leave the
 * editor with no chip selected and invite a mis-tap. Snapping is a visible
 * change the user can see in the "That's about ..." line before they save.
 */
export function snapFullness(pct: number): number {
  return [25, 50, 75, 100].reduce((best, o) => (Math.abs(o - pct) < Math.abs(best - pct) ? o : best), 25);
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
