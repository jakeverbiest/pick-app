/**
 * "My Path" recap — presents a closed week/month as a simple card, and a
 * closed year as a Spotify-Wrapped-style tap-through story (a few narrative
 * beats building up to the same shareable card). Both end at the same
 * RecapCard, captured to a real PNG via react-native-view-shot and handed to
 * the OS share sheet — the whole point is a card good enough to post.
 *
 * NOTE: react-native-view-shot has native code. It works once the app has
 * been rebuilt (EAS) with it linked — same situation as the pending push
 * build. Until then `capture()` will throw; we catch that and fall back to a
 * text-only share so the feature still works, just without the image.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Share, StyleSheet, Text, View, Modal as RNModal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { Icon, IconName } from './Icon';
import { RecapCard } from './RecapCard';
import { C, Fonts, radius, shadow } from './theme';
import { formatBagsShort } from '../services/impactMetrics';
import { buildRecapCaption, type RecapData } from '../services/recap';

const SLIDE_MS = 3800;

/**
 * Capture the card WHILE it's still mounted, then close the modal, THEN present
 * the OS share sheet. iOS silently no-ops Share.share() if it's called while a
 * React Native <Modal> is still on screen — ShareComposer hit this same bug —
 * so closing first (with a short delay for the dismiss animation) is required,
 * not optional polish.
 */
async function shareCard(shotRef: React.RefObject<ViewShotRef | null>, caption: string, onClose: () => void) {
  let uri: string | undefined;
  try {
    uri = await shotRef.current?.capture?.();
  } catch {
    // Native module not linked yet (pre-rebuild) or capture failed — text-only share still works.
  }
  onClose();
  setTimeout(() => {
    Share.share(uri ? { url: uri, message: caption } : { message: caption }).catch(() => {});
  }, 400);
}

export function RecapModal({
  visible,
  recap,
  displayName,
  subLabel,
  levelName,
  levelColor,
  onClose,
}: {
  visible: boolean;
  recap: RecapData | null;
  displayName?: string;
  subLabel?: string;
  /** Current all-time milestone tier — see RecapCard. */
  levelName?: string;
  levelColor?: string;
  onClose: () => void;
}) {
  if (!recap) return null;
  return recap.range.period === 'year' ? (
    <WrappedStory visible={visible} recap={recap} displayName={displayName} subLabel={subLabel} levelName={levelName} levelColor={levelColor} onClose={onClose} />
  ) : (
    <SimpleRecap visible={visible} recap={recap} displayName={displayName} subLabel={subLabel} levelName={levelName} levelColor={levelColor} onClose={onClose} />
  );
}

// ------------------------------------------------------------ week / month

function SimpleRecap({
  visible,
  recap,
  displayName,
  subLabel,
  levelName,
  levelColor,
  onClose,
}: {
  visible: boolean;
  recap: RecapData;
  displayName?: string;
  subLabel?: string;
  levelName?: string;
  levelColor?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShotRef>(null);
  const [sharing, setSharing] = useState(false);
  const periodWord = recap.range.period === 'week' ? "week's" : "month's";

  const onShare = async () => {
    setSharing(true);
    await shareCard(shotRef, buildRecapCaption(recap, displayName), onClose);
  };

  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.simpleOverlay}>
        <View style={[styles.simpleSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.grabber} />
          <View style={styles.simpleHead}>
            <Text style={styles.simpleTitle}>Your {periodWord} recap is ready</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Icon name="close" size={20} color={C.muted} sw={2} />
            </Pressable>
          </View>

          <View style={styles.cardCenter}>
            <ViewShot ref={shotRef} options={{ format: 'png', quality: 0.95 }}>
              <RecapCard recap={recap} displayName={displayName} subLabel={subLabel} levelName={levelName} levelColor={levelColor} />
            </ViewShot>
          </View>

          <Pressable style={[styles.shareBtn, sharing && { opacity: 0.7 }]} onPress={onShare} disabled={sharing}>
            <Icon name="share" size={18} color="#fff" sw={2} />
            <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share'}</Text>
          </Pressable>
        </View>
      </View>
    </RNModal>
  );
}

// ------------------------------------------------------------------ year

type Beat =
  | { kind: 'intro' }
  | { kind: 'path' }
  | { kind: 'stats' }
  | { kind: 'card' };

const BEATS: Beat[] = [{ kind: 'intro' }, { kind: 'path' }, { kind: 'stats' }, { kind: 'card' }];

function WrappedStory({
  visible,
  recap,
  displayName,
  subLabel,
  levelName,
  levelColor,
  onClose,
}: {
  visible: boolean;
  recap: RecapData;
  displayName?: string;
  subLabel?: string;
  levelName?: string;
  levelColor?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const shotRef = useRef<ViewShotRef>(null);
  const [index, setIndex] = useState(0);
  const [sharing, setSharing] = useState(false);
  const progress = useRef(BEATS.map(() => new Animated.Value(0))).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLast = index === BEATS.length - 1;

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    progress.forEach((v) => v.setValue(0));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    progress.forEach((v, i) => v.setValue(i < index ? 1 : 0));
    if (timer.current) clearTimeout(timer.current);
    if (isLast) return; // last beat waits for the user (share / close)

    const anim = Animated.timing(progress[index], {
      toValue: 1,
      duration: SLIDE_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) setIndex((i) => Math.min(i + 1, BEATS.length - 1));
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index]);

  const advance = (dir: 1 | -1) => {
    if (timer.current) clearTimeout(timer.current);
    setIndex((i) => Math.max(0, Math.min(BEATS.length - 1, i + dir)));
  };

  const onShare = async () => {
    setSharing(true);
    await shareCard(shotRef, buildRecapCaption(recap, displayName), onClose);
  };

  const beat = BEATS[index];
  const { stats, range } = recap;

  return (
    <RNModal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.story, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.progressRow}>
          {BEATS.map((_, i) => (
            <View key={i} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: progress[i].interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  },
                ]}
              />
            </View>
          ))}
        </View>

        <Pressable onPress={onClose} hitSlop={12} style={styles.storyClose}>
          <Icon name="close" size={22} color="#fff" sw={2} />
        </Pressable>

        <View style={styles.storyBody}>
          {beat.kind === 'intro' && (
            <StoryBeat icon="leaf" kicker={range.label.toUpperCase()} big={`${range.label} in Pick`} caption="Here's the ground you covered this year." />
          )}
          {beat.kind === 'path' && (
            <StoryBeat
              icon="route"
              kicker="YOUR PATH"
              big={stats.neighborhoods > 0 ? `${stats.neighborhoods} neighborhood${stats.neighborhoods === 1 ? '' : 's'}` : 'On the move'}
              caption={
                stats.activeDays > 0
                  ? `You were out cleaning on ${stats.activeDays} different day${stats.activeDays === 1 ? '' : 's'}.`
                  : 'Every walk adds to your path.'
              }
            />
          )}
          {beat.kind === 'stats' && (
            <StoryBeat
              icon="bag"
              kicker="YOUR IMPACT"
              big={`${stats.pickups.toLocaleString()} pieces`}
              caption={`That's about ${formatBagsShort(stats.bags)} bag${stats.bags >= 1.25 ? 's' : ''} off the street, across ${stats.cleanups.toLocaleString()} cleanup${stats.cleanups === 1 ? '' : 's'}.`}
            />
          )}
          {beat.kind === 'card' && (
            <View style={styles.cardCenter}>
              <ViewShot ref={shotRef} options={{ format: 'png', quality: 0.95 }}>
                <RecapCard recap={recap} displayName={displayName} subLabel={subLabel} levelName={levelName} levelColor={levelColor} />
              </ViewShot>
            </View>
          )}
        </View>

        {isLast ? (
          <Pressable style={[styles.shareBtn, sharing && { opacity: 0.7 }]} onPress={onShare} disabled={sharing}>
            <Icon name="share" size={18} color="#fff" sw={2} />
            <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share your year'}</Text>
          </Pressable>
        ) : (
          <View style={styles.tapZones} pointerEvents="box-none">
            <Pressable style={styles.tapZoneLeft} onPress={() => advance(-1)} />
            <Pressable style={styles.tapZoneRight} onPress={() => advance(1)} />
          </View>
        )}
      </View>
    </RNModal>
  );
}

function StoryBeat({ icon, kicker, big, caption }: { icon: IconName; kicker: string; big: string; caption: string }) {
  return (
    <View style={styles.beat}>
      <View style={styles.beatIconWell}>
        <Icon name={icon} size={26} color="#fff" sw={1.8} />
      </View>
      <Text style={styles.beatKicker}>{kicker}</Text>
      <Text style={styles.beatBig} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>
        {big}
      </Text>
      <Text style={styles.beatCaption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // simple (week/month) sheet
  simpleOverlay: { flex: 1, backgroundColor: 'rgba(15,47,102,0.5)', justifyContent: 'flex-end' },
  simpleSheet: { backgroundColor: C.white, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: 12, paddingHorizontal: 20 },
  grabber: { width: 40, height: 5, borderRadius: 999, backgroundColor: C.border, alignSelf: 'center', marginBottom: 12 },
  simpleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  simpleTitle: { fontFamily: Fonts.headlineBold, fontSize: 19, color: C.dark },
  cardCenter: { alignItems: 'center', marginBottom: 8 },

  shareBtn: {
    marginTop: 18,
    backgroundColor: C.primary,
    borderRadius: radius.button,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow.raised,
  },
  shareBtnText: { color: '#fff', fontFamily: Fonts.headlineBold, fontSize: 17, letterSpacing: 0.5, textTransform: 'uppercase' },

  // year "Wrapped" story
  story: { flex: 1, backgroundColor: C.dark, paddingHorizontal: 16 },
  progressRow: { flexDirection: 'row', gap: 5, marginBottom: 14 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff' },
  storyClose: { position: 'absolute', top: 54, right: 20, zIndex: 5, padding: 4 },

  storyBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  beat: { alignItems: 'center', paddingHorizontal: 20 },
  beatIconWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  beatKicker: { fontFamily: Fonts.bodyBold, fontSize: 13, letterSpacing: 1, color: C.heroSub },
  beatBig: { fontFamily: Fonts.displayBold, fontSize: 38, color: '#fff', letterSpacing: -0.6, marginTop: 10, textAlign: 'center' },
  beatCaption: { fontFamily: Fonts.body, fontSize: 15, color: C.heroSub2, marginTop: 14, textAlign: 'center', lineHeight: 21, maxWidth: 280 },

  tapZones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  tapZoneLeft: { flex: 1 },
  tapZoneRight: { flex: 2 },
});
