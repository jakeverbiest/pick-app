import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';

import * as Location from 'expo-location';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppInitialization } from '@/src/hooks/useAppInitialization';
import { prefetchHoodsNear } from '@/src/services/neighborhoods';
import { registerForPush, setupNotificationRouting } from '@/src/services/notifications';
import { LoadingView, ErrorView } from '@/src/pick/LoadingView';

// Keep the native splash up until our own branded loading view is on screen,
// so there's no white flash between the OS splash and the app.
SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { isInitialized, authUser, error } = useAppInitialization();

  // Route taps on push notifications to the right screen (once, at root).
  useEffect(() => {
    const unsub = setupNotificationRouting();
    return unsub;
  }, []);

  // Register this device for push once the user is signed in.
  useEffect(() => {
    if (isInitialized && authUser) void registerForPush();
  }, [isInitialized, authUser]);

  // Hand off from the native splash to our branded view on first render.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    // Warm the neighborhoods layer for the city the user is actually in, from a
    // cached location fix (no permission prompt), so the map's hood outlines and
    // first tap don't wait on the GeoJSON download. Unknown location (fresh
    // install, or outside a covered city) downloads nothing — the map's
    // on-view load covers it lazily once you're there.
    Location.getLastKnownPositionAsync()
      .then((pos) => {
        if (pos) prefetchHoodsNear(pos.coords.latitude, pos.coords.longitude);
      })
      .catch(() => {});
  }, []);

  // Show error screen if initialization fails
  if (error) {
    return <ErrorView message={error} />;
  }

  // Show branded loading screen while initializing
  if (!isInitialized) {
    return <LoadingView message="Getting things ready…" />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
