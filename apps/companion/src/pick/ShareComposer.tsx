/**
 * In-app share composer for a finished cleanup.
 * Live preview, per-platform presets + char limits, toggleable stat chips,
 * optional photo, then hands off to the OS share sheet (React Native Share).
 */
import React, { useEffect, useMemo, useState } from 'react';
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
import { C, Fonts, PLATFORM_ACCENT, radius } from './theme';
import { formatBags, formatKitchenBags } from '../services/impactMetrics';
import { getBlueskyAccount, postToBluesky } from '../services/bluesky';

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
  // Posts name the full unit ("kitchen trash bag") so strangers can picture it;
  // the compact chip uses the short form.
  const bagsText = formatKitchenBags(bags);
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
  const [blueskyHandle, setBlueskyHandle] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // Re-check each time the sheet opens, not just on mount — this component
  // stays rendered (just hidden) between opens, so a mount-only check would
  // miss a Bluesky connection made in Settings after the first open.
  useEffect(() => {
    if (!visible) return;
    getBlueskyAccount().then((acct) => setBlueskyHandle(acct?.handle ?? null));
  }, [visible]);

  const caption = captions[platform] ?? base[platform];
  const limit = LIMITS[platform];
  const remaining = limit - caption.length;
  const over = remaining < 0;
  const counterColor = over ? C.danger : remaining <= 25 ? C.warning : C.muted;

  const chips: { key: 'pieces' | 'bags' | 'distance'; text: string }[] = [
    { key: 'pieces', text: `${pieces} pieces` },
    { key: 'bags', text: formatBags(bags) },
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

    // Bluesky is the one platform Pick can actually post to directly (see
    // services/bluesky.ts) — post for real instead of the generic OS-share
    // handoff below, which for Bluesky specifically just opened a share
    // sheet that couldn't complete a post on its own without the Bluesky
    // app installed and the user pasting it in manually.
    if (platform === 'bluesky' && blueskyHandle) {
      setPosting(true);
      const ok = await postToBluesky({ text: message, photoUri });
      setPosting(false);
      if (ok) {
        onClose();
        Alert.alert('Posted', `Shared to Bluesky as @${blueskyHandle}.`);
      } else {
        Alert.alert('Could not post', "Something went wrong posting to Bluesky — check your connection and that your app password in Settings is still valid.");
      }
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
                    style={[styles.platChip, active && { borderColor: PLATFORM_ACCENT[p], backgroundColor: C.white }]}
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
              disabled={over || posting}
              style={({ pressed }) => [styles.postBtn, (over || posting) && styles.postDisabled, pressed && !over && { opacity: 0.92 }]}
              onPress={post}
            >
              <Text style={styles.postText}>
                {over
                  ? 'Caption too long'
                  : posting
                  ? 'Posting…'
                  : platform === 'copy'
                  ? 'Copy to clipboard'
                  : platform === 'bluesky' && blueskyHandle
                  ? `Post to Bluesky as @${blueskyHandle}`
                  : `Share to ${NAMES[platform]}`}
              </Text>
            </Pressable>
            {platform === 'bluesky' && !blueskyHandle && (
              <Text style={styles.blueskyHint}>
                Connect Bluesky in Settings to post directly — otherwise this opens the share sheet instead.
              </Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,47,102,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.white,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 14,
    paddingHorizontal: 20,
    maxHeight: '92%',
  },
  grabber: { width: 40, height: 5, borderRadius: 999, backgroundColor: C.border3, alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { fontFamily: Fonts.headlineBold, fontSize: 17, color: C.dark },

  preview: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: C.border, padding: 16 },
  previewTop: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 15 },
  previewName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: C.dark },
  previewHandle: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, marginTop: 1 },
  previewCaption: { fontFamily: Fonts.body, fontSize: 14, color: C.dark, lineHeight: 20 },
  previewPhoto: { width: '100%', height: 150, borderRadius: 12, marginTop: 10, backgroundColor: C.tint },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  previewChip: { backgroundColor: C.tint, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  previewChipText: { fontFamily: Fonts.bodySemibold, fontSize: 12, color: C.primary },

  fieldHeading: { fontFamily: Fonts.bodySemibold, fontSize: 12, color: C.muted, letterSpacing: 0.4, marginTop: 20, marginBottom: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  platChip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1.5, borderColor: C.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13 },
  platDot: { width: 9, height: 9, borderRadius: 5 },
  platChipText: { fontFamily: Fonts.bodySemibold, fontSize: 13, color: C.muted },
  statToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  statOn: { backgroundColor: C.tint },
  statOff: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  statToggleText: { fontFamily: Fonts.bodySemibold, fontSize: 13 },

  captionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  counter: { fontFamily: Fonts.bodySemibold, fontSize: 12, marginTop: 20 },
  captionInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: C.dark,
    lineHeight: 20,
    minHeight: 120,
  },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.tint, borderRadius: 14, paddingVertical: 13, marginBottom: 4 },
  inviteText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: C.primary },
  postBtn: { marginTop: 16, backgroundColor: C.primary, borderRadius: radius.button, paddingVertical: 16, alignItems: 'center' },
  postDisabled: { backgroundColor: 'rgba(15,47,102,0.35)' },
  postText: { color: C.creamText, fontFamily: Fonts.bodyBold, fontSize: 15 },
  blueskyHint: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 8 },
});
