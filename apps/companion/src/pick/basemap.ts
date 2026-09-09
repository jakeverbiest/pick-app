/**
 * The one CARTO basemap URL.
 *
 * WHY THIS EXISTS. The same tile URL was hand-copied into four WebViews —
 * app/(tabs)/map.tsx, app/challenge/new.tsx, src/pick/AreaPreview.tsx and
 * src/pick/ImpactMap.tsx. Four copies of a string that must carry an API key
 * is how one ends up without it, and a missing key does not fail: CARTO still
 * serves the tile, with "API KEY REQUIRED" printed diagonally across it. That
 * is a silent, shipped-to-users failure, and it has bitten this project
 * repeatedly (31 Aug native build, 1 Sep OTA twice).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DO NOT put `process.env.EXPO_PUBLIC_CARTO_API_KEY` behind a variable, a
 * ternary, or any other indirection. Write the expression inline, exactly as
 * below.
 *
 * Expo inlines EXPO_PUBLIC_* by TEXTUAL SUBSTITUTION of the literal
 * `process.env.EXPO_PUBLIC_…` expression at build time. It is not a real
 * runtime lookup. The first version of this file did:
 *
 *     const KEY = process.env.EXPO_PUBLIC_CARTO_API_KEY;
 *     export const BASEMAP_URL = `…png${KEY ? `?key=${KEY}` : ''}`;
 *
 * which is not substituted, so KEY was undefined, the ternary chose the empty
 * branch, and the published bundle contained a URL ending at `.png` with no
 * key parameter at all — removing the key from ALL FOUR maps at once. It
 * shipped, in an OTA, while trying to fix a watermark. Verified after the fact
 * by dumping the string constants out of the Hermes bundle.
 *
 * Keep it inline and keep it dumb.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * VERIFYING A BUILD. Do not grep a Hermes bundle for `key=undefined`: an
 * un-substituted env var becomes the `undefined` KEYWORD, not that text, so
 * the search returns zero either way. It is not evidence. The real check is to
 * dump the URL constant itself and confirm the key follows `?key=`:
 *
 *   strings <bundle>.hbc | grep -o 'cartocdn.com/light_all/{z}/{x}/{y}.png.\{0,45\}'
 */
export const BASEMAP_URL =
  `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${process.env.EXPO_PUBLIC_CARTO_API_KEY}`;

/**
 * The vector equivalent of BASEMAP_URL, for maps ported to MapLibre GL.
 *
 * CARTO is retiring the raster service and hinting they may freeze its
 * cartography — which matters here more than sharpness does, because street
 * geometry comes from live OSM via Overpass. A frozen basemap would drift away
 * from the data drawn on top of it. Full reasoning and build order in
 * docs/VECTOR_BASEMAP_MIGRATION_SCOPE.md.
 *
 * EVERY WARNING ABOVE APPLIES TO THIS CONSTANT TOO. Keep the env expression
 * inline. A `style.json` URL is substituted by the same textual mechanism that
 * shipped a keyless bundle on 2026-09-08; putting it behind a variable or a
 * ternary would fail in exactly the same way, and just as silently.
 *
 * Migration is partial by design — raster and vector coexist while maps are
 * ported one at a time, so BASEMAP_URL stays until the last caller is gone.
 */
export const BASEMAP_STYLE_URL =
  `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=${process.env.EXPO_PUBLIC_CARTO_API_KEY}`;

/**
 * MapLibre layer-insertion anchor. Returns the id of the first symbol layer
 * that sits AFTER every fill layer, or undefined if there is none.
 *
 * WHY THIS IS NOT `layers.find(l => l.type === 'symbol')`. That obvious version
 * resolves to `waterway_label`, which sits BELOW the building fills — overlays
 * inserted there get painted over by buildings and come out sliced into what
 * looks like a dash pattern but isn't. Caught on the first spike run,
 * 2026-09-08; see VECTOR_BASEMAP_MIGRATION_SCOPE.md §5a.
 *
 * Inserting at this anchor also puts overlays below the style's roadname_*
 * layers, so street names stay readable on top of drawn coverage — the label
 * defect the raster basemap has today, fixed for free.
 *
 * Computed at load time, never hardcoded: CARTO serves the style live and can
 * reorder it.
 */
export const MAPLIBRE_ANCHOR_FN = `
function pickOverlayAnchor(map) {
  var layers = (map.getStyle() && map.getStyle().layers) || [];
  var lastFill = -1;
  for (var i = 0; i < layers.length; i++) if (layers[i].type === 'fill') lastFill = i;
  for (var j = lastFill + 1; j < layers.length; j++) {
    if (layers[j].type === 'symbol') return layers[j].id;
  }
  return undefined;
}`;

/** True when this bundle shipped without a usable CARTO key. */
export function basemapKeyMissing(): boolean {
  const k = process.env.EXPO_PUBLIC_CARTO_API_KEY;
  return !k || k.length < 8;
}

if (__DEV__ && basemapKeyMissing()) {
  console.warn(
    '🗺️ EXPO_PUBLIC_CARTO_API_KEY is missing from this bundle — every map will ' +
    'render with CARTO\'s "API KEY REQUIRED" watermark. Publish with ' +
    'publish-detector.sh, which sources .env into the shell first.'
  );
}
