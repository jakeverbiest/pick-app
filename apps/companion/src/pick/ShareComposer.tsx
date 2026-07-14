/**
 * In-app share composer for a finished cleanup.
 * Live preview, per-platform presets + char limits, toggleable stat chips,
 * optional photo, then hands off to the OS share sheet (React Native Share).
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { C, PLATFORM_ACCENT, radius, shadow } from './theme';
import { formatBags } from '../services/impactMetrics';

type Platform = 'bluesky' | 'instagram' | 'facebook' | 'copy';

const ORDER: Platform[] = ['bluesky', 'instagram', 'facebook', 'copy'];
const LIMITS: Record<Platform, number> = { bluesky: 300, instagram: 2200, facebook: 5000, copy: 280 };
const NAMES: Record<Platform, string> = { bluesky: 'Bluesky', instagram: 'Instagram', facebook: 'Facebook', copy: 'Copy link' };

function presets(pieces: number, bagsText: string, hood: string, hoodPct: number | undefined, invite: string): Record<Platform, string> {
  const place = hood ? `${hood}` : 'my neighborhood';
  // Lead with the completion hook when we have it — "X% cleaned and climbing"
  // is the shareable, joinable framing; raw counts are the supporting detail.
  const hook = hoodPct != null ? `${place} is ${hoodPct}% cleaned and climbing` : `Another stretch of ${place}, litter-free`;
  const join = `Join me on Pick: ${invite}`;
  return {
    bluesky: `${hook} — ${pieces} pieces of litter (${bagsText}) off our streets today with Pick. Who's in for the next block? ${join} #KeepItClean`,
    instagram: `${hook}.\n\n${pieces} pieces of litter — ${bagsText} — collected on today's walk with Pick. Small actions, real impact — come help finish the neighborhood.\n\n${join}\n\n#KeepItClean #PickUp #CommunityCleanup #CleanStreets #LitterFree`,
    facebook: `${hook} — ${pieces} pieces of litter (${bagsText}) off our streets with Pick today.\n\nIf you're local, come help complete the neighborhood. Every pair of hands makes a difference.\n\n${join}\n\n#KeepItClean`,
    copy: `${hook} — ${pieces} pieces (${bagsText}) off our streets with Pick. ${join}`,
  };
}

export function ShareComposer({
  visible,
  onClose,
  pieces,
  bags,
  distanceMi,
  photoUri,
  fullName,
  initials,
  team,
  hood,
  hoodPct,
  inviteUrl,
}: {
  visible: boolean;
  onClose: () => void;
  pieces: number;
  bags: number;
  distanceMi: number;
  photoUri: string | null;
  fullName: string;
  initials: string;
  team: string;
  hood: string;
  hoodPct?: number;
  inviteUrl: string;
}) {
  const insets = useSafeAreaInsets();
  const bagsText = formatBags(bags);
  const base = useMemo(() => presets(pieces, bagsText, hood, hoodPct, inviteUrl), [pieces, bagsText, hood, hoodPct, inviteUrl]);

  // Frictionless network growth: one tap shares just the invite link via the OS
  // sheet (texts, WhatsApp, DMs — wherever their people are).
  const invite = () => {
    const place = hood ? hood : 'my neighborhood';
    onClose();
    setTimeout(() => {
      Share.share({ message: `Help me green ${place} on Pick — it's a litter-cleanup game for our streets. Join me: ${inviteUrl}` }).catch(() => {});
    }, 400);
  };

  const [platform, setPlatform] = useState<Platform>('bluesky');
  const [captions, setCaptions] = useState<Partial<Record<Platform, string>>>({});
  const [includeStats, setIncludeStats] = useState({ pieces: true, bags: true, distance: true });

  const caption = captions[platform] ?? base[platform];
  const limit = LIMITS[platform];
  const remaining = limit - caption.length;
  const over = remaining < 0;
  const counterColor = over ? C.danger : remaining <= 25 ? C.warning : C.muted;

  const chips: { key: 'pieces' | 'bags' | 'distance'; text: string }[] = [
    { key: 'pieces', text: `${pieces} pieces` },
    { key: 'bags', text: bagsText },
    { key: 'distance', text: `${distanceMi.toFixed(1)} mi` },
  ];
  const activeChips = chips.filter((c) => includeStats[c.key]);

  const post = async () => {
    const statLine = activeChips.map((c) => c.text).join(' · ');
    const message = statLine ? `${caption}\n\n${statLine}` : caption;

    if (platform === 'copy') {
      await Clipboard.setStringAsync(message);
      onClose();
      Alert.alert('Copied', 'Your caption is on the clipboard — paste it anywhere.');
      return;
    }

    // Dismiss this modal FIRST, then present the OS share sheet. iOS can't
    // present the share sheet over an open React Native Modal, which makes
    // it silently do nothing — closing first fixes that.
    onClose();
    setTimeout(() => {
      Share.share(photoUri ? { message, url: photoUri } : { message }).catch(() => {});
    }, 400);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="back" size={22} color={C.dark} sw={2} />
            </Pressable>
            <Text style={styles.headerTitle}>Share your impact</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* one-tap invite — pulls people into Pick, no caption needed */}
            <Pressable style={styles.inviteBtn} onPress={invite}>
              <Icon name="share" size={18} color={C.primary} sw={2} />
              <Text style={styles.inviteText}>Invite a friend to Pick</Text>
            </Pressable>

            {/* live preview */}
            <View style={styles.preview}>
              <View style={styles.previewTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View>
                  <Text style={styles.previewName}>{fullName}</Text>
                  {!!team && <Text style={styles.previewHandle}>{team}</Text>}
                </View>
              </View>
              <Text style={styles.previewCaption}>{caption}</Text>
              {!!photoUri && <Image source={{ uri: photoUri }} style={styles.previewPhoto} />}
              {activeChips.length > 0 && (
                <View style={styles.previewChips}>
                  {activeChips.map((c) => (
                    <View key={c.key} style={styles.previewChip}>
                      <Text style={styles.previewChipText}>{c.text}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* platform selector */}
            <Text style={styles.fieldHeading}>POST TO</Text>
            <View style={styles.row}>
              {ORDER.map((p) => {
                const active = p === platform;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setPlatform(p)}
                    style={[styles.platChip, active && { borderColor: PLATFORM_ACCENT[p], backgroundColor: '#fff' }]}
                  >
                    <View style={[styles.platDot, { backgroundColor: PLATFORM_ACCENT[p] }]} />
                    <Text style={[styles.platChipText, active && { color: C.dark }]}>{NAMES[p]}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* stat toggles */}
            <Text style={styles.fieldHeading}>INCLUDE STATS</Text>
            <View style={styles.row}>
              {chips.map((c) => {
                const on = includeStats[c.key];
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setIncludeStats((s) => ({ ...s, [c.key]: !s[c.key] }))}
                    style={[styles.statToggle, on ? styles.statOn : styles.statOff]}
                  >
                    <Icon name={on ? 'check' : 'plus'} size={13} color={on ? C.primary : C.muted} sw={2.2} />
                    <Text style={[styles.statToggleText, { color: on ? C.primary : C.muted }]}>{c.text}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* caption editor */}
            <View style={styles.captionHead}>
              <Text style={styles.fieldHeading}>CAPTION</Text>
              <Text style={[styles.counter, { color: counterColor }]}>
                {over ? `${Math.abs(remaining)} over` : `${remaining} left`}
              </Text>
            </View>
            <TextInput
              style={[styles.captionInput, over && { borderColor: C.danger }]}
              value={caption}
              onChangeText={(t) => setCaptions((c) => ({ ...c, [platform]: t }))}
              multiline
              textAlignVertical="top"
              selectionColor={C.primary}
            />

            <Pressable
              disabled={over}
              style={({ pressed }) => [styles.postBtn, over && styles.postDisabled, pressed && !over && { opacity: 0.92 }]}
              onPress={post}
            >
              <Text style={styles.postText}>{over ? 'Caption too long' : platform === 'copy' ? 'Copy to clipboard' : `Share to ${NAMES[platform]}`}</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(29,46,26,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.cream,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 14,
    paddingHorizontal: 20,
    maxHeight: '92%',
  },
  grabber: { width: 40, height: 5, borderRadius: 999, backgroundColor: '#D2D2CC', alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.dark },

  preview: { backgroundColor: '#fff', borderRadius: 16, padding: 16, ...shadow.card },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  previewName: { fontSize: 14, fontWeight: '700', color: C.dark },
  previewHandle: { fontSize: 12, color: C.muted, marginTop: 1 },
  previewCaption: { fontSize: 14, color: C.dark, lineHeight: 20 },
  previewPhoto: { width: '100%', height: 150, borderRadius: 12, marginTop: 10, backgroundColor: C.tint },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  previewChip: { backgroundColor: C.tint, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  previewChipText: { fontSize: 12, fontWeight: '600', color: C.primary },

  fieldHeading: { fontSize: 12, fontWeight: '600', color: C.muted, letterSpacing: 0.4, marginTop: 20, marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  platChip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1.5, borderColor: C.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  platDot: { width: 9, height: 9, borderRadius: 5 },
  platChipText: { fontSize: 13, fontWeight: '600', color: C.muted },
  statToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  statOn: { backgroundColor: C.tint },
  statOff: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  statToggleText: { fontSize: 13, fontWeight: '600' },

  captionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  counter: { fontSize: 12, fontWeight: '600', marginTop: 20 },
  captionInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: C.dark,
    lineHeight: 20,
    minHeight: 120,
  },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.tint, borderRadius: 14, paddingVertical: 13, marginBottom: 4 },
  inviteText: { fontSize: 14, fontWeight: '700', color: C.primary },
  postBtn: { marginTop: 16, backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 16, alignItems: 'center' },
  postDisabled: { backgroundColor: '#B4BBAB' },
  postText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
