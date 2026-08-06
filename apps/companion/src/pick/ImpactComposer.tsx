/**
 * Compose and share an "impact" post: a map snapshot of your adopted blocks
 * plus a stat summary. Unlike ShareComposer (which hands off to the OS share
 * sheet for external networks), this posts straight into the in-app community
 * feed via createImpactPost.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share,
  StyleSheet, Text, TextInput, View, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { Icon } from './Icon';
import { C, Fonts, radius, shadow } from './theme';
import { ImpactMap } from './ImpactMap';
import { buildMyImpact, type MyImpact } from '../services/impactShare';
import { getDatabase } from '../services/firebaseDatabase';
import { getAuthService } from '../services/authService';

function MiniStat({ value, label }: { value: string; label: string }) {
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
  const [sharing, setSharing] = useState(false);
  const [impact, setImpact] = useState<MyImpact | null>(null);
  const [caption, setCaption] = useState('');
  const [displayName, setDisplayName] = useState('');
  const shotRef = useRef<ViewShotRef>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setDisplayName(getAuthService().getCurrentUser()?.displayName || '');
    buildMyImpact(extra)
      .then((mi) => setImpact(mi))
      .catch((e) => { console.error(e); setImpact(null); })
      .finally(() => setLoading(false));
  }, [visible]);

  // The one visceral, headline number — pieces picked up — gets its own hero
  // treatment (matches RecapCard); everything else is a supporting stat.
  const heroPickups = impact?.stats.pickups ?? 0;

  const chips = useMemo(() => {
    const s = impact?.stats;
    if (!s) return [] as { value: string; label: string }[];
    const out: { value: string; label: string }[] = [];
    if (s.bags != null) out.push({ value: s.bags < 1 ? s.bags.toFixed(1) : String(Math.round(s.bags)), label: 'bags' });
    out.push({ value: String(s.adopted), label: s.adopted === 1 ? 'block adopted' : 'blocks adopted' });
    if (s.cleanups != null) out.push({ value: String(s.cleanups), label: 'cleanups' });
    if (s.pctGreen != null) out.push({ value: `${s.pctGreen}%`, label: 'green' });
    if (s.toGo != null) out.push({ value: String(s.toGo), label: 'to go' });
    return out;
  }, [impact]);

  const post = async () => {
    if (!impact) return;
    try {
      setPosting(true);
      const db = await getDatabase();
      const created = await db.createImpactPost({
        caption: caption.trim(),
        stats: impact.stats,
        coverage: impact.coverage,
      });
      if (created) {
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

  // Capture the card WHILE it's mounted, then close, THEN present the OS
  // share sheet — iOS silently no-ops Share.share() over an open RN Modal
  // (same fix as RecapModal/ShareComposer).
  const shareExternally = async () => {
    setSharing(true);
    let uri: string | undefined;
    try {
      uri = await shotRef.current?.capture?.();
    } catch {
      // Native module not linked yet, or capture failed — text-only share still works.
    }
    const message = caption.trim()
      ? `${caption.trim()}\n\n${heroPickups.toLocaleString()} pieces of litter picked up with Pick.`
      : `${heroPickups.toLocaleString()} pieces of litter picked up with Pick.`;
    setSharing(false);
    onClose();
    setTimeout(() => {
      Share.share(uri ? { url: uri, message } : { message }).catch(() => {});
    }, 400);
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
                <View style={styles.cardCenter}>
                  <ViewShot ref={shotRef} options={{ format: 'png', quality: 0.95 }}>
                    <View style={styles.previewCard}>
                      <Text style={styles.kicker}>MY IMPACT ON PICK</Text>
                      <View style={styles.heroRow}>
                        <Text style={styles.heroNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                          {heroPickups.toLocaleString()}
                        </Text>
                        <Text style={styles.heroUnit}>pieces picked up</Text>
                      </View>

                      <View style={styles.mapWrap}>
                        <ImpactMap coverage={impact.coverage} height={150} />
                        {!impact.hasBlocks && (
                          <View style={styles.mapEmptyOverlay}>
                            <Icon name="route" size={20} color={C.muted} sw={1.8} />
                          </View>
                        )}
                      </View>

                      <View style={styles.statsRow}>
                        {chips.map((c, i) => (
                          <MiniStat key={i} value={c.value} label={c.label} />
                        ))}
                      </View>

                      <View style={styles.footer}>
                        <View style={{ flex: 1 }}>
                          {!!displayName && (
                            <Text style={styles.footerName} numberOfLines={1}>{displayName}</Text>
                          )}
                        </View>
                        <View style={styles.brandRow}>
                          <Icon name="leaf" size={14} color="#fff" sw={1.8} />
                          <Text style={styles.brand}>Pick</Text>
                        </View>
                      </View>
                    </View>
                  </ViewShot>
                </View>

                {!impact.hasBlocks && (
                  <Text style={styles.hint}>
                    Log a cleanup or adopt a block on the map to fill in your snapshot — you can still share your stats now.
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
                  onPress={shareExternally}
                  disabled={sharing}
                  style={[styles.shareBtn, sharing && { opacity: 0.6 }]}
                >
                  <Icon name="share" size={18} color={C.primary} sw={2} />
                  <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share externally'}</Text>
                </Pressable>

                <Pressable
                  onPress={post}
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

  // Social-share card — same navy "wrapped" treatment as RecapCard, so every
  // share surface in the app reads as one consistent brand moment.
  cardCenter: { alignItems: 'center' },
  previewCard: {
    width: 320,
    backgroundColor: C.dark,
    borderRadius: radius.cardLg,
    padding: 22,
    ...shadow.card,
  },
  kicker: { fontFamily: Fonts.bodyBold, fontSize: 12, letterSpacing: 0.6, color: C.heroSub, textTransform: 'uppercase' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
  heroNum: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 46, letterSpacing: -1, color: '#fff' },
  heroUnit: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: C.heroSub2 },

  mapWrap: { borderRadius: radius.card, overflow: 'hidden', marginTop: 16 },
  mapEmptyOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 14 },
  stat: { minWidth: '33%', alignItems: 'center', paddingVertical: 6 },
  statValue: { fontFamily: Fonts.displayBold, fontSize: 20, color: '#fff' },
  statLabel: { fontFamily: Fonts.body, fontSize: 11.5, color: C.heroSub, marginTop: 2, textAlign: 'center' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)',
  },
  footerName: { fontFamily: Fonts.bodySemibold, fontSize: 12, color: 'rgba(255,255,255,0.72)' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  brand: { fontFamily: Fonts.bodyBold, fontSize: 13, color: '#fff' },

  hint: { fontFamily: Fonts.body, fontSize: 13, color: C.text3, marginTop: 12, lineHeight: 18, textAlign: 'center' },

  caption: {
    marginTop: 14, minHeight: 70, backgroundColor: '#fff', borderRadius: radius.card,
    borderWidth: 1, borderColor: C.border, padding: 14, fontFamily: Fonts.body, fontSize: 15, color: C.dark, textAlignVertical: 'top',
  },
  shareBtn: {
    marginTop: 12, backgroundColor: C.tint, borderRadius: radius.card, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  shareBtnText: { color: C.primary, fontFamily: Fonts.bodyBold, fontSize: 16 },
  postBtn: {
    marginTop: 16, backgroundColor: C.primary, borderRadius: radius.card, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  postBtnText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 16 },
});
