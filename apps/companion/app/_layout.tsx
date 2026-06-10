import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppInitialization } from '@/src/hooks/useAppInitialization';
import { COLORS } from '@/src/constants/colors';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { isInitialized, authUser, error } = useAppInitialization();

  // Show error screen if initialization fails
  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, backgroundColor: COLORS.cream }}>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 12, color: COLORS.darkSage }}>
          ⚠️ Initialization Error
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.mutedSage, textAlign: 'center' }}>
          {error}
        </Text>
      </View>
    );
  }

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.cream }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.sage }}>🧹 Pick</Text>
        <Text style={{ fontSize: 14, color: COLORS.mutedSage, marginTop: 12 }}>Initializing...</Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ animationEnabled: false }} />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
