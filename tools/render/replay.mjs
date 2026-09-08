#!/usr/bin/env node
/**
 * replay.mjs — pick a walk or a challenge, get a social-ready video.
 *
 *   node tools/render/replay.mjs --list
 *   node tools/render/replay.mjs --walk <cleanupId>
 *   node tools/render/replay.mjs --challenge <challengeId>
 *
 *   --format 9:16 | 4:5 | 1:1     default 9:16
 *   --seconds 14                  default 14
 *   --zoom 420                    metres across the frame; lower = tighter
 *   --out path.mp4
 *
 * WHY IT LOOKS LIKE THIS. The map is a FOLLOW-CAM at street level, not a
 * fit-the-whole-walk view: the app's map is always full-bleed and pans with
 * you, and fitting the entire route into frame leaves it small with dead space
 * around it. Segments are coloured with the app's own freshness gradient from
 * real segment_status ages — mostly red and orange, because most cleaning
 * history is old. That colour field is what makes it read as the app.
 *
 * Segment ids come from the app's own chopWaysIntoSegments(), so they join to
 * segment_status exactly; nothing here re-implements the app's logic.
 *
 * No npm dependencies: headless Chrome over the DevTools Protocol for frames,
 * AVFoundation (tools/pngs-to-mp4) for encoding. Build the encoder once:
 *   swiftc -O tools/pngs-to-mp4.swift -o tools/pngs-to-mp4
 *
 * Needs ~/.secrets/pick-app/serviceAccountKey.json and Overpass access.
 */
import { spawn, execFileSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const APP = path.join(REPO, 'apps/companion');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENCODER = path.join(REPO, 'tools/pngs-to-mp4');
const FORMATS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080] };
const CACHE = path.join(os.tmpdir(), 'pick-replay-cache');

const argv = process.argv;
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes('--' + n);
const log = console.log;

async function fb() {
  const admin = (await import(path.join(APP, 'functions/node_modules/firebase-admin/lib/index.js'))).default;
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(`${os.homedir()}/.secrets/pick-app/serviceAccountKey.json`, 'utf8'))) });
  return admin;
}
const secsOf = (t) => (t && (t._seconds || t.seconds)) || (typeof t === 'number' ? t : 0);

/* ------------------------------------------------------------------ list */
async function list() {
  const db = (await fb()).firestore();
  const ch = await db.collection('challenges').get();
  log('\nCHALLENGES');
  const rows = [];
  ch.forEach((d) => { const x = d.data(); rows.push({ id: d.id, name: x.name,
    s: secsOf(x.start_date), e: secsOf(x.end_date) }); });
  rows.sort((a, b) => b.s - a.s);
  rows.forEach((r) => log(`  ${r.id}  ${new Date(r.s * 1000).toISOString().slice(0, 10)}  ${r.name || '(unnamed)'}`));

  const cl = await db.collection('cleanups')
    .select('timestamp', 'neighborhood', 'city', 'team', 'items_count', 'duration_seconds', 'route_points').get();
  const walks = [];
  cl.forEach((d) => { const x = d.data();
    let n = 0; try { n = JSON.parse(x.route_points || '[]').length; } catch {}
    if (n < 4) return;   // too few points to draw a route
    walks.push({ id: d.id, t: secsOf(x.timestamp), hood: x.neighborhood || x.city,
      team: x.team, items: x.items_count || 0, min: Math.round((x.duration_seconds || 0) / 60), n });
  });
  walks.sort((a, b) => b.t - a.t);
  log('\nWALKS with a drawable route (newest first)');
  log('  id                    date        min  items  pts  where');
  walks.slice(0, 25).forEach((w) => log(
    `  ${w.id}  ${new Date(w.t * 1000).toISOString().slice(0, 10)}  ${String(w.min).padStart(3)}  ${String(w.items).padStart(5)}  ${String(w.n).padStart(3)}  ${w.hood || ''}${w.team ? ' · ' + w.team : ''}`));
  log(`\n  ${walks.length} drawable walks total. Render one:\n    node tools/render/replay.mjs --walk ${walks[0] ? walks[0].id : '<id>'}\n`);
}

/* ------------------------------------------------------------------ data */
async function buildPayload(walkIds, label) {
  const admin = await fb(); const db = admin.firestore();
  const { chopWaysIntoSegments } = await import(path.join(APP, 'functions/shared/streetGeometry.js'));

  const walks = [];
  for (const id of walkIds) {
    const snap = await db.collection('cleanups').doc(id).get();
    if (!snap.exists) throw new Error(`cleanup ${id} not found`);
    const x = snap.data();
    const route = JSON.parse(x.route_points || '[]');
    if (route.length < 4) { log(`  skipping ${id}: only ${route.length} route points`); continue; }
    walks.push({ id, route, pickups: JSON.parse(x.pickups || '[]'),
      dur: x.duration_seconds || 0, items: x.items_count || 0,
      hood: x.neighborhood || x.city, team: x.team, ts: secsOf(x.timestamp) });
  }
  if (!walks.length) throw new Error('no walk had enough route points to draw');

  const pts = walks.flatMap((w) => w.route.concat(w.pickups));
  let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180;
  pts.forEach((p) => { mnLa = Math.min(mnLa, p[0]); mxLa = Math.max(mxLa, p[0]);
                       mnLo = Math.min(mnLo, p[1]); mxLo = Math.max(mxLo, p[1]); });
  const pad = 0.004;
  const bb = `${(mnLa-pad).toFixed(5)},${(mnLo-pad).toFixed(5)},${(mxLa+pad).toFixed(5)},${(mxLo+pad).toFixed(5)}`;

  // The app's own sidewalk query, as a bbox so one call covers the whole walk.
  const q = `[out:json][timeout:90];
(way["highway"="footway"]["footway"="sidewalk"](${bb});
 way["highway"~"^(pedestrian|path|living_street)$"](${bb}););
out geom;`;
  const key = bb.replace(/[^0-9a-zA-Z.-]/g, '_') + '.json';
  const cacheFile = path.join(CACHE, key);
  let json = null;
  if (fs.existsSync(cacheFile)) { json = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); log('     geometry from cache'); }
  else {
    for (const m of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try {
        const r = await fetch(m, { method: 'POST', body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PICK-cleanup-app/1.0 (replay render)' } });
        if (!r.ok) { log(`     ${m} -> ${r.status}`); continue; }
        json = await r.json();
        try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(json)); } catch {}
        break;
      } catch (e) { log(`     ${m} failed: ${e.message}`); }
    }
  }
  if (!json) throw new Error('every Overpass mirror failed');

  const segs = chopWaysIntoSegments(json);
  const grids = [...new Set(segs.map((s) => s.grid))];
  const status = new Map();
  for (let i = 0; i < grids.length; i += 10) {
    const snap = await db.collection('segment_status').where('grid', 'in', grids.slice(i, i + 10)).get();
    snap.forEach((d) => status.set(d.id, d.data().last_cleaned));
  }
  const now = Date.now();
  const out = segs.map((s) => {
    const lc = status.get(s.id);
    return { c: s.coords.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]),
             d: lc ? Math.round((now - lc) / 86400000 * 10) / 10 : null };
  });
  const withAge = out.filter((s) => s.d !== null).length;
  log(`     ${segs.length} segments · ${withAge} with a recorded cleaning age`);

  // Multi-walk is concatenated into one track for now: a shared-clock group
  // replay needs per-crew cameras, which the follow-cam design does not yet
  // express. Stated rather than silently flattened.
  const route = walks.flatMap((w) => w.route);
  const pickups = walks.flatMap((w) => w.pickups);
  return { route, pickups, segs: out,
    meta: { hood: walks[0].hood, team: label || walks[0].team,
            dur: walks.reduce((n, w) => n + w.dur, 0),
            items: walks.reduce((n, w) => n + w.items, 0), walks: walks.length } };
}

/* --------------------------------------------------------------- render */
async function render(payload, W, H, secs, outPath, zoom) {
  const fps = 30, total = secs * fps;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-replay-'));
  const page = path.join(dir, 'f.html');
  fs.writeFileSync(page, fs.readFileSync(path.join(HERE, 'app-frame.html'), 'utf8')
    .replace('__DATA__', JSON.stringify(payload))
    .replace('__CONFIG__', JSON.stringify({ width: W, height: H, metresAcross: zoom })));

  const port = 9600 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}/prof`, '--no-first-run', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws, id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  try {
    let list = null;
    for (let i = 0; i < 60; i++) { await wait(250);
      try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); list = await r.json();
            if (list.some((t) => t.type === 'page')) break; } catch {} }
    ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (e) => { const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file://' + page });
    for (let i = 0; i < 80; i++) { await wait(150);
      const r = await send('Runtime.evaluate', { expression:
        'Boolean(window.PICK&&window.PICK.ready&&document.fonts&&document.fonts.status==="loaded")', returnByValue: true });
      if (r.result && r.result.value) break; }
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      await send('Runtime.evaluate', { expression: `window.PICK.frame(${(f / (total - 1)).toFixed(6)})` });
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(dir, `frame-${String(f).padStart(5, '0')}.png`), Buffer.from(s.data, 'base64'));
      if (f % 90 === 0) process.stdout.write(`\r     ${f}/${total}`);
    }
    process.stdout.write(`\r     ${total}/${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    log('     ' + execFileSync(ENCODER, [dir, outPath, '30'], { encoding: 'utf8' }).trim());
  } finally {
    try { ws && ws.close(); } catch {}
    chrome.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/* ----------------------------------------------------------------- main */
(async () => {
  if (has('list')) { await list(); process.exit(0); }
  const walkId = arg('walk'), chId = arg('challenge');
  if (!walkId && !chId) {
    console.error('usage: replay.mjs --list | --walk <id> | --challenge <id>  [--format 9:16] [--seconds 14] [--zoom 420]');
    process.exit(2);
  }
  const fmt = arg('format', '9:16');
  if (!FORMATS[fmt]) { console.error(`--format must be one of ${Object.keys(FORMATS).join(', ')}`); process.exit(2); }
  const [W, H] = FORMATS[fmt];
  const secs = Number(arg('seconds', 14));
  const zoom = Number(arg('zoom', 420));
  if (!fs.existsSync(ENCODER)) throw new Error(`encoder missing — build once:\n  swiftc -O ${ENCODER}.swift -o ${ENCODER}`);

  let ids = [], label = null;
  if (chId) {
    const db = (await fb()).firestore();
    const c = await db.collection('challenges').doc(chId).get();
    if (!c.exists) throw new Error(`challenge ${chId} not found`);
    const x = c.data(); label = x.name;
    const s = secsOf(x.start_date), e = secsOf(x.end_date) + 86400;
    const cl = await db.collection('cleanups').select('timestamp', 'route_points').get();
    cl.forEach((d) => { const t = secsOf(d.data().timestamp);
      let n = 0; try { n = JSON.parse(d.data().route_points || '[]').length; } catch {}
      if (t >= s && t <= e && n >= 4) ids.push(d.id); });
    log(`\nPICK replay — challenge "${label}" · ${ids.length} drawable walks`);
  } else { ids = [walkId]; log(`\nPICK replay — walk ${walkId}`); }

  const out = path.resolve(arg('out', `pick-replay-${(chId || walkId).slice(0, 8)}-${fmt.replace(':', 'x')}.mp4`));
  log(`  ${fmt} (${W}x${H}) · ${secs}s · ${zoom}m across\n`);
  log('1/3  reading walks + street geometry…');
  const payload = await buildPayload(ids, label);
  log('2/3  rendering…');
  await render(payload, W, H, secs, out, zoom);
  log(`\n✓ ${out}\n`);
})().catch((e) => { console.error('\nFAILED: ' + (e && e.message ? e.message : e)); process.exit(1); });
