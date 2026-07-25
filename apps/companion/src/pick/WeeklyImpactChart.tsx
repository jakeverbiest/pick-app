/**
 * "Your progress" — a small 8-week bar chart of pickups per week, so the Impact
 * tab shows momentum over time, not just lifetime totals. Drawn with
 * react-native-svg (already a dependency); no network beyond the cleanup fetch.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { Card } from './ui';
import { C } from './theme';
import { getDatabase } from '../services/database';

const WEEKS = 8;
const DAY = 86400000;

export function WeeklyImpactChart() {
  const [cleanups, setCleanups] = useState<any[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDatabase();
        setCleanups((await db.getCleanups(500)) || []);
      } catch {
        setCleanups([]);
      }
    })();
  }, []);

  const buckets = useMemo(() => {
    const b = new Array(WEEKS).fill(0);
    if (!cleanups) return b;
    const now = Date.now();
    for (const c of cleanups) {
      const ms = (c?.timestamp ?? 0) * 1000;
      const weeksAgo = Math.floor((now - ms) / (7 * DAY));
      if (weeksAgo >= 0 && weeksAgo < WEEKS) {
        b[WEEKS - 1 - weeksAgo] += Number(c?.items_count) || 0; // right = this week
      }
    }
    return b;
  }, [cleanups]);

  if (!cleanups) return null;
  const total = buckets.reduce((s, v) => s + v, 0);
  if (total === 0) return null; // nothing to show yet — keep the tab clean

  const max = Math.max(...buckets, 1);
  const thisWeek = buckets[WEEKS - 1];

  // Chart geometry
  const W = 320, H = 96, PAD_B = 4, gap = 8;
  const barW = (W - gap * (WEEKS - 1)) / WEEKS;

  return (
    <Card style={{ marginTop: 12 }}>
      <View style={styles.head}>
        <Text style={styles.title}>Your progress</Text>
        <Text style={styles.sub}>{thisWeek} this week</Text>
      </View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {buckets.map((v, i) => {
          const h = Math.max(2, ((v / max) * (H - PAD_B - 6)));
          const x = i * (barW + gap);
          const y = H - PAD_B - h;
          const isNow = i === WEEKS - 1;
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
              fill={isNow ? C.primary : C.tint}
            />
          );
        })}
      </Svg>
      <Text style={styles.axis}>{WEEKS} weeks ago → this week · pickups</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: C.dark },
  sub: { fontSize: 13, fontWeight: '700', color: C.primary },
  axis: { fontSize: 11.5, color: C.muted, marginTop: 8, textAlign: 'center' },
});
