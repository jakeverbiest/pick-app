/**
 * Bottom-sheet for a finished challenge's group recap. Two actions:
 *  - "Share externally" — same OS-share-sheet capture pipeline as
 *    RecapModal/ImpactComposer (close modal first, THEN present the share
 *    sheet — iOS silently no-ops Share.share() over an open RN <Modal>).
 *  - "Post to Community" — writes a challenge_recap post via
 *    createChallengeRecapPost, same in-app posting pattern as
 *    ImpactComposer's "Share to community" button.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { Icon } from './Icon';
import { GroupRecapCard } from './GroupRecapCard';
import { C, Fonts, radius, shadow } from './theme';
import { getDatabase, type Post } from '../services/firebaseDatabase';
import { buildChallengeRecapCaption, type ChallengeRecapData } from '../services/challengeRecap';
import { unflattenRing, type Challenge } from '../services/challenges';
import { challengeNeighborhoodBoundary } from '../services/neighborhoods';

export function GroupRecapModal({
  visible,
  recap,
  challenge,
  onClose,
  onPosted,
}: {
  visible: boolean;
  recap: ChallengeRecapData | null;
  challenge: Challenge | null;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShotRef>(null);
  const [sharing, setSharing] = useState(false);
  const [posting, setPosting] = useState(false);
  // §11.2/§11.3: the card's map + photo strip need data this modal fetches
  // itself (GroupRecapCard stays pure/presentational, same as RecapCard —
  // see that file's doc comment). undefined = not fetched yet, null = fetched
  // and empty; the card treats both as "show the placeholder."
  const [neighborhoodRing, setNeighborhoodRing] = useState<[number, number][] | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (!visible || !challenge) return;
    let canceled = false;
    if (challenge.area.type === 'neighborhood') {
      setNeighborhoodRing(undefined);
      void challengeNeighborhoodBoundary(challenge.area.label).then((ring) => {
        if (!canceled) setNeighborhoodRing(ring);
      });
    }
    void getDatabase()
      .then((db) => db.getPostsForChallenge(challenge.id))
      .then((p) => {
        if (!canceled) setPosts(p);
      });
    return () => {
      canceled = true;
    };
  }, [visible, challenge?.id, challenge?.area.type, challenge?.area.label]);

  if (!recap || !challenge) return null;
  const caption = buildChallengeRecapCaption(recap, challenge);

  const shareExternally = async () => {
    setSharing(true);
    let uri: string | undefined;
    try {
      uri = await shotRef.current?.capture?.();
    } catch {
      // Native module not linked yet, or capture failed — text-only share still works.
    }
    setSharing(false);
    onClose();
    setTimeout(() => {
      Share.share(uri ? { url: uri, message: caption } : { message: caption }).catch(() => {});
    }, 400);
  };

  const postToCommunity = async () => {
    setPosting(true);
    try {
      const db = await getDatabase();
      const ring = unflattenRing(challenge.area.ring);
      const created = await db.createChallengeRecapPost({
        challengeId: challenge.id,
        challengeName: challenge.name,
        neighborhood: challenge.area.label,
        recap: {
          totalPickups: recap.totalPickups,
          totalBags: recap.totalBags,
          totalCleanups: recap.totalCleanups,
          participantCount: recap.participantCount,
          goalReached: recap.goalReached,
          goalType: challenge.goal_type,
          goalValue: challenge.goal_value,
          topContributorName: recap.topContributorName,
        },
        areaRing: challenge.area.type === 'custom' && ring.length >= 3 ? challenge.area.ring : undefined,
      });
      if (created) {
        onPosted?.();
        onClose();
      } else {
        Alert.alert('Could not post', 'Please try again in a moment.');
      }
    } catch {
      Alert.alert('Could not post', 'Please try again in a moment.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handleBar} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>Share your recap</Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Icon name="close" size={20} color={C.muted} sw={2} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.cardCenter}>
                <ViewShot ref={shotRef} options={{ format: 'png', quality: 0.95 }}>
                  <GroupRecapCard recap={recap} challenge={challenge} neighborhoodRing={neighborhoodRing} posts={posts} />
                </ViewShot>
              </View>

              <Pressable onPress={shareExternally} disabled={sharing} style={[styles.shareBtn, sharing && { opacity: 0.6 }]}>
                <Icon name="share" size={18} color={C.primary} sw={2} />
                <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share externally'}</Text>
              </Pressable>

              <Pressable onPress={postToCommunity} disabled={posting} style={[styles.postBtn, posting && { opacity: 0.6 }]}>
                {posting ? (
                  <ActivityIndicator color={C.creamText} />
                ) : (
                  <>
                    <Icon name="leaf" size={18} color={C.creamText} sw={2} />
                    <Text style={styles.postBtnText}>Post to Community</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,47,102,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10, maxHeight: '90%' },
  handleBar: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontFamily: Fonts.headlineBold, fontSize: 20, color: C.dark },
  closeBtn: { padding: 4 },

  cardCenter: { alignItems: 'center' },

  shareBtn: {
    marginTop: 16, backgroundColor: C.tint, borderRadius: radius.card, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  shareBtnText: { color: C.primary, fontFamily: Fonts.bodyBold, fontSize: 16 },
  postBtn: {
    marginTop: 12, marginBottom: 4, backgroundColor: C.primary, borderRadius: radius.card, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...shadow.raised,
  },
  postBtnText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 16 },
});
