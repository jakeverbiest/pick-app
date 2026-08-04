/**
 * A small, non-interactive map of a challenge's drawn boundary — real streets
 * and labels (same Leaflet/CARTO tiles as the Map tab and BoundaryDrawer), so
 * you can actually recognize the place next to the words "Carroll Gardens",
 * not just an abstract shape. No pan/zoom — it's a preview inside a card, not
 * something to navigate.
 */
import { useMemo } from 'react';
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
    return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#FFFFFF; }
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
  var poly = L.polygon(${JSON.stringify(ring)}, {
    color: '#0F2F66', weight: 3, fillColor: '#4B7A54', fillOpacity: 0.18
  }).addTo(map);
  map.fitBounds(poly.getBounds().pad(0.2));
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
