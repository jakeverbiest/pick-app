#!/usr/bin/env node
/**
 * render-video.mjs — turn a real PICK cleanup into a social video.
 *
 * THE POINT. A screen recording of a live walk is close to self-defeating:
 * capturing the map means holding the phone with the screen awake for the whole
 * walk, which flips carry_mode from pocket to hand (the mode the detector is
 * least tuned for) and films someone using the app wrong. Every walk already
 * stores its route and pickup coordinates, so the map can be rendered from the
 * record instead — deterministic, re-renderable at any speed or aspect ratio,
 * and honest, because it IS the recorded data.
 *
 * HOW. Chrome renders frames headlessly over the DevTools Protocol (no
 * puppeteer — Node 24 has a global WebSocket and Chrome is already installed),
 * then tools/pngs-to-mp4 encodes them with AVFoundation (no ffmpeg — macOS
 * ships it and swiftc is here for the iOS build). Zero npm dependencies on
 * purpose: this has to still work in six months without a reinstall.
 *
 * The renderer page has NO animation loop. This driver calls PICK.frame(t) for
 * an exact t and screenshots it, so two renders of the same walk are identical
 * frame for frame.
 *
 * Usage:
 *   node render-video.mjs --walk <cleanupId> [options]
 *
 *   --walk <id>       cleanup document id (required)
 *   --seconds <n>     output duration, default 20
 *   --fps <n>         default 30
 *   --format <f>      4:5 (default, 1080x1350) | 9:16 (1080x1920) | 1:1 (1080x1080)
 *   --skin <s>        plain (default, data poster) | phone (the app's in-walk screen)
 *   --walks <a,b,c>   several cleanups on ONE shared clock (a group event)
 *   --title <s>       event name shown as the headline
 *   --out <path>      default ./pick-<id>.mp4
 *   --keep-frames     leave the PNG sequence on disk
 *
 * Requires ~/.secrets/pick-app/serviceAccountKey.json (same key the other
 * operator tools use) and network access to Overpass for street geometry.
 */

import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENCODER = path.join(REPO, 'tools/pngs-to-mp4');
const FORMATS = { '4:5': [1080, 1350], '9:16': [1080, 1920], '1:1': [1080, 1080] };

const argv = process.argv;
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1]; };
const has = (n) => argv.includes('--' + n);

const walkIds = String(arg('walks', arg('walk', ''))).split(',').map(v => v.trim()).filter(Boolean);
const seconds = Number(arg('seconds', 20));
const fps = Number(arg('fps', 30));
const format = arg('format', '4:5');
const skin = arg('skin', 'plain');
const title = arg('title', '');   // event name; defaults to the first walk's team   // 'plain' poster | 'phone' in-app screen
if (!walkIds.length) { console.error('usage: render-video.mjs --walk <cleanupId> | --walks <id,id,id> [--seconds 20] [--fps 30] [--format 4:5] [--skin phone]'); process.exit(2); }
if (!FORMATS[format]) { console.error(`--format must be one of ${Object.keys(FORMATS).join(', ')}`); process.exit(2); }
const [WIDTH, HEIGHT] = FORMATS[format];
const outPath = path.resolve(arg('out', `pick-${walkIds[0]}${walkIds.length>1?'-plus'+(walkIds.length-1):''}.mp4`));

const R = 6371000, rad = (x) => x * Math.PI / 180;
const distM = (a, b, c, d) => {
  const dLa = rad(c - a), dLo = rad(d - b);
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const log = (m) => console.log(m);

/* ---------------------------------------------------------------- 1. data */
async function loadWalk(id) {
  const admin = (await import(path.join(REPO, 'apps/companion/functions/node_modules/firebase-admin/lib/index.js'))).default;
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(
      JSON.parse(fs.readFileSync(`${os.homedir()}/.secrets/pick-app/serviceAccountKey.json`, 'utf8'))) });
  }
  const snap = await admin.firestore().collection('cleanups').doc(id).get();
  if (!snap.exists) throw new Error(`cleanup ${id} not found`);
  const x = snap.data();
  const route = JSON.parse(x.route_points || '[]');
  const pickups = JSON.parse(x.pickups || '[]');
  if (route.length < 4) throw new Error(`cleanup ${id} has only ${route.length} route points — not enough to draw`);
  return {
    hood: x.neighborhood || x.city || 'Cleanup', city: x.city, team: x.team, uid: x.userId || '',
    dur: x.duration_seconds || 0, items: x.items_count || 0, bags: x.bags_est || 0,
    ts: x.timestamp && (x.timestamp._seconds || x.timestamp.seconds), route, pickups,
  };
}

/* ------------------------------------------------------- 2. street geometry */
// Street geometry is cached on disk by bounding box. Iterating on a render
// otherwise re-queries Overpass every run — during this tool's own development
// that got the mirrors refusing requests, which is precisely the fair-use
// problem the precache work exists to avoid. Boundaries and streets do not
// change between two renders of the same walk five minutes apart.
const CACHE_DIR = path.join(os.tmpdir(), 'pick-render-cache');
async function loadStreets(bbox) {
  const [mnLa, mnLo, mxLa, mxLo] = bbox, pad = 0.0016;
  const key = bbox.map((v) => v.toFixed(4)).join('_').replace(/[^0-9a-zA-Z_.-]/g, 'm');
  const cacheFile = path.join(CACHE_DIR, key + '.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      log(`     ${cached.length} ways (cached)`);
      return cached;
    } catch {}
  }
  const q = `[out:json][timeout:60];
(way["highway"~"^(residential|primary|secondary|tertiary|unclassified|living_street|pedestrian|service|footway)$"]` +
    `(${(mnLa - pad).toFixed(5)},${(mnLo - pad).toFixed(5)},${(mxLa + pad).toFixed(5)},${(mxLo + pad).toFixed(5)}););
out geom;`;
  const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  for (const m of mirrors) {
    try {
      const res = await fetch(m, { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                   'User-Agent': 'PICK-cleanup-app/1.0 (impact video render)' } });
      if (!res.ok) { log(`  ${m} -> HTTP ${res.status}`); continue; }
      const j = await res.json();
      const ways = (j.elements || []).filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 1)
        .map((e) => ({ c: e.tags && e.tags.highway, g: e.geometry.map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]) }));
      try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(ways)); } catch {}
      return ways;
    } catch (e) { log(`  ${m} failed: ${e.message}`); }
  }
  throw new Error('every Overpass mirror failed');
}

/* ------------------------------------------------------------- 3. projection */
function buildPayload(walks, ways, TITLE) {
  const allPts = walks.flatMap((w) => w.route.concat(w.pickups));

  // ONE CLOCK ACROSS EVERY CREW. Walks run at real wall-clock times, so a group
  // event should animate as it happened — crews starting at different moments,
  // the map filling from several directions at once — not as a relay of
  // normalised tracks. Route points carry no individual timestamps, only order,
  // so a walk's points are spread evenly across its own duration; that is the
  // most the stored data supports and it is stated rather than hidden.
  const t0 = Math.min(...walks.map((w) => w.ts || 0));
  const t1 = Math.max(...walks.map((w) => (w.ts || 0) + (w.dur || 0)));
  const SPAN = Math.max(1, t1 - t0);
  const tickOf = (wi, i) => {
    const w = walks[wi];
    const frac = w.route.length > 1 ? i / (w.route.length - 1) : 1;
    return (((w.ts || 0) + frac * (w.dur || 0)) - t0) / SPAN;
  };

  // FRAME THE WORK, NOT THE EXTENT.
  //
  // Fitting to the full bounding box is the documented failure mode in
  // GROUP_IMPACT_MAP_SPEC: on the Litchfield data 96% of points sat in a
  // 715x423 m stretch while twelve strays pushed the box to ~20 km, wasting
  // the entire frame. This walk has the same shape — six GPS gaps up to
  // 1,992 m drag the extent out and leave the actual route as a small
  // diagonal in the middle of a mostly empty map.
  //
  // So the frame is set by the 4th-96th percentile of latitude and longitude
  // independently. Strays fall outside the frame and get clipped, which is
  // the right outcome: a point the GPS invented should not decide how the
  // real work is composed. Percentiles rather than a distance cutoff because
  // they need no tuning per city or walk length.
  const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };
  const lats = allPts.map((p) => p[0]), lons = allPts.map((p) => p[1]);
  let mnLa = pct(lats, 0.04), mxLa = pct(lats, 0.96);
  let mnLo = pct(lons, 0.04), mxLo = pct(lons, 0.96);
  // Degenerate guard: a walk confined to one spot would otherwise divide by ~0.
  if (mxLa - mnLa < 1e-4) { const c = (mxLa + mnLa) / 2; mnLa = c - 5e-5; mxLa = c + 5e-5; }
  if (mxLo - mnLo < 1e-4) { const c = (mxLo + mnLo) / 2; mnLo = c - 5e-5; mxLo = c + 5e-5; }
  const padLa = (mxLa - mnLa) * 0.10, padLo = (mxLo - mnLo) * 0.10;
  const B = [mnLa - padLa, mnLo - padLo, mxLa + padLa, mxLo + padLo];
  const kx = Math.cos(rad((B[0] + B[2]) / 2));
  const spanX = (B[3] - B[1]) * kx, spanY = B[2] - B[0];
  const S = 1000 / Math.max(spanX, spanY);
  const P = (la, lo) => [+(((lo - B[1]) * kx) * S).toFixed(1), +(((B[2] - la)) * S).toFixed(1)];

  // THE APP'S OWN RULE. streetSegments.ts marks a segment cleaned only when the
  // route covered COVERAGE_THRESHOLD (0.6) of its length, sampled every
  // SEGMENT_SAMPLE_STEP_M (5 m), each sample within SNAP_DISTANCE_M (11 m) of
  // the route POLYLINE — point-to-segment, not point-to-vertex.
  //
  // This replaced "any vertex within 28 m of any route point", which credits
  // every cross street at every intersection and draws as a green grid rather
  // than the streets actually walked. That is exactly what COVERAGE_THRESHOLD
  // exists to prevent ("stops one stray GPS ping from crediting a whole block").
  const SNAP_M = 11, COVER = 0.6, STEP_M = 5;
  const mLat = 111320, mLon = 111320 * Math.cos(rad(allPts[0][0]));
  const XY = ([la, lo]) => [lo * mLon, la * mLat];
  const routesXY = walks.map((w) => w.route.map(XY));

  const distToSeg = (p, a, b) => {
    const vx = b[0]-a[0], vy = b[1]-a[1], L2 = vx*vx + vy*vy;
    if (!L2) return Math.hypot(p[0]-a[0], p[1]-a[1]);
    let t = ((p[0]-a[0])*vx + (p[1]-a[1])*vy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0]-(a[0]+t*vx), p[1]-(a[1]+t*vy));
  };
  const sampleAlong = (g) => {
    const pts = g.map(XY), out = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i-1], b = pts[i], len = Math.hypot(b[0]-a[0], b[1]-a[1]);
      const n = Math.max(1, Math.round(len / STEP_M));
      for (let k = 0; k < n; k++) out.push([a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n]);
    }
    if (pts.length) out.push(pts[pts.length-1]);
    return out;
  };

  let cleaned = 0;
  const streets = ways.filter((x) => x.g.some(p => p[0]>=B[0]&&p[0]<=B[2]&&p[1]>=B[1]&&p[1]<=B[3]))
    .map((x) => {
      const samples = sampleAlong(x.g);
      // Earliest GLOBAL tick (0..1 across the whole event) at which each sample
      // came within snap distance of ANY crew's route. Union across walks is
      // what makes a group map work: one block cleaned by whoever got there.
      const first = samples.map((sp) => {
        let best = Infinity;
        routesXY.forEach((rt, wi) => {
          for (let i = 1; i < rt.length; i++)
            if (distToSeg(sp, rt[i-1], rt[i]) <= SNAP_M) { best = Math.min(best, tickOf(wi, i)); break; }
        });
        return best;
      });
      const hit = first.filter(Number.isFinite).length;
      const isClean = samples.length ? hit / samples.length >= COVER : false;
      let at = -1;
      if (isClean) {
        const sorted = first.filter(Number.isFinite).sort((a, b) => a - b);
        at = sorted[Math.max(0, Math.ceil(COVER * samples.length) - 1)];
        cleaned++;
      }
      const rank = /^(primary|secondary|tertiary)$/.test(x.c) ? 2
                 : /^(residential|unclassified|living_street)$/.test(x.c) ? 1 : 0;
      return { r: rank, c: isClean ? 1 : 0, at, g: x.g.map(p => P(p[0], p[1])) };
    });

  // One entry per crew: its own track, its own colour, its own pickups, all on
  // the shared clock above.
  const PALETTE = ['#4B7A54', '#C1502E', '#C98A2E', '#2E6B8A', '#7A4B6B', '#4B6B7A'];
  const routes = walks.map((w, wi) => ({
    label: w.team || w.hood || ('Crew ' + (wi + 1)),
    color: PALETTE[wi % PALETTE.length],
    pts: w.route.map((p) => P(p[0], p[1])),
    ticks: w.route.map((_, i) => +tickOf(wi, i).toFixed(5)),
    picks: w.pickups.map((p) => P(p[0], p[1])),
    pickTicks: w.pickups.map((pt) => {
      let bi = 0, bd = Infinity;
      w.route.forEach((r, i) => { const d = (r[0]-pt[0])**2 + (r[1]-pt[1])**2; if (d < bd) { bd = d; bi = i; } });
      return +tickOf(wi, bi).toFixed(5);
    }),
    items: w.items, bags: w.bags, minutes: Math.max(1, Math.round((w.dur || 0) / 60)),
  }));

  // The drawing fits to THIS rectangle, not to the extent of the fetched
  // streets. Streets are deliberately fetched wider than the frame so the
  // edges stay full of city instead of fading to empty ground — fitting to
  // them would zoom back out and undo the percentile framing above.
  const frame = [0, 0, +(((B[3] - B[1]) * kx) * S).toFixed(1), +((B[2] - B[0]) * S).toFixed(1)];

  return {
    frame,
    mPerUnit: +(111320 / S).toFixed(4),
    meta: { hood: walks[0].hood, city: walks[0].city,
            // CREWS = distinct people, not distinct walks. Four walks by two
            // pickers is a two-crew event; counting walks overstated it.
            team: TITLE || walks[0].team,
            crews: new Set(walks.map((w) => w.uid).filter(Boolean)).size || 1,
            walks: walks.length,
            minutes: Math.max(1, Math.round(SPAN / 60)),
            items: walks.reduce((n, w) => n + (w.items || 0), 0),
            bags: walks.reduce((n, w) => n + (w.bags || 0), 0),
            date: new Date(t0 * 1000).toISOString().slice(0, 10),
            mappedPickups: routes.reduce((n, r) => n + r.picks.length, 0),
            streetsCleaned: cleaned },
    streets, routes,
  };
}

/* ------------------------------------------------------------- 4. rendering */
async function renderFrames(payload, dir) {
  const tpl = fs.readFileSync(path.join(HERE, 'frame-template.html'), 'utf8');
  const page = path.join(dir, 'frame.html');
  fs.writeFileSync(page, tpl
    .replace('__DATA__', JSON.stringify(payload))
    .replace('__CONFIG__', JSON.stringify({ width: WIDTH, height: HEIGHT, skin })));

  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = path.join(dir, 'chrome-profile');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'], { stdio: 'ignore' });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws, id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  try {
    let list = null;
    for (let i = 0; i < 60; i++) {
      await wait(250);
      try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); list = await r.json();
            if (list.some((t) => t.type === 'page')) break; } catch {}
    }
    const target = list && list.find((t) => t.type === 'page');
    if (!target) throw new Error('Chrome DevTools never became available');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP socket failed')); });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    };

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',
      { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file://' + page });

    // Wait for the renderer AND its webfonts — a screenshot taken before
    // Archivo loads silently ships a fallback-font video.
    for (let i = 0; i < 80; i++) {
      await wait(150);
      const r = await send('Runtime.evaluate',
        { expression: 'Boolean(window.PICK && window.PICK.ready && document.fonts && document.fonts.status==="loaded")',
          returnByValue: true });
      if (r.result && r.result.value) break;
      if (i === 79) log('  ! fonts/renderer not confirmed ready — continuing anyway');
    }

    const total = Math.max(2, Math.round(seconds * fps));
    const t0 = Date.now();
    for (let f = 0; f < total; f++) {
      await send('Runtime.evaluate', { expression: `window.PICK.frame(${(f / (total - 1)).toFixed(6)})` });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(dir, `frame-${String(f).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'));
      if (f % 60 === 0 || f === total - 1) {
        process.stdout.write(`\r  frame ${f + 1}/${total}  (${(((Date.now() - t0) / (f + 1))).toFixed(0)} ms/frame)   `);
      }
    }
    process.stdout.write('\n');
    return total;
  } finally {
    try { ws && ws.close(); } catch {}
    chrome.kill();
  }
}

/* ------------------------------------------------------------------- main */
(async () => {
  if (!fs.existsSync(CHROME)) throw new Error('Google Chrome not found at ' + CHROME);
  if (!fs.existsSync(ENCODER)) throw new Error(`encoder missing — build it once:\n  swiftc -O ${path.join(REPO, 'tools/pngs-to-mp4.swift')} -o ${ENCODER}`);

  log(`\nPICK content render — ${walkIds.length > 1 ? walkIds.length + ' walks' : 'walk ' + walkIds[0]}`);
  log(`  format ${format} (${WIDTH}x${HEIGHT}), skin ${skin}, ${seconds}s @ ${fps}fps\n`);

  log(`1/4  reading ${walkIds.length} walk${walkIds.length > 1 ? 's' : ''}…`);
  const walks = [];
  for (const id of walkIds) {
    const w = await loadWalk(id);
    log(`     ${w.team || w.hood} · ${Math.round(w.dur / 60)} min · ${w.items} pickups · ${w.route.length} route points`);
    walks.push(w);
  }

  let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180;
  walks.flatMap((w) => w.route.concat(w.pickups)).forEach((p) => {
    mnLa = Math.min(mnLa, p[0]); mxLa = Math.max(mxLa, p[0]);
    mnLo = Math.min(mnLo, p[1]); mxLo = Math.max(mxLo, p[1]);
  });

  log('2/4  fetching street geometry from OpenStreetMap…');
  const ways = await loadStreets([mnLa, mnLo, mxLa, mxLo]);
  log(`     ${ways.length} ways`);

  const payload = buildPayload(walks, ways, title);
  log(`     ${payload.meta.streetsCleaned} segments within 28 m of the route`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-render-'));
  log('3/4  rendering frames (headless Chrome)…');
  const n = await renderFrames(payload, dir);

  log('4/4  encoding…');
  const out = execFileSync(ENCODER, [dir, outPath, String(fps)], { encoding: 'utf8' });
  process.stdout.write('     ' + out.trim() + '\n');

  if (has('keep-frames')) log(`\n     frames kept in ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });

  log(`\n✓ ${outPath}\n`);
})().catch((e) => { console.error('\nFAILED: ' + (e && e.message ? e.message : e)); process.exit(1); });
