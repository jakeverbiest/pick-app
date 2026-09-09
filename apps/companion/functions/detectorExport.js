/**
 * LIVE as of 2026-09-07 — wired into index.js and deployed on Jake's explicit
 * instruction. Renamed from detectorExport.staged.js at that point: a deployed
 * file called ".staged" is precisely the stale label this repo keeps getting
 * caught by, so the name moved with the status.
 *
 * The original "deliberately not wired in" reasoning (every export in index.js
 * ships on any `firebase deploy --only functions`, and that command runs here
 * for unrelated reasons) was about not shipping this WITHOUT review. It has now
 * been reviewed and shipped on purpose. See docs/DETECTOR_EXPORT_SPEC.md.
 *
 * WHY IT EXISTS: the detector is validated on exactly one person. Real org
 * walkers generate telemetry that is otherwise unreadable in bulk, so without
 * this the detector cannot move past n=1. Its value is privacy posture as much
 * as access — analyzing a non-identifying derivative rather than routinely
 * reading raw owner-scoped cleanup documents (which the admin SDK can already
 * do, and which is the heavier thing to be in the habit of).
 *
 * ---------------------------------------------------------------------------------------------
 * RETROACTIVE SCOPE — DECIDED 2026-09-07 BY JAKE. READ BEFORE ANY UNBOUNDED RUN.
 *
 * Called with no `user` and no `since`, this exports EVERY cleanup ever written,
 * including walks recorded before the 2026-09-06 privacy-policy amendment that
 * disclosed detector R&D as a use.
 *
 * THE STANDING DECISION IS: DON'T. Export Jake's own account only.
 *
 * The reasoning, so it survives the people who made it: of the 162
 * detector-bearing walks, 138 belong to Jake's own account (confirmed by him
 * 2026-09-07). Using your own data raises no policy question at all. The
 * remainder is ~24 walks from two other testers, collected before the
 * disclosure — and 24 walks from two people does not get anyone off n=1
 * either, so retroactive use buys almost nothing while spending the clean
 * claim that PICK only ever analyzed data collected under a policy that
 * disclosed it. Bad trade, and only tempting because "162" reads bigger than
 * it is.
 *
 * So: pass `user=<uid>`. Use `since=2026-09-06` if you ever need a
 * genuinely policy-bounded corpus across all accounts. An unbounded run is a
 * decision to reverse the above, not a default.
 *
 * WIDENED 2026-09-09 BY JAKE — FORWARD ONLY, NOT RETROACTIVE.
 *
 * The above still stands for every account that already existed. What changed
 * is that NEW signups can now consent, via a disclosure shown at account
 * creation, and `scope=consented` exports those accounts and only those.
 *
 * Three separate things have to be true before a walk appears in that scope,
 * and each is enforced in code rather than by convention:
 *   1. `users/{uid}.detector_telemetry_consent == true` — written only by the
 *      account-creation path, only when the disclosure copy actually rendered
 *      (src/constants/legal.ts DETECTOR_DISCLOSURE_TEXT/VERSION). Absent on
 *      every pre-existing account, and absence is treated as "no", never as
 *      "unknown".
 *   2. The account has a readable `detector_telemetry_consent_at`. Flagged but
 *      undatable accounts are skipped, not exported.
 *   3. The walk's own timestamp is at or after that consent moment.
 *
 * (3) is what makes this forward-only rather than a policy claim: even if a
 * pre-existing account somehow acquired the flag, its earlier walks are still
 * outside every pass's since-floor. Widening to already-collected data would
 * mean deleting that check, which is a decision to be made out loud.
 *
 * Until the disclosure copy lands, `scope=consented` correctly returns zero
 * accounts and an empty file.
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS DOES
 *
 * On demand (HTTP GET, not scheduled — the whole point is retroactive recovery of telemetry
 * already sitting in Firestore, per LAUNCH_LEDGER.md's "Detector export CF" row), scans every
 * `cleanups` document, keeps only an explicit field allowlist, and writes one NDJSON line per
 * walk to Cloud Storage. Nothing is written back to Firestore. Nothing is returned to the caller
 * except the object's path and, when the runtime can sign one, a short-lived download URL —
 * see the signing block below for why that link is best-effort rather than guaranteed.
 *
 * PRIVACY SCOPE (see docs/DETECTOR_EXPORT_SPEC.md §2 for the full reasoning against the actual
 * 2026-09-06 privacy-policy amendments):
 *   - IN:  items_detected, items_count, pace_median_mps, pace_slow_share, pace_low_confidence,
 *          duration_seconds, motion_log (parsed, per-event), ground_truth (parsed, if present),
 *          carry_mode, device_model, a day-granularity date bucket.
 *   - OUT: userId, cleanup doc id, location_lat/lon, city, neighborhood, route_points, notes,
 *          team, session_mode, exact timestamp.
 *   - `carry_mode`/`device_model` were excluded in the staged version on the belief that policy
 *     disclosed only COLLECTING them. CORRECTED 2026-09-07 by reading the actual text: both
 *     content-carrying copies (web/privacy.html and src/constants/legal.ts, both dated
 *     2026-09-06) disclose the USE explicitly — "your walking pace, and the device model and
 *     carry position above — to measure and improve detection accuracy" — and legal.ts goes
 *     further, saying both are "kept only to make the detection-accuracy work below
 *     meaningful." Excluding them was over-conservative against a policy that had already moved.
 *     They are the two fields that let a multi-tester corpus be stratified by phone and carry
 *     position, which is the entire point of getting past n=1.
 *     Reality check, so nobody expects more than this delivers: as of 2026-09-07 `carry_mode`
 *     is present on ZERO of 206 cleanups and `device_model` on ONE. That instrumentation
 *     shipped 2026-09-06 and almost nobody has walked since. This is a prospective unlock, not
 *     a retroactive one.
 *   - No per-user key of any kind is included, hashed or otherwise — each row is independent,
 *     by design (spec §2, "No cross-walk linkage"). The `user` query param below FILTERS by
 *     account without ever emitting it, which is a different thing: Firestore's select()
 *     projection controls what is READ BACK, while where() can still match on a field that is
 *     never returned.
 * ---------------------------------------------------------------------------------------------
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const DETECTOR_EXPORT_KEY = defineSecret('DETECTOR_EXPORT_KEY');

// Matches this repo's existing batch size for large Firestore scans elsewhere
// (see the Overpass precache drip's batching rationale) — small enough that
// one page can't blow function memory even on a large collection, large
// enough that a full-collection export doesn't take an unreasonable number
// of round-trips.
const PAGE_SIZE = 500;

// Exhaustive. Anything not listed here is never read out of Firestore in the
// first place (see the Firestore `select()` call below) — this is not a
// "read everything, filter after" design.
const ALLOWED_TOP_LEVEL_FIELDS = [
  'items_detected',
  'items_count',
  'pace_median_mps',
  'pace_slow_share',
  'pace_low_confidence',
  'duration_seconds',
  'motion_log', // stored as a JSON string; parsed below
  'ground_truth', // stored as a JSON string; parsed below, may be absent
  'carry_mode', // 'pocket' | 'hand' | absent when the app wasn't confident
  'device_model', // hardware model string, never the user-set device NAME
  'timestamp', // reduced to a day bucket below, exact value never emitted
];

/**
 * Cleanup timestamps are NOT plain numbers, whatever the client-side code
 * suggests. Confirmed against production 2026-09-07: `cleanups.timestamp` is
 * a Firestore Timestamp, which arrives from the admin SDK as an object
 * (`{_seconds, _nanoseconds}`, with a `toDate()`/`toMillis()` on the real
 * instance). The first version of this file assumed epoch seconds because
 * activity.tsx's exportCleanup does `new Date(cleanup.timestamp * 1000)`,
 * and that assumption silently produced `"date": null` on all 172 rows of
 * the first real export — no error, no warning, just a corpus with its only
 * temporal dimension missing.
 *
 * Accepts every shape rather than betting on one, since a collection this
 * old plausibly holds more than one.
 */
function toEpochSeconds(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v.toMillis === 'function') return v.toMillis() / 1000;
  if (typeof v.seconds === 'number') return v.seconds;
  if (typeof v._seconds === 'number') return v._seconds;
  return null;
}

/**
 * Consent timestamps are MILLISECONDS, and this is deliberately NOT
 * toEpochSeconds().
 *
 * `users/{uid}.detector_telemetry_consent_at` is written client-side as
 * `Date.now()`, matching that document's existing `created_at`/`updated_at`
 * convention — epoch MILLIS as a plain number. `cleanups.timestamp` is a
 * Firestore Timestamp. Two collections, two conventions.
 *
 * Feeding a millis number to toEpochSeconds() returns it unchanged as
 * "seconds", i.e. a consent moment somewhere around the year 57000, which
 * silently filters out every walk the person ever recorded and reports a
 * successful 0-row export. That failure mode is exactly the one this file's
 * header already records for `cleanups.timestamp` — same shape, different
 * field — so it is spelled out rather than left to the next reader.
 *
 * A Timestamp is still accepted in case this field is ever written
 * server-side, and a number is sanity-checked so a seconds-valued write
 * doesn't get divided a second time: anything below 1e11 (≈ year 5138 in
 * seconds, ≈ 1973 in millis) is read as already-seconds.
 */
function consentEpochSeconds(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return v >= 1e11 ? Math.floor(v / 1000) : Math.floor(v);
  }
  return toEpochSeconds(v);
}

function dayBucket(timestamp) {
  const secs = toEpochSeconds(timestamp);
  if (secs === null) return null;
  return new Date(secs * 1000).toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

/**
 * Builds one non-identifying telemetry row from a raw cleanups doc's data.
 * Exported separately so a future test can call it directly against fixture
 * data without spinning up an HTTP request.
 */
function buildTelemetryRow(data) {
  let motionLog = null;
  if (typeof data.motion_log === 'string' && data.motion_log.length > 0) {
    try {
      motionLog = JSON.parse(data.motion_log);
    } catch (e) {
      motionLog = 'unparseable';
    }
  }

  let groundTruth = null;
  if (typeof data.ground_truth === 'string' && data.ground_truth.length > 0) {
    try {
      groundTruth = JSON.parse(data.ground_truth);
    } catch (e) {
      groundTruth = 'unparseable';
    }
  }

  return {
    date: dayBucket(data.timestamp),
    items_detected: typeof data.items_detected === 'number' ? data.items_detected : null,
    items_count: typeof data.items_count === 'number' ? data.items_count : null,
    pace_median_mps: typeof data.pace_median_mps === 'number' ? data.pace_median_mps : null,
    pace_slow_share: typeof data.pace_slow_share === 'number' ? data.pace_slow_share : null,
    pace_low_confidence: typeof data.pace_low_confidence === 'boolean' ? data.pace_low_confidence : null,
    duration_seconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : null,
    motion_log: motionLog, // array of MotionEventRecord, or null/'unparseable'
    ground_truth: groundTruth, // array of numbers (walk-seconds), or null/'unparseable'
    carry_mode: typeof data.carry_mode === 'string' ? data.carry_mode : null,
    device_model: typeof data.device_model === 'string' ? data.device_model : null,
  };
}

/**
 * exportDetectorTelemetry — HTTPS GET, secret-gated.
 *
 * Query params:
 *   key    (required) must equal the DETECTOR_EXPORT_KEY secret.
 *   since  (optional) ISO date (YYYY-MM-DD); only cleanups with timestamp >= this day.
 *   until  (optional) ISO date (YYYY-MM-DD); only cleanups with timestamp <= this day.
 *   user   (optional) Firebase uid; export only that account's walks. The uid is used as a
 *          FILTER only and never appears in the output — see the PRIVACY SCOPE note above.
 *   scope  (optional) only value: 'consented'. Exports every account carrying a recorded
 *          detector-telemetry consent, each bounded to walks at or after that account's own
 *          consent moment. Mutually exclusive with `user`. See the RETROACTIVE SCOPE block
 *          at the top of this file.
 *
 * No CORS header is set — this is an operator tool hit directly (curl, browser address bar with
 * the key in the query string, or a local script), not called from pickglobal.org's client-side
 * JS the way orgDashboard is.
 */
const exportDetectorTelemetry = onRequest(
  { secrets: [DETECTOR_EXPORT_KEY], timeoutSeconds: 1800, memory: '512MiB' },
  async (req, res) => {
    const key = String(req.query.key || '');
    if (!key || key !== DETECTOR_EXPORT_KEY.value()) {
      res.status(403).json({ ok: false, error: 'missing or invalid key' });
      return;
    }

    const db = getFirestore();
    const bucket = getStorage().bucket();

    const sinceParam = req.query.since ? Date.parse(String(req.query.since)) : null;
    const untilParam = req.query.until ? Date.parse(String(req.query.until)) : null;
    const sinceSec = sinceParam ? Math.floor(sinceParam / 1000) : null;
    const untilSec = untilParam ? Math.floor(untilParam / 1000) : null;

    // `user` scopes the export to ONE account. Added 2026-09-07 for the
    // retroactivity decision recorded in LEDGER_INBOX.md: 138 of the 162
    // detector-bearing walks belong to Jake's own account, and using his own
    // data raises no policy question at all, while the ~24 walks belonging to
    // other testers predate the 2026-09-06 disclosure. Scoping the export is
    // what lets the useful 85% be worked on without deciding the retroactive
    // question for anyone else.
    //
    // userId is deliberately NOT in ALLOWED_TOP_LEVEL_FIELDS. select() limits
    // what is read back; where() still matches on fields outside that
    // projection. So this filters by account and the account id never appears
    // in the output — the no-cross-walk-linkage guarantee is unchanged.
    const userFilter = String(req.query.user || '').trim();

    // `scope=consented` — added 2026-09-09 for Jake's decision to widen the
    // export to NEW SIGNUPS ONLY, gated on the disclosure shown at account
    // creation (src/constants/legal.ts DETECTOR_DISCLOSURE_*). Existing users
    // and every pre-disclosure walk stay out.
    //
    // Additive on purpose. Passing no `scope` leaves every existing code path
    // byte-for-byte as it behaved on the 2026-09-08 run, so this file landing
    // in an unrelated `firebase deploy --only functions` cannot change what an
    // existing invocation does. Widening the corpus takes someone typing the
    // parameter.
    const scope = String(req.query.scope || '').trim();
    if (scope && scope !== 'consented') {
      res.status(400).json({ ok: false, error: `unknown scope '${scope}' (only 'consented' is supported)` });
      return;
    }
    if (scope === 'consented' && userFilter) {
      res.status(400).json({ ok: false, error: "pass either 'user' or 'scope=consented', not both" });
      return;
    }

    let q = db.collection('cleanups').select(...ALLOWED_TOP_LEVEL_FIELDS);
    let filterDatesInMemory = false;

    if (userFilter || scope === 'consented') {
      // No orderBy, and no timestamp where(): either combined with this
      // equality filter would demand a composite index on
      // (userId, timestamp), and standing up an index for a hand-run
      // operator tool is not worth it. Pagination still works — without an
      // explicit orderBy, Firestore pages by document id, which is
      // deterministic, so startAfter() is safe. since/until are applied in
      // memory below instead, and rows are sorted by date before writing.
      // Sound at this corpus size (206 documents total); if `cleanups` ever
      // reaches a size where buffering one account's walks is a problem,
      // create the composite index and drop this branch.
      filterDatesInMemory = true;
    } else {
      q = q.orderBy('timestamp', 'asc');
      // Compare against a Timestamp, not a number. Firestore orders values by
      // TYPE first, so a `where('timestamp', '>=', <number>)` against a
      // Timestamp-typed field does not mean "later than this date" — it means
      // "any value whose type sorts at or after number", which silently
      // matches or drops the whole collection depending on the operator. That
      // is why the first bounded run reported 0 rows and looked like a
      // legitimately empty window.
      if (sinceSec !== null) q = q.where('timestamp', '>=', Timestamp.fromMillis(sinceSec * 1000));
      if (untilSec !== null) q = q.where('timestamp', '<=', Timestamp.fromMillis(untilSec * 1000));
    }

    // One "pass" per account to scan (a single unscoped pass on the default
    // path). Each pass carries its OWN since-floor, which is what lets the
    // consent cutoff be enforced per person rather than as one global date.
    let passes = [{ uid: null, sinceSec, untilSec }];
    let consentedAccounts = null;
    let skippedNoConsentAt = 0;

    if (scope === 'consented') {
      // Single-field equality, so Firestore's automatic single-field index
      // serves it — nothing to create before the first run.
      //
      // This fails closed on absence, which is the entire mechanism: every
      // account that existed before the disclosure shipped has no such field,
      // is therefore not returned here, and never enters the scan below. There
      // is no "unknown, assume yes" path.
      //
      // Only the two consent fields are read off `users` — no display name,
      // email or neighborhood enters function memory, same select()-projection
      // discipline the cleanups read uses.
      const consentSnap = await db
        .collection('users')
        .where('detector_telemetry_consent', '==', true)
        .select('detector_telemetry_consent_at')
        .get();

      passes = [];
      for (const d of consentSnap.docs) {
        const consentSec = consentEpochSeconds(d.get('detector_telemetry_consent_at'));
        if (consentSec === null) {
          // Flagged as consented but with no usable consent moment. SKIPPED,
          // not exported: without a timestamp there is no way to demonstrate a
          // given walk post-dates the disclosure, and "probably fine" isn't the
          // standard for the one guarantee this scope exists to make. Surfaced
          // in the response so a nonzero count gets noticed rather than
          // silently shrinking the corpus.
          skippedNoConsentAt += 1;
          continue;
        }
        passes.push({
          uid: d.id,
          // The stricter of the operator's `since` and this account's own
          // consent moment. A walk recorded before that person consented is
          // never exported, whatever `since` says.
          sinceSec: sinceSec === null ? consentSec : Math.max(sinceSec, consentSec),
          untilSec,
        });
      }
      consentedAccounts = passes.length;
    } else if (userFilter) {
      passes = [{ uid: userFilter, sinceSec, untilSec }];
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const objectPath = `detector_exports/${stamp}.ndjson`;
    const file = bucket.file(objectPath);
    const stream = file.createWriteStream({ contentType: 'application/x-ndjson' });

    let rowCount = 0;
    const buffered = []; // only used on the per-account branches, see above

    try {
      // Manual pagination rather than a single `.get()` on the whole
      // collection — this repo already has full-collection scans elsewhere
      // (rebuildTeamStats, orgDashboard's cold-start fallback) but this
      // export is meant to run against the WHOLE history since launch, which
      // is a materially larger and still-growing read than either of those.
      //
      // One scan per consenting account rather than a single `userId in [...]`
      // batch of 30: the per-account consent cutoff needs to know WHICH account
      // a document belongs to, and `userId` is deliberately outside the
      // select() projection, so the only place that association exists is the
      // loop variable. Cheap at new-signup scale; if consenting accounts ever
      // reach the hundreds, replace the per-account cutoff with a single global
      // disclosure-date floor and batch the queries.
      for (const pass of passes) {
        const passQuery = pass.uid ? q.where('userId', '==', pass.uid) : q;
        let cursor = null;
        for (;;) {
          let page = passQuery.limit(PAGE_SIZE);
          if (cursor) page = page.startAfter(cursor);
          const snap = await page.get();
          if (snap.empty) break;

          for (const doc of snap.docs) {
            const data = doc.data();
            if (filterDatesInMemory) {
              // The date window couldn't go into the query on this branch (see
              // the userFilter comment above), so it is applied here against
              // the same epoch-seconds field the query would have used. A doc
              // whose timestamp can't be read is DROPPED whenever a floor is
              // set — on the consented path a floor is always set, so an
              // undatable walk can never slip past the consent cutoff.
              const ts = toEpochSeconds(data.timestamp);
              if (pass.sinceSec !== null && (ts === null || ts < pass.sinceSec)) continue;
              if (pass.untilSec !== null && (ts === null || ts > pass.untilSec)) continue;
              buffered.push(buildTelemetryRow(data));
              continue;
            }
            stream.write(JSON.stringify(buildTelemetryRow(data)) + '\n');
            rowCount += 1;
          }

          cursor = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < PAGE_SIZE) break;
        }
      }

      if (filterDatesInMemory) {
        // Document-id order is meaningless for analysis; emit oldest-first so
        // the file reads chronologically like the unfiltered path does.
        buffered.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        for (const row of buffered) {
          stream.write(JSON.stringify(row) + '\n');
          rowCount += 1;
        }
      }

      await new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', resolve);
        stream.end();
      });

      // The signed URL is a CONVENIENCE, not the deliverable — the export is
      // the object in Cloud Storage, and it is already written by this point.
      // Signing must therefore never fail the request.
      //
      // Confirmed live on the first real invocation 2026-09-07: getSignedUrl
      // needs `iam.serviceAccounts.signBlob` on the runtime service account,
      // which the default compute account does NOT have, so this threw and
      // took a perfectly good export down with it as an HTTP 500 — the file
      // was sitting in the bucket the whole time. Granting
      // roles/iam.serviceAccountTokenCreator would fix the signing, but that
      // is a broad permission to hand a function purely for a download link,
      // so the link is optional instead and the object path is always
      // returned.
      let signedUrl = null;
      let signingError = null;
      try {
        [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });
      } catch (e) {
        signingError = String((e && e.message) || e);
        console.warn(`exportDetectorTelemetry: could not sign a download URL (export itself is fine): ${signingError}`);
      }

      res.json({
        ok: true,
        object_path: objectPath,
        row_count: rowCount,
        // Present only on scope=consented. `consented_accounts: 0` is the
        // expected result until the disclosure copy ships and someone signs up
        // under it — an empty file then is correct, not a bug.
        ...(scope === 'consented'
          ? { scope, consented_accounts: consentedAccounts, skipped_no_consent_at: skippedNoConsentAt }
          : {}),
        ...(signedUrl
          ? { download_url: signedUrl, expires_in_seconds: 3600 }
          : {
              download_url: null,
              signing_error: signingError,
              fetch_with: `gcloud storage cp gs://${bucket.name}/${objectPath} .`,
            }),
      });
    } catch (e) {
      console.error('exportDetectorTelemetry failed', e);
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  }
);

module.exports = { exportDetectorTelemetry, buildTelemetryRow, ALLOWED_TOP_LEVEL_FIELDS };
