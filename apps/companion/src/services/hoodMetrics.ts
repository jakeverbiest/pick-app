/**
 * Pure neighborhood metrics — no platform I/O, deliberately.
 *
 * These two functions used to live in `neighborhoods.ts`, which imports
 * `expo-file-system/legacy` and therefore pulls in `react-native`. React
 * Native's `index.js` is Flow-typed, esbuild cannot parse it, and so
 * `npm run test:hoods` died on `Unexpected "typeof"` before running a single
 * assertion — unrunnable since 2026-07-14. The logic was always testable; it
 * was just sitting behind an import that made loading it impossible.
 *
 * Same separation the `functions/shared/*` modules already use in this repo:
 * pure logic in its own file so more than one caller — here, the app and the
 * test runner — can import it without dragging a platform along.
 *
 * Keep this file free of AsyncStorage, FileSystem, Firebase and anything else
 * that reaches for a native module. `neighborhoods.ts` re-exports both symbols,
 * so existing importers are unaffected.
 */
import { pointInPolygon } from './streetSegments';

/** A curated city whose boundary set exists but has no finer subdivision than
 *  the city outline itself — used to tell someone the map can show their city
 *  but not their neighborhood within it. */
export function isFallbackCityWithNoSubdivision(hoodCount: number, hasFineSubdivision: boolean): boolean {
  return hoodCount > 0 && !hasFineSubdivision;
}

/** % of segments inside a polygon that are fresh (cleaned ≤5d) — a hood's score.
 *  A segment counts as inside when its midpoint is inside the ring, which keeps
 *  a street that merely clips the boundary from being claimed by the hood. */
export function polygonStats(
  ring: [number, number][],
  segments: { coords: [number, number][]; daysOld: number | null }[]
): { total: number; fresh: number; freshPct: number; toGo: number } {
  let total = 0;
  let fresh = 0;
  for (const s of segments) {
    const c = s.coords;
    if (!c.length) continue;
    const m = c[Math.floor(c.length / 2)];
    if (pointInPolygon(m[0], m[1], ring)) {
      total++;
      if (s.daysOld !== null && s.daysOld <= 5) fresh++;
    }
  }
  return { total, fresh, freshPct: total > 0 ? Math.round((fresh / total) * 100) : 0, toGo: Math.max(0, total - fresh) };
}
