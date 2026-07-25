/**
 * "Who's cleaning now" banner — a live pulse of community activity.
 * Polls presence while mounted and shows how many OTHER pickers are mid-walk
 * right now, plus the neighborhoods they're in. Renders nothing when it's quiet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, Easing } from 'react-native';
import { getLiveWalks, type LiveWalk } from '../services/presence';
import { getAuthService } from '../services/authService';
import { C, radius } from './theme';

export function LiveNow({ pollMs = 30000 }: { pollMs?: number }) {
  const [walks, setWalks] = useState<LiveWalk[]>([]);
  const pulse = useRef(new Animated.Value(0.4)).current;
  const meUid = getAuthService().getCurrentUser()?.uid;

  const refresh = useCallback(async () => {
    const all = await getLiveWalks();
    setWalks(all.filter((w) => w.userId !== meUid)); // show OTHERS' activity
  }, [meUid]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (walks.length === 0) return null;

  const n = walks.length;
  // Unique neighborhoods, up to three, for the "in …" line.
  const hoods = Array.from(new Set(walks.map((w) => w.neighborhood).filter(Boolean))).slice(0, 3);
  const where = hoods.length ? `in ${hoods.join(', ')}` : 'across your area';

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
      <Text style={styles.text}>
        <Text style={styles.strong}>{n} {n === 1 ? 'neighbor is' : 'neighbors are'}</Text> cleaning right now — {where}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#EAF3E1',
    borderRadius: radius.card,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.accent },
  text: { flex: 1, fontSize: 13.5, color: C.primary, lineHeight: 18 },
  strong: { fontWeight: '700' },
});
