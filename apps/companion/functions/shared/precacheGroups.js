'use strict';

/**
 * Neighborhood grouping for the street-tile precache drip (added 2026-09-09).
 *
 * WHY THIS EXISTS. `getPrecachedSegmentsForRing()` (src/services/streetSegments.ts)
 * is strictly all-or-nothing: one missing / stale / empty cell in a neighborhood's
 * bbox and the WHOLE ring falls through to a ~20s live Overpass fetch. The drip
 * used to walk the roster as a flat list with a rolling cursor, which advances in
 * roster order rather than by neighborhood — so mid-cycle most neighborhoods sat
 * at "most-but-not-all cells warm", which that all-or-nothing check scores as a
 * plain MISS. Partial progress bought exactly zero speed. Grouping the drip's work
 * by neighborhood makes each unit of work actually flip something from slow to
 * fast.
 *
 * This module is deliberately pure (no Firestore, no network) so the grouping and
 * ordering can be exercised against a simulated roster without deploying.
 *
 * THE TILE ARRAY IS NOT REORDERED. The roster is append-only and the cursor's
 * "position N" has to mean the same tile across rebuilds (see
 * rebuildStreetTileRoster's own comment) — so this changes the drip's *selection
 * strategy* only. `buildDripGroups` returns groups of INDEXES into the caller's
 * unmodified tiles array.
 */

/**
 * Groups the drip warms first, in this order, matched on the normalized label
 * (see normalizeHoodLabel — so 'Fort Greene, Brooklyn' from STREET_SEED_POINTS and
 * 'Fort Greene' from the NYC neighborhoods GeoJSON are the same group).
 *
 * Provenance, so this list isn't mistaken for a guess (Jake, 2026-09-09):
 *   1. Jake's own area — Fort Greene and the brownstone-Brooklyn ring around it,
 *      which is where his own walks and nearly all field testing happen.
 *   2. Astoria — Litter Legion and Astoria Trash Club, live org-outreach targets.
 *   3. Jackson Heights — JHBG, same.
 * Everything else keeps the roster's own append-only order behind these.
 *
 * An entry that matches no group in the roster is not an error (a rename in the
 * upstream GeoJSON, a borough suffix we didn't anticipate); the drip logs the
 * unmatched entries via missingPriorityLabels() rather than failing.
 */
const PRECACHE_PRIORITY_LABELS = [
  // 1. Jake's own area, Fort Greene outward.
  'fort greene',
  'clinton hill',
  'downtown brooklyn',
  'brooklyn heights',
  'boerum hill',
  'prospect heights',
  'park slope',
  'cobble hill',
  'carroll gardens',
  // 2. Astoria — Litter Legion, Astoria Trash Club.
  'astoria',
  // 3. Jackson Heights — JHBG.
  'jackson heights',
];

/** '<name>' from any of the label spellings this repo produces:
 *  'Fort Greene' (GeoJSON `neighborhood`), 'Fort Greene, Brooklyn' and
 *  'Sunset Park (north), Brooklyn' (STREET_SEED_POINTS). Lowercased, the
 *  parenthetical dropped, the borough suffix after the first comma dropped, and
 *  punctuation collapsed to single spaces ('Prospect-Lefferts Gardens' ->
 *  'prospect lefferts gardens'). Returns '' for anything unusable, which the
 *  caller treats as unlabeled. */
function normalizeHoodLabel(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every raw label on a roster tile. Reads the newer `labels` array first and
 *  falls back to the original single `label` field, so a roster written before
 *  the 2026-09-09 multi-label change still groups correctly (just more coarsely
 *  — see rebuildStreetTileRoster, which enriches `labels` in place on its next
 *  run without moving any tile). */
function rawTileLabels(tile) {
  if (!tile) return [];
  if (Array.isArray(tile.labels)) return tile.labels.filter((l) => typeof l === 'string' && l);
  if (typeof tile.label === 'string' && tile.label) return [tile.label];
  return [];
}

/**
 * Group the roster's tiles by neighborhood, priority groups first.
 *
 * Returns `[{ key, label, indexes }]` where `indexes` are positions in the
 * caller's `tiles` array, ascending. A tile that belongs to several
 * neighborhoods (bboxes overlap constantly — Jackson Heights' bbox shares cells
 * with Elmhurst, Corona, East Elmhurst, Ditmars Steinway and College Point)
 * appears in EVERY group it belongs to. That is the point: a group has to be the
 * full cell set the client's `gridCellsForRingBbox()` will ask for, or
 * "completing" it still leaves the ring on the slow path.
 *
 * Ordering after the priority prefix is first-appearance order in the tiles
 * array. Because the roster is append-only, a newly-derived neighborhood appears
 * at the END of that order and never shifts an existing group — the same
 * invariant the flat cursor relied on, one level up.
 */
function buildDripGroups(tiles, opts) {
  const priority = (opts && opts.priorityLabels) || PRECACHE_PRIORITY_LABELS;
  const byKey = new Map(); // normalized key -> { key, label, indexes }
  const unlabeled = { key: '', label: '(unlabeled)', indexes: [] };

  (tiles || []).forEach((tile, i) => {
    const labels = rawTileLabels(tile);
    let placed = false;
    for (const raw of labels) {
      const key = normalizeHoodLabel(raw);
      if (!key) continue;
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: raw, indexes: [] };
        byKey.set(key, group);
      }
      // Two spellings on one tile can normalize to the same key; indexes are
      // pushed ascending, so checking the tail is enough to keep them unique.
      if (group.indexes[group.indexes.length - 1] !== i) group.indexes.push(i);
      placed = true;
    }
    if (!placed) unlabeled.indexes.push(i);
  });

  const ordered = [];
  const used = new Set();
  for (const key of priority) {
    const group = byKey.get(key);
    if (group && !used.has(key)) {
      ordered.push(group);
      used.add(key);
    }
  }
  for (const [key, group] of byKey) {
    if (!used.has(key)) ordered.push(group);
  }
  // Cleanup-promoted tiles carry no label (promotedStreetTilesFromCleanups);
  // they are a real neighborhood to somebody, we just don't know which, so they
  // go last as one synthetic group rather than being dropped from the drip.
  if (unlabeled.indexes.length) ordered.push(unlabeled);
  return ordered;
}

/**
 * Where to resume. Prefers the persisted `groupKey` (a label), falling back to
 * the persisted numeric `groupCursor`, falling back to 0.
 *
 * Resolving by label first is what makes the cursor survive a roster rebuild
 * that adds a whole new neighborhood, or a future edit to
 * PRECACHE_PRIORITY_LABELS — either can shift group INDEXES, and silently
 * resuming at a shifted index would restart a half-finished neighborhood
 * somewhere else. The numeric fallback only matters for a roster written before
 * this existed.
 */
function resolveGroupIndex(groups, state) {
  if (!groups || !groups.length) return 0;
  const key = state && typeof state.groupKey === 'string' ? state.groupKey : null;
  if (key !== null) {
    const at = groups.findIndex((g) => g.key === key);
    if (at >= 0) return at;
  }
  const cursor = state && Number.isFinite(state.groupCursor) ? state.groupCursor : 0;
  return ((Math.trunc(cursor) % groups.length) + groups.length) % groups.length;
}

/** Priority entries that matched no group in the current roster — logged by the
 *  drip so a renamed or mis-spelled priority silently failing to take effect is
 *  visible rather than invisible. */
function missingPriorityLabels(groups, priorityLabels) {
  const have = new Set((groups || []).map((g) => g.key));
  return (priorityLabels || PRECACHE_PRIORITY_LABELS).filter((k) => !have.has(k));
}

module.exports = {
  PRECACHE_PRIORITY_LABELS,
  normalizeHoodLabel,
  rawTileLabels,
  buildDripGroups,
  resolveGroupIndex,
  missingPriorityLabels,
};
