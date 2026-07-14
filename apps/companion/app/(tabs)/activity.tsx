import { useCallback, useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';

import { getAuthService } from '../../src/services/authService';
import { getDatabase } from '../../src/services/database';
import { getCoverageStats } from '../../src/services/streetSegments';
import { Icon, IconName } from '../../src/pick/Icon';
import { C, radius, shadow } from '../../src/pick/theme';
import { Card, ProgressBar } from '../../src/pick/ui';
import { cleanupBags, formatBagsShort } from '../../src/services/impactMetrics';

const MILESTONE = 50;

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

function formatDate(ts: number) {
  const date = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
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
  const [editBags, setEditBags] = useState('');
  const [badges, setBadges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [coverage, setCoverage] = useState<{ freshPct: number; everCleanedPct: number; totalSegments: number } | null>(null);

  useEffect(() => {
    loadActivity();
    loadCoverage();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
    }, [])
  );

  const loadCoverage = async () => {
    try {
      const pos = await Location.getLastKnownPositionAsync();
      if (!pos) return;
      const s = await getCoverageStats(pos.coords.latitude, pos.coords.longitude);
      if (s.totalSegments > 0) setCoverage(s);
    } catch (error) {
      console.log('Coverage stats unavailable:', error);
    }
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

  const openEdit = (cleanup: any) => {
    setEditing(cleanup);
    setEditBags(cleanup.bags_est ? String(cleanup.bags_est) : '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const b = parseFloat(editBags);
    if (isNaN(b) || b < 0) {
      Alert.alert('Enter bags', 'How many standard (13-gal) bags did you fill? e.g. 0.5 or 2');
      return;
    }
    try {
      const db = await getDatabase();
      const ok = await db.updateCleanup(editing.id, { bags_est: b });
      if (ok) {
        Keyboard.dismiss();
        setEditing(null);
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

  const milestonePct = Math.min(1, totalCleanups / MILESTONE);

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

        {/* cumulative hero */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Total pickups{sinceLabel ? ` since ${sinceLabel}` : ''}</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroNum}>{totalPickups}</Text>
            <Text style={styles.heroUnit}>pieces</Text>
            {weekDelta > 0 && (
              <View style={styles.trendPill}>
                <Icon name="trend" size={14} color={C.accent} sw={2.2} />
                <Text style={styles.trendText}>+{weekDelta} this week</Text>
              </View>
            )}
          </View>
        </View>

        {/* stat tiles — bags stays small here; it headlines on the end screen and team boards */}
        <View style={styles.tiles}>
          <Tile value={String(totalCleanups)} label="CLEANUPS" />
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

        {/* milestone */}
        <Card style={{ marginTop: 12 }}>
          <View style={styles.between}>
            <Text style={styles.milestoneTitle}>Next milestone</Text>
            <Text style={styles.milestoneMeta}>
              {totalCleanups} / {MILESTONE} cleanups
            </Text>
          </View>
          <View style={{ marginTop: 12 }}>
            <ProgressBar pct={milestonePct} />
          </View>
          <Text style={styles.milestoneHint}>
            {Math.max(0, MILESTONE - totalCleanups)} more cleanups to your next milestone.
          </Text>
        </Card>

        {/* street coverage — scoped to a 600m radius around the CURRENT GPS fix,
            not a selected neighborhood; the heading and hint say so honestly. */}
        {coverage && (
          <Card style={{ marginTop: 12 }}>
            <Text style={styles.cardHeading}>Streets around you</Text>
            <View style={[styles.tiles, { marginTop: 14 }]}>
              <MiniStat value={`${coverage.freshPct}%`} label="FRESH" />
              <MiniStat value={`${coverage.everCleanedPct}%`} label="EVER CLEANED" />
              <MiniStat value={String(coverage.totalSegments)} label="BLOCKS" />
            </View>
            <View style={{ marginTop: 14 }}>
              <ProgressBar pct={Math.max(0.01, coverage.everCleanedPct / 100)} height={8} />
            </View>
            <Text style={styles.milestoneHint}>{coverage.everCleanedPct}% of the streets near your current location have ever been cleaned.</Text>
          </Card>
        )}

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
                  <Text style={styles.recentPlace}>{formatDate(c.timestamp)}</Text>
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

      {/* Edit / add-weight-later for a saved cleanup */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView style={styles.editOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => Keyboard.dismiss()} />
          <View style={styles.editSheet}>
            <Text style={styles.editTitle}>Edit bags</Text>
            {editing && <Text style={styles.editSub}>{formatDate(editing.timestamp)} · {editing.items_count} pieces</Text>}
            <TextInput
              style={styles.editInput}
              placeholder="Standard 13-gal bags (e.g. 0.5 or 2)"
              placeholderTextColor={C.muted}
              keyboardType="decimal-pad"
              value={editBags}
              onChangeText={setEditBags}
              autoFocus
            />
            <View style={styles.editActions}>
              <TouchableOpacity style={[styles.editBtn, styles.editCancel]} onPress={() => { Keyboard.dismiss(); setEditing(null); }}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editBtn, styles.editSave]} onPress={saveEdit}>
                <Text style={styles.editSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.miniNum}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loading: { fontSize: 16, color: C.muted },

  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: C.dark, marginBottom: 18 },

  hero: { backgroundColor: C.primary, borderRadius: radius.cardLg, padding: 22 },
  heroLabel: { fontSize: 13, color: C.heroSub, fontWeight: '500' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  heroNum: { fontSize: 52, fontWeight: '700', letterSpacing: -1.5, lineHeight: 54, color: '#fff' },
  heroUnit: { fontSize: 18, fontWeight: '600', color: C.heroSub2 },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
  },
  trendText: { fontSize: 13, fontWeight: '600', color: '#fff' },

  tiles: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tile: { flex: 1, backgroundColor: '#fff', borderRadius: radius.card, padding: 15, ...shadow.card },
  tileNum: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5, color: C.dark },
  miniNum: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5, color: C.primary },
  tileLabel: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 2 },

  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardHeading: { fontSize: 15, fontWeight: '700', color: C.dark },
  milestoneTitle: { fontSize: 14, fontWeight: '600', color: C.dark },
  milestoneMeta: { fontSize: 13, color: C.muted },
  milestoneHint: { fontSize: 12, color: C.muted, marginTop: 8 },

  sectionHead: { marginTop: 22, marginBottom: 12, marginHorizontal: 4 },
  sectionH: { fontSize: 17, fontWeight: '700', color: C.dark },
  sectionAction: { fontSize: 13, color: C.accent, fontWeight: '600' },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { width: '31.6%', backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', ...shadow.card },
  badgeWell: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tint },
  badgeName: { fontSize: 11, fontWeight: '600', color: '#3A4A33', marginTop: 8, textAlign: 'center' },

  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 15 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border2 },
  recentWell: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  recentPlace: { fontSize: 15, fontWeight: '600', color: C.dark },
  recentSub: { fontSize: 12, color: C.muted, marginTop: 1 },
  rowBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.field, alignItems: 'center', justifyContent: 'center' },

  empty: { fontSize: 14, color: C.muted, textAlign: 'center', paddingVertical: 12 },

  editOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(27,46,26,0.45)' },
  editSheet: { backgroundColor: C.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 },
  editTitle: { fontSize: 20, fontWeight: '700', color: C.dark },
  editSub: { fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 14 },
  editInput: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border3, paddingVertical: 14, paddingHorizontal: 14, fontSize: 16, color: C.dark },
  editActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  editBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  editCancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border3 },
  editCancelText: { color: C.dark, fontSize: 15, fontWeight: '700' },
  editSave: { backgroundColor: C.primary },
  editSaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
