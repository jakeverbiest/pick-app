import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppInitialization } from '@/src/hooks/useAppInitialization';
import { prefetchNycHoods } from '@/src/services/neighborhoods';
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

  // Hand off from the native splash to our branded view on first render.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    // Warm the NYC neighborhoods layer during login/safety, so the map's hood
    // outlines (and the first hood tap) don't wait on a 1.5MB download.
    prefetchNycHoods();
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
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
