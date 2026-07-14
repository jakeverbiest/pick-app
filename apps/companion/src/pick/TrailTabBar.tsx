import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Icon, IconName } from './Icon';
import { C } from './theme';

/** The Trail tabs, in order. Other registered routes are hidden.
 *  Challenges/Goals live inside the Ranks (Leaderboard) tab. */
const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'map', label: 'Map', icon: 'pin' },
  { name: 'activity', label: 'Impact', icon: 'activity' },
  { name: 'leaderboard', label: 'Ranks', icon: 'trophy' },
  { name: 'community', label: 'Community', icon: 'camera' },
  { name: 'settings', label: 'You', icon: 'user' },
];

export function TrailTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
      {TABS.map((t) => {
        const route = state.routes.find((r) => r.name === t.name);
        const focused = activeName === t.name;
        const color = focused ? C.primary : C.muted;
        const onPress = () => {
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name as never);
        };
        return (
          <Pressable key={t.name} style={styles.tab} onPress={onPress} hitSlop={6}>
            <Icon name={t.icon} size={24} color={color} sw={focused ? 2 : 1.8} />
            <Text style={[styles.label, { color }]} numberOfLines={1}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: 9,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(250,250,248,0.98)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border3,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3 },
  label: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
});
