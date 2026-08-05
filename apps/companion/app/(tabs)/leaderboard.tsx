import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAuthService } from '../../src/services/authService';
import { getDatabase } from '../../src/services/firebaseDatabase';
import type { UserStats } from '../../src/services/firebaseDatabase';
import {
  listChallenges,
  listMyInvites,
  declineInvite,
  getContributions,
  totalFor,
  challengeSubtitle,
  daysLeft,
  GOAL_LABEL,
  type Challenge,
} from '../../src/services/challenges';
import { formatBagsShort, itemsToBags, aggregateBags } from '../../src/services/impactMetrics';
import { Icon, IconName } from '../../src/pick/Icon';
import { getProfiles } from '../../src/services/profiles';
import { getBlockedUids } from '../../src/services/moderation';
import { C, Fonts, radius } from '../../src/pick/theme';
import { ProgressBar } from '../../src/pick/ui';
import { levelTierColor, milestoneProgress } from '../../src/services/milestones';

type Board = 'you' | 'teams' | 'challenges';

const BOARDS: { key: Board; label: string }[] = [
  { key: 'you', label: 'You' },
  { key: 'teams', label: 'Teams' },
  { key: 'challenges', label: 'Challenges' },
];

const GOAL_ICON: Record<string, IconName> = {
  pickups: 'bag',
  bags: 'leaf',
  cleanups: 'route',
};

/** Where a challenge's area restriction shows up on the card. */
const AREA_ICON: Record<string, IconName> = {
  anywhere: 'target',
  neighborhood: 'pin',
  custom: 'route',
};

type Personal = { pickups: number; bags: number; days: number; cleanups: number };

/** All three impact metrics at once — pickups, bags, active days.
 *  `hero` scales it up for the personal card; rows use the compact form. */
function StatTrio({
  pickups,
  bags,
  days,
  hero = false,
}: {
  pickups: number;
  bags: number;
  days: number;
  hero?: boolean;
}) {
  return (
    <View style={hero ? styles.trioHero : styles.trio}>
      <View style={styles.trioCol}>
        <Text style={hero ? styles.trioNumHero : styles.trioNum}>{pickups.toLocaleString()}</Text>
        <Text style={styles.trioCap}>Pickups</Text>
      </View>
      <View style={styles.trioDiv} />
      <View style={styles.trioCol}>
        <Text style={hero ? styles.trioNumHero : styles.trioNum}>{formatBagsShort(bags)}</Text>
        <Text style={styles.trioCap}>Bags</Text>
      </View>
      <View style={styles.trioDiv} />
      <View style={styles.trioCol}>
        <Text style={hero ? styles.trioNumHero : styles.trioNum}>{days.toLocaleString()}</Text>
        <Text style={styles.trioCap}>Active days</Text>
      </View>
    </View>
  );
}

export default function LeaderboardScreen() {
  const [board, setBoard] = useState<Board>('you');
  const [teams, setTeams] = useState<any[]>([]);
  const [individuals, setIndividuals] = useState<UserStats[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  // Group progress per challenge, summed from each participant's published
  // contribution doc. Keyed by challenge id.
  const [chTotals, setChTotals] = useState<Record<string, number>>({});
  const [invites, setInvites] = useState<Challenge[]>([]);
  const [userTeam, setUserTeam] = useState<string>('solo');
  const [me, setMe] = useState<{ uid: string; hidden: boolean } | null>(null);
  const [handles, setHandles] = useState<Record<string, string>>({});
  // uids whose owner allows their profile to be opened (profiles/{uid}.hidden !== true)
  const [openProfiles, setOpenProfiles] = useState<Set<string>>(new Set());
  const [personal, setPersonal] = useState<Personal>({ pickups: 0, bags: 0, days: 0, cleanups: 0 });
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const db = await getDatabase();
      const currentUser = getAuthService().getCurrentUser();
      // Needed further down to scope team-only challenges, so it can't stay
      // scoped to the signed-in branch.
      let myTeam: string | undefined;
      if (currentUser) {
        const settings = await db.getUserSettings(currentUser.uid);
        myTeam = settings?.team_name || undefined;
        setUserTeam(settings?.team_name || 'solo');
        setMe({ uid: currentUser.uid, hidden: !!settings?.leaderboard_hidden });
        // Write this account's public stats doc and WAIT for it, so the
        // individual board read below includes the current user on first open
        // (a fire-and-forget write here races the read and omits you).
        await db.updateUserStats(currentUser.uid);
      }
      const mine = await db.getCleanups(1000);
      setPersonal({
        pickups: mine.reduce((s, c) => s + (c.items_count || 0), 0),
        bags: aggregateBags(mine),
        days: new Set(mine.map((c) => new Date((c.timestamp || 0) * 1000).toDateString())).size,
        cleanups: mine.length,
      });
      const [indiv, teamData, allChallenges, blocked] = await Promise.all([
        db.getIndividualLeaderboard('pickups'),
        db.getTeamLeaderboard(),
        listChallenges({ team: myTeam }),
        getBlockedUids(),
      ]);
      // Blocked either direction: neither side should see the other on the
      // individual board, same as the community feed and people search.
      setIndividuals((indiv || []).filter((u) => !blocked.includes(u.uid)));
      setTeams(teamData || []);
      // Finished challenges stay out of the board; the detail screen keeps them
      // reachable for anyone who bookmarked one.
      const live = allChallenges.filter((c) => c.status !== 'completed');
      setChallenges(live);
      try {
        setInvites(await listMyInvites());
      } catch {}
      // Group totals, one read per challenge. Cheap at this scale and it
      // avoids a Cloud Function just to keep a denormalised counter honest.
      try {
        const totals = await Promise.all(
          live.map(async (c) => [c.id, totalFor(c.goal_type, await getContributions(c.id))] as const)
        );
        setChTotals(Object.fromEntries(totals));
      } catch {}
      // Author handles for the You board (name + @handle, design audit)
      try {
        const uids = [...new Set((indiv || []).map((u: UserStats) => u.uid).filter(Boolean))];
        const profiles = await getProfiles(uids);
        const map: Record<string, string> = {};
        const open = new Set<string>();
        profiles.forEach((p) => {
          if (p?.handle) map[p.uid] = p.handle;
          // Opt-out, not opt-in: a picker with no profile doc yet is still
          // reachable, they just haven't set a handle.
          if (p?.uid && !p.hidden) open.add(p.uid);
        });
        setHandles(map);
        setOpenProfiles(open);
      } catch {}
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const dismissInvite = async (challengeId: string) => {
    if (!me) return;
    setInvites((prev) => prev.filter((c) => c.id !== challengeId)); // optimistic
    try {
      await declineInvite(challengeId, me.uid);
    } catch (error) {
      console.error('Failed to decline invite:', error);
      load(); // put it back if the write lost
    }
  };

  const openChallenge = (challengeId: string) => {
    if (!me) {
      Alert.alert('Sign in required', 'You must be logged in to join a challenge.');
      return;
    }
    router.push(`/challenge/${challengeId}` as any);
  };

  // One board, all metrics visible at once. Ranked by pickups — the counted,
  // canonical unit; bags and active days ride along on every row.
  const userValue = (u: UserStats): number => u.total_pickups || 0;
  const teamValue = (t: any): number => t.total_pickups || 0;
  const userBags = (u: UserStats): number => u.total_bags ?? itemsToBags(u.total_pickups || 0);
  const teamBags = (t: any): number => t.total_bags ?? itemsToBags(t.total_pickups || 0);
  const userDays = (u: UserStats): number => u.active_days || 0;
  const teamDays = (t: any): number => t.total_days || 0;

  const indivRanked = [...individuals].sort((a, b) => userValue(b) - userValue(a));
  const myIndex = me && !me.hidden ? indivRanked.findIndex((u) => u.uid === me.uid) : -1;
  const myRank = myIndex >= 0 ? myIndex + 1 : null;

  const isSolo = !userTeam || userTeam.toLowerCase() === 'solo';
  const teamRanked = [...teams]
    .filter((t) => (t.team || '').toLowerCase() !== 'solo')
    .sort((a, b) => teamValue(b) - teamValue(a));
  const teamIndex = isSolo ? -1 : teamRanked.findIndex((t) => t.team === userTeam);
  const teamRank = teamIndex >= 0 ? teamIndex + 1 : null;
  const teamGap = teamIndex > 0 ? teamValue(teamRanked[teamIndex - 1]) - teamValue(teamRanked[teamIndex]) : 0;


  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.loading}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Leaderboard</Text>
        <Text style={styles.sub}>Your impact, your team, the challenges.</Text>

        {/* board switch: You · Teams · Challenges */}
        <View style={styles.segment}>
          {BOARDS.map((b) => {
            const active = board === b.key;
            return (
              <Pressable key={b.key} style={[styles.segBtn, active && styles.segBtnActive]} onPress={() => setBoard(b.key)}>
                <Text style={[styles.segText, active && styles.segTextActive]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>


        {/* ============================ YOU ============================ */}
        {board === 'you' && (
          <View style={{ marginTop: 16 }}>
            <View style={styles.personalCard}>
              <View style={styles.personalTop}>
                <Icon name="activity" size={20} color={C.primary} sw={1.8} />
                <Text style={styles.personalLabel}>Your impact</Text>
              </View>
              <StatTrio pickups={personal.pickups} bags={personal.bags} days={personal.days} hero />
              <Text style={styles.personalSub}>
                {me?.hidden
                  ? "You're hidden from the leaderboard — only you can see this."
                  : myRank
                    ? `Ranked #${myRank} of ${indivRanked.length} ${indivRanked.length === 1 ? 'picker' : 'pickers'}`
                    : `${personal.cleanups} cleanup${personal.cleanups === 1 ? '' : 's'} logged`}
              </Text>
              {me?.hidden && (
                <Pressable style={styles.joinBtn} onPress={() => router.push('/(tabs)/settings')}>
                  <Text style={styles.joinBtnText}>Show me on the leaderboard</Text>
                </Pressable>
              )}
            </View>

            {indivRanked.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>The leaderboard is just getting started. Log a cleanup to appear here.</Text>
              </View>
            ) : (
              <View style={{ gap: 10, marginTop: 14 }}>
                {indivRanked.map((u, i) => {
                  const you = me && u.uid === me.uid;
                  const top = i < 3;
                  // Rows open the picker's public profile — unless they've
                  // turned that off in Settings (profiles/{uid}.hidden).
                  const tappable = !!u.uid && (you || openProfiles.has(u.uid));
                  // ALWAYS a Pressable, disabled when there's nowhere to go.
                  // Swapping in a plain View here broke the layout: View does
                  // not accept a style FUNCTION, so those rows silently
                  // rendered with no card, padding or row direction at all.
                  const level = milestoneProgress(u.total_cleanups || 0);
                  return (
                    <Pressable
                      key={u.uid}
                      disabled={!tappable}
                      style={({ pressed }) => [
                        styles.row,
                        you && styles.rowYou,
                        pressed && tappable && { opacity: 0.85 },
                      ]}
                      onPress={tappable ? () => router.push(`/profile/${u.uid}` as any) : undefined}
                      accessibilityRole={tappable ? 'button' : undefined}
                      accessibilityLabel={tappable ? `Open ${u.display_name || 'this picker'}'s profile` : undefined}
                    >
                      <View style={[styles.rank, top ? styles.rankTop : styles.rankPlain]}>
                        <Text style={[styles.rankText, top && { color: C.creamText }]}>{i + 1}</Text>
                      </View>
                      {level.earned > 0 && (
                        <View style={[styles.levelDot, { backgroundColor: levelTierColor(level.earned) }]} />
                      )}
                      <View style={styles.rowName}>
                        <Text style={styles.teamName} numberOfLines={1}>
                          {u.display_name || 'Picker'}
                          {you ? '  ·  You' : ''}
                        </Text>
                        <Text style={styles.teamMembers} numberOfLines={1}>
                          {handles[u.uid] ? `@${handles[u.uid]}  ·  ` : ''}{u.team || 'Solo'}
                        </Text>
                        {level.earned > 0 && (
                          <Text style={[styles.levelName, { color: levelTierColor(level.earned) }]} numberOfLines={1}>
                            {level.previousName}
                          </Text>
                        )}
                      </View>
                      <StatTrio pickups={userValue(u)} bags={userBags(u)} days={userDays(u)} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ============================ TEAMS ============================ */}
        {board === 'teams' && (
          <View style={{ marginTop: 16 }}>
            {teamRanked.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No teams yet — be the first to start one.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {teamRanked.map((entry, i) => {
                  const you = entry.team === userTeam;
                  const top = i < 3;
                  return (
                    <View key={entry.team} style={[styles.row, you && styles.rowYou]}>
                      <View style={[styles.rank, top ? styles.rankTop : styles.rankPlain]}>
                        <Text style={[styles.rankText, top && { color: C.creamText }]}>{i + 1}</Text>
                      </View>
                      <View style={styles.rowName}>
                        <Text style={styles.teamName} numberOfLines={1}>
                          {entry.team}
                          {you ? '  ·  You' : ''}
                        </Text>
                        <Text style={styles.teamMembers} numberOfLines={1}>
                          {entry.member_count} {entry.member_count === 1 ? 'member' : 'members'}
                        </Text>
                      </View>
                      <StatTrio pickups={teamValue(entry)} bags={teamBags(entry)} days={teamDays(entry)} />
                    </View>
                  );
                })}
              </View>
            )}

            {isSolo ? (
              <View style={styles.callout}>
                <Icon name="trophy" size={26} color={C.primary} sw={1.7} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.calloutTitle}>You're flying solo</Text>
                  <Text style={styles.calloutSub}>Join a team to climb the team board.</Text>
                </View>
                <Pressable style={styles.calloutBtn} onPress={() => router.push('/(tabs)/settings')}>
                  <Text style={styles.calloutBtnText}>Join</Text>
                </Pressable>
              </View>
            ) : teamRank ? (
              <View style={styles.callout}>
                <Icon name="trophy" size={26} color={C.primary} sw={1.7} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.calloutTitle}>{userTeam} is #{teamRank}</Text>
                  <Text style={styles.calloutSub}>
                    {teamRank === 1 ? "You're in the lead — keep it up." : `${teamGap.toLocaleString()} pickups from the next spot.`}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* ========================= CHALLENGES ========================= */}
        {board === 'challenges' && (
          <View style={{ marginTop: 16 }}>
            {/* Invitations first — someone asked for you personally, so it
                outranks the open board below it. */}
            {invites.length > 0 && (
              <View style={{ marginBottom: 18, gap: 10 }}>
                <Text style={styles.inviteHead}>
                  {invites.length === 1 ? 'You’ve been invited' : `${invites.length} invitations`}
                </Text>
                {invites.map((c) => (
                  <View key={c.id} style={styles.inviteCard}>
                    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => openChallenge(c.id)}>
                      <Text style={styles.inviteName} numberOfLines={1}>{c.name}</Text>
                      <Text style={styles.inviteSub} numberOfLines={1}>{challengeSubtitle(c)}</Text>
                    </Pressable>
                    <Pressable style={styles.inviteView} onPress={() => openChallenge(c.id)}>
                      <Text style={styles.inviteViewText}>View</Text>
                    </Pressable>
                    <Pressable onPress={() => dismissInvite(c.id)} hitSlop={8} style={styles.inviteX}>
                      <Icon name="close" size={15} color={C.muted} sw={2.2} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <Pressable style={styles.newChallengeBtn} onPress={() => router.push('/challenge/new' as any)}>
              <Icon name="plus" size={17} color="#fff" sw={2.2} />
              <Text style={styles.newChallengeText}>Start a challenge</Text>
            </Pressable>

            {challenges.length === 0 ? (
              <View style={[styles.chEmptyCard, { marginTop: 14 }]}>
                <Text style={styles.emptyText}>
                  No challenges running. Start one — pick an area, pick a window, pick a number, and
                  whoever joins works toward it together.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 14, marginTop: 14 }}>
                {/* Anything shown as an invitation above is skipped here so it
                    doesn't appear twice on the same screen. */}
                {challenges.filter((c) => !invites.some((i) => i.id === c.id)).map((c) => {
                  const joined = c.participants?.includes(me?.uid || '');
                  const left = daysLeft(c);
                  const joinedCount = c.participants?.length || 0;
                  // Real progress: the group's actual work against the goal —
                  // not the old "how many people joined" placeholder.
                  const done = chTotals[c.id] || 0;
                  const pct = Math.min(1, done / Math.max(1, c.goal_value));
                  return (
                    <Pressable
                      key={c.id}
                      style={({ pressed }) => [styles.chCard, pressed && { opacity: 0.9 }]}
                      onPress={() => openChallenge(c.id)}
                    >
                      <View style={styles.chHeadRow}>
                        <View style={styles.chWell}>
                          <Icon name={GOAL_ICON[c.goal_type] ?? 'flag'} size={22} color={C.primary} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.chName} numberOfLines={1}>{c.name}</Text>
                          <Text style={styles.chDesc} numberOfLines={1}>{challengeSubtitle(c)}</Text>
                        </View>
                        {joined && (
                          <View style={styles.chJoinedPill}>
                            <Icon name="check" size={12} color={C.primary} sw={2.6} />
                            <Text style={styles.chJoinedPillText}>In</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.chMetaRow}>
                        <Text style={styles.chProgressText} numberOfLines={1}>
                          <Text style={styles.chProgressStrong}>{Math.round(done).toLocaleString()}</Text>
                          {' / '}
                          {c.goal_value.toLocaleString()} {GOAL_LABEL[c.goal_type]}
                          {'  ·  '}
                          {joinedCount} in
                        </Text>
                        <View style={styles.chDaysPill}>
                          <Icon name={AREA_ICON[c.area?.type] ?? 'clock'} size={12} color={C.warning} sw={1.8} />
                          <Text style={styles.chDaysText}>
                            {c.status === 'upcoming' ? 'soon' : left <= 1 ? 'last day' : `${left}d left`}
                          </Text>
                        </View>
                      </View>

                      <View style={{ marginTop: 12 }}>
                        <ProgressBar pct={Math.max(0.01, pct)} height={8} />
                      </View>

                      <View style={styles.chFootRow}>
                        <Text style={styles.chFootText}>
                          {joined ? 'View progress and contributors' : 'Tap to see the rules and join'}
                        </Text>
                        <Icon name="chevron" size={14} color={C.chevron} sw={2} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loading: { fontFamily: Fonts.body, fontSize: 16, color: C.muted },

  h1: { fontFamily: Fonts.displayBold, fontSize: 32, letterSpacing: -0.4, color: C.dark, textTransform: 'uppercase' },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: C.text3, marginTop: 4, marginBottom: 18 },

  segment: { flexDirection: 'row', gap: 6, backgroundColor: C.tint, borderRadius: radius.field, padding: 3 },
  segBtn: { flex: 1, borderRadius: radius.chip, paddingVertical: 9, alignItems: 'center' },
  segBtnActive: { backgroundColor: C.white },
  segText: { fontFamily: Fonts.bodySemibold, fontSize: 13, color: C.muted },
  segTextActive: { color: C.dark, fontFamily: Fonts.bodyBold },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  rowYou: { borderLeftWidth: 4, borderLeftColor: C.accent },
  rank: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  rankTop: { backgroundColor: C.primary },
  rankPlain: { backgroundColor: C.tint },
  rankText: { fontFamily: Fonts.displayBold, fontSize: 15, color: C.primary },
  // Current milestone tier at a glance — see services/milestones. Placeholder
  // color dot until real illustrated tier badges exist.
  levelDot: { width: 10, height: 10, borderRadius: 5, marginLeft: -5 },
  rowName: { flex: 1, minWidth: 0, marginRight: 4 },
  teamName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: C.dark },
  teamMembers: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },
  levelName: { fontFamily: Fonts.bodyBold, fontSize: 11, marginTop: 1 },

  // all-metrics trio (pickups · bags · active days), shown on every row + hero
  trio: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trioHero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  trioCol: { alignItems: 'center', minWidth: 34 },
  trioDiv: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.border },
  trioNum: { fontFamily: Fonts.displayBold, fontSize: 17, color: C.primary, letterSpacing: -0.3 },
  trioNumHero: { fontFamily: Fonts.displayBold, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
  trioCap: { fontFamily: Fonts.bodyBold, fontSize: 9.5, color: C.muted, marginTop: 1 },

  callout: { backgroundColor: C.tint, borderRadius: radius.card, padding: 16, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  calloutTitle: { fontFamily: Fonts.headlineBold, fontSize: 15, color: C.dark },
  calloutSub: { fontFamily: Fonts.body, fontSize: 12, color: C.text2, marginTop: 2 },
  calloutBtn: { backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 8, paddingHorizontal: 14 },
  calloutBtnText: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 13 },

  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: C.muted, textAlign: 'center' },

  personalCard: {
    backgroundColor: C.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 18,
    borderLeftWidth: 4,
    borderLeftColor: C.rust,
  },
  personalTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  personalLabel: { fontFamily: Fonts.bodyBold, fontSize: 11, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  personalValue: { fontFamily: Fonts.displayBold, fontSize: 30, color: C.primary, letterSpacing: -0.5 },
  personalUnit: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: C.muted },
  personalSub: { fontFamily: Fonts.body, fontSize: 13, color: C.text2, marginTop: 4 },
  joinBtn: { marginTop: 14, backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 11, alignItems: 'center' },
  joinBtnText: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 14 },

  // challenges
  chCard: { backgroundColor: C.white, borderRadius: radius.cardLg, borderWidth: 1.5, borderColor: C.border, padding: 18 },
  chHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  chWell: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  chName: { fontFamily: Fonts.headlineBold, fontSize: 17, letterSpacing: -0.2, color: C.dark },
  chDesc: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },
  chMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  chProgressText: { fontFamily: Fonts.body, fontSize: 13, color: C.text2, flex: 1 },
  chProgressStrong: { fontFamily: Fonts.bodyBold, color: C.dark },
  chDaysPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.warnBg, paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.pill },
  chDaysText: { fontFamily: Fonts.bodyBold, color: C.warning, fontSize: 12 },
  chJoinedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.tint, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 9 },
  chJoinedPillText: { fontFamily: Fonts.bodyBold, fontSize: 11.5, color: C.primary },
  chFootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 8 },
  chFootText: { fontFamily: Fonts.bodySemibold, fontSize: 12.5, color: C.muted, flexShrink: 1 },
  chEmptyCard: { backgroundColor: C.white, borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, padding: 20 },
  newChallengeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 13,
  },
  newChallengeText: { fontFamily: Fonts.headlineBold, color: '#fff', fontSize: 15, letterSpacing: 0.3, textTransform: 'uppercase' },

  inviteHead: { fontFamily: Fonts.bodyBold, fontSize: 11, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginHorizontal: 4 },
  inviteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.white, borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, padding: 14,
    borderLeftWidth: 4, borderLeftColor: C.accent,
  },
  inviteName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: C.dark },
  inviteSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 2 },
  inviteView: { backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 8, paddingHorizontal: 14 },
  inviteViewText: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 13 },
  inviteX: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});
