# Walk feedback — 2026-07-19 (Smith St, Brooklyn)

## Done (shipped via OTA)
1. **Over-counting fixed.** A segment (one ~50m side of a block) is now marked clean only if the route ran within 15m of **≥80%** of its length (`COVERAGE_THRESHOLD` in `streetSegments.ts`). Was: a single GPS ping marked a whole block (both sides). Now: clipping a corner / the opposite sidewalk falls under the bar.
2. **"Done" is no longer a phantom save step.** Cleanups save on **"Save & log"**; the recap screen is now titled **"Cleanup saved"** with a note that it's already logged. (`map.tsx`)
3. **New-neighborhood resilience.** 3 Overpass mirrors with fallback + the coverage "loaded" flag only locks on success, so a failed first fetch retries on the next GPS fix. (`streetSegments.ts`, `map.tsx`) — interim fix; see backend below for the real scale answer.

## Open — needs decision / infra

### A. Parks (e.g. Carroll Park) — ✅ BUILT
Fetches `leisure=park`/`garden`/`playground` polygons from OSM, renders them as filled freshness-colored zones, and marks the **park** cleaned (not phantom streets) when the route has ≥6 GPS points inside it (`markParksCleaned`, point-in-polygon). New `park_status` Firestore collection + rule. Files: `streetSegments.ts`, `map.tsx`, `firestore.rules`. Typecheck clean.
**Ships via:** (1) `firebase deploy --only firestore:rules` (REQUIRED — park writes are denied until the rule is live), then (2) `eas update`. Test: walk a loop inside Carroll Park, save, confirm it fills green + log shows "Marked 1 park(s) cleaned".

### B. "Works in every neighborhood" — the real scaling piece (backend)
Today each user fetches street geometry **live from the free public Overpass API** on first visit to an area. That's the root of "map fails to load on start in new areas" — slow, rate-limited, no SLA. The mirror fallback (shipped) helps but isn't a real fix at scale.
**Plan:** a **Cloud Function** (`firebase/functions`) that fetches OSM geometry for an area **once, globally**, caches it (Firestore or Storage keyed by grid cell), and serves it fast to all users. Client calls the function instead of Overpass directly.
**Needs from you:** Blaze plan (already on it), a `firebase deploy --only functions`, and on-device testing. This is the biggest of the four — a real but well-understood piece of infra, not a rewrite.
**Risk note:** do NOT wire the client to the function until it's deployed, or street loading breaks. Build + deploy together.

## Recommended order
1. Parks (user-visible, self-contained, no infra). 
2. OSM caching backend (unlocks reliable nationwide coverage).

## Round 2 feedback (same day)
- ✅ **Weight entry hard to submit** — the summary sheet now rises above the (done-less) decimal keypad + tap-dim-to-dismiss. `map.tsx`.
- ✅ **Edit old walks / add weight later** — new `updateCleanup()` in the data layer; Activity rows get a "+" button → edit-weight modal → updates Firestore, cache, and the leaderboard aggregate. Lets users skip weight at the finish and add it later (also simplifies submission). `firebaseDatabase.ts`, `activity.tsx`.
- ⏳ **Severe overcounts** — detection accuracy; can't tune blind. NEED DATA: Activity → tap the **share icon** on an overcounted walk (already exports the raw `motion_log`) → paste it. Then tune detector thresholds against the false-positive pattern.
- Data access: cleanups are owner-only in Firestore; assistant has no session, so it can't read them directly — the export is the channel.
