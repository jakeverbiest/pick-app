/**
 * The shareable "My Path" recap card — weekly/monthly recap and the year-end
 * "Wrapped" card share this one component with a `period` variant, so the
 * path-in-green art and stat layout stay consistent everywhere they appear.
 *
 * Deliberately shows the walked PATH only (via ImpactMap, no pickup pins) —
 * same "no exact locations" convention as every other public impact share.
 *
 * This is meant to be wrapped in a `react-native-view-shot` <ViewShot> by the
 * caller (see RecapModal) so it can be captured to a real image for sharing —
 * this component itself has no capture logic, just the visual.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { ImpactMap } from './ImpactMap';
import { C, Fonts, radius, shadow } from './theme';
import { formatBagsShort } from '../services/impactMetrics';
import type { RecapData, RecapPeriod } from '../services/recap';

const KICKER: Record<RecapPeriod, string> = {
  week: 'YOUR WEEK ON PICK',
  month: 'YOUR MONTH ON PICK',
  year: 'YOUR YEAR IN PICK',
};

function MiniTile({ value, label, big }: { value: string; label: string; big?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileNum, big && styles.tileNumYear]}>{value}</Text>
      <Text style={[styles.tileLabel, big && styles.tileLabelYear]}>{label}</Text>
    </View>
  );
}

export function RecapCard({
  recap,
  displayName,
  subLabel,
  levelName,
  levelColor,
}: {
  recap: RecapData;
  displayName?: string;
  /** Team or home neighborhood — shown under the name. */
  subLabel?: string;
  /** Current all-time milestone tier (see services/milestones) — shown as a
   *  small badge next to the name, so a shared card carries the same level
   *  identity as the Impact tab. Omitted entirely pre-first-milestone. */
  levelName?: string;
  levelColor?: string;
}) {
  const { period, label } = recap.range;
  const { stats } = recap;
  const isYear = period === 'year';

  return (
    <View style={[styles.card, isYear ? styles.cardYear : styles.cardDefault]}>
      <View style={styles.head}>
        <Text style={[styles.kicker, isYear && styles.kickerYear]}>{KICKER[period]}</Text>
        <Text style={[styles.period, isYear && styles.periodYear]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      <View style={[styles.mapWrap, isYear && styles.mapWrapYear]}>
        <ImpactMap coverage={recap.coverage} height={isYear ? 230 : 150} />
        {!recap.hasPath && (
          <View style={styles.mapEmptyOverlay}>
            <Icon name="route" size={20} color={isYear ? 'rgba(255,255,255,0.5)' : C.muted} sw={1.8} />
          </View>
        )}
      </View>

      <View style={styles.heroRow}>
        <Text style={[styles.heroNum, isYear && styles.heroNumYear]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {stats.pickups.toLocaleString()}
        </Text>
        <Text style={[styles.heroUnit, isYear && styles.heroUnitYear]}>pieces picked up</Text>
      </View>

      <View style={styles.tiles}>
        <MiniTile value={formatBagsShort(stats.bags)} label="BAGS" big={isYear} />
        <MiniTile value={String(stats.cleanups)} label="CLEANUPS" big={isYear} />
        <MiniTile value={String(stats.activeDays)} label="DAYS" big={isYear} />
      </View>

      {stats.bestDay && (
        <Text style={[styles.bestDay, isYear && styles.bestDayYear]} numberOfLines={1}>
          Best day: {stats.bestDay.dateLabel} · {stats.bestDay.pickups} pieces
        </Text>
      )}

      <View style={[styles.footer, isYear && styles.footerYear]}>
        <View style={styles.footerLeft}>
          {!!displayName && (
            <Text style={[styles.footerName, isYear && styles.footerNameYear]} numberOfLines={1}>
              {displayName}
              {subLabel ? ` · ${subLabel}` : ''}
            </Text>
          )}
          {!!levelName && (
            <View style={[styles.levelPill, { backgroundColor: levelColor ?? C.tint }]}>
              <Text style={styles.levelPillText} numberOfLines={1}>{levelName}</Text>
            </View>
          )}
        </View>
        <View style={styles.brandRow}>
          <Icon name="leaf" size={14} color={isYear ? C.creamText : C.primary} sw={1.8} />
          <Text style={[styles.brand, isYear && styles.brandYear]}>Pick</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 340,
    borderRadius: radius.cardLg,
    padding: 22,
    ...shadow.card,
  },
  cardDefault: { backgroundColor: '#fff' },
  cardYear: { backgroundColor: C.dark, width: 320, paddingVertical: 30 },

  head: { marginBottom: 14 },
  kicker: { fontFamily: Fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase' },
  kickerYear: { color: C.heroSub, fontSize: 12 },
  period: { fontFamily: Fonts.headlineBold, fontSize: 26, letterSpacing: -0.4, color: C.dark, marginTop: 2 },
  periodYear: { color: '#fff', fontSize: 32, letterSpacing: -0.6 },

  mapWrap: { borderRadius: radius.card, overflow: 'hidden' },
  mapWrapYear: { borderRadius: radius.card },
  mapEmptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 18 },
  heroNum: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 42, letterSpacing: -1, color: C.dark },
  heroNumYear: { color: '#fff', fontSize: 54 },
  heroUnit: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: C.muted },
  heroUnitYear: { color: C.heroSub2, fontSize: 15 },

  tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
  tile: { flex: 1, alignItems: 'center' },
  tileNum: { fontFamily: Fonts.displayBold, fontSize: 20, letterSpacing: -0.3, color: C.primary },
  tileNumYear: { color: '#fff', fontSize: 23 },
  tileLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  tileLabelYear: { color: C.heroSub, fontSize: 10.5 },

  bestDay: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 14, textAlign: 'center' },
  bestDayYear: { color: C.heroSub2 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border2,
  },
  footerYear: { borderTopColor: 'rgba(255,255,255,0.14)' },
  footerLeft: { flex: 1, marginRight: 8, gap: 4 },
  footerName: { fontFamily: Fonts.bodySemibold, fontSize: 12, color: C.text3 },
  footerNameYear: { color: 'rgba(255,255,255,0.72)' },
  levelPill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9 },
  levelPillText: { fontFamily: Fonts.bodyBold, fontSize: 10, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brand: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.primary },
  brandYear: { color: '#fff' },
});
