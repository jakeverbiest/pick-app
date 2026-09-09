/**
 * ImpactMap — a small, non-interactive "map snapshot" for impact posts and
 * recaps. Renders the post's `coverage` (walked block polylines + optional
 * cleaned-tile centers) on real streets, so a path reads against actual
 * geography instead of floating on a blank rectangle.
 *
 * MIGRATED TO MAPLIBRE GL + CARTO's Positron VECTOR style, 2026-09-08 — the
 * first of the four app maps off Leaflet + raster tiles. The other three
 * (AreaPreview, challenge/new, the Map tab) are still Leaflet; both basemap
 * constants live in ./basemap while that is true. See
 * docs/VECTOR_BASEMAP_MIGRATION_SCOPE.md.
 *
 * ⚠️ VERIFY THE SHARE FLOW ON-DEVICE BEFORE TRUSTING THIS. This component is
 * captured by react-native-view-shot from RecapCard/GroupRecapCard/
 * ImpactComposer, and WKWebView content was ALREADY known to sometimes capture
 * blank on iOS. Vector rendering draws to a WebGL canvas rather than to
 * composited raster tiles, which is a strictly harder case for that capture
 * path — if share cards come out with an empty map, this migration is the
 * first thing to suspect, and reverting this file alone is enough to test it.
 *
 * NOTE: this used to be a dependency-free react-native-svg drawing
 * specifically to avoid a WebView in feed cards and recap share cards. That
 * tradeoff was deliberately given up in favor of real map context — every card
 * is now its own WebView, a real cost in a feed that renders several at once.
 */
import React, { useMemo } from 'react';
import { BASEMAP_STYLE_URL, MAPLIBRE_ANCHOR_FN } from './basemap';
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

    // MapLibre GL + CARTO's Positron VECTOR style — first of the four app maps
    // ported off Leaflet + raster tiles (VECTOR_BASEMAP_MIGRATION_SCOPE.md §5,
    // step 1). This one first because it is the smallest real map, so the
    // source/layer pattern is established somewhere cheap.
    //
    // COORDINATE ORDER IS THE THING TO WATCH. Leaflet takes [lat, lon];
    // MapLibre and GeoJSON take [lon, lat]. Every point below is flipped once,
    // at the boundary, and the incoming `lines`/`shortMarks`/`tiles` arrays are
    // left in the app's own [lat, lon] convention so nothing upstream changes.
    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:${C.cream}; }
  .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { display: none; }
</style></head><body><div id="map"></div><script>
${MAPLIBRE_ANCHOR_FN}

  var lines = ${JSON.stringify(lines)};
  var shortMarks = ${JSON.stringify(shortMarks)};
  var tiles = ${JSON.stringify(tiles)};
  var flip = function (p) { return [p[1], p[0]]; };

  var map = new maplibregl.Map({
    container: 'map',
    style: '${BASEMAP_STYLE_URL}',
    center: [0, 0],
    zoom: 1,
    // Static preview: this WebView already has pointerEvents="none", but
    // interactive:false also stops MapLibre installing handlers at all.
    interactive: false,
    attributionControl: false
  });

  map.on('load', function () {
    var anchor = pickOverlayAnchor(map);
    var bounds = [];
    var push = function (p) { bounds.push(flip(p)); };

    if (lines.length) {
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection',
        features: lines.map(function (pts) {
          pts.forEach(push);
          return { type: 'Feature', properties: {},
                   geometry: { type: 'LineString', coordinates: pts.map(flip) } };
        }) } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '${C.accent}', 'line-width': 3 } }, anchor);
    }

    // Two dot layers, matching the previous circleMarker radii and opacities:
    // solid marks for short segments, faint ones for covered tiles.
    var dotLayer = function (id, pts, radius, opacity) {
      if (!pts.length) return;
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection',
        features: pts.map(function (p) {
          push(p);
          return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: flip(p) } };
        }) } });
      map.addLayer({ id: id, type: 'circle', source: id,
        paint: { 'circle-radius': radius, 'circle-color': '${C.accent}', 'circle-opacity': opacity } }, anchor);
    };
    dotLayer('shortMarks', shortMarks, 5, 1);
    dotLayer('tiles', tiles, 3.2, 0.35);

    if (bounds.length) {
      var b = bounds.reduce(function (acc, c) {
        return [Math.min(acc[0], c[0]), Math.min(acc[1], c[1]),
                Math.max(acc[2], c[0]), Math.max(acc[3], c[1])];
      }, [180, 90, -180, -90]);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 10, duration: 0, maxZoom: 17 });
    } else if (${hasBbox}) {
      map.fitBounds([[${minLon}, ${minLat}], [${maxLon}, ${maxLat}]], { padding: 10, duration: 0, maxZoom: 17 });
    }
  });
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
