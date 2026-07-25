import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { getDatabase } from '../../src/services/firebaseDatabase';
import type { Post } from '../../src/services/firebaseDatabase';
import { getAuthService } from '../../src/services/authService';
import { listFollowingIds } from '../../src/services/follows';
import { Icon } from '../../src/pick/Icon';
import { ImpactMap } from '../../src/pick/ImpactMap';
import { ImpactComposer } from '../../src/pick/ImpactComposer';
import { LiveNow } from '../../src/pick/LiveNow';
import { C, radius, shadow } from '../../src/pick/theme';

type FeedMode = 'following' | 'everyone';

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** The stat chips shown on an impact post. */
function impactChips(post: Post): { value: string; label: string }[] {
  const s = post.stats;
  if (!s) return [];
  const out: { value: string; label: string }[] = [];
  if (s.pctGreen != null) out.push({ value: `${s.pctGreen}%`, label: 'green' });
  out.push({ value: String(s.adopted ?? 0), label: (s.adopted === 1 ? 'block' : 'blocks') + ' adopted' });
  if (s.toGo != null) out.push({ value: String(s.toGo), label: 'to go' });
  if (s.cleanups != null) out.push({ value: String(s.cleanups), label: 'cleanups' });
  return out;
}

export default function CommunityScreen() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [uid, setUid] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<FeedMode>('everyone');
  const [composerOpen, setComposerOpen] = useState(false);

  const load = useCallback(async (feedMode: FeedMode) => {
    try {
      setLoading(true);
      const db = await getDatabase();
      const user = getAuthService().getCurrentUser();
      setUid(user?.uid || '');
      if (feedMode === 'following') {
        const ids = await listFollowingIds();
        setPosts(await db.getPostsByUsers(ids, 50));
      } else {
        setPosts(await db.getPosts(50));
      }
    } catch (error) {
      console.error('Failed to load community feed:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(mode);
    }, [load, mode])
  );

  const switchMode = (m: FeedMode) => {
    if (m === mode) return;
    setMode(m);
    load(m);
  };

  const toggleLike = async (post: Post) => {
    const liked = post.liked_by?.includes(uid);
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, liked_by: liked ? (p.liked_by || []).filter((u) => u !== uid) : [...(p.liked_by || []), uid] }
          : p
      )
    );
    try {
      const db = await getDatabase();
      await db.toggleLikePost(post.id, !liked);
    } catch (error) {
      console.error('Failed to toggle like:', error);
      load(mode); // resync on failure
    }
  };

  const removePost = (post: Post) => {
    Alert.alert('Delete post?', 'This removes it from the community feed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const db = await getDatabase();
          const ok = await db.deletePost(post);
          if (ok) setPosts((prev) => prev.filter((p) => p.id !== post.id));
          else Alert.alert('Error', 'Could not delete that post.');
        },
      },
    ]);
  };

  const emptyCopy =
    mode === 'following'
      ? { title: 'Nothing here yet', text: 'Follow some pickers and their posts will show up here.' }
      : { title: 'No posts yet', text: 'Finish a cleanup, add a photo, or share your impact to be the first.' };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={styles.h1}>Community</Text>
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/people' as any)} hitSlop={6} style={styles.actionBtn}>
              <Icon name="user" size={16} color={C.primary} sw={2} />
              <Text style={styles.actionText}>Find people</Text>
            </Pressable>
            <Pressable onPress={() => setComposerOpen(true)} hitSlop={6} style={[styles.actionBtn, styles.actionPrimary]}>
              <Icon name="leaf" size={16} color="#fff" sw={2} />
              <Text style={[styles.actionText, { color: '#fff' }]}>Share impact</Text>
            </Pressable>
          </View>
        </View>

        {/* Feed toggle */}
        <View style={styles.segmentWrap}>
          {(['following', 'everyone'] as FeedMode[]).map((m) => (
            <Pressable key={m} onPress={() => switchMode(m)} style={[styles.segment, mode === m && styles.segmentActive]}>
              <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                {m === 'following' ? 'Following' : 'Everyone'}
              </Text>
            </Pressable>
          ))}
        </View>

        <LiveNow />

        {loading ? (
          <View style={styles.center}>
            <Text style={styles.loading}>Loading…</Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyWell}>
              <Icon name={mode === 'following' ? 'user' : 'camera'} size={26} color={C.primary} sw={1.7} />
            </View>
            <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
            <Text style={styles.emptyText}>{emptyCopy.text}</Text>
            {mode === 'following' && (
              <Pressable onPress={() => router.push('/people' as any)} style={styles.emptyCta}>
                <Text style={styles.emptyCtaText}>Find people to follow</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {posts.map((post) => {
              const liked = post.liked_by?.includes(uid);
              const likes = post.liked_by?.length || 0;
              const mine = post.uid === uid;
              const isImpact = post.kind === 'impact';
              return (
                <View key={post.id} style={styles.card}>
                  {isImpact && post.coverage ? (
                    <View>
                      <ImpactMap coverage={post.coverage} height={170} />
                      <View style={styles.statsRow}>
                        {impactChips(post).map((c, i) => (
                          <View key={i} style={styles.stat}>
                            <Text style={styles.statValue}>{c.value}</Text>
                            <Text style={styles.statLabel}>{c.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : post.image_url ? (
                    <Image source={{ uri: post.image_url }} style={styles.photo} resizeMode="cover" />
                  ) : null}

                  <View style={styles.body}>
                    {!!post.display_name && (
                      <Pressable
                        onPress={() => router.push(`/profile/${post.uid}` as any)}
                        style={styles.authorRow}
                        hitSlop={4}
                      >
                        <View style={styles.authorAvatar}>
                          <Text style={styles.authorAvatarText}>{post.display_name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <Text style={styles.author}>{post.display_name}</Text>
                      </Pressable>
                    )}
                    {!!post.caption && <Text style={styles.caption}>{post.caption}</Text>}

                    <View style={styles.metaRow}>
                      <View style={styles.metaLeft}>
                        {!!post.neighborhood && (
                          <View style={styles.placePill}>
                            <Icon name="pin" size={12} color={C.muted} sw={1.8} />
                            <Text style={styles.placeText} numberOfLines={1}>
                              {post.neighborhood}
                            </Text>
                          </View>
                        )}
                        <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
                      </View>

                      <View style={styles.actions}>
                        {mine && (
                          <Pressable onPress={() => removePost(post)} hitSlop={8} style={styles.iconBtn}>
                            <Icon name="trash" size={18} color={C.muted} sw={1.8} />
                          </Pressable>
                        )}
                        <Pressable onPress={() => toggleLike(post)} hitSlop={8} style={styles.likeBtn}>
                          <Icon name="leaf" size={18} color={liked ? C.accent : C.muted} sw={liked ? 2 : 1.8} />
                          <Text style={[styles.likeCount, liked && { color: C.accent }]}>{likes}</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <ImpactComposer visible={composerOpen} onClose={() => setComposerOpen(false)} onPosted={() => load(mode)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { paddingVertical: 60, alignItems: 'center' },
  loading: { fontSize: 16, color: C.muted },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: C.dark },
  headerActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.border },
  actionPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  actionText: { fontSize: 13, fontWeight: '700', color: C.primary },

  segmentWrap: { flexDirection: 'row', backgroundColor: C.border2, borderRadius: 999, padding: 3, marginTop: 16, marginBottom: 18 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 999 },
  segmentActive: { backgroundColor: '#fff', ...shadow.card },
  segmentText: { fontSize: 14, fontWeight: '700', color: C.muted },
  segmentTextActive: { color: C.dark },

  card: { backgroundColor: '#fff', borderRadius: radius.card, overflow: 'hidden', ...shadow.card },
  photo: { width: '100%', aspectRatio: 1.25, backgroundColor: C.tint },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 12, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: C.border2 },
  stat: { minWidth: '25%', alignItems: 'center', paddingVertical: 6 },
  statValue: { fontSize: 19, fontWeight: '700', color: C.primary },
  statLabel: { fontSize: 11.5, color: C.text3, marginTop: 2, textAlign: 'center' },

  body: { padding: 14 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  authorAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  authorAvatarText: { fontSize: 12, fontWeight: '700', color: C.primary },
  author: { fontSize: 14, fontWeight: '700', color: C.dark },
  caption: { fontSize: 15, color: C.dark, fontWeight: '500', lineHeight: 21, marginBottom: 10 },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  metaLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  placePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.tint, paddingVertical: 4, paddingHorizontal: 9, borderRadius: radius.pill, maxWidth: '70%' },
  placeText: { fontSize: 12, color: C.text2, fontWeight: '600' },
  time: { fontSize: 12, color: C.muted },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBtn: { padding: 2 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeCount: { fontSize: 13, fontWeight: '700', color: C.muted },

  emptyCard: { backgroundColor: '#fff', borderRadius: radius.card, padding: 28, alignItems: 'center', ...shadow.card },
  emptyWell: { width: 56, height: 56, borderRadius: 18, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.dark, marginBottom: 6 },
  emptyText: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },
  emptyCta: { marginTop: 16, backgroundColor: C.primary, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
