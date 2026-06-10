import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { COLORS } from '@/src/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.sage,
        tabBarInactiveTintColor: COLORS.mutedSage,
        tabBarStyle: {
          backgroundColor: COLORS.cream,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
        },
        headerShown: false,
        tabBarButton: HapticTab,
      }}
      initialRouteName="map">
      {/* Map - Main Home Screen */}
      <Tabs.Screen
        name="map"
        options={{
          title: '',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="map.fill" color={color} />,
        }}
      />
      {/* Activity - Combined History + Stats */}
      <Tabs.Screen
        name="activity"
        options={{
          title: '',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.bar.fill" color={color} />,
        }}
      />
      {/* Community - Announcements + UGC */}
      <Tabs.Screen
        name="community"
        options={{
          title: '',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.3.fill" color={color} />,
        }}
      />
      {/* Settings */}
      <Tabs.Screen
        name="settings"
        options={{
          title: '',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />

      {/* Hidden screens - no bottom tab */}
      <Tabs.Screen
        name="index"
        options={{
          href: null, // Hide from bottom nav
          title: 'Cleanup',
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          href: null, // Hide from bottom nav
          title: 'History',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null, // Hide from bottom nav
          title: 'Profile',
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          href: null, // Hide from bottom nav
          title: 'Leaderboard',
        }}
      />
    </Tabs>
  );
}
