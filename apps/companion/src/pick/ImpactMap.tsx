/**
 * ImpactMap — a small, non-interactive "map snapshot" for impact posts and
 * recaps. Renders the post's `coverage` (walked block polylines + optional
 * cleaned-tile centers) on real streets, using the same Leaflet + CARTO
 * light-tile setup as AreaPreview/the Map tab, so a path reads against
 * actual geography instead of floating on a blank rectangle.
 *
 * NOTE: this used to be a dependency-free react-native-svg drawing
 * specifically to avoid a WebView in feed cards and recap share cards. That
 * tradeoff was deliberately given up here in favor of real map context —
 * know the costs: every card is now its own WebView (real cost in a feed
 * that renders several at once), and RecapCard/GroupRecapCard/ImpactComposer
 * capture this via react-native-view-shot for the share sheet — WKWebView
 * content is known to sometimes capture blank on iOS. Verify the actual
 * share flow on-device after any change here.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ImpactCoverage } from '../services/firebaseDatabase';
import { C } from './theme';

export function ImpactMap({
  coverage,
  height = 170,
}: {
  coverage: ImpactCoverage;
  height?: number;
  /** No longer used — Leaflet sizes itself from the WebView's actual layout
   *  width, unlike the old fixed SVG viewBox. Kept only so existing call
   *  sites that still pass it don't need editing. */
  width?: number;
}) {
  const html = useMemo(() => {
    const [minLat, minLon, maxLat, maxLon] = coverage.bbox || [0, 0, 0, 0];
    const hasBbox = Number.isFinite(minLat) && (maxLat - minLat > 0 || maxLon - minLon > 0);
    // Rough diagonal of the overall bbox, in degrees — used below to size the
    // "is this block too short to read as a line at this zoom" threshold.
    const bboxDiag = Math.hypot(maxLat - minLat, maxLon - minLon) || 1e-5;

    const blocks = (coverage.blocks || []).filter((b) => Array.isArray(b) && b.length >= 2);
    // A short, localized cleanup (pause at one spot, pick up litter, move on)
    // can be a tiny fraction of the overall bbox — still a real Leaflet
    // polyline, but visually indistinguishable from nothing at that zoom.
    // Mark it with a small circle instead of a line so it doesn't just vanish.
    const lines: [number, number][][] = [];
    const shortMarks: [number, number][] = [];
    for (const b of blocks) {
      let lo = Infinity, la = Infinity, hiLo = -Infinity, hiLa = -Infinity;
      for (const [lat, lon] of b) {
        lo = Math.min(lo, lon); hiLo = Math.max(hiLo, lon);
        la = Math.min(la, lat); hiLa = Math.max(hiLa, lat);
      }
      const span = Math.hypot(hiLa - la, hiLo - lo);
      if (span < bboxDiag * 0.015) {
        shortMarks.push(b[Math.floor(b.length / 2)]);
      } else {
        lines.push(b);
      }
    }

    const tiles = coverage.tiles || [];

    // Callers (recap.ts, impactShare.ts) stamp a tiny non-zero fallback bbox
    // — e.g. [0,0,1e-4,1e-4], Null Island — when there's no real geometry yet,
    // purely so their OWN projection math doesn't divide by zero. That bbox
    // is "valid" by the hasBbox check above, but there's nothing to actually
    // draw there — rendering it would show a real map, just centered on a
    // patch of empty ocean. Gate on actual content instead of bbox validity;
    // callers already render their own empty-state overlay (a route icon)
    // when they have no coverage, same as before this was a real WebView.
    if (lines.length === 0 && shortMarks.length === 0 && tiles.length === 0) return '';

    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:${C.cream}; }
  .leaflet-control-attribution, .leaflet-control-zoom { display: none; }
</style></head><body><div id="map"></div><script>
  var map = L.map('map', {
    zoomControl: false, attributionControl: false,
    dragging: false, touchZoom: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  var lines = ${JSON.stringify(lines)};
  var shortMarks = ${JSON.stringify(shortMarks)};
  var tiles = ${JSON.stringify(tiles)};
  var bounds = [];

  lines.forEach(function (pts) {
    L.polyline(pts, { color: '${C.accent}', weight: 3, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    bounds = bounds.concat(pts);
  });
  shortMarks.forEach(function (p) {
    L.circleMarker(p, { radius: 5, color: '${C.accent}', fillColor: '${C.accent}', fillOpacity: 1, weight: 0 }).addTo(map);
    bounds.push(p);
  });
  tiles.forEach(function (p) {
    L.circleMarker(p, { radius: 3.2, color: '${C.accent}', fillColor: '${C.accent}', fillOpacity: 0.35, weight: 0, opacity: 0.35 }).addTo(map);
    bounds.push(p);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [10, 10] });
  } else if (${hasBbox}) {
    map.fitBounds([[${minLat}, ${minLon}], [${maxLat}, ${maxLon}]], { padding: [10, 10] });
  } else {
    map.setView([0, 0], 2);
  }
</script></body></html>`;
  }, [coverage]);

  return (
    <View style={[styles.wrap, { height }]}>
      {!!html && (
        <WebView
          source={{ html }}
          style={{ flex: 1 }}
          scrollEnabled={false}
          pointerEvents="none"
          originWhitelist={['*']}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: C.cream, overflow: 'hidden' },
});
