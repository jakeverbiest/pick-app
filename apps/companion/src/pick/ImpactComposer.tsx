/**
 * Compose and share an "impact" post: a map snapshot of your adopted blocks
 * plus a stat summary. Unlike ShareComposer (which hands off to the OS share
 * sheet for external networks), this posts straight into the in-app community
 * feed via createImpactPost.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { C, Fonts, radius } from './theme';
import { ImpactMap } from './ImpactMap';
import { buildMyImpact, type MyImpact } from '../services/impactShare';
import { getDatabase } from '../services/firebaseDatabase';

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function ImpactComposer({
  visible,
  onClose,
  onPosted,
  extra,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted?: () => void;
  extra?: { pctGreen?: number; toGo?: number };
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [impact, setImpact] = useState<MyImpact | null>(null);
  const [caption, setCaption] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    buildMyImpact(extra)
      .then((mi) => setImpact(mi))
      .catch((e) => { console.error(e); setImpact(null); })
      .finally(() => setLoading(false));
  }, [visible]);

  const chips = useMemo(() => {
    const s = impact?.stats;
    if (!s) return [] as { value: string; label: string }[];
    const out: { value: string; label: string }[] = [];
    if (s.pctGreen != null) out.push({ value: `${s.pctGreen}%`, label: 'green' });
    out.push({ value: String(s.adopted), label: s.adopted === 1 ? 'block adopted' : 'blocks adopted' });
    if (s.toGo != null) out.push({ value: String(s.toGo), label: 'to go' });
    if (s.cleanups != null) out.push({ value: String(s.cleanups), label: 'cleanups' });
    return out;
  }, [impact]);

  const share = async () => {
    if (!impact) return;
    try {
      setPosting(true);
      const db = await getDatabase();
      const post = await db.createImpactPost({
        caption: caption.trim(),
        stats: impact.stats,
        coverage: impact.coverage,
      });
      if (post) {
        setCaption('');
        onPosted?.();
        onClose();
      } else {
        Alert.alert('Could not share', 'Please try again in a moment.');
      }
    } catch (e) {
      Alert.alert('Could not share', 'Please try again in a moment.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handleBar} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>Share your impact</Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Icon name="close" size={20} color={C.muted} sw={2} />
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
            ) : !impact ? (
              <View style={styles.center}><Text style={styles.dim}>Couldn’t load your impact.</Text></View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.previewCard}>
                  <ImpactMap coverage={impact.coverage} height={170} />
                  <View style={styles.statsRow}>
                    {chips.map((c, i) => (
                      <Stat key={i} value={c.value} label={c.label} />
                    ))}
                  </View>
                </View>

                {!impact.hasBlocks && (
                  <Text style={styles.hint}>
                    Adopt a block on the map to fill in your snapshot — you can still share your stats now.
                  </Text>
                )}

                <TextInput
                  style={styles.caption}
                  placeholder="Say something about your progress… (optional)"
                  placeholderTextColor={C.muted}
                  value={caption}
                  onChangeText={(t) => setCaption(t.slice(0, 280))}
                  multiline
                />

                <Pressable
                  onPress={share}
                  disabled={posting}
                  style={[styles.postBtn, posting && { opacity: 0.6 }]}
                >
                  {posting ? (
                    <ActivityIndicator color={C.creamText} />
                  ) : (
                    <>
                      <Icon name="leaf" size={18} color={C.creamText} sw={2} />
                      <Text style={styles.postBtnText}>Share to community</Text>
                    </>
                  )}
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,47,102,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 10, maxHeight: '88%' },
  handleBar: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontFamily: Fonts.headlineBold, fontSize: 20, color: C.dark },
  closeBtn: { padding: 4 },
  center: { paddingVertical: 50, alignItems: 'center' },
  dim: { color: C.muted, fontFamily: Fonts.body, fontSize: 15 },

  previewCard: { backgroundColor: '#fff', borderRadius: radius.card, overflow: 'hidden', borderWidth: 1.5, borderColor: C.border },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 14, paddingHorizontal: 6 },
  stat: { minWidth: '25%', alignItems: 'center', paddingVertical: 6 },
  statValue: { fontFamily: Fonts.displayBold, fontSize: 20, color: C.primary },
  statLabel: { fontFamily: Fonts.body, fontSize: 12, color: C.text3, marginTop: 2, textAlign: 'center' },

  hint: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 12, lineHeight: 18 },

  caption: {
    marginTop: 14, minHeight: 70, backgroundColor: '#fff', borderRadius: radius.card,
    borderWidth: 1, borderColor: C.border, padding: 14, fontFamily: Fonts.body, fontSize: 15, color: C.dark, textAlignVertical: 'top',
  },
  postBtn: {
    marginTop: 16, backgroundColor: C.primary, borderRadius: radius.card, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  postBtnText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 16 },
});
