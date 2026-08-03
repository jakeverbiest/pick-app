/**
 * Find people → follow them. One-way follow: tapping Follow means you start
 * seeing their posts in the "Following" feed immediately (no approval).
 *
 * Discovery: search by @handle (prefix) or paste an exact email. Your own
 * handle lives up top — set it so others can find YOU.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '../src/pick/Icon';
import { C, Fonts, radius } from '../src/pick/theme';
import {
  ensureProfile, getProfile, setHandle, searchByHandle, findByEmail,
  normalizeHandle, type PublicProfile,
} from '../src/services/profiles';
import { follow, unfollow, listFollowingIds } from '../src/services/follows';

export default function PeopleScreen() {
  const router = useRouter();
  const [myHandle, setMyHandle] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [savingHandle, setSavingHandle] = useState(false);

  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load my profile + who I already follow.
  useEffect(() => {
    (async () => {
      await ensureProfile();
      const [p, ids] = await Promise.all([myProfile(), listFollowingIds()]);
      if (p?.handle) { setMyHandle(p.handle); setHandleInput(p.handle); }
      setFollowingSet(new Set(ids));
    })();
  }, []);

  async function myProfile(): Promise<PublicProfile | null> {
    // ensureProfile has run; read our own doc by resolving from search is
    // overkill — just re-read via getProfile using the auth uid.
    const { getAuthService } = await import('../src/services/authService');
    const uid = getAuthService().getCurrentUser()?.uid;
    return uid ? getProfile(uid) : null;
  }

  const runSearch = useCallback(async (text: string) => {
    const t = text.trim();
    if (t.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      if (t.includes('@') && t.includes('.')) {
        const p = await findByEmail(t);
        setResults(p ? [p] : []);
      } else {
        setResults(await searchByHandle(t));
      }
    } finally {
      setSearching(false);
    }
  }, []);

  const onChangeQuery = (text: string) => {
    setQueryText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), 320);
  };

  const toggleFollow = async (p: PublicProfile) => {
    const isF = followingSet.has(p.uid);
    setBusy((s) => new Set(s).add(p.uid));
    // Optimistic.
    setFollowingSet((s) => {
      const n = new Set(s);
      isF ? n.delete(p.uid) : n.add(p.uid);
      return n;
    });
    try {
      isF ? await unfollow(p.uid) : await follow(p.uid);
    } catch {
      // Revert on failure.
      setFollowingSet((s) => {
        const n = new Set(s);
        isF ? n.add(p.uid) : n.delete(p.uid);
        return n;
      });
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(p.uid); return n; });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Icon name="back" size={22} color={C.dark} sw={2} />
        </Pressable>
        <Text style={styles.h1}>Find people</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Handle editing moved to You → Edit profile (design audit). */}
        {!myHandle && (
          <Text style={styles.help}>Set your @handle in You → Edit so friends can find you.</Text>
        )}

        {/* Search */}
        <Text style={[styles.section, { marginTop: 10 }]}>Search</Text>
        <View style={styles.searchField}>
          <Icon name="user" size={18} color={C.muted} sw={1.8} />
          <TextInput
            style={styles.searchInput}
            value={queryText}
            onChangeText={onChangeQuery}
            placeholder="@handle or email"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching && <ActivityIndicator color={C.muted} size="small" />}
        </View>

        <View style={{ marginTop: 14, gap: 10 }}>
          {results.map((p) => {
            const isF = followingSet.has(p.uid);
            const isBusy = busy.has(p.uid);
            return (
              <View key={p.uid} style={styles.personCard}>
                <Pressable
                  onPress={() => router.push(`/profile/${p.uid}` as any)}
                  style={styles.personTap}
                  hitSlop={4}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(p.display_name || p.handle || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{p.display_name || 'Picker'}</Text>
                    <Text style={styles.handle} numberOfLines={1}>
                      @{p.handle}{p.neighborhood ? ` · ${p.neighborhood}` : ''}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => toggleFollow(p)}
                  disabled={isBusy}
                  style={[styles.followBtn, isF && styles.followingBtn, isBusy && { opacity: 0.6 }]}
                >
                  {isBusy ? (
                    <ActivityIndicator color={isF ? C.primary : C.creamText} size="small" />
                  ) : (
                    <>
                      <Icon name={isF ? 'check' : 'plus'} size={15} color={isF ? C.primary : C.creamText} sw={2.2} />
                      <Text style={[styles.followText, isF && { color: C.primary }]}>{isF ? 'Following' : 'Follow'}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}

          {!searching && queryText.trim().length >= 2 && results.length === 0 && (
            <Text style={styles.empty}>
              No one found. If you searched a handle, they may not have set one yet — try their exact email.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  h1: { fontFamily: Fonts.headlineBold, fontSize: 20, color: C.dark },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  section: { fontFamily: Fonts.bodyBold, fontSize: 13, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },

  handleRow: { flexDirection: 'row', gap: 10 },
  handleField: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 48 },
  at: { fontFamily: Fonts.body, fontSize: 16, color: C.muted, marginRight: 2 },
  handleInput: { flex: 1, fontFamily: Fonts.body, fontSize: 16, color: C.dark },
  saveBtn: { backgroundColor: C.primary, borderRadius: radius.card, paddingHorizontal: 20, height: 48, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 15 },
  help: { fontFamily: Fonts.body, fontSize: 12.5, color: C.text3, marginTop: 8, lineHeight: 17 },

  searchField: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 48 },
  searchInput: { flex: 1, fontFamily: Fonts.body, fontSize: 16, color: C.dark },

  personCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, padding: 12 },
  personTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 17, color: C.creamText },
  name: { fontFamily: Fonts.bodySemibold, fontSize: 15.5, color: C.dark },
  handle: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 1 },

  followBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.primary, borderRadius: 999, paddingHorizontal: 14, height: 36 },
  followingBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary },
  followText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 14 },

  empty: { fontFamily: Fonts.body, fontSize: 14, color: C.text3, lineHeight: 20, paddingVertical: 10 },
});
