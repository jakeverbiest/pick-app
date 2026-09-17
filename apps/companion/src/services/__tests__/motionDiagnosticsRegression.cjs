const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const ts = require('typescript');
const staged = require('path').resolve(__dirname, '..') + '/';
function load(name, imports = {}) {
  const js = ts.transpileModule(fs.readFileSync(staged + name + '.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { exports: mod.exports, module: mod, require: n => { if (!(n in imports)) throw Error(n); return imports[n]; }, setInterval: () => 1, clearInterval() {}, Date, Math, console });
  return mod.exports;
}
const { DiagnosticBuffer } = load('motionDiagnosticBuffer');
(async () => {
  const written = [];
  const b = new DiagnosticBuffer(1000, async (name, data) => written.push([name, data]));
  b.add('location', { speed: 0, measuredAtMs: 900 }, 1000);
  b.add('accelerometer', { sample: { x: -1, y: 0, z: 0.1, timestamp: 44 } }, 1100);
  b.add('accelerometer', { sample: { x: 1, y: 0, z: 0.1, timestamp: 46 } }, 3100);
  await b.stop('test', 3200);
  b.add('ignored', {}, 3300);
  const rows = written.flatMap(([, s]) => s.trim().split('\n').map(JSON.parse));
  assert.equal(rows.length, 4); assert.equal(rows[0].speed, 0);
  assert.equal(rows[1].sample.x, -1); assert.equal(rows[2].deliveryGapMs, 2000);
  assert.equal(rows[3].type, 'end'); assert.equal(rows[3].lastSeen.accelerometer, 3100);
  const limited = [];
  const limit = new DiagnosticBuffer(0, async (_, s) => limited.push(s), () => {}, { rows: 2, bytes: 10000, durationMs: 1000, batch: 10, pending: 2 });
  limit.add('one', {}, 1); limit.add('two', {}, 2); limit.add('three', {}, 3);
  await limit.stop('again', 4);
  assert.equal(limit.active, false); assert.equal(limit.count, 2);
  // A normal capture receives accelerometer, gyroscope, and fused motion at
  // 10 Hz each. Keep the advertised 20-minute capacity honest against those
  // representative raw rows; a lower byte ceiling used to end at 9:55.
  const long = new DiagnosticBuffer(0, async () => {});
  for (let tick = 0; tick < 12000; tick++) {
    const at = tick * 100;
    long.add('accelerometer', { sample: { x: -0.123456789, y: 0.987654321, z: -0.456789123, timestamp: tick / 10 } }, at);
    long.add('gyroscope', { sample: { x: -1.23456789, y: 2.34567891, z: -3.45678912, timestamp: tick / 10 } }, at);
    long.add('deviceMotion', { sample: { acceleration: { x: 1.23456789, y: -2.34567891, z: 3.45678912 }, rotation: { alpha: 0.123, beta: -0.456, gamma: 0.789 } } }, at);
    if (tick % 100 === 99) await long.drained();
  }
  assert.equal(long.active, true); assert.equal(long.count, 36000); assert.equal(long.dropped, 0);
  await long.stop('test complete', 1200000);
  const failing = new DiagnosticBuffer(0, async () => { throw Error('disk full'); });
  failing.add('test', {}, 1); await failing.stop('done', 2);
  assert.match(failing.error, /disk full/);
  // Native-wrapper lifecycle, using an in-memory filesystem (no radio or server).
  const files = new Map(); const dirs = new Set(['file:///docs/']); let enabled = null; let shared; let fused; let app;
  const fakeFS = { documentDirectory: 'file:///docs/',
    makeDirectoryAsync: async p => dirs.add(p.endsWith('/') ? p : p + '/'),
    writeAsStringAsync: async (p, s) => files.set(p, s),
    readAsStringAsync: async p => files.get(p),
    getInfoAsync: async p => ({ exists: dirs.has(p) || files.has(p) }),
    readDirectoryAsync: async p => [...new Set([...dirs, ...files.keys()].filter(x => x.startsWith(p) && x !== p).map(x => x.slice(p.length).split('/')[0]))],
    deleteAsync: async p => { for (const k of [...files.keys()]) if (k.startsWith(p)) files.delete(k); for (const k of [...dirs]) if (k.startsWith(p)) dirs.delete(k); },
  };
  const svc = load('motionDiagnostics', {
    '@react-native-async-storage/async-storage': { default: { getItem: async () => enabled, setItem: async (_, v) => { enabled = v; } } },
    'expo-file-system/legacy': fakeFS,
    'expo-sensors': { DeviceMotion: { isAvailableAsync: async () => true, setUpdateInterval() {}, addListener(fn) { fused = fn; return { remove() { fused = null; } }; } } },
    'expo-device': { modelName: 'iPhone 14' }, 'expo-updates': { updateId: 'test' },
    'react-native': { AppState: { currentState: 'active', addEventListener(_, fn) { app = fn; return { remove() { app = null; } }; } }, Platform: { OS: 'ios', Version: 'test' }, Share: { share: async data => { shared = data; } } },
    './motionDiagnosticBuffer': { DiagnosticBuffer },
  });
  await svc.startMotionDiagnostics('disabled'); assert.equal(files.size, 0);
  await svc.setMotionDiagnosticsEnabled(true);
  await svc.startMotionDiagnostics('stop-only');
  svc.recordMotionDiagnostic('location', { speed: 0, measuredAtMs: Date.now() - 3000 });
  fused({ acceleration: { x: -1, y: 0, z: 0, timestamp: 2 } }); app('background');
  await svc.stopMotionDiagnostics(); assert.equal(fused, null); assert.equal(app, null);
  await svc.startMotionDiagnostics('real-picks'); svc.recordMotionDiagnostic('watchMark', { capturedAtMs: Date.now() });
  await assert.rejects(svc.shareMotionDiagnostics(), /End this cleanup/);
  await svc.stopMotionDiagnostics(); await svc.shareMotionDiagnostics();
  const exported = files.get(shared.url).trim().split('\n').map(JSON.parse);
  assert.equal(exported.filter(r => r.type === 'start').length, 2);
  assert.equal(exported.filter(r => r.type === 'end').length, 2);
  assert.equal(exported.find(r => r.type === 'location').speed, 0);
  assert.equal(exported.find(r => r.type === 'deviceMotion').sample.acceleration.x, -1);
  assert.equal(exported.find(r => r.type === 'appState').state, 'background');
  // Export is rebuilt from durable chunks rather than the current capture buffer.
  await svc.setMotionDiagnosticsEnabled(false);
  assert.match(svc.motionDiagnosticStatus(), /off/);
  console.log('PASS: defaults off; signed samples + zero GPS; delivery gaps; bounded capture; write failure; two durable tests; explicit file export; teardown.');
})().catch(e => { console.error(e); process.exitCode = 1; });
