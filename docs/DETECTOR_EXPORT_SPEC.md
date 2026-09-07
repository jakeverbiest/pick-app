# Detector telemetry export — spec + staged code

**Status (2026-09-07): designed and staged by the `code` subagent. NOT deployed, NOT wired
into `functions/index.js`.** No `firebase deploy` has been run and none should be until Jake
reviews this doc and the staged file below. See "Deliberately not wired in" at the end for why
the code isn't just sitting in `index.js` already.

**Origin:** `LAUNCH_LEDGER.md`'s "Detector export CF" row, open for weeks and flagged as **the
top priority** under "Public beta — go, capped": the public TestFlight link has been open since
~June 15; `cleanups` is owner-only in `firestore.rules`; every stranger who has walked since
produced `items_detected`/`motion_log` that is stored and owned by them.
Also named directly in `docs/PUBLIC_BETA_GONOGO.md` §"Detector export — becomes urgent here" and
in `roadmap-ops`'s 2026-09-06 backlog triage as one of the real launch-adjacent gates (not a
launch blocker itself — it gates the *value* of the beta, not whether it can run).

**Premise corrected 2026-09-07 — it changes how this function should be justified, not whether
to build it.** This paragraph previously said that data was "unreadable by Jake." That is not
accurate: the owner-only rule governs **client SDK** access, not the admin SDK. The service
account at `~/.secrets/pick-app/serviceAccountKey.json` reads every cleanup document today and
has been used to do so repeatedly — the cross-tester comparison in
`DETECTOR_VALIDATION_PLAN.md` §8a was produced exactly that way, with a short local script.

So **access is not the problem this function solves.** What it solves is **privacy posture**:
routinely reading raw, identifiable, owner-scoped documents is materially heavier than analyzing
a non-identifying derivative, and Safety's 2026-09-06 pass declined to put "anonymized" in the
privacy policy precisely because that pipeline did not exist yet — deferring the stronger claim
until this function ships. That is the real case for building it, and it is a good one. §2 is
where the value actually lives.

(`DETECTOR_VALIDATION_PLAN.md` §7a briefly reached the opposite conclusion — that the function
was unnecessary — by judging it as an access tool. That section has been corrected to match.)

**Searched first, per the task brief.** Grepped `docs/` and `apps/companion/src` for an existing
detector-export design (`detector export`, `exportCleanup`, the three `pace_*` field names) —
found the *symptom* documented in several places (`LAUNCH_LEDGER.md` line 269,
`PUBLIC_BETA_GONOGO.md` §2, `docs/DETECTOR_VALIDATION_PLAN.md` line 334) but no design or code
for the Cloud Function itself. This is a first pass, not a rewrite of prior work.

**One correction to the task brief, verified against the code, not assumed:** the brief says
`exportCleanup()` currently omits the `pace_*` fields. That was true 2026-08-19 through some
point before 2026-09-06 (`LAUNCH_LEDGER.md` still carries it open in the "OTA-able, not done"
table), but `docs/LEDGER_INBOX.md`'s entry around line 529 records it as closed, and reading
`apps/companion/app/(tabs)/activity.tsx`'s `exportCleanup()` directly (lines 173-213, current
tree) confirms: it already emits `pace_median_mps`, `pace_slow_share`, and `pace_low_confidence`,
alongside `carry_mode` and `device_model` (added 2026-09-06). That client-side function is a
*single-record, owner-triggered* share-sheet export (one tester copies one of their own walks to
clipboard); it has nothing to do with the server-side, cross-tester export this spec is about,
and its pace-field gap is already closed. `LAUNCH_LEDGER.md`'s open-item row for this appears to
be stale — worth a note to `LEDGER_INBOX.md` (see the end of this doc), not fixed here.

---

## 1. What this function does, in one sentence

On demand (not on a schedule — the whole point is retroactive recovery), scan every `cleanups`
document, strip every field this spec's privacy scope doesn't cover, and write the rest as one
NDJSON line per walk to a private Cloud Storage object — never returned to a browser, never
written back to Firestore, never linked to a user.

## 2. Privacy scope — this is the load-bearing section

Per the task brief and verified directly against `~/pick-app/docs/OPS_STATUS.md`'s Sentinel/Safety
section (2026-09-06 entries) and `apps/companion/src/constants/legal.ts`/`web/privacy.html`:

- **What the draft "use-limitation" amendment (2026-09-06) covers:** analyzing tester walks —
  named explicitly as "detected-vs-confirmed pickup counts, pace" — to improve pickup-detection
  accuracy. This is real R&D use beyond "running the app," and it's the only detector-specific
  use disclosed anywhere today.
- **What it does NOT cover, confirmed in the same OPS_STATUS entry's judgment call (3):**
  `carry_mode` and `device_model`. Those got their *own*, separate, same-day collection-disclosure
  amendment — a *collection* disclosure, not a *use* disclosure. Nothing in either amendment says
  those two fields may be used for cross-tester analysis. Judgment call (3) explicitly reads:
  *"adding them to the detector export needs its own collection-disclosure amendment and its own
  sign-off... flagged now because the brief named both as arriving 'shortly'."* That flag is about
  this exact function. **This design does not include `carry_mode` or `device_model`.** If you
  want them in a later pass, that's a fourth privacy sign-off, not a code change — see §6.
- **What the amendment explicitly does NOT yet claim:** anonymization or aggregation. Judgment
  call (2) on the same policy pass says plainly: *"today the analysis reads `motion_log` on
  identifiable owner-scoped cleanup docs, so claiming anonymized/aggregated analysis would
  describe a pipeline that doesn't exist yet. Revisit after that function ships, not before."*
  That is *this* function. Once this ships, the anonymization claim in the policy becomes true
  and can be added — that's a follow-up privacy edit, not part of this spec, and not something
  this session is doing unasked.

**Field allowlist (exhaustive — anything not listed here is dropped, not passed through by
default):**

| Field | In export? | Why |
|---|---|---|
| `items_detected` | Yes | Named explicitly in the amendment ("detected... counts"). |
| `items_count` | Yes | The "confirmed" half of "detected-vs-confirmed" — the correction is the ground truth the whole export exists to compare against. |
| `pace_median_mps` | Yes | Named explicitly ("pace"). |
| `pace_slow_share` | Yes | Same field family, same disclosure. |
| `pace_low_confidence` | Yes | Same field family, same disclosure. |
| `duration_seconds` | Yes | Not named in the amendment by itself, but it's ordinary session-operation data already covered under the policy's contract-necessity basis ("cleanup-session data... motion-detection summaries"), not new R&D-specific processing. Needed to make pace/rate numbers interpretable at all — a `pace_median_mps` without a walk length is close to unusable for tuning. |
| `motion_log` (parsed) | Yes, per-event | This *is* the substrate under "detected... counts" and "pace" — `pace_median_mps` etc. are themselves derived from it. Verified directly against `MotionEventRecord` (`apps/companion/src/services/motionDetection.ts:58`): ten numeric/boolean fields (`t`, `peak`, `duration`, `peakTime`, `gyro`, `confidence`, `accepted`, `counted`, `peaks`, `speed`, `speedAgeMs`) plus one rejection-reason string (`reason`, a fixed small vocabulary — `'ok'`, `'cooldown'`, or a rejection code — not free text). No location, no identity, matches the task brief's own description. |
| `ground_truth` (parsed) | Yes, if present | Walk-relative seconds of LOG PICK taps (tester-only feature, build 32+). Same class of data as `motion_log` — numeric, walk-relative, non-identifying — and it's the labelled truth that makes `items_detected` scoreable rather than just a raw count. |
| `session_mode` | **Excluded, flagged not decided** | Arguably already covered by ordinary app-operation disclosure (it's "which power path the walk took," not a detection-accuracy metric), but it isn't named in the amendment and isn't needed to retune thresholds. Left out by default; a one-line, low-risk addition if Jake wants it — see §6. |
| `userId` | **No** | The one field that would turn "non-identifying telemetry" into "a labeled per-person dataset." Never read into the export at all — see §3. |
| `id` (cleanup doc ID) | **No** | Not itself a name, but it's a stable handle that lets anyone with Firestore admin access join the export back to the *identifiable* source doc (which does carry `userId`). No field in the export can be used to look anything back up. |
| `location_lat` / `location_lon` | No | Precise coordinates. Explicitly out of scope — the brief's whole point is "non-identifying." |
| `city` / `neighborhood` | No | Not named in the amendment; a coarse city name is weak alone but stacks with other quasi-identifiers (pace, walk length, time) for a small-cohort tester pool. Cheap to leave out; nothing in tuning needs it. |
| `route_points` | No | GPS trail. Never in scope. |
| `carry_mode` / `device_model` | **No — see §2 above.** Explicitly not covered by any current disclosure for this use. |
| `notes` | No | Freeform user text — the one field `MotionEventRecord` itself deliberately excludes; the export shouldn't reintroduce a free-text field through the back door via the parent doc. |
| `team` | No | Not needed for detector tuning; a light quasi-identifier for small teams. |
| `timestamp` | **Day only, not the exact epoch** | Kept coarse (`YYYY-MM-DD`, derived, exact epoch discarded) so tuning can be plotted against known code-change dates (e.g. "everything before 25 Aug used the pre-fix pause gate") without carrying a precise timestamp that could be correlated against a specific tester's known movements. |

**No cross-walk linkage, by default.** Each exported row stands alone — there is no per-user
key, hashed or otherwise, connecting two rows to "the same anonymous walker." This is a
deliberate, conservative choice, not an oversight: a stable pseudonymous ID would let an analyst
reconstruct one person's walking history over time, which is a materially different privacy
posture than looking at each walk as an independent sample, and nothing in either 2026-09-06
amendment authorizes building longitudinal profiles of anonymous testers. If cohort analysis
across a single tester's multiple walks turns out to matter later, that's a fifth explicit
decision for Jake (see §6), not a default.

## 3. How this stays non-identifying in the code, not just on paper

- The Firestore read projects only the allowlisted fields (`select()`), so `userId` and every
  excluded field never enter function memory in the first place — this isn't "read everything,
  then filter before writing," it's "never read the excluded fields at all."
- The output is one flat NDJSON object per walk with no `id` field of any kind (not even an
  export-internal counter that could be used to correlate row order against Firestore's own
  creation-time ordering, which would leak an approximate rough timeline).
- The function is read-only against `cleanups` — nothing is written back to Firestore, no field
  is added to any cleanup doc, no rules change is needed.

## 4. Output format and where it goes

- **NDJSON** (one JSON object per line), not a single JSON array — lets the reader (Jake, or a
  tuning script) stream/`grep`/`jq` the file without loading the whole thing into memory, and
  lets the writer append batch-by-batch without holding the whole export in function memory
  either. Matches the granularity every prior manual field-test analysis in this repo already
  used (`docs/fielddata/*.md`, `B6_PREDICTION.md`) — per-event rows, not pre-bucketed histograms.
- Written to **Cloud Storage** (`gs://<default bucket>/detector_exports/<UTC-timestamp>.ndjson`),
  reusing the same `getStorage()`/`bucket` handle `deleteMyPrivateData` already imports in
  `functions/index.js` — no new dependency. Never returned in the HTTP response body; the
  collection is large enough (public beta since mid-June) that inlining it risks the same
  timeout/size problems `orgDashboard`'s design notes already flag for large scans.
- The HTTP response is metadata only: object path, row count, and a **signed URL** (short expiry,
  e.g. 1 hour) so Jake can download the file directly without needing separate `gsutil`/Console
  access each time.

## 5. Access control

**No existing admin/owner-role convention exists anywhere in this codebase to reuse** — checked
directly (grepped `index.js` for `customClaims`, `isAdmin`, any hardcoded admin UID: none). Two
real options, both viable, neither implemented elsewhere here:

1. **A Secret Manager–backed key** via `firebase-functions/params`' `defineSecret` (the SDK
   already installed, `firebase-functions@^6.1.0`, supports this — confirmed in
   `functions/package.json`). Recommended: this is a single high-privilege operator secret, not a
   per-org token to hand out, so it belongs in Secret Manager rather than a Firestore document a
   client-facing pattern (`orgDashboard`'s `team_token_index`) was built for. Requires one new
   one-time setup step before first deploy: `firebase functions:secrets:set DETECTOR_EXPORT_KEY`
   — **not run by this session**, and deploy will fail without it.
2. Alternative, more consistent with `orgDashboard`'s existing pattern but a worse fit for a
   single-operator secret: a Firestore doc holding a shared token, checked the same way
   `team_token_index` is. Rejected for the reason above, noted here so the choice isn't silent.

The staged code below implements option 1. **This is a judgment call worth Jake's explicit
sign-off, not just this session's default** — flagged in §6.

## 6. Open judgment calls for Jake

1. **Access-control mechanism** — Secret Manager key (staged, §5 option 1) vs. a Firestore
   token like `orgDashboard` uses (§5 option 2). Staged code assumes option 1.
2. **`session_mode`** — leave out (current default) or add? It's a one-line change
   (`select()` list + output object) if you want it; it's arguably already covered by the
   contract-necessity basis rather than needing the R&D amendment at all, but it wasn't named in
   either amendment and this pass didn't add it unasked.
3. **Cross-walk linkage** — none, by default (§2). Only revisit if a specific tuning question
   genuinely needs "this same walker, multiple walks" rather than "many independent samples,"
   and treat that as a new privacy decision, not a code toggle.
4. **`carry_mode` / `device_model`** — deliberately excluded per §2. If you want them, that's a
   privacy sign-off (a fourth disclosure/use amendment) before it's a code change, not the other
   way around.
5. **Retroactive scope** — as designed, one run exports *every* `cleanups` doc ever written,
   including the anonymous-public-tester walks that predate either 2026-09-06 amendment's
   effective date. That's the whole point per `LAUNCH_LEDGER.md` ("the function recovers it
   retroactively... it has to exist before the data is worth anything"), but it's worth Jake
   consciously confirming rather than assuming, since those specific walks were collected before
   any detector-R&D use was disclosed at all. This spec doesn't resolve that; it's a policy
   question about backdating disclosed use to already-collected data, not an engineering one.

## 7. Staged code

`functions/detectorExport.staged.js` (new file, this session) — **not required or exported from
`index.js`, and deliberately so.**

### Deliberately not wired in

Every export in `functions/index.js` deploys together on the next
`firebase deploy --only functions` — and this repo's own history shows that command gets run for
unrelated reasons (the Overpass precache work, team-stats rebuilds, etc.). Adding this function's
`exports.exportDetectorTelemetry = ...` directly into `index.js` would mean the *next* unrelated
functions deploy ships this Cloud Function too, without Jake ever having reviewed *this* diff
specifically — exactly the kind of side-effect deploy this project's standing rules exist to
prevent (see the NYC-wide Overpass precache drip's "awaiting Jake's own direct go-ahead" note in
`LAUNCH_LEDGER.md` for the precedent). Keeping the code in a separate, unimported file means it
can only ship when someone deliberately adds one `require`/`exports` line to `index.js` — a
reviewable, obviously-intentional act, not a byproduct of deploying something else.

To wire it in when ready: add near the other exports in `index.js`

```js
const { exportDetectorTelemetry } = require('./detectorExport.staged');
exports.exportDetectorTelemetry = exportDetectorTelemetry;
```

then `firebase functions:secrets:set DETECTOR_EXPORT_KEY` (one time) before
`firebase deploy --only functions`.
