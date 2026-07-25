/**
 * Push notifications (client side).
 *
 * On sign-in we ask permission, get the device's Expo push token, and store it
 * on the user's profile (users/{uid}.pushToken). The Cloud Functions read that
 * token to send the friendly nudges: new follower, someone liked your post, a
 * milestone, or an adopt-a-block reminder.
 *
 * NOTE: remote push needs a real device + a native build — it does nothing in
 * the simulator. Everything here fails safe (no-ops) so it never blocks the app.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { router } from 'expo-router';
import { app } from './firebaseConfig';
import { getAuthService } from './authService';

const db = getFirestore(app);

// Foreground behavior: show a banner even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as any)?.eas?.projectId ||
    (Constants as any)?.easConfig?.projectId
  );
}

/**
 * Ask permission, fetch the Expo push token, and save it to the user's profile.
 * Safe to call on every launch — it just refreshes the stored token.
 */
export async function registerForPush(): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators can't receive remote push
    const user = getAuthService().getCurrentUser();
    if (!user) return;

    // Cast: the temporarily-installed expo-notifications is ahead of SDK 54 and
    // its types differ; the real pinned version exposes granted/status. Reading
    // both shapes keeps this correct at runtime.
    const perm: any = await Notifications.getPermissionsAsync();
    let granted = perm.granted ?? perm.status === 'granted';
    if (!granted) {
      const req: any = await Notifications.requestPermissionsAsync();
      granted = req.granted ?? req.status === 'granted';
    }
    if (!granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Pick',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    if (!token) return;

    await setDoc(
      doc(db, 'users', user.uid),
      { pushToken: token, pushPlatform: Platform.OS, pushUpdatedAt: Date.now() },
      { merge: true }
    );
  } catch (e) {
    console.warn('registerForPush failed (non-fatal):', e);
  }
}

/**
 * Route to the right screen when a notification is tapped. Wire this up once at
 * app root. Returns an unsubscribe function.
 */
export function setupNotificationRouting(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response.notification.request.content.data || {}) as Record<string, any>;
    try {
      if (data.type === 'follow' && data.actorUid) {
        router.push(`/profile/${data.actorUid}` as any);
      } else if (data.type === 'like') {
        router.push('/(tabs)/community' as any);
      } else if (data.type === 'adoption') {
        router.push('/(tabs)/map' as any);
      }
    } catch {}
  });
  return () => sub.remove();
}
