/**
 * "My Path" — the always-available entry point for recaps, as opposed to the
 * once-per-period auto-surfaced banner on the Impact tab. Lets you browse
 * past weeks/months/years and reopen any of them (the banner disappears once
 * dismissed and only ever shows the single latest unseen period, so without
 * this there'd be no way to revisit one, and no way to QA the feature before
 * a real period actually closes).
 *
 * Periods with zero cleanups are skipped — nobody wants a scrollable list of
 * "0 pieces" rows.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { RecapModal } from './RecapModal';
import { C, Fonts, radius } from './theme';
import { formatBagsShort } from '../services/impactMetrics';
import { buildRecap, listRecentRanges, type RecapData, type RecapPeriod } from '../services/recap';
import type { Cleanup } from '../services/firebaseDatabase';

const TABS: { key: RecapPeriod; label: string; lookback: number }[] = [
  { key: 'week', label: 'Weeks', lookback: 10 },
  { key: 'month', label: 'Months', lookback: 12 },
  { key: 'year', label: 'Years', lookback: 6 },
];

export function RecapHistory({
  visible,
  cleanups,
  displayName,
  subLabel,
  levelName,
  levelColor,
  onClose,
}: {
  visible: boolean;
  cleanups: Cleanup[];
  displayName?: string;
  subLabel?: string;
  /** Current all-time milestone tier — see RecapCard. */
  levelName?: string;
  levelColor?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<RecapPeriod>('month');
  const [selected, setSelected] = useState<RecapData | null>(null);

  const rows = useMemo(() => {
    const cfg = TABS.find((t) => t.key === tab)!;
    return listRecentRanges(tab, cfg.lookback)
      .map((range) => buildRecap(cleanups, range))
      .filter((d) => d.stats.cleanups > 0);
  }, [tab, cleanups]);

  return (
    <>
      {/* Hidden while a recap is selected — a second <Modal> can't stack over
          an already-open one on iOS (same issue as ShareComposer/community's
          post composer), so tapping a row would otherwise silently do
          nothing. Toggling visible off here, rather than unmounting, means
          it's already there and just reappears when RecapModal closes. */}
      <Modal visible={visible && !selected} animationType="slide" onRequestClose={onClose}>
        <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>My Path</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={22} color={C.dark} sw={2} />
            </Pressable>
          </View>
          <Text style={styles.sub}>Every walk, recapped. Tap one to view it again — and share it.</Text>

          <View style={styles.tabs}>
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <Pressable key={t.key} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(t.key)}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="route" size={28} color={C.muted} sw={1.6} />
              <Text style={styles.emptyText}>
                No {tab}s with cleanups yet. Once one closes with activity in it, it'll show up here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(d) => d.range.key}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => setSelected(item)}>
                  <View style={styles.rowWell}>
                    <Icon name={item.range.period === 'year' ? 'trophy' : 'route'} size={18} color={C.primary} sw={1.8} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{item.range.label}</Text>
                    <Text style={styles.rowSub}>
                      {item.stats.pickups.toLocaleString()} pieces · {formatBagsShort(item.stats.bags)} bags · {item.stats.cleanups} cleanup
                      {item.stats.cleanups === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Icon name="chevron" size={16} color={C.chevron} sw={2} />
                </Pressable>
              )}
            />
          )}
        </View>
      </Modal>

      <RecapModal
        visible={!!selected}
        recap={selected}
        displayName={displayName}
        subLabel={subLabel}
        levelName={levelName}
        levelColor={levelColor}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: Fonts.displayBold, fontSize: 28, letterSpacing: -0.4, color: C.dark },
  sub: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 4, marginBottom: 16, lineHeight: 18 },

  tabs: { flexDirection: 'row', gap: 6, marginBottom: 14, backgroundColor: C.tint, borderRadius: radius.field, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.chip, alignItems: 'center' },
  tabActive: { backgroundColor: C.white },
  tabText: { fontFamily: Fonts.bodySemibold, fontSize: 13, color: C.muted },
  tabTextActive: { color: C.dark, fontFamily: Fonts.bodyBold },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
  },
  rowWell: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: Fonts.headlineBold, fontSize: 16, color: C.dark },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30, gap: 12 },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },
});
