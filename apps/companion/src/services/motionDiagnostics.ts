/** Tester opt-in. Raw readings stay in app-local files; never added to Firestore. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { DeviceMotion } from 'expo-sensors';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { AppState, Platform, Share } from 'react-native';
import { DiagnosticBuffer } from './motionDiagnosticBuffer';
const KEY = '@pick_motion_diagnostics_v1';
const root = FS.documentDirectory ? `${FS.documentDirectory}motion-tests/` : null;
let buffer: DiagnosticBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let motionSub: { remove(): void } | null = null;
let appSub: { remove(): void } | null = null;
let status = 'Motion test recording off';
const listeners = new Set<(value: string) => void>();
function publish(value: string) { status = value; listeners.forEach((fn) => fn(value)); }
export function motionDiagnosticStatus() { return status; }
export function subscribeMotionDiagnostics(fn: (value: string) => void) {
  listeners.add(fn); fn(status); return () => { listeners.delete(fn); };
}
export async function isMotionDiagnosticsEnabled() {
  try { return await AsyncStorage.getItem(KEY) === 'true'; } catch { return false; }
}
export async function setMotionDiagnosticsEnabled(enabled: boolean) {
  await AsyncStorage.setItem(KEY, String(enabled));
  if (!enabled) await stopMotionDiagnostics('disabled by tester');
  publish(enabled ? 'Ready for next cleanup · maximum 20 minutes per test' : 'Motion test recording off');
}
function detach() {
  if (timer) clearInterval(timer); timer = null;
  motionSub?.remove(); motionSub = null;
  appSub?.remove(); appSub = null;
}
/** Called only on a NEW cleanup; detector reattachment must not reset this. */
export async function startMotionDiagnostics(walkId: string) {
  await stopMotionDiagnostics('new cleanup');
  if (!(await isMotionDiagnosticsEnabled())) return;
  try {
    if (!root) throw new Error('Local document storage is unavailable');
    await FS.makeDirectoryAsync(root, { intermediates: true });
    // Retain four tests, including interrupted ones, so the paired walks survive restart.
    const old = (await FS.readDirectoryAsync(root)).filter((name) => /^test-\d+-/.test(name)).sort();
    for (const name of old.slice(0, Math.max(0, old.length - 3))) {
      await FS.deleteAsync(`${root}${name}`, { idempotent: true });
    }
    const startedAt = Date.now();
    const dir = `${root}test-${startedAt}-${Math.random().toString(36).slice(2, 7)}/`;
    await FS.makeDirectoryAsync(dir, { intermediates: true });
    const current = new DiagnosticBuffer(startedAt, (name, text) => FS.writeAsStringAsync(dir + name, text), () => {
      if (buffer !== current) return;
      if (!current.active) {
        detach(); publish(current.error ?? `Motion test stopped · ${current.count} records · export in Settings`);
      } else publish(`Recording motion test · ${current.count} records · ${current.dropped} dropped`);
    });
    buffer = current;
    current.add('start', { schema: 1, walkId, deviceModel: Device.modelName,
      os: Platform.OS, osVersion: Platform.Version, updateId: Updates.updateId,
      appState: AppState.currentState, maxDurationMs: 1200000,
      units: { accel: 'g including gravity', gyro: 'rad/s', deviceMotionAcceleration: 'm/s²',
        deviceMotionRotation: 'radians', deviceMotionRotationRate: 'deg/s', locationSpeed: 'm/s',
        atMs: 'receipt Unix milliseconds', sensorTimestamp: 'native sensor seconds; different clock from atMs' },
      note: 'Delivery gaps are measured, never interpolated. No guarantee of screen-off sensor delivery. Missing end row means interrupted capture.' });
    await current.drained();
    if (!current.active) throw new Error(current.error ?? 'Recorder could not start');
    appSub = AppState.addEventListener('change', (state) => {
      current.add('appState', { state }); current.flush();
    });
    timer = setInterval(() => { current.add('heartbeat', { appState: AppState.currentState }); current.flush(); }, 2000);
    publish('Recording motion test · waiting for sensor samples');
    // Separate fused stream; does not change accelerometer/gyro detection cadence.
    try {
      if (await DeviceMotion.isAvailableAsync()) {
        if (buffer !== current || !current.active) return;
        DeviceMotion.setUpdateInterval(100);
        motionSub = DeviceMotion.addListener((sample) => current.add('deviceMotion', { sample }));
      } else current.add('sensorUnavailable', { sensor: 'DeviceMotion' });
    } catch (error) { current.add('sensorUnavailable', { sensor: 'DeviceMotion', error: String(error) }); }
  } catch (error) {
    detach();
    const failed = buffer; buffer = null;
    if (failed) await failed.stop('setup failed');
    publish(`Motion test could not record: ${String(error)}`);
    // Diagnostics must never prevent a cleanup from starting.
  }
}
/** Safe non-throwing tap from normal detector callbacks; no decisions modified. */
export function recordMotionDiagnostic(type: string, data: Record<string, unknown>, atMs = Date.now()) {
  try { buffer?.add(type, data, atMs); } catch { /* diagnostics cannot break detection */ }
}
export async function stopMotionDiagnostics(reason = 'cleanup ended') {
  detach();
  const current = buffer;
  if (current) {
    try { await current.stop(reason); } catch { /* surfaced by status/export where possible */ }
    if (buffer === current) {
      publish(current.error ?? `Motion test saved locally · ${current.count} records · ${current.dropped} dropped`);
      buffer = null;
    }
  }
}
/** Explicit share only. Recovery exports chunks even when a crash prevented the end row. */
export async function shareMotionDiagnostics() {
  if (!root) throw new Error('Local document storage is unavailable');
  if (buffer?.active) throw new Error('End this cleanup before exporting the motion tests.');
  await buffer?.drained();
  const info = await FS.getInfoAsync(root);
  if (!info.exists) throw new Error('No recordings yet. Enable recording, then start a cleanup.');
  const tests = (await FS.readDirectoryAsync(root)).filter((name) => /^test-\d+-/.test(name)).sort();
  if (!tests.length) throw new Error('No recordings yet. Start a cleanup with recording enabled.');
  const parts: string[] = [];
  for (const name of tests) {
    const names = (await FS.readDirectoryAsync(`${root}${name}/`)).filter((n) => /^chunk-\d+\.jsonl$/.test(n)).sort();
    parts.push(JSON.stringify({ type: 'testFile', name, chunks: names.length }) + '\n');
    for (const chunk of names) parts.push(await FS.readAsStringAsync(`${root}${name}/${chunk}`));
  }
  const uri = `${root}pick-motion-tests.jsonl`;
  await FS.writeAsStringAsync(uri, parts.join(''));
  if (Platform.OS !== 'ios') throw new Error('File sharing for this tester tool currently requires iPhone.');
  await Share.share({ url: uri, title: 'Pick motion test recordings' });
}
