/**
 * Background Session — keeps PICK alive with the screen off.
 *
 * How "normal apps" do it: they register a background location task, and iOS/
 * Android keep the app's JS running while it tracks location (like a run
 * tracker). While the app is alive, the motion sensors keep streaming too —
 * so pickup detection works with the phone locked in your pocket.
 *
 * IMPORTANT: this only works in a real build of PICK (dev build / TestFlight /
 * store build). Inside Expo Go it fails gracefully — keep the screen on and
 * use Pocket Mode there instead.
 *
 * Requires (already configured in app.json):
 * - iOS: UIBackgroundModes ["location"] + NSLocationAlways… string
 * - Android: ACCESS_BACKGROUND_LOCATION + foreground service
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK = 'pick-cleanup-location-task';

// Most recent background location (readable by anyone who cares)
let lastBackgroundLocation: { lat: number; lon: number; timestamp: number } | null = null;

// Must be defined in module scope so it survives app relaunches
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error.message);
    return;
  }
  const locations = (data as any)?.locations;
  if (locations?.length) {
    const loc = locations[locations.length - 1];
    lastBackgroundLocation = {
      lat: loc.coords.latitude,
      lon: loc.coords.longitude,
      timestamp: loc.timestamp,
    };
  }
});

export function getLastBackgroundLocation() {
  return lastBackgroundLocation;
}

/**
 * Start the background-capable location session. Returns:
 * - 'background' — full screen-off support active
 * - 'foreground' — permissions or environment don't allow background
 *   (e.g. Expo Go); session works but screen must stay on
 */
export async function startBackgroundSession(): Promise<'background' | 'foreground'> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return 'foreground';

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      console.log('🔆 Background location not granted — screen must stay on');
      return 'foreground';
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      // High (~5-10m) so screen-off/pocket tracking stays on the correct block.
      // Balanced (~100m) was mapping pickups across the street.
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      distanceInterval: 5,
      showsBackgroundLocationIndicator: true, // iOS blue pill — honest UX
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'PICK cleanup in progress',
        notificationBody: 'Tracking your route and pickups',
        killServiceOnDestroy: true,
      },
    });
    console.log('🌙 Background session active — screen can turn off');
    return 'background';
  } catch (error: any) {
    // Expected inside Expo Go
    console.log(`🔆 Background session unavailable (${error?.message ?? 'unknown'}) — keep screen on / use Pocket Mode`);
    return 'foreground';
  }
}

export async function stopBackgroundSession(): Promise<void> {
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      console.log('🌙 Background session stopped');
    }
  } catch {
    // nothing to stop
  }
}
