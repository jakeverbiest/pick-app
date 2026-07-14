import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDatabase } from '../../src/services/firebaseDatabase';
import type { Post } from '../../src/services/firebaseDatabase';
import { getAuthService } from '../../src/services/authService';
import { Icon } from '../../src/pick/Icon';
import { C, radius, shadow } from '../../src/pick/theme';

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function CommunityScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [uid, setUid] = useState('');
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const db = await getDatabase();
      const user = getAuthService().getCurrentUser();
      setUid(user?.uid || '');
      setVerified(getAuthService().isEmailVerified());
      setPosts(await db.getPosts(50));
    } catch (error) {
      console.error('Failed to load community feed:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
      load(); // resync on failure
    }
  };

  const removePost = (post: Post) => {
    Alert.alert('Delete post?', 'This removes your photo from the community feed.', [
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

  const resendVerification = () => {
    getAuthService()
      .resendVerification()
      .then(() => Alert.alert('Email sent', 'Check your inbox for the verification link.'))
      .catch(() => Alert.alert('Error', 'Could not resend right now. Try again shortly.'));
  };

  const refreshVerification = async () => {
    const v = await getAuthService().refreshEmailVerified();
    setVerified(v);
    Alert.alert(v ? 'Verified' : 'Not yet', v ? 'Thanks — you can post now.' : 'We still see your email as unverified. Tap the link in the email, then try again.');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1}>Community</Text>
        <Text style={styles.sub}>Cleanups from your neighbors.</Text>

        {!verified && (
          <View style={styles.verifyBanner}>
            <Text style={styles.verifyText}>Verify your email to post to the community.</Text>
            <View style={styles.verifyActions}>
              <Pressable onPress={resendVerification} hitSlop={6}>
                <Text style={styles.verifyBtn}>Resend</Text>
              </Pressable>
              <Pressable onPress={refreshVerification} hitSlop={6}>
                <Text style={styles.verifyBtn}>I verified</Text>
              </Pressable>
            </View>
          </View>
        )}

        {loading ? (
          <View style={styles.center}>
            <Text style={styles.loading}>Loading…</Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyWell}>
              <Icon name="camera" size={26} color={C.primary} sw={1.7} />
            </View>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyText}>
              Finish a cleanup, add a photo, and tap “Share to community” to be the first.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {posts.map((post) => {
              const liked = post.liked_by?.includes(uid);
              const likes = post.liked_by?.length || 0;
              const mine = post.uid === uid;
              return (
                <View key={post.id} style={styles.card}>
                  {post.image_url ? (
                    <Image source={{ uri: post.image_url }} style={styles.photo} resizeMode="cover" />
                  ) : null}

                  <View style={styles.body}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  center: { paddingVertical: 60, alignItems: 'center' },
  loading: { fontSize: 16, color: C.muted },

  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4, color: C.dark },
  sub: { fontSize: 14, color: C.text3, marginTop: 4, marginBottom: 18 },

  card: { backgroundColor: '#fff', borderRadius: radius.card, overflow: 'hidden', ...shadow.card },
  photo: { width: '100%', aspectRatio: 1.25, backgroundColor: C.tint },
  body: { padding: 14 },
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

  verifyBanner: { backgroundColor: '#FFF7E6', borderRadius: radius.card, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#F5D88A' },
  verifyText: { fontSize: 13, color: '#7A5B12', fontWeight: '600' },
  verifyActions: { flexDirection: 'row', gap: 18, marginTop: 8 },
  verifyBtn: { fontSize: 13, fontWeight: '700', color: C.primary },

  emptyCard: { backgroundColor: '#fff', borderRadius: radius.card, padding: 28, alignItems: 'center', ...shadow.card },
  emptyWell: { width: 56, height: 56, borderRadius: 18, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.dark, marginBottom: 6 },
  emptyText: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },
});
