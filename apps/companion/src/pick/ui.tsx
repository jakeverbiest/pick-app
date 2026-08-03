/** Small shared building blocks used across the Civic Blueprint screens. */
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { C, Fonts, radius, type } from './theme';

/**
 * Cards are defined by a crisp navy border now, not a soft shadow — the
 * "drafted line" look is the whole point of the blueprint aesthetic.
 * 1.5px navy at 20% opacity, 8px radius, per the design spec's shared card
 * recipe (used identically across Impact/Leaderboard/Community/Settings).
 */
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

export type ProgressBarColor = 'navy' | 'green' | 'rust';

const PROGRESS_COLOR: Record<ProgressBarColor, string> = {
  navy: C.primary,
  green: C.accent,
  rust: C.rust,
};

export function ProgressBar({
  pct,
  height = 10,
  color = 'navy',
  gradient,
}: {
  pct: number;
  height?: number;
  /** navy (default/generic), green (streaks, weekly goal — "positive" per spec), rust (milestones — primary accent). */
  color?: ProgressBarColor;
  /** @deprecated use `color` — kept so old call sites (`gradient={false}` = green) still work. */
  gradient?: boolean;
}) {
  const fill = gradient === undefined ? PROGRESS_COLOR[color] : gradient ? C.primary : C.accent;
  return (
    <View style={[styles.track, { height, borderRadius: radius.pill }]}>
      <View
        style={{
          width: `${Math.min(100, Math.max(0, pct * 100))}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 16,
  },
  sectionLabel: {
    ...type.label,
    marginHorizontal: 6,
  },
  tileLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    color: C.muted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  track: {
    backgroundColor: C.progressTrack,
    overflow: 'hidden',
  },
});
