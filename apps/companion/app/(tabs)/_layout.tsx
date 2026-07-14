import { Tabs } from 'expo-router';
import React from 'react';

import { TrailTabBar } from '@/src/pick/TrailTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <TrailTabBar {...props} />}
      screenOptions={{ headerShown: false }}
      initialRouteName="map">
      {/* Trail tabs: Map · Impact · Ranks · Community · You (Challenges live inside Ranks) */}
      <Tabs.Screen name="map" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="leaderboard" />
      <Tabs.Screen name="community" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
