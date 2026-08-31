#!/usr/bin/env node
/**
 * create-sponsor-team.js — one-off tool to onboard a real civic-org/BID
 * sponsor: creates an area-scoped "sponsor" team via the createSponsorTeam
 * callable, retrieves its dashboard token, and prints the ready-to-hand-over
 * pickglobal.org/org.html?token=... URL.
 *
 * There's no in-app or admin UI for this yet (CIVIC_ORG_DASHBOARD_SPEC.md
 * scoped backend + website page only) — this script is that missing step,
 * meant to be run by hand whenever a real sponsor is ready, not automated.
 *
 * Usage:
 *   node create-sponsor-team.js --name "Example BID" --type neighborhood --label "Park Slope"
 *   node create-sponsor-team.js --name "Example BID" --type custom \
 *     --ring '[40.68,-73.99,40.69,-73.99,40.69,-73.98,40.68,-73.98]' --label "Downtown District" \
 *     --goal-type bags --goal-value 500
 *
 * area.ring is flat [lat,lon,lat,lon,...], at least 3 points (6 numbers) — the
 * same encoding used everywhere else in this codebase for polygon rings.
 * Requires ~/.secrets/pick-app/serviceAccountKey.json and the app's Firebase
 * Web API key (reads EXPO_PUBLIC_FIREBASE_API_KEY from apps/companion/../.env,
 * i.e. the repo-root .env — same place every other admin script in this repo
 * reads it from).
 */
const admin = require('/Users/jakeverbiest/Desktop/pick-app/apps/companion/functions/node_modules/firebase-admin');
const https = require('https');
const fs = require('fs');
const path = require('path');

const KEY_PATH = '/Users/jakeverbiest/.secrets/pick-app/serviceAccountKey.json';
const PROJECT_ID = 'pick-app-74c2e';
const REGION = 'us-central1';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

function readWebApiKey() {
  const envPath = path.join(__dirname, '.env');
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content.split('\n').find((l) => l.startsWith('EXPO_PUBLIC_FIREBASE_API_KEY='));
  if (!line) throw new Error('EXPO_PUBLIC_FIREBASE_API_KEY not found in ' + envPath);
  return line.split('=').slice(1).join('=').trim();
}

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function callCallable(name, data, idToken) {
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
  const resp = await postJson(url, { data }, { Authorization: `Bearer ${idToken}` });
  if (resp.body && resp.body.error) {
    throw new Error(`${name} failed: ${resp.body.error.message || JSON.stringify(resp.body.error)}`);
  }
  return resp.body.result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name || !args.type) {
    console.error('Usage: node create-sponsor-team.js --name "Org Name" --type neighborhood|custom [--label "..."] [--ring "[lat,lon,...]"] [--goal-type pickups|bags|cleanups --goal-value N]');
    console.error('("anywhere" is not a valid sponsor area — it would expose the whole platform\'s activity, not a district.)');
    process.exit(2);
  }

  const area = { type: args.type, label: args.label || '' };
  if (args.type === 'custom') {
    if (!args.ring) throw new Error('--ring is required for --type custom');
    area.ring = JSON.parse(args.ring);
  }

  let goal = null;
  if (args['goal-type'] && args['goal-value']) {
    goal = { type: args['goal-type'], value: Number(args['goal-value']) };
  }

  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
  const apiKey = readWebApiKey();

  console.log('Authenticating as admin...');
  const customToken = await admin.auth().createCustomToken('sponsor-onboarding-script');
  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const signInResp = await postJson(signInUrl, { token: customToken, returnSecureToken: true });
  if (!signInResp.body.idToken) throw new Error('Failed to exchange custom token: ' + JSON.stringify(signInResp.body));
  const idToken = signInResp.body.idToken;

  console.log(`Creating sponsor team "${args.name}"...`);
  // createSponsorTeam returns { id, name, token } directly — no separate
  // getTeamToken call needed for a fresh creation (that callable exists for
  // the case of retrieving the token again later, e.g. if the link is lost).
  const created = await callCallable('createSponsorTeam', { name: args.name, area, goal }, idToken);
  console.log('Created:', JSON.stringify(created, null, 2));

  const dashboardUrl = `https://pickglobal.org/org.html?token=${created.token}`;
  console.log('\n=== Done ===');
  console.log('Team:', args.name);
  console.log('Dashboard URL to hand to the sponsor:');
  console.log(dashboardUrl);
}

main().catch((e) => { console.error(e); process.exit(1); });
