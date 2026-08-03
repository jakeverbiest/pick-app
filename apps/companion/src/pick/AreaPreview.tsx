/**
 * A tiny SVG rendering of a challenge's drawn boundary — no map tiles, no
 * WebView, no network. Enough to recognise the shape of the area you're
 * looking at next to the words "Carroll Gardens".
 *
 * Same trick as the impact-post map snapshot: normalise lat/lon into the
 * viewBox, correct longitude for the latitude so the shape isn't stretched.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C, radius } from './theme';

export function AreaPreview({
  ring,
  height = 150,
}: {
  ring: [number, number][];
  height?: number;
}) {
  const d = useMemo(() => {
    if (!ring || ring.length < 3) return '';
    const lats = ring.map((p) => p[0]);
    const lons = ring.map((p) => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);

    // A degree of longitude shrinks with latitude; without this the shape
    // leans badly at NYC latitudes.
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

    const w = Math.max(1e-6, (maxLon - minLon) * lonScale);
    const h = Math.max(1e-6, maxLat - minLat);
    const span = Math.max(w, h);
    const pad = 6;
    const size = 100 - pad * 2;

    const pts = ring.map(([lat, lon]) => {
      const x = pad + ((lon - minLon) * lonScale) / span * size + (span - w) / span * size / 2;
      // SVG y grows downward; latitude grows north, so flip it.
      const y = pad + (1 - (lat - minLat) / span) * size - (span - h) / span * size / 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return `M${pts.join('L')}Z`;
  }, [ring]);

  if (!d) return null;

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <Path d={d} fill={C.accent} fillOpacity={0.14} stroke={C.primary} strokeWidth={1.6} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: C.tint,
    borderRadius: radius.chip,
    overflow: 'hidden',
    padding: 6,
  },
});
