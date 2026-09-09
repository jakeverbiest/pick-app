/**
 * A small, non-interactive map of a challenge's drawn boundary — real streets
 * and labels, so you can actually recognize the place next to the words
 * "Carroll Gardens", not just an abstract shape. No pan/zoom — it's a preview
 * inside a card, not something to navigate.
 *
 * MIGRATED TO MAPLIBRE GL + CARTO's Positron VECTOR style, 2026-09-08 (step 2
 * of VECTOR_BASEMAP_MIGRATION_SCOPE.md §5). The Map tab and challenge/new are
 * still Leaflet, so the header's old "same tiles as the Map tab" claim no
 * longer holds and has been dropped rather than left to mislead.
 */
import { useMemo } from 'react';
import { BASEMAP_STYLE_URL, MAPLIBRE_ANCHOR_FN } from './basemap';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { radius } from './theme';

export function AreaPreview({
  ring,
  height = 150,
}: {
  ring: [number, number][];
  height?: number;
}) {
  const html = useMemo(() => {
    if (!ring || ring.length < 3) return '';
    // `ring` stays in the app's [lat, lon] convention; flipped once here,
    // because MapLibre and GeoJSON take [lon, lat].
    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#FFFFFF; }
  .maplibregl-ctrl-attrib, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { display: none; }
</style></head><body><div id="map"></div><script>
${MAPLIBRE_ANCHOR_FN}

  var ring = ${JSON.stringify(ring)}.map(function (p) { return [p[1], p[0]]; });
  var map = new maplibregl.Map({
    container: 'map',
    style: '${BASEMAP_STYLE_URL}',
    center: ring[0],
    zoom: 12,
    interactive: false,
    attributionControl: false
  });

  map.on('load', function () {
    var anchor = pickOverlayAnchor(map);
    // GeoJSON polygons must close: first point repeated as the last.
    var closed = ring.concat([ring[0]]);
    map.addSource('area', { type: 'geojson', data: {
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [closed] } } });
    map.addLayer({ id: 'area-fill', type: 'fill', source: 'area',
      paint: { 'fill-color': '#4B7A54', 'fill-opacity': 0.18 } }, anchor);
    map.addLayer({ id: 'area-line', type: 'line', source: 'area',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#0F2F66', 'line-width': 3 } }, anchor);

    // Leaflet's fitBounds(...).pad(0.2) grew the box by 20%; MapLibre has no
    // pad(), so the equivalent is padding in pixels.
    var b = ring.reduce(function (acc, c) {
      return [Math.min(acc[0], c[0]), Math.min(acc[1], c[1]),
              Math.max(acc[2], c[0]), Math.max(acc[3], c[1])];
    }, [180, 90, -180, -90]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 0, maxZoom: 16 });
  });
</script></body></html>`;
  }, [ring]);

  if (!html) return null;

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        source={{ html }}
        style={{ flex: 1 }}
        scrollEnabled={false}
        pointerEvents="none"
        originWhitelist={['*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    borderRadius: radius.chip,
    overflow: 'hidden',
  },
});
