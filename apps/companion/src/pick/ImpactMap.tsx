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

  const { polylines, dots, shortMarks } = useMemo(() => {
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

    // A short, localized cleanup (pause at one spot, pick up litter, move on)
    // can project to just a few pixels once it shares a bbox with a whole
    // week's spread-out walks — a real Polyline still draws, but it's
    // effectively invisible at that scale, so the block silently vanishes
    // instead of reading as "something happened here." Below MIN_VISIBLE_PX,
    // mark it with a small circle at its midpoint instead of a sub-pixel line.
    const MIN_VISIBLE_PX = 6;
    const polylines: string[] = [];
    const shortMarks: [number, number][] = [];
    for (const b of coverage.blocks || []) {
      if (!Array.isArray(b) || b.length < 2) continue;
      const projected = b.map(([lat, lon]) => project(lat, lon));
      let maxSpan = 0;
      for (let i = 1; i < projected.length; i++) {
        maxSpan = Math.max(maxSpan, Math.hypot(projected[i][0] - projected[0][0], projected[i][1] - projected[0][1]));
      }
      if (maxSpan < MIN_VISIBLE_PX) {
        const mid = projected[Math.floor(projected.length / 2)];
        shortMarks.push(mid);
      } else {
        polylines.push(projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
      }
    }

    const dots = (coverage.tiles || []).map(([lat, lon]) => project(lat, lon));

    return { polylines, dots, shortMarks };
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
              stroke={C.accent}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {shortMarks.map(([x, y], i) => (
            <Circle key={`s${i}`} cx={x} cy={y} r={4.5} fill={C.accent} />
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: C.cream, overflow: 'hidden' },
});
