/**
 * The one CARTO basemap URL.
 *
 * WHY THIS EXISTS. The same tile URL was hand-copied into four WebViews —
 * app/(tabs)/map.tsx, app/challenge/new.tsx, src/pick/AreaPreview.tsx and
 * src/pick/ImpactMap.tsx. Four copies of a string that must carry an API key
 * is exactly how one ends up without it, and a missing key does not fail: CARTO
 * still serves the tile, with "API KEY REQUIRED" printed diagonally across it.
 * That is a silent, shipped-to-users failure mode, and it has bitten this
 * project repeatedly (31 Aug native build, 1 Sep OTA twice).
 *
 * Now there is one definition. Adding a fifth map means importing this, not
 * copying a string.
 *
 * NOTE ON VERIFYING A BUILD. Do not try to confirm the key by grepping a
 * Hermes bundle for `key=undefined` — the env var inlines as the `undefined`
 * KEYWORD, not the text, so that search returns zero whether or not the key is
 * present. It is not evidence. `basemapKeyMissing()` below is the real check,
 * and it runs on device where the answer is actually knowable.
 */

const KEY = process.env.EXPO_PUBLIC_CARTO_API_KEY;

/** True when the bundle shipped without a usable CARTO key. */
export function basemapKeyMissing(): boolean {
  return !KEY || KEY.length < 8;
}

/**
 * Leaflet tile-layer URL template. Interpolate into WebView HTML with
 * `${BASEMAP_URL}` — it is already a complete, quoted-safe URL string.
 */
export const BASEMAP_URL =
  `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png${KEY ? `?key=${KEY}` : ''}`;

/**
 * Omitting the parameter entirely when there is no key is deliberate: sending
 * `?key=undefined` is a malformed request, whereas no parameter is the honest
 * unauthenticated call. Both get the watermark, but only one of them is a lie
 * about what we sent.
 */
if (__DEV__ && basemapKeyMissing()) {
  console.warn(
    '🗺️ EXPO_PUBLIC_CARTO_API_KEY is missing from this bundle — every map will ' +
    'render with CARTO\'s "API KEY REQUIRED" watermark. Publish with ' +
    'publish-detector.sh, which sources .env into the shell first.'
  );
}
