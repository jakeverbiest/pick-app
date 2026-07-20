import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../src/constants/colors';
import { Icon } from '../src/pick/Icon';

// Keeps the same key + /safety route as before, so the first-run gate in
// index.tsx is unchanged — this screen just became a short tutorial that ends
// with the safety acknowledgment as its final card.
export const SAFETY_ACK_KEY = 'pick_safety_ack_v1';

const TIPS: Array<{ title: string; body: string }> = [
  { title: 'Wear gloves', body: 'Always. A grabber tool keeps your hands even further from trouble.' },
  { title: 'Watch traffic', body: 'Stay on sidewalks, face oncoming traffic near roads, and never reach into the street for an item.' },
  { title: 'Never pick up sharps or hazards', body: 'Needles, broken glass, chemicals, dead animals, or anything biological — leave them and report to 311.' },
  { title: 'Mind the weather', body: 'Hydrate in heat, watch for ice, and skip the walk in storms. The trash will wait.' },
  { title: 'Respect property', body: 'Public spaces only — no reaching into private yards, vehicles, or posted areas.' },
  { title: 'Wash up after', body: 'Soap and water when you get home, every time, gloves or not.' },
];

const LAST = 4;

// Street-freshness legend — mirrors the map's "vitality fade": bright green
// when just cleaned, quietly graying as it ages. Never-cleaned is a hollow ring
// (dashed on the map) so "blank" reads differently from "cleaned long ago".
const FRESHNESS: Array<{ color: string; label: string; sub: string; hollow?: boolean }> = [
  { color: '#2FB457', label: 'Just cleaned', sub: 'fresh in the last few days' },
  { color: '#F2C500', label: 'Deteriorating', sub: 'about a week on' },
  { color: '#BE5528', label: 'Needs a pass', sub: 'unclean — go get it' },
  { color: '#C4C8BD', label: 'Not cleaned yet', sub: 'faded to blank', hollow: true },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const finish = async () => {
    await AsyncStorage.setItem(SAFETY_ACK_KEY, String(Date.now()));
    router.replace('/(tabs)/map');
  };

  const goTo = (p: number) => {
    scrollRef.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  };

  const onNext = () => (page < LAST ? goTo(page + 1) : finish());

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        {page < LAST ? (
          <TouchableOpacity onPress={() => goTo(LAST)} hitSlop={10}>
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.pager}
      >
        {/* 1 — Welcome */}
        <ScrollView style={{ width }} contentContainerStyle={styles.pageCenter} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <Image source={require('../assets/images/logo-mark.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Welcome to PICK</Text>
          <Text style={styles.body}>
            Start by picking your neighborhood or city, then check the map to see how fresh your streets
            are — bright where they've just been cleaned, fading where they need a pass.
          </Text>
          <Text style={styles.note}>Tap any street or neighborhood to see how long since its last pick.</Text>
        </ScrollView>

        {/* 2 — Track */}
        <ScrollView style={{ width }} contentContainerStyle={styles.pageCenter} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <View style={styles.well}><Icon name="route" size={40} color={COLORS.sage} sw={1.7} /></View>
          <Text style={styles.title}>Start, then just walk</Text>
          <Text style={styles.body}>
            On the Map tab, tap <Text style={styles.bold}>Start cleanup</Text>, drop your phone in your
            pocket, and go. PICK counts your pickups automatically with your phone's motion sensors — no
            buttons while you walk. Tap <Text style={styles.bold}>Stop &amp; save</Text> when you're done
            and report your bag.
          </Text>
          <Text style={styles.note}>You have to start it — nothing is tracked until you tap Start, and counts are a friendly estimate, not exact.</Text>
        </ScrollView>

        {/* 3 — Explore */}
        <ScrollView style={{ width }} contentContainerStyle={styles.pageCenter} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <View style={styles.well}><Icon name="pin" size={40} color={COLORS.sage} sw={1.7} /></View>
          <Text style={styles.title}>Watch your streets turn green</Text>
          <Text style={styles.body}>
            Tap your neighborhood on the map to see how clean it is. Your running totals live on the{' '}
            <Text style={styles.bold}>Impact</Text> tab, and you can climb the <Text style={styles.bold}>Ranks</Text>{' '}
            with friends and teams.
          </Text>
        </ScrollView>

        {/* 4 — Street freshness */}
        <ScrollView style={{ width }} contentContainerStyle={styles.pageCenter} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <View style={styles.well}><Icon name="clock" size={40} color={COLORS.sage} sw={1.7} /></View>
          <Text style={styles.title}>Fresh streets, together</Text>
          <Text style={styles.body}>
            Every street you clean glows green, then slowly fades as litter drifts back. The map's colors
            show what's fresh and what needs a pass — so when neighbors pitch in, you keep the whole area
            green together.
          </Text>
          <View style={styles.legend}>
            {FRESHNESS.map((f) => (
              <View key={f.label} style={styles.legendRow}>
                <View style={[styles.legendDot, f.hollow ? { borderWidth: 2, borderColor: f.color, backgroundColor: 'transparent' } : { backgroundColor: f.color }]} />
                <Text style={styles.legendLabel}>{f.label}</Text>
                <Text style={styles.legendSub}>{f.sub}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* 5 — Safety (acknowledgment) */}
        <ScrollView style={{ width }} contentContainerStyle={styles.pageTop} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { marginTop: 8 }]}>Before your first cleanup</Text>
          <Text style={[styles.body, { marginBottom: 6 }]}>
            Picking up litter is a real-world activity with real-world risks. A few rules keep it fun:
          </Text>
          {TIPS.map((t) => (
            <View key={t.title} style={styles.tip}>
              <View style={styles.bullet} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tipTitle}>{t.title}</Text>
                <Text style={styles.tipBody}>{t.body}</Text>
              </View>
            </View>
          ))}
          <Text style={styles.disclaimer}>
            You participate at your own risk — PICK tracks your impact but can't assess the safety of any
            location or item. Full details in You → Terms of Service.
          </Text>
        </ScrollView>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity style={styles.cta} onPress={onNext} activeOpacity={0.9}>
          <Text style={styles.ctaText}>{page === LAST ? "I understand — let's pick" : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream },
  topBar: { height: 44, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 20 },
  skip: { fontSize: 15, fontWeight: '600', color: COLORS.mutedSage },
  pager: { flex: 1 },

  pageCenter: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30, paddingBottom: 24 },
  pageTop: { flexGrow: 1, paddingHorizontal: 26, paddingBottom: 24 },

  logo: { width: 92, height: 92, borderRadius: 22, marginBottom: 20 },
  well: {
    width: 88, height: 88, borderRadius: 26, backgroundColor: COLORS.light,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.darkSage, textAlign: 'center', letterSpacing: -0.4, marginBottom: 12 },
  body: { fontSize: 15, color: '#5C6B54', textAlign: 'center', lineHeight: 22 },
  bold: { fontWeight: '700', color: COLORS.darkSage },
  note: { fontSize: 13, color: COLORS.mutedSage, textAlign: 'center', marginTop: 14, fontStyle: 'italic' },

  legend: { width: '100%', marginTop: 22, gap: 14 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot: { width: 14, height: 14, borderRadius: 7 },
  legendLabel: { fontSize: 15, fontWeight: '700', color: COLORS.darkSage },
  legendSub: { fontSize: 13, color: COLORS.mutedSage, flexShrink: 1 },

  tip: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 14, alignItems: 'flex-start' },
  bullet: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.sage, marginTop: 6 },
  tipTitle: { fontSize: 15, fontWeight: '700', color: COLORS.darkSage },
  tipBody: { fontSize: 13, color: '#666', lineHeight: 18, marginTop: 2 },
  disclaimer: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 18, lineHeight: 16 },

  footer: { paddingHorizontal: 24, paddingTop: 12, gap: 16 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D8D8D2' },
  dotActive: { width: 20, backgroundColor: COLORS.sage },
  cta: { backgroundColor: COLORS.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
