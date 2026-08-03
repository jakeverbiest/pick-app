import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';

import * as Location from 'expo-location';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppInitialization } from '@/src/hooks/useAppInitialization';
import { prefetchHoodsNear } from '@/src/services/neighborhoods';
import { registerForPush, setupNotificationRouting } from '@/src/services/notifications';
import { LoadingView, ErrorView } from '@/src/pick/LoadingView';
import { initErrorMonitoring } from '@/src/services/errorMonitoring';

// Keep the native splash up until our own branded loading view is on screen,
// so there's no white flash between the OS splash and the app.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Remote crash/error reporting — no-ops until EXPO_PUBLIC_SENTRY_DSN is set.
initErrorMonitoring();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { isInitialized, authUser, error } = useAppInitialization();

  // Civic Blueprint type system: Barlow Condensed for headlines/numbers,
  // Public Sans for body/UI (see src/pick/theme.ts `Fonts`). Gate the whole
  // tree on these loading so nothing — including the branded loading screen
  // itself — renders with a fallback system font first.
  const [fontsLoaded] = useFonts({
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
  });

  // Route taps on push notifications to the right screen (once, at root).
  useEffect(() => {
    const unsub = setupNotificationRouting();
    return unsub;
  }, []);

  // Register this device for push once the user is signed in.
  useEffect(() => {
    if (isInitialized && authUser) void registerForPush();
  }, [isInitialized, authUser]);

  // Hand off from the native splash to our branded view once fonts are ready
  // — otherwise the loading screen itself would flash system font first.
  useEffect(() => {
    if (!fontsLoaded) return;
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
  }, [fontsLoaded]);

  // Show error screen if initialization fails
  if (error) {
    return <ErrorView message={error} />;
  }

  // Show branded loading screen while fonts/app init are in flight
  if (!fontsLoaded || !isInitialized) {
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
