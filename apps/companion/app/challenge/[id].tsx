/**
 * A single challenge: the shared limitation (where + when), the collective
 * number, and who's contributing what.
 *
 * Progress is the sum of every participant's published contribution doc — see
 * src/services/challenges.ts for why the tally is client-published rather than
 * server-computed (raw cleanups are owner-only reads by design).
 *
 * Opening this screen republishes MY contribution first, so the number a
 * participant sees always includes their own latest walks.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Icon } from '../../src/pick/Icon';
import { C, Fonts, radius } from '../../src/pick/theme';
import { ProgressBar } from '../../src/pick/ui';
import { getAuthService } from '../../src/services/authService';
import { getDatabase } from '../../src/services/database';
import { formatBagsShort } from '../../src/services/impactMetrics';
import {
  getChallenge,
  getContributions,
  joinChallenge,
  leaveChallenge,
  deleteChallenge,
  publishMyContribution,
  totalFor,
  challengeSubtitle,
  daysLeft,
  unflattenRing,
  GOAL_LABEL,
  type Challenge,
  type Contribution,
} from '../../src/services/challenges';
import { buildChallengeRecap, getUnseenChallengeRecap, markChallengeRecapSeen } from '../../src/services/challengeRecap';
import { AreaPreview } from '../../src/pick/AreaPreview';
import { InviteSheet } from '../../src/pick/InviteSheet';
import { GroupRecapModal } from '../../src/pick/GroupRecapModal';

function fmt(goal: string, n: number): string {
  return goal === 'bags' ? formatBagsShort(n) : Math.round(n).toLocaleString();
}

export default function ChallengeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const me = getAuthService().getCurrentUser()?.uid || '';

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const c = await getChallenge(id);
      setChallenge(c);
      if (!c) return;

      // Refresh my own numbers before reading the board, so my latest walks
      // are already folded into the total the moment it renders.
      if (c.participants.includes(me)) {
        try {
          const db = await getDatabase();
          const mine = await db.getCleanups(1000);
          await publishMyContribution(c, mine as any);
        } catch (e) {
          console.warn('Could not refresh my contribution:', e);
        }
      }
      const fresh = await getContributions(id);
      setContribs(fresh);

      // First participant to open a just-completed challenge gets the recap
      // auto-presented once, instead of relying on someone remembering to tap
      // "Share recap" (mirrors getUnseenRecap's seen-map pattern for "My Path").
      if (c.status === 'completed' && (await getUnseenChallengeRecap(c.id))) {
        setRecapOpen(true);
        await markChallengeRecapSeen(c.id);
      }
    } catch (e) {
      console.error('Failed to load challenge:', e);
    } finally {
      setLoading(false);
    }
  }, [id, me]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleJoin = async () => {
    if (!challenge || !me) return;
    const joined = challenge.participants.includes(me);
    setBusy(true);
    try {
      if (joined) {
        await leaveChallenge(challenge.id, me);
      } else {
        await joinChallenge(challenge.id, me);
      }
      await load();
    } catch (e: any) {
      Alert.alert(joined ? 'Could not leave' : 'Could not join', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!challenge) return;
    Alert.alert(
      'Delete this challenge?',
      `"${challenge.name}" and everyone's contributions to it will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteChallenge(challenge.id);
              router.back();
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!challenge) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>This challenge no longer exists.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const joined = challenge.participants.includes(me);
  const isCreator = challenge.created_by === me;
  const total = totalFor(challenge.goal_type, contribs);
  const pct = Math.min(1, total / Math.max(1, challenge.goal_value));
  const left = daysLeft(challenge);
  const ring = unflattenRing(challenge.area.ring);
  const goalWord = GOAL_LABEL[challenge.goal_type];

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Icon name="back" size={22} color={C.dark} sw={2} />
        </Pressable>
        <Text style={styles.h1} numberOfLines={1}>{challenge.name}</Text>
        {isCreator ? (
          <Pressable onPress={confirmDelete} hitSlop={10}>
            <Icon name="trash" size={19} color={C.danger} sw={1.8} />
          </Pressable>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* The collective number — the whole point of the screen. */}
        <View style={styles.hero}>
          <Text style={styles.heroLabel} numberOfLines={2}>{challengeSubtitle(challenge)}</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {fmt(challenge.goal_type, total)}
            </Text>
            <Text style={styles.heroUnit}>/ {fmt(challenge.goal_type, challenge.goal_value)} {goalWord}</Text>
          </View>
          <View style={{ marginTop: 14 }}>
            <ProgressBar pct={Math.max(0.01, pct)} height={10} />
          </View>
          <View style={styles.heroMeta}>
            <View style={[styles.statusPill, challenge.status === 'completed' && styles.statusPillDone]}>
              {challenge.status !== 'completed' && <Icon name="clock" size={12} color="#fff" sw={1.8} />}
              <Text style={styles.statusText}>
                {challenge.status === 'upcoming'
                  ? 'Starts soon'
                  : challenge.status === 'completed'
                  ? pct >= 1 ? 'Goal reached' : 'Finished'
                  : left <= 1 ? 'Last day' : `${left} days left`}
              </Text>
            </View>
            <Text style={styles.heroSub}>
              {challenge.participants.length} {challenge.participants.length === 1 ? 'picker' : 'pickers'} in
              {challenge.invited?.length ? ` · ${challenge.invited.length} invited` : ''}
            </Text>
          </View>
        </View>

        {/* Anyone in the challenge can pull more people in — a collective goal
            is easier with more hands, and gatekeeping it to the creator just
            means fewer pickers. */}
        {challenge.status !== 'completed' && (
          <Pressable style={styles.inviteBtn} onPress={() => setInviting(true)}>
            <Icon name="plus" size={17} color={C.primary} sw={2.2} />
            <Text style={styles.inviteBtnText}>Invite pickers</Text>
          </Pressable>
        )}

        {!!challenge.description && (
          <View style={styles.card}>
            <Text style={styles.body}>{challenge.description}</Text>
          </View>
        )}

        {/* The limitation, stated plainly. */}
        <View style={styles.card}>
          <Text style={styles.cardHeading}>The rules</Text>
          <Rule
            icon="pin"
            label="Where"
            value={
              challenge.area.type === 'anywhere'
                ? 'Anywhere — every cleanup counts'
                : challenge.area.type === 'neighborhood'
                ? `Cleanups in ${challenge.area.label}`
                : `Inside the drawn boundary (${challenge.area.label})`
            }
          />
          <Rule
            icon="clock"
            label="When"
            value={
              challenge.kind === 'day'
                ? new Date(challenge.start_date * 1000).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric',
                  })
                : `${new Date(challenge.start_date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(
                    challenge.end_date * 1000
                  ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            }
          />
          <Rule icon="target" label="Goal" value={`${challenge.goal_value.toLocaleString()} ${goalWord}, together`} />
          {ring.length >= 3 && (
            <View style={{ marginTop: 14 }}>
              <AreaPreview ring={ring} height={150} />
            </View>
          )}
        </View>

        {/* Who's doing the work. */}
        <View style={[styles.between, styles.sectionHead]}>
          <Text style={styles.sectionH}>Contributors</Text>
          <Text style={styles.sectionAction}>{contribs.length} reporting</Text>
        </View>
        {contribs.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              {joined
                ? 'No cleanups counted yet. Log one inside the area and window and it lands here.'
                : 'Nobody has logged a qualifying cleanup yet — join and be first.'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {contribs.map((c, i) => {
              const you = c.uid === me;
              const value = (c as any)[challenge.goal_type] || 0;
              return (
                <View key={c.uid} style={[styles.row, you && styles.rowYou]}>
                  <View style={[styles.rank, i < 3 ? styles.rankTop : styles.rankPlain]}>
                    <Text style={[styles.rankText, i < 3 && { color: C.creamText }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {c.display_name || 'Picker'}{you ? '  ·  You' : ''}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {c.cleanups} cleanup{c.cleanups === 1 ? '' : 's'} · {formatBagsShort(c.bags || 0)} bags
                    </Text>
                  </View>
                  <Text style={styles.rowValue}>{fmt(challenge.goal_type, value)}</Text>
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.footnote}>
          Everyone's totals refresh when they open the app, so the group number can trail a teammate's
          latest walk by a few minutes.
        </Text>
      </ScrollView>

      {/* Opt in / out — the "limitation" only applies to people who chose it.
          Once the challenge is over, the whole point of this button changes:
          there's nothing left to join or leave, so it becomes the entry
          point to the group's shareable recap instead of going dead. */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.primaryBtn, joined && challenge.status !== 'completed' && styles.secondaryBtn, busy && { opacity: 0.6 }]}
          onPress={challenge.status === 'completed' ? () => setRecapOpen(true) : toggleJoin}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={joined ? C.primary : C.creamText} />
          ) : (
            <Text style={[styles.primaryBtnText, joined && challenge.status !== 'completed' && { color: C.primary }]}>
              {challenge.status === 'completed' ? 'Share recap' : joined ? 'Leave challenge' : 'Join challenge'}
            </Text>
          )}
        </Pressable>
      </View>

      <InviteSheet
        visible={inviting}
        challenge={challenge}
        onClose={() => setInviting(false)}
        onInvited={load}
      />

      <GroupRecapModal
        visible={recapOpen}
        recap={challenge.status === 'completed' ? buildChallengeRecap(challenge, contribs) : null}
        challenge={challenge}
        onClose={() => setRecapOpen(false)}
        onPosted={() => Alert.alert('Posted', 'Your group recap is live in the Community feed.')}
      />
    </SafeAreaView>
  );
}

function Rule({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleWell}>
        <Icon name={icon} size={17} color={C.primary} sw={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ruleLabel}>{label}</Text>
        <Text style={styles.ruleValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 16 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: { width: 22 },
  h1: { flex: 1, fontFamily: Fonts.headlineBold, fontSize: 18, color: C.dark, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },

  hero: { backgroundColor: C.primary, borderRadius: radius.cardLg, padding: 20 },
  heroLabel: { fontFamily: Fonts.bodySemibold, fontSize: 12.5, color: C.heroSub },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  heroNum: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 44, letterSpacing: -1.2, lineHeight: 50, color: C.creamText },
  heroUnit: { fontFamily: Fonts.bodySemibold, fontSize: 15, color: C.heroSub2, flexShrink: 1 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 10 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(193,80,46,0.32)', borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 11,
  },
  statusPillDone: { backgroundColor: 'rgba(254,252,221,0.16)' },
  statusText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: '#fff' },
  heroSub: { fontFamily: Fonts.body, fontSize: 12.5, color: C.heroSub, flexShrink: 1, textAlign: 'right' },

  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 12, paddingVertical: 13,
    backgroundColor: C.tint, borderRadius: radius.button,
  },
  inviteBtnText: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: C.primary },

  card: { backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, padding: 16, marginTop: 12 },
  cardHeading: { fontFamily: Fonts.headlineBold, fontSize: 15, color: C.dark, marginBottom: 4 },
  body: { fontFamily: Fonts.body, fontSize: 14, color: C.text2, lineHeight: 20 },

  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12 },
  ruleWell: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  ruleLabel: { fontFamily: Fonts.bodyBold, fontSize: 11, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  ruleValue: { fontFamily: Fonts.body, fontSize: 14, color: C.dark, marginTop: 2, lineHeight: 19 },

  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sectionHead: { marginTop: 22, marginBottom: 12, marginHorizontal: 4 },
  sectionH: { fontFamily: Fonts.headlineBold, fontSize: 17, color: C.dark },
  sectionAction: { fontFamily: Fonts.bodySemibold, fontSize: 13, color: C.muted },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border,
    paddingVertical: 13, paddingHorizontal: 14,
  },
  rowYou: { borderLeftWidth: 4, borderLeftColor: C.accent },
  rank: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rankTop: { backgroundColor: C.primary },
  rankPlain: { backgroundColor: C.tint },
  rankText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.primary },
  rowName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: C.dark },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },
  rowValue: { fontFamily: Fonts.bodyBold, fontSize: 17, color: C.primary, letterSpacing: -0.3 },

  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },
  footnote: { fontFamily: Fonts.body, fontSize: 11.5, color: C.muted, lineHeight: 16, marginTop: 18, marginHorizontal: 4 },

  footer: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border,
    backgroundColor: C.white,
  },
  primaryBtn: { backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 15 },
  secondaryBtn: { backgroundColor: C.tint },
});
