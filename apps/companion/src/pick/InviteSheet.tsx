/**
 * Invite people to a challenge.
 *
 * Two ways in, because they cover different situations:
 *   1. The people you already follow / who follow you — the common case, and
 *      it needs no typing.
 *   2. @handle search — for someone you haven't followed yet.
 * Plus a share sheet for anyone not on the app at all.
 *
 * Already-in and already-invited pickers still appear, greyed with their state,
 * rather than being hidden — otherwise it reads as "search is broken."
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { C, Fonts, radius } from './theme';
import { getAuthService } from '../services/authService';
import { listFollowingIds, listFollowerIds } from '../services/follows';
import { getProfiles, searchByHandle, type PublicProfile } from '../services/profiles';
import { inviteToChallenge, challengeInviteMessage, type Challenge } from '../services/challenges';

export function InviteSheet({
  visible,
  challenge,
  onClose,
  onInvited,
}: {
  visible: boolean;
  challenge: Challenge;
  onClose: () => void;
  onInvited: () => void;
}) {
  const me = getAuthService().getCurrentUser();
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [results, setResults] = useState<PublicProfile[] | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const inChallenge = useMemo(() => new Set(challenge.participants || []), [challenge.participants]);
  const alreadyInvited = useMemo(() => new Set(challenge.invited || []), [challenge.invited]);

  // Your people: everyone either side of the follow graph, de-duped.
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setPicked(new Set());
    setQ('');
    setResults(null);
    (async () => {
      try {
        const [following, followers] = await Promise.all([listFollowingIds(), listFollowerIds()]);
        const uids = [...new Set([...following, ...followers])].filter((u) => u !== me?.uid);
        setPeople(await getProfiles(uids));
      } catch (e) {
        console.warn('Could not load your people:', e);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const runSearch = useCallback(async (text: string) => {
    const term = text.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      setResults(await searchByHandle(term));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced so a fast typist doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => runSearch(q), 300);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  const toggle = (uid: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  const send = async () => {
    if (!picked.size) return;
    setSending(true);
    try {
      await inviteToChallenge(challenge.id, [...picked]);
      onInvited();
      onClose();
    } catch (e) {
      console.error('Invite failed:', e);
    } finally {
      setSending(false);
    }
  };

  const shareLink = () => {
    const message = challengeInviteMessage(challenge, me?.displayName || undefined);
    // Dismiss this modal FIRST, then present the OS share sheet — iOS can't
    // present it over an open React Native Modal, and once the share sheet
    // goes away the Modal underneath stops receiving touches, so you're stuck
    // on a screen with no working close button. Same fix as ShareComposer.
    onClose();
    setTimeout(() => {
      Share.share({ message }).catch(() => {});
    }, 400);
  };

  const list = results ?? people;
  const emptyCopy = results
    ? searching
      ? 'Searching…'
      : 'No picker with that handle.'
    : "You're not following anyone yet. Search a @handle, or share a link.";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={{ width: 22 }}>
            <Icon name="close" size={21} color={C.dark} sw={2} />
          </Pressable>
          <Text style={styles.h1}>Invite pickers</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder="Search a @handle"
            placeholderTextColor={C.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <Pressable style={styles.shareRow} onPress={shareLink}>
          <View style={styles.shareWell}>
            <Icon name="share" size={17} color={C.primary} sw={1.8} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.shareTitle}>Share an invite link</Text>
            <Text style={styles.shareSub}>For anyone not on Pick yet</Text>
          </View>
          <Icon name="chevron" size={15} color={C.chevron} sw={2} />
        </Pressable>

        {!results && <Text style={styles.sectionH}>People you follow</Text>}

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {list.length === 0 ? (
              <Text style={styles.empty}>{emptyCopy}</Text>
            ) : (
              list.map((p) => {
                const isIn = inChallenge.has(p.uid);
                const wasInvited = alreadyInvited.has(p.uid);
                const disabled = isIn || wasInvited;
                const on = picked.has(p.uid);
                return (
                  <Pressable
                    key={p.uid}
                    style={[styles.row, on && styles.rowOn, disabled && { opacity: 0.55 }]}
                    onPress={() => !disabled && toggle(p.uid)}
                    disabled={disabled}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(p.display_name || p.handle || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{p.display_name || 'Picker'}</Text>
                      <Text style={styles.sub} numberOfLines={1}>
                        {p.handle ? `@${p.handle}` : 'no handle'}
                        {isIn ? '  ·  already in' : wasInvited ? '  ·  invited' : ''}
                      </Text>
                    </View>
                    {!disabled && (
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on && <Icon name="check" size={14} color={C.creamText} sw={2.6} />}
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <Pressable
            style={[styles.primaryBtn, (!picked.size || sending) && { opacity: 0.5 }]}
            onPress={send}
            disabled={!picked.size || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={C.creamText} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {picked.size ? `Invite ${picked.size}` : 'Select people to invite'}
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  h1: { flex: 1, fontFamily: Fonts.headlineBold, fontSize: 18, color: C.dark, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  searchWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  search: {
    backgroundColor: '#fff', borderRadius: radius.field, borderWidth: 1, borderColor: C.border3,
    paddingVertical: 12, paddingHorizontal: 14, fontFamily: Fonts.body, fontSize: 16, color: C.dark,
  },

  shareRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 8, padding: 14,
    backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border,
  },
  shareWell: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  shareTitle: { fontFamily: Fonts.bodyBold, fontSize: 14.5, color: C.dark },
  shareSub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },

  sectionH: { fontFamily: Fonts.bodyBold, fontSize: 12, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase', marginHorizontal: 20, marginTop: 12, marginBottom: 2 },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, gap: 8 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: radius.card, padding: 12,
    borderWidth: 1.5, borderColor: C.border,
  },
  rowOn: { borderColor: C.primary },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: C.primary },
  name: { fontFamily: Fonts.bodyBold, fontSize: 15, color: C.dark },
  sub: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: C.border3, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.primary, borderColor: C.primary },

  empty: { fontFamily: Fonts.body, fontSize: 13.5, color: C.muted, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 20, lineHeight: 19 },

  footer: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, backgroundColor: C.white,
  },
  primaryBtn: { backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 15 },
});
