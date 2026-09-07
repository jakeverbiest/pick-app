/**
 * STAGED — NOT DEPLOYED, NOT WIRED IN.
 *
 * This file is not required or exported from index.js on purpose. Every export in index.js
 * deploys together on the next `firebase deploy --only functions`, and this repo has a real
 * history of that command running for unrelated reasons (Overpass precache work, team-stats
 * rebuilds). Wiring this in directly would mean the next unrelated functions deploy ships this
 * Cloud Function too, without anyone reviewing this diff specifically. See
 * docs/DETECTOR_EXPORT_SPEC.md ("Deliberately not wired in") for the full reasoning.
 *
 * To activate (after Jake reviews docs/DETECTOR_EXPORT_SPEC.md and this file):
 *   1. `firebase functions:secrets:set DETECTOR_EXPORT_KEY` (one-time; picks the operator key)
 *   2. In index.js, near the other exports:
 *        const { exportDetectorTelemetry } = require('./detectorExport.staged');
 *        exports.exportDetectorTelemetry = exportDetectorTelemetry;
 *   3. `firebase deploy --only functions`
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS DOES
 *
 * On demand (HTTP GET, not scheduled — the whole point is retroactive recovery of telemetry
 * already sitting in Firestore, per LAUNCH_LEDGER.md's "Detector export CF" row), scans every
 * `cleanups` document, keeps only an explicit field allowlist, and writes one NDJSON line per
 * walk to Cloud Storage. Nothing is written back to Firestore. Nothing is returned to the caller
 * except a signed URL to the resulting file.
 *
 * PRIVACY SCOPE (see docs/DETECTOR_EXPORT_SPEC.md §2 for the full reasoning against the actual
 * 2026-09-06 privacy-policy amendments):
 *   - IN:  items_detected, items_count, pace_median_mps, pace_slow_share, pace_low_confidence,
 *          duration_seconds, motion_log (parsed, per-event), ground_truth (parsed, if present),
 *          a day-granularity date bucket.
 *   - OUT: userId, cleanup doc id, location_lat/lon, city, neighborhood, route_points, notes,
 *          team, carry_mode, device_model, session_mode, exact timestamp.
 *   - `carry_mode`/`device_model` are excluded because today's privacy policy only discloses
 *     COLLECTING them, not USING them for cross-tester analysis — see the spec's §2 before ever
 *     adding them here.
 *   - No per-user key of any kind is included, hashed or otherwise — each row is independent,
 *     by design (spec §2, "No cross-walk linkage").
 * ---------------------------------------------------------------------------------------------
 */

const { onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore } = require('firebase-admin/firestore');
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
  'timestamp', // reduced to a day bucket below, exact value never emitted
];

function dayBucket(timestampSeconds) {
  if (typeof timestampSeconds !== 'number' || !Number.isFinite(timestampSeconds)) return null;
  // Cleanup timestamps are stored in epoch seconds elsewhere in this codebase
  // (see activity.tsx's exportCleanup: `new Date(cleanup.timestamp * 1000)`).
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10); // 'YYYY-MM-DD'
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
  };
}

/**
 * exportDetectorTelemetry — HTTPS GET, secret-gated.
 *
 * Query params:
 *   key    (required) must equal the DETECTOR_EXPORT_KEY secret.
 *   since  (optional) ISO date (YYYY-MM-DD); only cleanups with timestamp >= this day.
 *   until  (optional) ISO date (YYYY-MM-DD); only cleanups with timestamp <= this day.
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

    let q = db.collection('cleanups').select(...ALLOWED_TOP_LEVEL_FIELDS).orderBy('timestamp', 'asc');

    const sinceParam = req.query.since ? Date.parse(String(req.query.since)) : null;
    const untilParam = req.query.until ? Date.parse(String(req.query.until)) : null;
    if (sinceParam) q = q.where('timestamp', '>=', Math.floor(sinceParam / 1000));
    if (untilParam) q = q.where('timestamp', '<=', Math.floor(untilParam / 1000));

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const objectPath = `detector_exports/${stamp}.ndjson`;
    const file = bucket.file(objectPath);
    const stream = file.createWriteStream({ contentType: 'application/x-ndjson' });

    let rowCount = 0;
    let cursor = null;

    try {
      // Manual pagination rather than a single `.get()` on the whole
      // collection — this repo already has full-collection scans elsewhere
      // (rebuildTeamStats, orgDashboard's cold-start fallback) but this
      // export is meant to run against the WHOLE history since launch, which
      // is a materially larger and still-growing read than either of those.
      for (;;) {
        let page = q.limit(PAGE_SIZE);
        if (cursor) page = page.startAfter(cursor);
        const snap = await page.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
          const row = buildTelemetryRow(doc.data());
          stream.write(JSON.stringify(row) + '\n');
          rowCount += 1;
        }

        cursor = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_SIZE) break;
      }

      await new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.on('finish', resolve);
        stream.end();
      });

      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });

      res.json({
        ok: true,
        object_path: objectPath,
        row_count: rowCount,
        download_url: signedUrl,
        expires_in_seconds: 3600,
      });
    } catch (e) {
      console.error('exportDetectorTelemetry failed', e);
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  }
);

module.exports = { exportDetectorTelemetry, buildTelemetryRow, ALLOWED_TOP_LEVEL_FIELDS };
