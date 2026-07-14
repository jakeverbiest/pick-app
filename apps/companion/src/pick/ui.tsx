/** Small shared building blocks used across the Trail screens. */
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { C, radius, shadow, type } from './theme';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

/** UPPERCASE 11px tile label (e.g. CLEANUPS). */
export function TileLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.tileLabel}>{String(children).toUpperCase()}</Text>;
}

export function ProgressBar({
  pct,
  height = 10,
  gradient = true,
}: {
  pct: number;
  height?: number;
  gradient?: boolean;
}) {
  return (
    <View style={[styles.track, { height, borderRadius: radius.pill }]}>
      <View
        style={{
          width: `${Math.min(100, Math.max(0, pct * 100))}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: gradient ? C.primary : C.accent,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.white,
    borderRadius: radius.card,
    padding: 16,
    ...shadow.card,
  },
  sectionLabel: {
    ...type.label,
    marginHorizontal: 6,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.muted,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  track: {
    backgroundColor: C.progressTrack,
    overflow: 'hidden',
  },
});
