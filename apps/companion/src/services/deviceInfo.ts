import * as Device from 'expo-device';

/**
 * Which phone a walk was recorded on.
 *
 * Why this exists: as of the 2026-09-06 audit of the live `cleanups` collection
 * (205 docs), every threshold in the detector is fitted to ONE tester on ONE
 * phone in ONE carry position. The 33 walks by other people carry no
 * `items_detected` and no `pace_*` at all, so they are permanently unusable for
 * accuracy work. With community orgs about to onboard, a walk that can't be
 * attributed to a device model can't distinguish a gait problem from a sensor
 * problem — different iPhone generations have materially different IMUs and
 * sampling behaviour, and the detector reads peak accel/gyro directly.
 *
 * Deliberately NOT `Device.deviceName` — that is user-set and routinely a real
 * name ("Vivian's iPhone"). This returns hardware/OS identity only.
 *
 * Pure JS: `expo-device` is already a dependency (in `package.json` since
 * `9a8c049`, in `ios/Podfile.lock`, and already imported by
 * `src/services/notifications.ts`), so the native module is present in the
 * shipped binary and reading it ships over the air with no new build.
 *
 * Shape: `"iPhone14,3 (iPhone 13 Pro) / iOS 18.5"` — model identifier first
 * because that is the field that actually stratifies hardware; the marketing
 * name is parenthetical for human readability. Returns `null` when nothing
 * useful is available, so the caller can omit the field entirely rather than
 * write a placeholder.
 */
export function getDeviceModelString(): string | null {
  const id = typeof Device.modelId === 'string' && Device.modelId ? Device.modelId : null;
  const name = Device.modelName || null;
  const os = [Device.osName, Device.osVersion].filter(Boolean).join(' ').trim();

  const hardware = id ? (name && name !== id ? `${id} (${name})` : id) : name;
  if (!hardware && !os) return null;
  if (!hardware) return os;
  if (!os) return hardware;
  return `${hardware} / ${os}`;
}
