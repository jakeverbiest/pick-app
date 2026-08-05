/**
 * You → Settings → Blocked accounts. Lists everyone this user has blocked
 * (not everyone who blocked them — that stays invisible, see moderation.ts)
 * and lets them undo it via the existing unblockUser().
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Icon } from '../src/pick/Icon';
import { C, Fonts, radius } from '../src/pick/theme';
import { listMyBlockedUids, unblockUser } from '../src/services/moderation';
import { getProfiles, type PublicProfile } from '../src/services/profiles';

export default function BlockedAccountsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const uids = await listMyBlockedUids();
      setProfiles(uids.length ? await getProfiles(uids) : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doUnblock = (p: PublicProfile) => {
    const who = p.display_name || 'this picker';
    Alert.alert(`Unblock ${who}?`, "They'll be able to follow you and see your posts again.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          setBusy((s) => new Set(s).add(p.uid));
          try {
            await unblockUser(p.uid);
            setProfiles((prev) => prev.filter((r) => r.uid !== p.uid));
          } finally {
            setBusy((s) => { const n = new Set(s); n.delete(p.uid); return n; });
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Icon name="back" size={22} color={C.dark} sw={2} />
        </Pressable>
        <Text style={styles.h1}>Blocked accounts</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {profiles.length === 0 ? (
            <Text style={styles.empty}>You haven't blocked anyone.</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {profiles.map((p) => {
                const isBusy = busy.has(p.uid);
                return (
                  <View key={p.uid} style={styles.row}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(p.display_name || p.handle || '?').slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.name} numberOfLines={1}>{p.display_name || 'Picker'}</Text>
                      {!!p.handle && <Text style={styles.handle} numberOfLines={1}>@{p.handle}</Text>}
                    </View>
                    <Pressable
                      onPress={() => doUnblock(p)}
                      disabled={isBusy}
                      style={[styles.unblockBtn, isBusy && { opacity: 0.6 }]}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color={C.primary} />
                      ) : (
                        <Text style={styles.unblockText}>Unblock</Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
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
  h1: { fontFamily: Fonts.headlineBold, fontSize: 18, color: C.dark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: C.text3, lineHeight: 20, paddingVertical: 10 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.card, borderWidth: 1.5, borderColor: C.border, padding: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Fonts.bodyBold, fontSize: 17, color: C.creamText },
  name: { fontFamily: Fonts.bodySemibold, fontSize: 15.5, color: C.dark },
  handle: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 1 },

  unblockBtn: { borderRadius: 999, paddingHorizontal: 14, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.primary },
  unblockText: { fontFamily: Fonts.bodyBold, color: C.primary, fontSize: 14 },
});
