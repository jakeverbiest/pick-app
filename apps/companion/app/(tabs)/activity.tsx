import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { getAuthService } from '../../src/services/authService';
import { getDatabase } from '../../src/services/database';
import { Icon, IconName } from '../../src/pick/Icon';
import { C, Fonts, radius } from '../../src/pick/theme';
import { Card, ProgressBar } from '../../src/pick/ui';
import { StreakCard } from '../../src/pick/StreakCard';
import { RecapModal } from '../../src/pick/RecapModal';
import { RecapHistory } from '../../src/pick/RecapHistory';
import {
  BAG_SIZE_FACTORS,
  cleanupBags,
  formatBagsShort,
  reportedBags,
  snapFullness,
  storedFullness,
} from '../../src/services/impactMetrics';
import { BagDetails, type BagDetailsValue } from '../../src/pick/BagDetails';
import { levelTierColor, milestoneProgress } from '../../src/services/milestones';
import { buildRecap, getUnseenRecap, listRecentRanges, markRecapSeen, type RecapData, type RecapPeriod } from '../../src/services/recap';
import { RecapCard } from '../../src/pick/RecapCard';

function recapBannerTitle(period: RecapPeriod): string {
  if (period === 'year') return 'Your year in Pick is ready';
  return `Your ${period}'s recap is ready`;
}

// Map a backend badge_type to a Trail line-icon + readable name.
const BADGE_ICON: Record<string, IconName> = {
  pioneer: 'pin',
  explorer: 'route',
  city_mapper: 'target',
  collector: 'bag',
  heavy_lifter: 'bag',
  king_queen: 'trophy',
  consistent: 'check',
  dedicated: 'clock',
  unstoppable: 'bolt',
};

function badgeName(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Short by design: these labels sit on a single row next to a time and a
// stat line, and "Yesterday" wrapped onto a second line on smaller phones.
function formatDate(ts: number) {
  const date = new Date(ts * 1000);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${seconds}s`;
}

export default function ActivityScreen() {
  const [stats, setStats] = useState<any>(null);
  const [cleanups, setCleanups] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [editValue, setEditValue] = useState<BagDetailsValue | null>(null);
  const [badges, setBadges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // "My Path" recap: whichever closed week/month/year the user hasn't seen
  // yet, surfaced as a banner (year takes priority over month over week —
  // showing all three at a year boundary would be noisy).
  const [recapPeriod, setRecapPeriod] = useState<RecapPeriod | null>(null);
  const [recapData, setRecapData] = useState<RecapData | null>(null);
  const [recapProfile, setRecapProfile] = useState<{ displayName?: string; subLabel?: string }>({});
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapDismissed, setRecapDismissed] = useState(false);
  // Full cleanup history for "My Path" browsing (the recent-cleanups list above
  // only loads 20) — populated by checkRecap and refreshed whenever My Path opens.
  const [allCleanups, setAllCleanups] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Preview art for the "My Path" entry point — the most recently closed
  // week, rendered small. Falls back to RecapCard's own empty-path state
  // when there's nothing to show yet, same as the full history browser.
  const previewRecap = useMemo(
    () => buildRecap(cleanups, listRecentRanges('week', 1)[0]),
    [cleanups]
  );

  useEffect(() => {
    loadActivity();
    checkRecap();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [])
  );

  const checkRecap = async () => {
    try {
      const currentUser = getAuthService().getCurrentUser();
      if (!currentUser) return;
      const db = await getDatabase();
      const [all, settings] = await Promise.all([db.getCleanups(1000), db.getUserSettings(currentUser.uid)]);
      setAllCleanups(all || []);
      setRecapProfile({ displayName: settings?.display_name, subLabel: settings?.team_name || settings?.neighborhood });

      // Priority: a closed year matters more than the month/week nested inside
      // it — surface at most one banner at a time. Skip a period with zero
      // cleanups entirely rather than nagging an inactive user every week.
      for (const period of ['year', 'month', 'week'] as const) {
        const range = await getUnseenRecap(period);
        if (!range) continue;
        const data = buildRecap(all || [], range);
        if (data.stats.cleanups === 0) continue;
        setRecapPeriod(period);
        setRecapData(data);
        return;
      }
    } catch (error) {
      console.log('Recap check skipped:', error);
    }
  };

  const openRecap = async () => {
    if (!recapPeriod || !recapData) return;
    await markRecapSeen(recapPeriod, recapData.range.key);
    setRecapOpen(true);
  };

  const openHistory = () => {
    setHistoryOpen(true);
    // Refresh in the background — checkRecap may have run a while ago (or
    // before login resolved), so this catches anything logged since.
    (async () => {
      try {
        const db = await getDatabase();
        const all = await db.getCleanups(1000);
        setAllCleanups(all || []);
      } catch {}
    })();
  };

  const loadActivity = async () => {
    try {
      const db = await getDatabase();
      const currentUser = getAuthService().getCurrentUser();
      if (!currentUser) {
        setLoading(false);
        return;
      }
      const userStats = await db.getCleanupStats();
      const userCleanups = await db.getCleanups(20);
      const userBadges = await db.getBadges(currentUser.uid);
      setStats(userStats);
      setCleanups(userCleanups || []);
      setBadges(userBadges || []);
    } catch (error) {
      console.error('Failed to load activity:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportCleanup = async (cleanup: any) => {
    try {
      const exportData = {
        id: cleanup.id,
        date: new Date(cleanup.timestamp * 1000).toISOString(),
        duration: formatTime(cleanup.duration_seconds),
        items_detected: cleanup.items_count,
        bags_est: cleanupBags(cleanup),
        team: cleanup.team,
        location: { lat: cleanup.location_lat, lon: cleanup.location_lon },
        route_points: cleanup.route_points ? JSON.parse(cleanup.route_points) : [],
        motion_log: cleanup.motion_log ? JSON.parse(cleanup.motion_log) : 'not recorded',
        notes: cleanup.notes || 'N/A',
      };
      await Clipboard.setStringAsync(JSON.stringify(exportData, null, 2));
      Alert.alert('Exported', 'Cleanup data copied to clipboard.');
    } catch (error) {
      Alert.alert('Error', 'Failed to export cleanup data');
      console.error('Export failed:', error);
    }
  };

  /**
   * Rebuild the four values a walk was reported with, so the sheet opens
   * showing roughly what the record already says instead of a blank form the
   * user could silently overwrite by tapping Save.
   *
   * `bag_fullness` is stored directly on walks saved from 17 Aug on. Older
   * ones only kept the derived `bags_est`, so fullness is backed out of it
   * (storedFullness); walks with no bag report at all fall back to whatever
   * fullness best matches the pickup-derived estimate currently displayed.
   */
  const openEdit = (cleanup: any) => {
    const size = BAG_SIZE_FACTORS[cleanup.bag_size || ''] ? cleanup.bag_size : 'kitchen';
    const qty = cleanup.bag_qty > 0 ? cleanup.bag_qty : 1;
    const reported = storedFullness(cleanup);
    const derived = Math.min(100, (cleanupBags(cleanup) / (BAG_SIZE_FACTORS[size] * qty)) * 100);
    setEditing(cleanup);
    setEditValue({
      count: cleanup.items_count || 0,
      size,
      qty,
      fullness: snapFullness(reported ?? derived),
    });
  };

  const saveEdit = async () => {
    if (!editing || !editValue) return;
    try {
      const db = await getDatabase();
      // bags_est is recomputed here on purpose: it is the ONLY field the
      // aggregates read (cleanupBags), so writing size/qty/fullness without it
      // would change the record and nothing the user can see. items_detected
      // is never touched — it stays the raw sensor figure for detector tuning.
      const ok = await db.updateCleanup(editing.id, {
        items_count: editValue.count,
        bag_size: editValue.size,
        bag_qty: editValue.qty,
        bag_fullness: editValue.fullness,
        bags_est: reportedBags(editValue.size, editValue.fullness, editValue.qty),
      });
      if (ok) {
        Keyboard.dismiss();
        setEditing(null);
        setEditValue(null);
        loadActivity();
      } else {
        Alert.alert('Error', 'Could not update that cleanup.');
      }
    } catch {
      Alert.alert('Error', 'Could not update that cleanup.');
    }
  };

  const deleteCleanup = (cleanup: any) => {
    Alert.alert(
      'Delete this cleanup?',
      `${formatDate(cleanup.timestamp)} · ${cleanup.items_count} items. This removes it from your stats and the community map. Cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDatabase();
              const ok = await db.deleteCleanup(cleanup.id);
              if (ok) loadActivity();
              else Alert.alert('Error', 'Failed to delete cleanup');
            } catch {
              Alert.alert('Error', 'Failed to delete cleanup');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.loading}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const totalBags = (stats?.total_bags as number) || 0;
  const totalPickups = (stats?.total_pickups as number) || 0;
  const totalCleanups = (stats?.total_cleanups as number) || 0;
  const cleanupDays = (stats?.cleanup_days as number) || 0;

  // Pickups in the last 7 days, computed from real cleanups.
  const weekAgo = Date.now() / 1000 - 7 * 24 * 3600;
  const weekDelta = cleanups
    .filter((c) => c.timestamp >= weekAgo)
    .reduce((sum, c) => sum + (c.items_count || 0), 0);

  const milestone = milestoneProgress(totalCleanups);

  // "since June 2026" — anchor the all-time total to the first cleanup.
  const firstTs = cleanups.length ? Math.min(...cleanups.map((c) => c.timestamp || Infinity)) : null;
  const sinceLabel =
    firstTs && isFinite(firstTs)
      ? new Date(firstTs * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Your impact</Text>

        {/* Hero first — the flagship personal stat (design audit: this page is
            the #1 home for personal stats; lead with the number). */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel} numberOfLines={2}>
            Total pickups{sinceLabel ? ` since ${sinceLabel}` : ''}
          </Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {totalPickups.toLocaleString()}
            </Text>
            <Text style={styles.heroUnit}>pieces</Text>
          </View>
          <Text style={styles.heroSubStat} numberOfLines={1}>
            across {totalCleanups.toLocaleString()} {totalCleanups === 1 ? 'cleanup' : 'cleanups'}
          </Text>
          {/* Trend sits on its own row: at 6-digit totals it used to be pushed
              off the right edge of the card when it shared the number's row. */}
          {weekDelta > 0 && (
            <View style={styles.trendPill}>
              <Icon name="trend" size={14} color={C.accent} sw={2.2} />
              <Text style={styles.trendText} numberOfLines={1}>
                +{weekDelta.toLocaleString()} this week
              </Text>
            </View>
          )}
        </View>

        {/* Level + next-tier progress, merged into one card — these used to be
            two separate cards describing the same milestone system (current
            tier vs. next tier), which was pure duplication. */}
        <Card style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[styles.levelBadge, { backgroundColor: levelTierColor(milestone.earned) }]}>
              <Icon name={milestone.earned > 0 ? 'trophy' : 'target'} size={22} color="#fff" sw={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelLabel}>YOUR LEVEL</Text>
              <Text style={styles.levelName} numberOfLines={1}>
                {milestone.previousName ?? 'Unranked'}
              </Text>
            </View>
            {milestone.earned > 0 && (
              <View style={styles.levelTierPill}>
                <Text style={styles.levelTierPillText}>Tier {milestone.earned}</Text>
              </View>
            )}
          </View>
          <View style={{ marginTop: 16 }}>
            <View style={styles.between}>
              <Text style={styles.milestoneTitle} numberOfLines={1}>
                Next: {milestone.name}
              </Text>
              <Text style={styles.milestoneMeta}>
                {totalCleanups.toLocaleString()} / {milestone.target.toLocaleString()}
              </Text>
            </View>
            <View style={{ marginTop: 12 }}>
              <ProgressBar pct={Math.max(0.01, milestone.pct)} color="rust" />
            </View>
            <Text style={styles.milestoneHint}>
              {milestone.remaining === 1
                ? '1 more cleanup to go.'
                : `${milestone.remaining.toLocaleString()} more cleanups to go.`}
            </Text>
          </View>
        </Card>

        {/* "My Path" recap banner — at most one of week/month/year, whichever
            closed period hasn't been shown yet. Dismissing just hides it for
            this session; it reappears next launch until actually opened. */}
        {recapPeriod && recapData && !recapDismissed && (
          <Pressable style={styles.recapBanner} onPress={openRecap}>
            <View style={styles.recapIconWell}>
              <Icon name={recapPeriod === 'year' ? 'trophy' : 'route'} size={20} color="#fff" sw={1.8} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recapTitle} numberOfLines={1}>
                {recapBannerTitle(recapPeriod)}
              </Text>
              <Text style={styles.recapSub} numberOfLines={1}>
                {recapData.range.label} · {recapData.stats.pickups.toLocaleString()} pieces picked up
              </Text>
            </View>
            <Pressable
              hitSlop={10}
              onPress={(e) => {
                e.stopPropagation();
                setRecapDismissed(true);
              }}
            >
              <Icon name="close" size={16} color="rgba(255,255,255,0.7)" sw={2} />
            </Pressable>
          </Pressable>
        )}

        {/* stat tiles — cleanups already leads the hero card above, so this
            row is just the two supporting stats. Bags stays small here; it
            headlines on the end screen and team boards. */}
        <View style={styles.tiles}>
          <Tile value={String(cleanupDays)} label="ACTIVE DAYS" />
          <Tile
            value={formatBagsShort(totalBags)}
            label="BAGS"
            onPress={() =>
              Alert.alert(
                'What counts as a bag?',
                'One bag = a standard 13-gallon kitchen trash bag — roughly 200 pickups of typical street litter. When you report your bag at the end of a cleanup, your report is used instead of the estimate.'
              )
            }
          />
        </View>

        <StreakCard />

        {/* "My Path" entry point — always available, unlike the banner above
            (which shows once and disappears). Lets you browse and re-share
            any past week/month/year, not just the newest one. */}
        <Pressable style={styles.pathRow} onPress={openHistory}>
          <View style={styles.pathPreview} pointerEvents="none">
            <View style={styles.pathPreviewInner}>
              <RecapCard recap={previewRecap} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.pathRowTitle}>My Path</Text>
            <Text style={styles.pathRowSub}>Your walks, recapped — weekly, monthly, year-end</Text>
          </View>
          <Icon name="chevron" size={16} color={C.chevron} sw={2} />
        </Pressable>

        {/* badges (real) */}
        {badges.length > 0 && (
          <>
            <View style={[styles.between, styles.sectionHead]}>
              <Text style={styles.sectionH}>Badges</Text>
              <Text style={styles.sectionAction}>{badges.length} earned</Text>
            </View>
            <View style={styles.badgeGrid}>
              {badges.map((b, i) => (
                <View key={b.id ?? i} style={styles.badge}>
                  <View style={styles.badgeWell}>
                    <Icon name={BADGE_ICON[b.badge_type] ?? 'leaf'} size={20} color={C.primary} />
                  </View>
                  <Text style={styles.badgeName}>{badgeName(b.badge_type)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* recent cleanups (real) */}
        <View style={[styles.between, styles.sectionHead]}>
          <Text style={styles.sectionH}>Recent cleanups</Text>
        </View>
        {cleanups.length > 0 ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {cleanups.map((c, i) => (
              <View key={c.id ?? i} style={[styles.recentRow, i < cleanups.length - 1 && styles.rowBorder]}>
                <View style={styles.recentWell}>
                  <Icon name="leaf" size={20} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentPlace}>
                    {formatDate(c.timestamp)} · {new Date(c.timestamp * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <Text style={styles.recentSub}>
                    {c.items_count} pieces · {formatTime(c.duration_seconds)}
                  </Text>
                </View>
                <Pressable style={styles.rowBtn} onPress={() => openEdit(c)} hitSlop={6}>
                  <Icon name="plus" size={17} color={C.primary} sw={1.9} />
                </Pressable>
                <Pressable style={styles.rowBtn} onPress={() => exportCleanup(c)} hitSlop={6}>
                  <Icon name="share" size={17} color={C.muted} sw={1.8} />
                </Pressable>
                <Pressable style={styles.rowBtn} onPress={() => deleteCleanup(c)} hitSlop={6}>
                  <Icon name="trash" size={17} color={C.danger} sw={1.8} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : (
          <Card>
            <Text style={styles.empty}>No cleanups logged yet. Start one on the Map tab.</Text>
          </Card>
        )}
      </ScrollView>

      <RecapModal
        visible={recapOpen}
        recap={recapData}
        displayName={recapProfile.displayName}
        subLabel={recapProfile.subLabel}
        levelName={milestone.previousName ?? undefined}
        levelColor={levelTierColor(milestone.earned)}
        onClose={() => setRecapOpen(false)}
      />

      <RecapHistory
        visible={historyOpen}
        cleanups={allCleanups}
        displayName={recapProfile.displayName}
        subLabel={recapProfile.subLabel}
        levelName={milestone.previousName ?? undefined}
        levelColor={levelTierColor(milestone.earned)}
        onClose={() => setHistoryOpen(false)}
      />

      {/* Edit / add-weight-later for a saved cleanup */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        {/* No KeyboardAvoidingView: this sheet is bottom-anchored and taller
            than the screen, so padding the container by the keyboard height
            pushes the field you just tapped off the TOP of the display. The
            ScrollView takes the inset instead and scrolls focus into view. */}
        <View style={styles.editOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => Keyboard.dismiss()} />
          <View style={styles.editSheet}>
            <ScrollView
              contentContainerStyle={styles.editScroll}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.editTitle}>Edit this walk</Text>
              {editing && <Text style={styles.editSub}>{formatDate(editing.timestamp)}</Text>}
              {editValue && (
                <BagDetails
                  value={editValue}
                  onChange={setEditValue}
                  detectedCount={typeof editing?.items_detected === 'number' ? editing.items_detected : null}
                />
              )}
              <View style={styles.editActions}>
                <TouchableOpacity style={[styles.editBtn, styles.editCancel]} onPress={() => { Keyboard.dismiss(); setEditing(null); }}>
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.editBtn, styles.editSave]} onPress={saveEdit}>
                  <Text style={styles.editSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Tile({ value, label, onPress }: { value: string; label: string; onPress?: () => void }) {
  return (
    <Pressable style={styles.tile} onPress={onPress} disabled={!onPress}>
      <Text style={styles.tileNum}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loading: { fontFamily: Fonts.body, fontSize: 16, color: C.muted },

  h1: { fontFamily: Fonts.displayBold, fontSize: 32, letterSpacing: -0.4, color: C.dark, marginBottom: 18, textTransform: 'uppercase' },

  hero: { backgroundColor: C.primary, borderRadius: radius.cardLg, padding: 22 },
  heroLabel: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: C.heroSub },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  heroNum: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 52, letterSpacing: -1.5, lineHeight: 58, color: C.creamText },
  heroUnit: { fontFamily: Fonts.bodySemibold, fontSize: 18, color: C.heroSub2 },
  heroSubStat: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: C.heroSub2, marginTop: 4 },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: 12,
    backgroundColor: 'rgba(254,252,221,0.16)',
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
  },
  trendText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.creamText },

  recapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.dark,
    borderRadius: radius.card,
    padding: 14,
    marginTop: 12,
  },
  recapIconWell: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(254,252,221,0.16)', alignItems: 'center', justifyContent: 'center' },
  recapTitle: { fontFamily: Fonts.headlineBold, fontSize: 15, color: C.creamText },
  recapSub: { fontFamily: Fonts.body, fontSize: 12, color: C.heroSub2, marginTop: 2 },

  pathRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 14,
    marginTop: 12,
  },
  pathIconWell: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  pathRowTitle: { fontFamily: Fonts.headlineBold, fontSize: 15, color: C.dark },
  pathRowSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 2 },
  // A real (if tiny) render of RecapCard, cropped to its top slice — shows the
  // path art itself rather than a generic icon, so the row previews what
  // tapping in actually gets you.
  pathPreview: { width: 52, height: 68, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.white, overflow: 'hidden' },
  pathPreviewInner: { width: 340, transform: [{ scale: 52 / 340 }], transformOrigin: 'top left' },

  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 14,
    marginTop: 12,
  },
  levelBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  levelLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  levelName: { fontFamily: Fonts.headlineBold, fontSize: 17, color: C.dark, marginTop: 2 },
  levelTierPill: { backgroundColor: C.tint, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 11 },
  levelTierPillText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: C.primary },

  tiles: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tile: { flex: 1, backgroundColor: C.white, borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, padding: 14 },
  tileNum: { fontFamily: Fonts.displayBold, fontSize: 26, letterSpacing: -0.5, color: C.dark },
  tileLabel: { fontFamily: Fonts.bodyBold, fontSize: 10, color: C.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },

  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  milestoneTitle: { fontFamily: Fonts.headlineBold, fontSize: 16, color: C.dark },
  milestoneMeta: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.muted },
  milestoneHint: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 8 },

  sectionHead: { marginTop: 22, marginBottom: 12, marginHorizontal: 4 },
  sectionH: { fontFamily: Fonts.headlineBold, fontSize: 20, color: C.dark },
  sectionAction: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.accent },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { width: '31.6%', backgroundColor: C.white, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
  badgeWell: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tint },
  badgeName: { fontFamily: Fonts.bodyBold, fontSize: 11, color: C.dark, marginTop: 8, textAlign: 'center' },

  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 15 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border2 },
  recentWell: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  recentPlace: { fontFamily: Fonts.bodySemibold, fontSize: 15, color: C.dark },
  recentSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },
  rowBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.field, alignItems: 'center', justifyContent: 'center' },

  empty: { fontFamily: Fonts.body, fontSize: 14, color: C.muted, textAlign: 'center', paddingVertical: 12 },

  editOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,47,102,0.45)' },
  editSheet: { backgroundColor: C.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  editScroll: { padding: 22, paddingBottom: 34 },
  editTitle: { fontFamily: Fonts.headlineBold, fontSize: 21, color: C.dark },
  editSub: { fontFamily: Fonts.body, fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 6 },
  editActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  editCancel: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border3 },
  editCancelText: { fontFamily: Fonts.bodyBold, color: C.dark, fontSize: 15 },
  editSave: { backgroundColor: C.primary },
  editSaveText: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 15 },
});
