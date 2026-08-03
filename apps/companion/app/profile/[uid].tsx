/**
 * Public profile for any picker — tap a post author or a People-search result
 * to land here. Shows their name/handle/neighborhood, follower & following
 * counts, public impact stats, a follow/unfollow button, and their posts.
 *
 * All reads are privacy-safe: profiles are public; user_stats is opt-in
 * (getUserStats returns null for opted-out users); adoptions stay private.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '../../src/pick/Icon';
import { ImpactMap } from '../../src/pick/ImpactMap';
import { C, Fonts, radius } from '../../src/pick/theme';
import { getAuthService } from '../../src/services/authService';
import { getProfile, type PublicProfile } from '../../src/services/profiles';
import { follow, unfollow, isFollowing, followCounts } from '../../src/services/follows';
import { getDatabase, type Post, type UserStats } from '../../src/services/firebaseDatabase';
import { formatBags } from '../../src/services/impactMetrics';

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const me = getAuthService().getCurrentUser()?.uid || '';
  const isMe = uid === me;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [counts, setCounts] = useState<{ followers: number; following: number }>({ followers: 0, following: 0 });
  const [posts, setPosts] = useState<Post[]>([]);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const db = await getDatabase();
      const [p, s, c, f, ps] = await Promise.all([
        getProfile(uid),
        db.getUserStats(uid),
        followCounts(uid),
        isMe ? Promise.resolve(false) : isFollowing(uid),
        db.getPostsByUsers([uid], 30),
      ]);
      setProfile(p);
      setStats(s);
      setCounts(c);
      setFollowing(!!f);
      setPosts(ps);
    } finally {
      setLoading(false);
    }
  }, [uid, isMe]);

  useEffect(() => { load(); }, [load]);

  const toggleFollow = async () => {
    if (isMe || !uid) return;
    const next = !following;
    setBusy(true);
    setFollowing(next);
    setCounts((c) => ({ ...c, followers: c.followers + (next ? 1 : -1) }));
    try {
      next ? await follow(uid) : await unfollow(uid);
    } catch {
      setFollowing(!next);
      setCounts((c) => ({ ...c, followers: c.followers + (next ? -1 : 1) }));
    } finally {
      setBusy(false);
    }
  };

  const name = profile?.display_name || stats?.display_name || 'Picker';
  const initial = (name || '?').slice(0, 1).toUpperCase();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Icon name="back" size={22} color={C.dark} sw={2} />
        </Pressable>
        <Text style={styles.h1} numberOfLines={1}>{profile?.handle ? `@${profile.handle}` : name}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : profile?.hidden && !isMe ? (
        // They turned off "Let people open my profile" in Settings. Their name
        // shouldn't have been tappable, but deep links and stale lists exist.
        <View style={styles.center}>
          <Icon name="user" size={30} color={C.muted} sw={1.7} />
          <Text style={styles.privateTitle}>This profile is private</Text>
          <Text style={styles.privateSub}>
            This picker has chosen not to share their profile. Their cleanups still count toward the map.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.idRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {profile?.handle ? `@${profile.handle}` : 'no handle yet'}
                {profile?.neighborhood ? ` · ${profile.neighborhood}` : ''}
              </Text>
            </View>
            {!isMe && (
              <Pressable
                onPress={toggleFollow}
                disabled={busy}
                style={[styles.followBtn, following && styles.followingBtn, busy && { opacity: 0.6 }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={following ? C.primary : C.creamText} />
                ) : (
                  <>
                    <Icon name={following ? 'check' : 'plus'} size={15} color={following ? C.primary : C.creamText} sw={2.2} />
                    <Text style={[styles.followText, following && { color: C.primary }]}>{following ? 'Following' : 'Follow'}</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>

          <View style={styles.followRow}>
            <Text style={styles.followCount}><Text style={styles.followNum}>{counts.followers}</Text> followers</Text>
            <Text style={styles.followCount}><Text style={styles.followNum}>{counts.following}</Text> following</Text>
          </View>

          {stats ? (
            <View style={styles.statsCard}>
              <Stat value={String(stats.total_cleanups ?? 0)} label="cleanups" />
              <View style={styles.statDivider} />
              <Stat value={formatBags(stats.total_bags ?? 0).replace(/^about /, '')} label="collected" />
              <View style={styles.statDivider} />
              <Stat value={String(stats.active_days ?? 0)} label="active days" />
            </View>
          ) : (
            <Text style={styles.privateNote}>This picker keeps their stats private.</Text>
          )}

          <Text style={styles.section}>Posts</Text>
          {posts.length === 0 ? (
            <Text style={styles.emptyPosts}>No posts yet.</Text>
          ) : (
            <View style={{ gap: 14 }}>
              {posts.map((post) => (
                <View key={post.id} style={styles.card}>
                  {post.kind === 'impact' && post.coverage ? (
                    <ImpactMap coverage={post.coverage} height={150} />
                  ) : post.image_url ? (
                    <Image source={{ uri: post.image_url }} style={styles.photo} resizeMode="cover" />
                  ) : null}
                  <View style={styles.cardBody}>
                    {!!post.caption && <Text style={styles.caption}>{post.caption}</Text>}
                    <Text style={styles.time}>
                      {post.neighborhood ? `${post.neighborhood} · ` : ''}{timeAgo(post.created_at)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  h1: { flex: 1, textAlign: 'center', fontFamily: Fonts.headlineBold, fontSize: 18, color: C.dark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 10 },
  privateTitle: { fontFamily: Fonts.headlineBold, fontSize: 17, color: C.dark, marginTop: 4 },
  privateSub: { fontFamily: Fonts.body, fontSize: 13.5, color: C.muted, textAlign: 'center', lineHeight: 19 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  idRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 24, color: C.creamText },
  name: { fontFamily: Fonts.headlineBold, fontSize: 20, color: C.dark },
  sub: { fontFamily: Fonts.body, fontSize: 14, color: C.text3, marginTop: 2 },

  followBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primary, borderRadius: 999, paddingHorizontal: 16, height: 38 },
  followingBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary },
  followText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 14 },

  followRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
  followCount: { fontFamily: Fonts.body, fontSize: 14, color: C.text3 },
  followNum: { fontFamily: Fonts.bodyBold, color: C.dark },

  statsCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, paddingVertical: 16, marginTop: 18 },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 34, backgroundColor: C.border2 },
  statValue: { fontFamily: Fonts.displayBold, fontSize: 19, color: C.primary },
  statLabel: { fontFamily: Fonts.body, fontSize: 12, color: C.text3, marginTop: 3 },
  privateNote: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 18, fontStyle: 'italic' },

  section: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 26, marginBottom: 12 },
  emptyPosts: { fontFamily: Fonts.body, fontSize: 14, color: C.muted },

  card: { backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, overflow: 'hidden' },
  photo: { width: '100%', aspectRatio: 1.25, backgroundColor: C.tint },
  cardBody: { padding: 12 },
  caption: { fontFamily: Fonts.bodyMedium, fontSize: 15, color: C.dark, lineHeight: 21, marginBottom: 6 },
  time: { fontFamily: Fonts.body, fontSize: 12, color: C.muted },
});
