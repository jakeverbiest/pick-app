/**
 * ImpactMap — a tiny, dependency-free "map snapshot" for impact posts.
 *
 * The full map is a Leaflet WebView (heavy, interactive, per-user). For a feed
 * card we don't want that — we want a small, static picture that re-renders
 * from the coords stored on the post. This projects a post's `coverage`
 * (adopted/cleaned block polylines + optional cleaned-tile centers) into a
 * fixed viewBox and draws it with react-native-svg. No image files, no network.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Polyline, Circle, G } from 'react-native-svg';
import type { ImpactCoverage } from '../services/firebaseDatabase';
import { C } from './theme';

export function ImpactMap({
  coverage,
  height = 170,
  width,
}: {
  coverage: ImpactCoverage;
  height?: number;
  width?: number;
}) {
  const W = width ?? 340;
  const H = height;
  const PAD = 10;

  const { polylines, dots } = useMemo(() => {
    const [minLat, minLon, maxLat, maxLon] = coverage.bbox || [0, 0, 0, 0];
    // Guard degenerate bboxes (single point / empty) so we never divide by 0.
    const latSpan = Math.max(maxLat - minLat, 1e-5);
    const lonSpan = Math.max(maxLon - minLon, 1e-5);
    // Keep aspect ratio roughly true: longitude degrees shrink with latitude.
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
    const dataW = lonSpan * lonScale;
    const dataH = latSpan;
    const scale = Math.min((W - PAD * 2) / dataW, (H - PAD * 2) / dataH);
    const offX = (W - dataW * scale) / 2;
    const offY = (H - dataH * scale) / 2;

    const project = (lat: number, lon: number): [number, number] => {
      const x = offX + (lon - minLon) * lonScale * scale;
      // SVG y grows downward; latitude grows upward → invert.
      const y = offY + (maxLat - lat) * scale;
      return [x, y];
    };

    const polylines = (coverage.blocks || [])
      .filter((b) => Array.isArray(b) && b.length >= 2)
      .map((b) => b.map(([lat, lon]) => project(lat, lon).map((n) => n.toFixed(1)).join(',')).join(' '));

    const dots = (coverage.tiles || []).map(([lat, lon]) => project(lat, lon));

    return { polylines, dots };
  }, [coverage, W, H]);

  return (
    <View style={[styles.wrap, { height: H }]}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} rx={0} fill={C.cream} />
        <G>
          {dots.map(([x, y], i) => (
            <Circle key={`t${i}`} cx={x} cy={y} r={3.2} fill={C.accent} opacity={0.35} />
          ))}
          {polylines.map((pts, i) => (
            <Polyline
              key={`b${i}`}
              points={pts}
              fill="none"
              stroke={C.primary}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: C.cream, overflow: 'hidden' },
});
