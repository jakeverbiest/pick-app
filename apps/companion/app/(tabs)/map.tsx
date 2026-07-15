import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert, AppState, Image, Share, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import MotionDetector from '../../src/services/motionDetection';
import PickupAggregator from '../../src/services/pickupAggregator';
import { itemsToBags, reportedBags, formatBags, formatKitchenBags } from '../../src/services/impactMetrics';
import { getCoverage, markRouteCleaned, getParkCoverage, markParksCleaned, getTileStats, tileId, getCoverageForRing, routeCoverageFraction } from '../../src/services/streetSegments';
import { osmNeighborhood, getHoodsInBounds, polygonStats, HoodShape } from '../../src/services/neighborhoods';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import Constants from 'expo-constants';
import { startBackgroundSession, stopBackgroundSession } from '../../src/services/backgroundSession';
import { beginSessionTrace, heartbeat, endSessionTrace } from '../../src/services/crashRecorder';
import { syncWorkoutToHealth, isHealthSyncEnabled } from '../../src/services/healthService';
import { simplifyRoute, simplifyCoordPairs, privacyTrimRoute } from '../../src/services/routeUtils';
import { getFitnessService } from '../../src/services/fitnessService';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getBadgeService } from '../../src/services/badgeService';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../src/constants/colors';
import { Icon } from '../../src/pick/Icon';
import { ShareComposer } from '../../src/pick/ShareComposer';

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const heatmapWebviewRef = useRef<WebView>(null);
  const [pickupCount, setPickupCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [communitySharing, setCommunitySharing] = useState(true);
  const [communityAutoPost, setCommunityAutoPost] = useState(false);
  // 'background' = OS keeps the walk alive screen-off (real build + Always loc);
  // 'foreground' = screen must stay on (Expo Go / permission denied); null = unknown.
  const [sessionMode, setSessionMode] = useState<'background' | 'foreground' | null>(null);
  const startingRef = useRef(false);
  const [showCommunityCompose, setShowCommunityCompose] = useState(false);
  const [communityCaption, setCommunityCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const pickPhoto = () => {
    Alert.alert('Add a photo', 'Show the spot you cleaned up.', [
      {
        text: 'Take photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
            return;
          }
          const res = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
          if (!res.canceled && res.assets?.[0]) setPhotoUri(res.assets[0].uri);
        },
      },
      {
        text: 'Choose from library',
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true });
          if (!res.canceled && res.assets?.[0]) setPhotoUri(res.assets[0].uri);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const [bagSize, setBagSize] = useState<'small' | 'medium' | 'large' | 'xl'>('small');
  const [bagFullness, setBagFullness] = useState(50);
  // True once the user touches the bag report — their report then wins over the estimate.
  const [bagReported, setBagReported] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [userTeam, setUserTeam] = useState<string>('');
  const [superlative, setSuperlative] = useState<string>('');
  const [sessionRoute, setSessionRoute] = useState<any[]>([]);
  // Drives unmounting the heavy map WebView when backgrounded mid-cleanup
  // (iOS gives backgrounded apps a tiny memory budget — the WebView was the
  // prime suspect for the ~7-min long-walk kills).
  const [appActive, setAppActive] = useState(true);
  const [pickupLocations, setPickupLocations] = useState<any[]>([]);
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  const [batterySaver, setBatterySaver] = useState(true); // Optimized for battery
  const pickupCounterRef = useRef(0); // Track pickups since last location record
  const currentLocationRef = useRef<{ lat: number; lon: number } | null>(null); // latest fix — pickup-pin fallback
  const [gpsInterval, setGpsInterval] = useState(20000); // 20s base interval
  const lastPickupTimeRef = useRef(0);
  const highFrequencyEndRef = useRef(0);
  const [historicalCleanups, setHistoricalCleanups] = useState<any[]>([]);
  const [showLayers, setShowLayers] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [showScaleInfo, setShowScaleInfo] = useState(false);
  const [showNeighborhood, setShowNeighborhood] = useState(false);
  // Past-cleanup coverage (street shading + dimmed routes) stays visible during
  // an active walk so the cleaned area reads as "cared for"; toggle to declutter.
  const [coverageVisible, setCoverageVisible] = useState(true);
  const [coverageStats, setCoverageStats] = useState<{ freshPct: number; totalSegments: number; toGo: number } | null>(null);
  // Tap-to-focus neighborhood + a running city rollup across hoods checked.
  const [selectedHood, setSelectedHood] = useState<{ name: string; freshPct: number; toGo: number; total: number } | null>(null);
  const [cityRollup, setCityRollup] = useState<{ city: string; freshPct: number } | null>(null);
  const hoodRingsRef = useRef<Record<string, [number, number][]>>({});
  const hoodScoresRef = useRef<Record<string, { fresh: number; total: number }>>({});
  // Level mode: a neighborhood "booted up" as a bounded level you fill in.
  const [activeLevel, setActiveLevel] = useState<{
    name: string;
    total: number; fresh: number; freshPct: number; toGo: number; untouched: number;
  } | null>(null);
  const [activating, setActivating] = useState<string | null>(null); // hood name during reveal
  const activeLevelRef = useRef<boolean>(false);
  const activationTokenRef = useRef<number>(0); // invalidates stale in-flight activations
  // Live recolor: the active level's segments + a throttle clock.
  const levelSegmentsRef = useRef<Array<{ id: string; coords: [number, number][]; daysOld: number | null; cleaned: boolean }>>([]);
  const lastRecolorRef = useRef<number>(0);
  const [currentArea, setCurrentArea] = useState<{ city: string; neighborhood: string }>({ city: '', neighborhood: '' });
  const coverageLoadedRef = useRef(false);
  const panLoadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pocketMode, setPocketMode] = useState(false);
  const pocketTapsRef = useRef<number[]>([]);
  const pocketModeRef = useRef(false);
  const appActiveRef = useRef(true);

  // The map must NOT render during pocket/screen-off stretches — hours of
  // invisible tile streaming + redraws is what memory-killed long walks.
  useEffect(() => {
    pocketModeRef.current = pocketMode;
  }, [pocketMode]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active';
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  const mapVisible = () => appActiveRef.current && !pocketModeRef.current;

  // When the map WebView unmounts on background-during-cleanup, reset mapReady
  // so coverage + route re-inject cleanly once it remounts on return.
  useEffect(() => {
    if (!appActive && isListening) setMapReady(false);
  }, [appActive, isListening]);

  // Keep the screen awake ONLY when we can't run in the background. When a real
  // background-location session is active ('background'), let the screen lock in
  // the pocket — the walk survives via the OS, there's nothing to touch, and no
  // Pocket Mode is needed. Until the mode resolves (null) we keep it awake to be
  // safe, so we never silently drop a foreground-only session.
  useEffect(() => {
    if (isListening && sessionMode !== 'background') {
      activateKeepAwakeAsync('cleanup');
    } else {
      deactivateKeepAwake('cleanup');
    }
    if (!isListening) {
      setPocketMode(false);
      setSessionMode(null);
    }
    return () => {
      deactivateKeepAwake('cleanup');
    };
  }, [isListening, sessionMode]);

  // Pocket mode exits on triple-tap within 1.2s. Exiting also trims the
  // last few seconds of "pickups" — that motion was you pulling the phone out.
  const handlePocketTap = () => {
    const now = Date.now();
    pocketTapsRef.current = [...pocketTapsRef.current.filter((t) => now - t < 1200), now];
    if (pocketTapsRef.current.length >= 3) {
      pocketTapsRef.current = [];
      setPocketMode(false);
      const corrected = MotionDetector.trimRecentPickups(4000);
      setPickupCount(corrected);
    }
  };

  useEffect(() => {
    loadUserStats();
    loadHistoricalCleanups();
    requestLocationPermission();
    // Get initial location on mount
    trackLocation();
  }, []);

  // Street-segment coverage: load when map + location are ready. Only lock the
  // "loaded" flag on SUCCESS — a new neighborhood whose first Overpass fetch is
  // slow/failed will retry on the next GPS fix instead of staying empty.
  useEffect(() => {
    if (mapReady && currentLocation && !coverageLoadedRef.current && !activeLevelRef.current) {
      loadStreetCoverage(currentLocation.lat, currentLocation.lon).then((ok) => {
        if (ok) coverageLoadedRef.current = true;
      });
      // Also draw the tappable hood outlines on launch so the overview is never
      // blank waiting for a pan/moveend.
      loadHoodsInView([currentLocation.lat - 0.012, currentLocation.lon - 0.016, currentLocation.lat + 0.012, currentLocation.lon + 0.016]);
    }
  }, [mapReady, currentLocation]);

  // When the app returns to the foreground while idle, re-fetch location and
  // allow coverage to reload — so opening in a NEW neighborhood updates the map
  // without needing a full app restart (the WebView persists across background).
  useEffect(() => {
    if (appActive && !isListening) {
      coverageLoadedRef.current = false;
      trackLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appActive, isListening]);

  // Re-center the idle map + re-name the neighborhood whenever the fix changes
  // (e.g. after foregrounding somewhere new). Only when not mid-cleanup, so it
  // never yanks the map during a walk.
  useEffect(() => {
    if (!currentLocation || isListening || !mapReady) return;
    webviewRef.current?.injectJavaScript(
      `if (window.updateLocation) { window.updateLocation(${currentLocation.lat}, ${currentLocation.lon}); } true;`
    );
    refreshArea(currentLocation.lat, currentLocation.lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation, isListening, mapReady]);

  // Past-cleanup routes race the WebView load at mount, so redraw them once the
  // map JS is ready — and keep them visible (or hidden) per the coverage toggle.
  // This also restores them after a background-driven WebView remount mid-walk.
  useEffect(() => {
    if (!mapReady) return;
    loadHistoricalCleanups();
    webviewRef.current?.injectJavaScript(`
      if (window.setCoverageVisible) { window.setCoverageVisible(${coverageVisible}); }
      true;
    `);

    // If the app sits open past local midnight, today's corridors are now
    // "yesterday" — reload to drop them. (Foreground refresh covers the more
    // common background-then-reopen case.)
    const msToMidnight = new Date().setHours(24, 0, 0, 0) - Date.now();
    const midnightTimer = setTimeout(() => { loadHistoricalCleanups(); }, msToMidnight + 1000);
    return () => clearTimeout(midnightTimer);
  }, [mapReady]);

  const loadStreetCoverage = async (lat: number, lon: number): Promise<boolean> => {
    try {
      // Streets and parks are independent fetches — run them concurrently so a
      // cold start pays for the slower of the two, not the sum.
      const parksPromise = getParkCoverage(lat, lon).catch((e) => {
        console.error('Park coverage error:', e);
        return [] as Awaited<ReturnType<typeof getParkCoverage>>;
      });
      const segments = await getCoverage(lat, lon);
      if (segments.length > 0 && webviewRef.current) {
        webviewRef.current.injectJavaScript(`
          if (window.renderSegments) { window.renderSegments(${JSON.stringify(segments)}); }
          true;
        `);
      }

      // Parks (open zones, e.g. Carroll Park) — render alongside street segments.
      try {
        const parks = await parksPromise;
        if (parks.length > 0 && webviewRef.current) {
          webviewRef.current.injectJavaScript(`
            if (window.renderParks) { window.renderParks(${JSON.stringify(parks)}); }
            true;
          `);
        }
      } catch (e) {
        console.error('Park coverage error:', e);
      }
      // Stats are scoped to the CURRENT TILE (a fixed, completable area), not the
      // whole 600m fetch bubble — so "% green" and "blocks to go" hold steady as
      // you pan instead of drifting with the map. The tile is universal: same
      // unit in any city, no per-city boundary data.
      const tile = getTileStats(lat, lon, segments);
      // A failed/rate-limited re-fetch returns 0 segments — don't let it clobber
      // stats we already have with a bogus "0/0".
      setCoverageStats((prev) =>
        tile.total === 0 && prev && prev.totalSegments > 0
          ? prev
          : { freshPct: tile.freshPct, totalSegments: tile.total, toGo: tile.toGo }
      );
      console.log(`🛣️ Tile ${tile.tileId}: ${tile.freshPct}% green, ${tile.toGo}/${tile.total} to go`);
      return segments.length > 0;
    } catch (error) {
      console.error('Street coverage error:', error);
      return false;
    }
  };

  // NYC counties → boroughs. Apple's geocoder sometimes returns the
  // NEIGHBORHOOD as `city` in NYC ("Carroll Gardens"), which made the map
  // title look pre-selected. The county (subregion) is reliable — map it to
  // the borough people actually say.
  const NYC_BOROUGHS: Record<string, string> = {
    'Kings County': 'Brooklyn',
    'Queens County': 'Queens',
    'New York County': 'Manhattan',
    'Bronx County': 'The Bronx',
    'Richmond County': 'Staten Island',
  };
  const resolveCity = (g: { city?: string | null; subregion?: string | null; region?: string | null }): string =>
    NYC_BOROUGHS[g.subregion || ''] || g.city || g.subregion || g.region || '';

  // Reverse-geocode a point to its city + neighborhood NAME (works globally
  // via the phone's geocoder — the unit for local boards until we bundle crisp
  // official boundary shapes per launch city).
  const geocodeArea = async (lat: number, lon: number): Promise<{ city: string; neighborhood: string }> => {
    try {
      const g = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }))[0];
      if (g) {
        const city = resolveCity(g);
        const district = g.district || '';
        // Prefer OSM (free, global, tile-cached). Apple frequently returns the
        // BOROUGH as its sub-locality for NYC — taking that gave the stuck
        // "Brooklyn". So call OSM regardless, and use Apple's district only when
        // OSM is empty AND it isn't just echoing the city/borough.
        const osm = await osmNeighborhood(lat, lon);
        const neighborhood = osm || (district && district !== city ? district : '');
        // Ground-truth readout for the Settings "Geo debug" row.
        try {
          await AsyncStorage.setItem('@pick_geodebug', JSON.stringify({ district, osm, city, tile: tileId(lat, lon) }));
        } catch {}
        return { city, neighborhood };
      }
    } catch {}
    return { city: '', neighborhood: '' };
  };

  // Apply a geocode result to the header, keeping a neighborhood name once we
  // have one: a later geocode over a panned map center often returns no
  // sub-locality, and we'd rather hold the last real name than drop back to the
  // borough. Reset the name only when we've genuinely moved to a different city.
  const applyArea = (area: { city: string; neighborhood: string }) =>
    setCurrentArea((prev) => ({
      city: area.city || prev.city,
      neighborhood:
        area.neighborhood || (area.city && area.city !== prev.city ? '' : prev.neighborhood),
    }));

  // Default header name from the geocoder (used until you tap a neighborhood).
  const refreshArea = (lat: number, lon: number) => {
    geocodeArea(lat, lon).then(applyArea);
  };

  // Draw all neighborhood outlines intersecting the current view as a tappable
  // layer. Rings are stashed so a tap can score that hood from coverage.
  const loadHoodsInView = (b: [number, number, number, number]) => {
    getHoodsInBounds(b[0], b[1], b[2], b[3]).then((hoods: HoodShape[]) => {
      if (!hoods.length) return;
      hoods.forEach((h) => { hoodRingsRef.current[h.name] = h.ring; });
      const payload = hoods.map((h) => ({ name: h.name, ring: h.ring }));
      webviewRef.current?.injectJavaScript(`
        if (window.renderNeighborhoods) { window.renderNeighborhoods(${JSON.stringify(payload)}); }
        ${selectedHood ? `if (window.highlightNeighborhood) { window.highlightNeighborhood(${JSON.stringify(selectedHood.name)}); }` : ''}
        true;
      `);
    });
  };

  // Activate a hood as a level: frame + lock the map on it, reveal all its
  // streets (untouched in soft gray, cleaned on the freshness scale), show
  // completion stats. reveal=true plays the 2s "entering" beat (tap to browse);
  // reveal=false enters quietly (used when you start a cleanup inside a hood).
  const activateHood = async (name: string, ring: [number, number][], reveal: boolean) => {
    if (activating) return;
    const token = ++activationTokenRef.current; // invalidated by exitLevel / a newer activation
    setSelectedHood(null);
    if (reveal) setActivating(name);
    activeLevelRef.current = true;
    webviewRef.current?.injectJavaScript(`
      if (window.enterLevel) { window.enterLevel(${JSON.stringify(ring)}); }
      true;
    `);
    const started = Date.now();
    const segments = await getCoverageForRing(ring);
    // Bail if we've since exited the level (or started a different one) — stops a
    // stale fetch from re-drawing the spotlight/level after the user left.
    if (activationTokenRef.current !== token || !activeLevelRef.current) return;
    const total = segments.length;
    const fresh = segments.filter((s) => s.daysOld !== null && s.daysOld <= 5).length;
    const untouched = segments.filter((s) => s.daysOld === null).length;
    const freshPct = total > 0 ? Math.round((fresh / total) * 100) : 0;
    const toGo = Math.max(0, total - fresh);
    // Keep the segments for live recoloring as you walk.
    levelSegmentsRef.current = segments.map((s) => ({ id: s.id, coords: s.coords, daysOld: s.daysOld, cleaned: false }));
    const payload = segments.map((s) => ({ id: s.id, coords: s.coords, daysOld: s.daysOld }));
    webviewRef.current?.injectJavaScript(`
      if (window.renderLevel) { window.renderLevel(${JSON.stringify(payload)}); }
      true;
    `);
    hoodScoresRef.current[name] = { fresh, total };
    const agg = Object.values(hoodScoresRef.current).reduce(
      (a, s) => ({ fresh: a.fresh + s.fresh, total: a.total + s.total }), { fresh: 0, total: 0 });
    setCityRollup({ city: currentArea.city || 'City', freshPct: agg.total > 0 ? Math.round((agg.fresh / agg.total) * 100) : 0 });
    const apply = () => { setActiveLevel({ name, total, fresh, freshPct, toGo, untouched }); setActivating(null); };
    if (reveal) setTimeout(apply, Math.max(400, 2000 - (Date.now() - started)));
    else apply();
  };

  // Tap a neighborhood outline → browse it with the full 2s reveal.
  const focusHood = (name: string) => {
    const ring = hoodRingsRef.current[name];
    if (ring) activateHood(name, ring, true);
  };

  // Live recolor: while picking inside a level, flip each street green the moment
  // your route covers ≥80% of it — you watch the hood fill in. Throttled, and
  // only segments near you are checked, so it stays cheap.
  useEffect(() => {
    if (!isListening || !activeLevelRef.current) return;
    const pts = sessionRoute;
    if (pts.length < 2) return;
    const now = Date.now();
    if (now - lastRecolorRef.current < 2500) return;
    lastRecolorRef.current = now;
    const segs = levelSegmentsRef.current;
    if (!segs.length) return;
    const last = pts[pts.length - 1];
    const newlyClean: string[] = [];
    for (const s of segs) {
      if (s.cleaned) continue;
      const m = s.coords[Math.floor(s.coords.length / 2)];
      const dx = (m[1] - last.lon) * 111320 * Math.cos((last.lat * Math.PI) / 180);
      const dy = (m[0] - last.lat) * 110540;
      if (dx * dx + dy * dy > 90 * 90) continue; // only segments within ~90m of you
      if (routeCoverageFraction(s.coords, pts, 15) >= 0.8) { s.cleaned = true; newlyClean.push(s.id); }
    }
    if (newlyClean.length) {
      webviewRef.current?.injectJavaScript(
        newlyClean.map((id) => `if(window.markLevelClean){window.markLevelClean(${JSON.stringify(id)});}`).join('') + ' true;'
      );
      const total = segs.length;
      const fresh = segs.filter((s) => s.cleaned || (s.daysOld !== null && s.daysOld <= 5)).length;
      const untouched = segs.filter((s) => !s.cleaned && s.daysOld === null).length;
      setActiveLevel((prev) => prev ? { ...prev, fresh, freshPct: total > 0 ? Math.round((fresh / total) * 100) : 0, toGo: Math.max(0, total - fresh), untouched } : prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRoute, isListening]);

  // Re-draw the tappable hood outlines + coverage around a point (used when
  // returning to the overview so neighborhoods are immediately selectable).
  const refreshOverviewAround = (lat: number, lon: number) => {
    loadStreetCoverage(lat, lon);
    loadHoodsInView([lat - 0.012, lon - 0.016, lat + 0.012, lon + 0.016]);
  };

  // Close the results recap and return to a fresh, tappable overview where you
  // are now — so you can immediately pick a new neighborhood after submitting.
  const finishSession = () => {
    setShowResults(false);
    setPickupCount(0);
    setElapsedSeconds(0);
    setSessionRoute([]);
    setPickupLocations([]);
    setPhotoUri(null);
    setShowShare(false);
    if (activeLevelRef.current) exitLevel();
    else if (currentLocation) refreshOverviewAround(currentLocation.lat, currentLocation.lon);
  };

  // Leave level mode → back to the overview of all hoods, recentered on you.
  const exitLevel = () => {
    activationTokenRef.current++; // cancel any in-flight activation
    activeLevelRef.current = false;
    setActiveLevel(null);
    setActivating(null);
    setSelectedHood(null);
    levelSegmentsRef.current = [];
    const la = currentLocation?.lat, lo = currentLocation?.lon;
    // Always tear down the veil/level layers; recenter + reload only if we have a fix.
    webviewRef.current?.injectJavaScript(`
      if (window.exitLevel) { window.exitLevel(); }
      ${typeof la === 'number' ? `try { map.setView([${la}, ${lo}], 15); } catch (e) {}` : ''}
      true;
    `);
    if (typeof la === 'number') refreshOverviewAround(la, lo);
  };

  // "Map grows as you explore": when you pan/zoom the map (and aren't mid-
  // cleanup), load coverage for the area you moved to. The neighborhood name +
  // boundary deliberately do NOT update here — they're anchored to your real
  // location (below) so the outline stays put instead of flipping as the map
  // center crosses hoods. Debounced; skips very zoomed-out views.
  const handleMapMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'hoodTap' && msg.name) {
        if (!activeLevelRef.current) focusHood(msg.name);
        return;
      }
      if (msg.type !== 'moveend' || isListening) return;
      if (activeLevelRef.current) return; // level is locked to its hood — don't grow/rename
      if (typeof msg.zoom === 'number' && msg.zoom < 14) return;
      if (panLoadRef.current) clearTimeout(panLoadRef.current);
      panLoadRef.current = setTimeout(() => {
        loadStreetCoverage(msg.lat, msg.lon);
        if (Array.isArray(msg.b)) loadHoodsInView(msg.b);
      }, 600);
    } catch {}
  };

  // Name the user's current neighborhood once we have a fix (header label).
  useEffect(() => {
    if (currentLocation && !currentArea.neighborhood && !currentArea.city) {
      refreshArea(currentLocation.lat, currentLocation.lon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation]);

  useEffect(() => {
    if (isListening) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);

      // Dense GPS during active cleanup: 20s gaps (~25m walking) skip street
      // segments when snapping routes. 5s normal / 10s battery saver.
      const activeInterval = batterySaver ? 10000 : 5000;
      trackLocation(); // Get initial location immediately
      locationRef.current = setInterval(() => {
        trackLocation();
      }, activeInterval);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationRef.current) clearInterval(locationRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationRef.current) clearInterval(locationRef.current);
    };
  }, [isListening]);

  useEffect(() => {
    return () => {
      if (isListening) {
        MotionDetector.stopListening();
      }
    };
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
      }
    } catch (error) {
      console.error('Location permission error:', error);
    }
  };

  const trackLocation = async () => {
    try {
      // During a session, reuse the motion detector's GPS watcher instead of
      // requesting our own fixes — one radio stream instead of three.
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (MotionDetector.isActive()) {
        const last = MotionDetector.getLastLocation();
        if (last) {
          latitude = last.latitude;
          longitude = last.longitude;
        }
      }
      if (latitude === undefined || longitude === undefined) {
        // Idle path (map centering before a session): one-off fix
        const accuracy = batterySaver ? Location.Accuracy.Low : Location.Accuracy.Balanced;
        const location = await Location.getCurrentPositionAsync({ accuracy });
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }
      setCurrentLocation({ lat: latitude, lon: longitude });
      currentLocationRef.current = { lat: latitude, lon: longitude };

      setSessionRoute((prev) => {
        const updated = [
          ...prev,
          {
            lat: latitude,
            lon: longitude,
            timestamp: Date.now(),
          },
        ];
        const now = Date.now();
        let mode = 'normal';
        if (now < highFrequencyEndRef.current) {
          mode = 'HIGH-FREQ (pickup mode)';
        } else if (now - lastPickupTimeRef.current > 30000) {
          mode = 'low-freq (idle)';
        }
        console.log(`📍 ${mode}: ${updated.length} pts`);

        // Black box heartbeat: overwrite the on-disk sentinel with the latest
        // counters + timestamp. The last surviving copy tells us how far a
        // crashed walk got and roughly when it died. No-op when not in a session.
        heartbeat({
          routePoints: updated.length,
          pickups: pickupCounterRef.current,
          motionEvents: MotionDetector.getSessionEvents().length,
        });

        // Update map in real-time — but only when someone can actually see it
        if (isListening && webviewRef.current && mapReady && mapVisible()) {
          // Simplify: clean bar following the path, not every GPS wobble
          const simplified = simplifyRoute(updated);
          console.log(`🗺️ Injecting route: ${updated.length} pts → ${simplified.length} simplified`);
          const routeCoords = simplified.map(p => [p.lat, p.lon]);
          webviewRef.current.injectJavaScript(`
            try {
              if (window.updateLocation && window.redrawRoute) {
                window.updateLocation(${latitude}, ${longitude});
                window.redrawRoute(${JSON.stringify(routeCoords)});
                console.log('Route updated with ${updated.length} points');
              } else {
                console.log('Map functions not ready');
              }
            } catch(e) {
              console.error('Map update error:', e.toString());
            }
          `);
        }

        return updated;
      });

      const db = await getDatabase();
      await db.addLocationPoint(latitude, longitude);
    } catch (error) {
      console.error('Location tracking error:', error);
    }
  };

  const calculateSuperlative = (stats: any) => {
    const cleanups = stats?.total_cleanups || 0;
    const days = stats?.cleanup_days || 0;

    if (cleanups >= 50) return 'Champion';
    if (cleanups >= 20) return 'Rising Star';
    if (cleanups >= 10) return 'Committed';
    if (cleanups >= 5) return 'Growing';
    if (cleanups >= 1) return 'Getting Started';
    return '';
  };

  // NYC SCALE - aggressive, high-maintenance model
  const CLEANLINESS_SCALE = {
    fresh: 5,      // Green: 0-5 days
    dusty: 9,      // Yellow: 6-9 days
    attention: 13, // Orange: 10-13 days
    dirty: Infinity, // Red: 14+ days (doesn't count as cleaned)
  };

  const getCleanlinessColor = (lastCleanedTime: number) => {
    const now = Date.now();
    const ageInDays = (now - lastCleanedTime) / (1000 * 60 * 60 * 24);

    if (ageInDays <= CLEANLINESS_SCALE.fresh) return '#34C759'; // Green - Fresh
    if (ageInDays <= CLEANLINESS_SCALE.dusty) return '#FFCC00'; // Yellow - Getting dusty
    if (ageInDays <= CLEANLINESS_SCALE.attention) return '#FF9500'; // Orange - Needs attention
    return '#FF3B30'; // Red - Not counted / needs immediate re-cleaning
  };

  const getCleanlinessLabel = (lastCleanedTime: number) => {
    const now = Date.now();
    const ageInDays = Math.floor((now - lastCleanedTime) / (1000 * 60 * 60 * 24));

    if (ageInDays === 0) return 'Just now';
    if (ageInDays === 1) return 'Yesterday';
    if (ageInDays <= CLEANLINESS_SCALE.fresh) return `${ageInDays} days ago (Fresh)`;
    if (ageInDays <= CLEANLINESS_SCALE.dusty) return `${ageInDays} days ago (Getting dusty)`;
    if (ageInDays <= CLEANLINESS_SCALE.attention) return `${ageInDays} days ago (Needs attention)`;
    return `${ageInDays} days ago (Not counted - needs re-cleaning)`;
  };

  // Map layers only need timestamp + route + location. Passing whole cleanup
  // objects (incl. motion_log flight data) serialized huge JS strings into the
  // WebView — a memory kill on June 11. Slim + simplify before injecting.
  const simplifyCleanupRoutes = (cleanups: any[]) =>
    cleanups.map((c) => {
      let route_points = null;
      try {
        const pts = c.route_points ? JSON.parse(c.route_points) : null;
        if (Array.isArray(pts) && pts.length > 1) {
          const slim = (pts.length > 2 ? simplifyCoordPairs(pts) : pts)
            .map(([la, lo]: [number, number]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
          route_points = JSON.stringify(slim);
        }
      } catch {}
      // The DB stores timestamp in SECONDS, but the WebView freshness logic
      // compares against Date.now() (MILLISECONDS). Passing seconds straight
      // through made every walk read as ~20,000 days old → forced red. Normalize
      // to ms here (any value that looks like seconds gets *1000).
      const tsMs = c.timestamp && c.timestamp < 1e12 ? c.timestamp * 1000 : c.timestamp;
      return {
        timestamp: tsMs,
        location_lat: c.location_lat,
        location_lon: c.location_lon,
        route_points,
      };
    });

  const loadHistoricalCleanups = async () => {
    try {
      const db = await getDatabase();
      const cleanups = await db.getCleanups(100); // Load recent cleanups
      setHistoricalCleanups(cleanups);

      // Personal walk corridors are an "I just did this" confirmation, not a
      // permanent freshness map — the shared segment layer owns long-term
      // freshness. So only draw walks from the current local calendar day; at
      // midnight (or the next refresh after it) they fall off. timestamp is in
      // SECONDS from the DB, but be robust to ms too.
      const startOfTodayMs = new Date().setHours(0, 0, 0, 0);
      const todayCleanups = cleanups.filter((c: any) => {
        const tsMs = c.timestamp && c.timestamp < 1e12 ? c.timestamp * 1000 : c.timestamp;
        return tsMs >= startOfTodayMs;
      });

      // Inject into map if available (always inject — an empty array clears
      // yesterday's corridors when today has no walks yet).
      if (webviewRef.current) {
        webviewRef.current.injectJavaScript(`
          if (window.addHistoricalRoutes) { window.addHistoricalRoutes(${JSON.stringify(simplifyCleanupRoutes(todayCleanups))}); }
          true;
        `);
      }
    } catch (error) {
      console.error('Failed to load historical cleanups:', error);
    }
  };

  const loadUserStats = async () => {
    try {
      const db = await getDatabase();
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();
      const userStats = await db.getCleanupStats();

      setUser(currentUser);
      setStats(userStats);

      // Load team from user settings
      const settings = await db.getUserSettings(currentUser?.uid || '');
      if (settings && settings.team_name) {
        setUserTeam(settings.team_name);
      }
      setNeighborhood(settings?.neighborhood || '');
      setCommunitySharing(settings?.community_sharing_enabled !== false);
      setCommunityAutoPost(!!settings?.community_auto_post);

      // Calculate superlative if no team
      if (!settings?.team_name) {
        const sup = calculateSuperlative(userStats);
        setSuperlative(sup);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  // Opt-in: upload the cleanup photo to Storage and create a community post.
  const shareToCommunity = async () => {
    console.log('📸 shareToCommunity tapped', { hasPhoto: !!photoUri, posting });
    if (!photoUri || posting) return;

    // Public posting requires a verified email (anti-abuse). Re-check live in
    // case they verified since launch, then gate.
    const authSvc = getAuthService();
    if (!authSvc.isEmailVerified() && !(await authSvc.refreshEmailVerified())) {
      Alert.alert(
        'Verify your email first',
        'Posting to the community needs a verified email address. We can resend the verification link.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Resend email', onPress: () => authSvc.resendVerification().catch(() => {}) },
        ]
      );
      return;
    }

    setPosting(true);
    try {
      const db = await getDatabase();
      const post = await db.createPost({ caption: communityCaption.trim(), neighborhood, photoUri });
      if (post) {
        setShowCommunityCompose(false);
        setCommunityCaption('');
        Alert.alert('Posted', 'Your cleanup is on the community feed.');
      } else {
        Alert.alert('Could not post', 'Something went wrong sharing your photo. Please try again.');
      }
    } catch (error: any) {
      console.error('Failed to share to community:', error);
      // Surface the real reason so we can diagnose (e.g. storage/unauthorized,
      // permission-denied, network) instead of a generic message.
      const detail = error?.code || error?.message || 'unknown error';
      Alert.alert('Could not post', `Sharing failed: ${detail}`);
    } finally {
      setPosting(false);
    }
  };

  const startCleanup = async () => {
    // Re-entry guard: this fn is async and doesn't flip isListening until after
    // GPS + listener setup, so rapid taps in that window were double-starting the
    // background session and motion listener (the duplicate logs). Block it.
    if (startingRef.current || isListening) return;
    startingRef.current = true;
    try {
    setPickupCount(0);
    setElapsedSeconds(0);
    setSessionRoute([]);
    setPickupLocations([]);
    PickupAggregator.resetSession();

    // Get initial location
    await trackLocation();

    await MotionDetector.startListening(
      async (event) => {
        setPickupCount((c) => c + 1);
        pickupCounterRef.current += 1;

        // Trigger high-frequency GPS mode when pickup detected
        lastPickupTimeRef.current = Date.now();
        highFrequencyEndRef.current = Date.now() + 30000; // 30s of high frequency
        console.log('Pickup detected - HIGH FREQUENCY GPS for 30s');

        // Record pickup location from the detector's existing GPS watcher —
        // requesting a fresh fix per pickup was up to ~90 radio hits per walk
        {
          try {
            // Prefer the detector's GPS fix; fall back to the map's latest fix
            // (via ref, not the stale closure) so pins aren't lost when the
            // detector's watcher hasn't locked yet (early/indoor sessions — the
            // "Pickup locations: 0" we kept seeing in logs).
            const last = MotionDetector.getLastLocation();
            const lat = last?.latitude ?? currentLocationRef.current?.lat;
            const lon = last?.longitude ?? currentLocationRef.current?.lon;
            if (lat == null || lon == null) throw new Error('no fix yet');
            const pickupLoc = { lat, lon, timestamp: Date.now() };

            setPickupLocations((prev) => [...prev, pickupLoc]);

            // Add marker to map (skip while invisible — redraw catches up later)
            if (webviewRef.current && mapReady && mapVisible()) {
              webviewRef.current.injectJavaScript(`
                try {
                  if (window.addPickup) {
                    window.addPickup(${lat}, ${lon});
                  }
                } catch(e) {
                  console.error('Pickup marker error:', e);
                }
                true;
              `);
            }

            const db = await getDatabase();
            await db.addPickupLocation(lat, lon);
          } catch (error) {
            console.error('Pickup location error:', error);
          }
        }
      },
      (error) => console.error(error)
    );
    setIsListening(true);

    // Black box: drop a sentinel to disk so a screen-off crash leaves a trail
    // (recovered at next launch). Cleared on a clean Stop below. The build label
    // tells us dev/Expo-Go vs a real build when reading recovered reports.
    beginSessionTrace({
      batterySaver,
      build: `${__DEV__ ? 'dev' : 'release'}/${Constants.executionEnvironment ?? '?'}/v${Constants.expoConfig?.version ?? '?'}`,
    });

    // Real builds: register background location so the session survives
    // screen-off. Expo Go: falls back to foreground (keep screen on).
    startBackgroundSession().then((mode) => {
      setSessionMode(mode);
      if (mode === 'foreground') {
        console.log('💡 Foreground-only (Expo Go or "Always" location not granted) — keeping screen on for this walk.');
      } else {
        console.log('🌙 Background session active — screen may sleep; no keep-awake or Pocket Mode needed.');
      }
    });
    } finally {
      startingRef.current = false;
    }
  };

  const stopCleanup = () => {
    stopBackgroundSession();
    // Clean stop — clear the black-box sentinel so launch sees no crash.
    endSessionTrace();
    MotionDetector.stopListening();
    // Pocket-removal guard: pulling the phone out to tap Stop looks like a pickup
    // (June 11: 3.5s missed a removal — people take a beat before tapping Stop)
    const correctedCount = MotionDetector.trimRecentPickups(6000);
    setPickupCount(correctedCount);
    setIsListening(false);
    setShowSummary(true);
    setBagReported(false);
    setBagSize('small');
    setBagFullness(50);

    // Debug logging
    console.log('Session stopped');
    console.log(`Route points: ${sessionRoute.length}`);
    console.log(`Pickup locations: ${pickupLocations.length}`);
    if (sessionRoute.length > 0) {
      console.log(`First point: ${sessionRoute[0].lat}, ${sessionRoute[0].lon}`);
      console.log(`Last point: ${sessionRoute[sessionRoute.length-1].lat}, ${sessionRoute[sessionRoute.length-1].lon}`);
    }
  };

  const saveSummary = async () => {
    setShowSummary(false);
    setShowResults(true);

    try {
      // The user's bag report wins; otherwise derive bags from the pickup count.
      const finalBags = bagReported
        ? reportedBags(bagSize, bagFullness)
        : itemsToBags(pickupCount);

      const db = await getDatabase();
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();

      if (!currentUser) throw new Error('User not initialized');

      // Use center of route as location
      const centerLat = sessionRoute.length
        ? sessionRoute.reduce((sum, p) => sum + p.lat, 0) / sessionRoute.length
        : 40.7128;
      const centerLon = sessionRoute.length
        ? sessionRoute.reduce((sum, p) => sum + p.lon, 0) / sessionRoute.length
        : -74.006;

      // Reverse-geocode the walk's center → reliable city + neighborhood NAME
      // (the local board this walk counts toward; rolls up to city + global).
      let area = { city: '', neighborhood: '' };
      try {
        const g = (await Location.reverseGeocodeAsync({ latitude: centerLat, longitude: centerLon }))[0];
        if (g) {
          const city = resolveCity(g);
          // Same name resolution as the header: Apple sub-locality → OSM → city,
          // so a saved walk / community post carries the real neighborhood name.
          let neighborhood = g.district || '';
          if (!neighborhood) neighborhood = await osmNeighborhood(centerLat, centerLon);
          area = { city, neighborhood: neighborhood || city };
        }
      } catch {}

      await db.addCleanup({
        timestamp: Date.now(),
        location_lat: centerLat,
        location_lon: centerLon,
        items_count: pickupCount,
        bag_qty: 0,
        bag_size: bagReported ? bagSize : '',
        bags_est: finalBags,
        duration_seconds: elapsedSeconds,
        // Record the user's actual team so it counts toward the team leaderboard
        // (falls back to 'solo' when they're not on a team).
        team: userTeam || 'solo',
        fitness_tracked: false,
        city: area.city,
        neighborhood: area.neighborhood,
        route_points: JSON.stringify(simplifyRoute(privacyTrimRoute(sessionRoute)).map(p => [p.lat, p.lon])),
        motion_log: JSON.stringify(MotionDetector.getSessionEvents()),
      } as any);

      const updatedStats = await db.getCleanupStats();
      setStats(updatedStats);

      // Mark walked street segments AND any park walked through as cleaned.
      if (sessionRoute.length > 0) {
        const marked = await markRouteCleaned(sessionRoute, currentUser.uid);
        const parksMarked = await markParksCleaned(sessionRoute, currentUser.uid);
        if (marked > 0 || parksMarked > 0) {
          loadStreetCoverage(centerLat, centerLon); // refresh segments + parks
        }
      }

      // Apple Health: log the cleanup as a walking workout (fitness credit).
      // The weight arg is an internal calorie heuristic only (never displayed):
      // ~0.05 lb of trash per pickup.
      if (await isHealthSyncEnabled()) {
        const workout = getFitnessService().createWorkout(pickupCount, pickupCount * 0.05, elapsedSeconds);
        const gpsKm = parseFloat(String(calculateCoverage().distance)) || 0;
        syncWorkoutToHealth({
          startMs: Date.now() - elapsedSeconds * 1000,
          endMs: Date.now(),
          distanceKm: gpsKm > 0 ? gpsKm : workout.distance_km,
          calories: workout.calories_burned,
          itemsCollected: pickupCount,
        });
      }

      // Auto-post the cleanup photo to community if the user opted in (and a
      // photo was added). Requires a verified email; silently skips otherwise.
      if (communityAutoPost && communitySharing && photoUri) {
        const authSvc = getAuthService();
        if (authSvc.isEmailVerified() || (await authSvc.refreshEmailVerified())) {
          const post = await db.createPost({ caption: '', neighborhood, photoUri });
          if (post) console.log('✅ Auto-posted cleanup photo to community');
        } else {
          console.log('ℹ️ Auto-post skipped — email not verified');
        }
      }
    } catch (error) {
      console.error('Failed to save cleanup:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const calculateCoverage = () => {
    if (sessionRoute.length < 2) return { distance: 0, area: 0 };

    let distance = 0;
    for (let i = 1; i < sessionRoute.length; i++) {
      const lat1 = sessionRoute[i - 1].lat;
      const lon1 = sessionRoute[i - 1].lon;
      const lat2 = sessionRoute[i].lat;
      const lon2 = sessionRoute[i].lon;

      // Simple distance calculation
      const dLat = (lat2 - lat1) * 111; // km per degree
      const dLon = (lon2 - lon1) * 111 * Math.cos((lat1 * Math.PI) / 180);
      distance += Math.sqrt(dLat * dLat + dLon * dLon);
    }

    return {
      distance: distance.toFixed(2),
      points: sessionRoute.length,
      pickups: pickupLocations.length,
    };
  };

  const exportSession = async () => {
    const coverage = calculateCoverage();
    const estBags = itemsToBags(pickupCount);
    const reported = bagReported ? reportedBags(bagSize, bagFullness) : null;

    const exportData = `
═══════════════════════════════════════════════════════════
  📊 PICK APP - SESSION EXPORT
═══════════════════════════════════════════════════════════

Session Date: ${new Date().toISOString()}
User: ${user?.displayName || 'Unknown'}

═══════════════════════════════════════════════════════════
  SUMMARY STATISTICS
═══════════════════════════════════════════════════════════

Duration: ${formatTime(elapsedSeconds)}
Distance Walked: ${coverage.distance} km
Location Points Tracked: ${coverage.points}
Pickups Detected: ${pickupCount}
Pickup Locations Recorded: ${pickupLocations.length}

═══════════════════════════════════════════════════════════
  BAG ANALYSIS
═══════════════════════════════════════════════════════════

Estimated Bags (from ${pickupCount} pickups): ${estBags.toFixed(2)} (${formatBags(estBags)})
Reported Bags: ${reported !== null ? `${reported.toFixed(2)} (${bagSize}, ${bagFullness}% full)` : 'not reported'}
${reported !== null ? `Estimate vs report variance: ${Math.abs(reported - estBags).toFixed(2)} bags` : ''}

═══════════════════════════════════════════════════════════
  ROUTE DATA (GPS POINTS)
═══════════════════════════════════════════════════════════

Start: ${sessionRoute[0]?.lat.toFixed(6)}, ${sessionRoute[0]?.lon.toFixed(6)}
End: ${sessionRoute[sessionRoute.length - 1]?.lat.toFixed(6)}, ${sessionRoute[sessionRoute.length - 1]?.lon.toFixed(6)}

Total Points: ${sessionRoute.length}
${sessionRoute.slice(0, 20).map((p, i) => `  ${i + 1}. ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`).join('\n')}
${sessionRoute.length > 20 ? `  ... and ${sessionRoute.length - 20} more points` : ''}

═══════════════════════════════════════════════════════════
  PICKUP HEATMAP DATA
═══════════════════════════════════════════════════════════

Pickup Locations: ${pickupLocations.length}
${pickupLocations.slice(0, 15).map((p, i) => `  ${i + 1}. ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} (${new Date(p.timestamp).toLocaleTimeString()})`).join('\n')}
${pickupLocations.length > 15 ? `  ... and ${pickupLocations.length - 15} more detections` : ''}

═══════════════════════════════════════════════════════════
  MOTION EVENT LOG (flight recorder — every event, incl. rejected)
═══════════════════════════════════════════════════════════

t(s) | peak(g) | dur(ms) | peakT(ms) | gyro | peaks | m/s | conf | result
${MotionDetector.getSessionEvents().map((e) =>
  `${String(e.t).padStart(4)} | ${e.peak.toFixed(2).padStart(7)} | ${String(e.duration).padStart(7)} | ${String(e.peakTime).padStart(9)} | ${e.gyro.toFixed(2).padStart(4)} | ${String(e.peaks).padStart(5)} | ${(e.speed >= 0 ? e.speed.toFixed(1) : ' ? ').padStart(3)} | ${String(e.confidence).padStart(4)} | ${e.counted ? 'counted' : e.accepted ? '🔁 cooldown' : '⛔ ' + e.reason}`
).join('\n') || '  (no motion events recorded)'}

═══════════════════════════════════════════════════════════
  BATTERY & PERFORMANCE
═══════════════════════════════════════════════════════════

Battery Saver Mode: ${batterySaver ? 'ON (Optimized)' : 'OFF (Normal)'}
Location Interval: ${batterySaver ? '30s' : '15s'}
GPS Accuracy: ${batterySaver ? 'Low Power' : 'Balanced'}
Pickup Location Sampling: Every 3rd pickup

═══════════════════════════════════════════════════════════

Generated by Pick App - Share this with the development team
    `.trim();

    try {
      // Copy to clipboard using React Native Clipboard
      await Clipboard.setStringAsync(exportData);
      Alert.alert(
        'Copied!',
        'Session data copied to clipboard. Paste in email, Notes, or Drive.'
      );
    } catch (error) {
      console.error('Copy failed:', error);
      Alert.alert(
        'Copy Failed',
        'Could not copy to clipboard. Try again.'
      );
    }
  };

  return (
    <View style={styles.container}>
      {/* Header - Show when NOT cleaning and not in a neighborhood level */}
      {!isListening && !activeLevel && !activating && (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Pre-selection the title names the CONTAINER (borough/city) — the
                neighborhood name is the reward for tapping in. Showing the hood
                name before selection made it look already-selected. */}
            <Text style={styles.userName} numberOfLines={1}>
              {selectedHood?.name || currentArea.city || user?.displayName || 'Your area'}
            </Text>
            {/* Progress numbers only appear for a SELECTED neighborhood. The old
                idle readout was scoped to an invisible ~500m tile, so its
                denominator shifted as you walked — inconsistent with the hood
                you'd then tap into. */}
            {selectedHood ? (
              selectedHood.total ? (
                <Text style={styles.coverageText} numberOfLines={1}>
                  {selectedHood.toGo === 0
                    ? 'All green here — nicely done'
                    : `${selectedHood.toGo} block${selectedHood.toGo === 1 ? '' : 's'} to go`}
                  {cityRollup ? `  ·  ${cityRollup.city} ${cityRollup.freshPct}%` : ''}
                </Text>
              ) : (
                <Text style={styles.coverageText}>Scoring…</Text>
              )
            ) : (
              <Text style={styles.coverageText}>Tap a neighborhood to see its progress</Text>
            )}
          </View>
          {selectedHood && selectedHood.total > 0 && (
            <View style={styles.completionPill}>
              <Text style={styles.completionPct}>{selectedHood.freshPct}%</Text>
              <Text style={styles.completionLbl}>green</Text>
            </View>
          )}
        </View>
      )}

      {/* Level reveal — the 2s "entering the neighborhood" beat */}
      {activating && (
        <View style={styles.levelReveal} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.levelRevealSub}>Entering</Text>
          <Text style={styles.levelRevealName}>{activating}</Text>
        </View>
      )}

      {/* Level header — the active neighborhood's stats + exit */}
      {!isListening && activeLevel && !activating && (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={exitLevel} style={styles.levelBack} accessibilityLabel="Back to all neighborhoods">
            <Text style={styles.levelBackIcon}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName} numberOfLines={1}>{activeLevel.name}</Text>
            <Text style={styles.coverageText} numberOfLines={1}>
              {activeLevel.toGo === 0
                ? 'Complete — all green'
                : `${activeLevel.toGo} to go${activeLevel.untouched > 0 ? `  ·  ${activeLevel.untouched} never cleaned` : ''}`}
            </Text>
          </View>
          <View style={styles.completionPill}>
            <Text style={styles.completionPct}>{activeLevel.freshPct}%</Text>
            <Text style={styles.completionLbl}>done</Text>
          </View>
        </View>
      )}


      {/* Top Bar - Only during cleanup */}
      {isListening && (
        <View style={[styles.topBarWhite, { top: insets.top + 8 }]}>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue}>{formatTime(elapsedSeconds)}</Text>
            <Text style={styles.topBarLabel}>Time</Text>
          </View>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue}>{pickupCount}</Text>
            <Text style={styles.topBarLabel}>Pickups</Text>
          </View>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue}>{(parseFloat(String(calculateCoverage().distance || '0')) * 0.621371).toFixed(1)} mi</Text>
            <Text style={styles.topBarLabel}>Distance</Text>
          </View>
          <TouchableOpacity
            style={styles.coverageToggle}
            accessibilityLabel={coverageVisible ? 'Hide area coverage' : 'Show area coverage'}
            onPress={() => {
              const v = !coverageVisible;
              setCoverageVisible(v);
              webviewRef.current?.injectJavaScript(
                `if (window.setCoverageVisible) { window.setCoverageVisible(${v}); } true;`
              );
            }}
          >
            <Icon name="route" size={18} color={coverageVisible ? COLORS.sage : COLORS.mutedSage} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.pocketButton} onPress={() => setPocketMode(true)}>
            <Text style={styles.pocketButtonLabel}>Pocket</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Completion focus while picking — which hood you're filling in */}
      {isListening && activeLevel && (
        <View style={[styles.pickingBanner, { top: insets.top + 72 }]} pointerEvents="none">
          <Text style={styles.pickingBannerText} numberOfLines={1}>
            {activeLevel.name} · {activeLevel.freshPct}% done
            {activeLevel.toGo > 0 ? ` · ${activeLevel.toGo} to go` : ' · complete!'}
          </Text>
        </View>
      )}

      {/* Pocket Mode — black touch-shield, dim counter, triple-tap to exit */}
      <Modal visible={pocketMode} animationType="fade" transparent={false}>
        <TouchableOpacity style={styles.pocketOverlay} activeOpacity={1} onPress={handlePocketTap}>
          <Text style={styles.pocketCount}>{pickupCount}</Text>
          <Text style={styles.pocketTimer}>{formatTime(elapsedSeconds)}</Text>
          <Text style={styles.pocketHint}>triple-tap to exit</Text>
        </TouchableOpacity>
      </Modal>

      {/* Real Map - Expands when cleaning */}
      <View style={[styles.mapContainer, isListening && styles.mapContainerExpanded]}>
        {/* Map Controls - Top Right */}
        {!isListening && (
          <View style={styles.mapControls}>
            <TouchableOpacity
              style={[styles.mapButton, showNeighborhood && styles.mapButtonActive]}
              onPress={async () => {
                const newState = !showNeighborhood;
                setShowNeighborhood(newState);

                if (newState) {
                  // Reload historical cleanups before showing
                  try {
                    const db = await getDatabase();
                    const cleanups = await db.getCleanups(100);
                    setHistoricalCleanups(cleanups);
                    console.log(`🗺️ Loaded ${cleanups.length} cleanups for neighborhood view`);

                    if (webviewRef.current && cleanups.length > 0) {
                      webviewRef.current.injectJavaScript(`
                        if (window.showNeighborhoodCoverage) { window.showNeighborhoodCoverage(${JSON.stringify(simplifyCleanupRoutes(cleanups))}); }
                        true;
                      `);
                    }
                  } catch (error) {
                    console.error('Failed to load cleanups:', error);
                  }
                } else if (webviewRef.current) {
                  // Hide neighborhood
                  webviewRef.current.injectJavaScript(`
                    if (window.clearNeighborhoodCoverage) { window.clearNeighborhoodCoverage(); }
                    true;
                  `);
                }
              }}
            >
              <Icon name="route" size={20} color={COLORS.sage} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => setShowScaleInfo(true)}
            >
              <Icon name="target" size={20} color={COLORS.sage} />
            </TouchableOpacity>
          </View>
        )}

        {(currentLocation && (appActive || !isListening)) ? (
          <WebView
            ref={webviewRef}
            originWhitelist={['*']}
            onMessage={handleMapMessage}
            onLoad={() => {
              // Set initial location if available
              if (currentLocation && webviewRef.current) {
                webviewRef.current.injectJavaScript(`
                  if (window.updateLocation) { window.updateLocation(${currentLocation.lat}, ${currentLocation.lon}); }
                  true;
                `);
              }
              setMapReady(true);
              console.log('Map ready');
            }}
            source={{
              html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
  <style>
    body { margin: 0; padding: 0; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
    /* Zoom control sits above the floating Start button, lowered closer to it */
    .leaflet-bottom.leaflet-right { margin-bottom: 96px; margin-right: 8px; }
    /* Attribution anchored to the very bottom-left corner of the map */
    .leaflet-bottom.leaflet-left { margin-bottom: 0; margin-left: 0; }
    .leaflet-control-attribution { font-size: 10px; padding: 1px 5px; background: rgba(255,255,255,0.7) !important; }
    .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 8px rgba(27,46,26,0.18) !important; border-radius: 12px !important; overflow: hidden; }
    .leaflet-control-zoom a { width: 38px !important; height: 38px !important; line-height: 38px !important; color: #2D5016 !important; font-size: 20px !important; font-weight: 600 !important; background: #fff !important; }
    .leaflet-control-zoom a:hover { background: #EEF3E6 !important; }
    /* Neighborhood name labels — prominent, no box, halo for legibility over the map */
    .hood-label { background: transparent !important; border: none !important; box-shadow: none !important;
      color: #1B2E1A !important; font-weight: 800 !important; font-size: 13px !important; letter-spacing: -0.2px;
      padding: 0 !important; white-space: nowrap; pointer-events: none !important;
      text-shadow: 0 0 3px #F5F5F0, 0 0 3px #F5F5F0, 0 0 4px #F5F5F0, 0 1px 2px rgba(245,245,240,0.95); }
    .hood-label::before { display: none !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    // Initialize map with NYC default, will be updated via JavaScript injection.
    // Always north-up; activated neighborhoods are highlighted with a spotlight
    // dim-mask (below) rather than rotation.
    let map = L.map('map', { zoomControl: false }).setView([40.7128, -74.0060], 16);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.attributionControl.setPosition('bottomleft');
    // Report pan/zoom to the app so it can load coverage for the new area.
    map.on('moveend', function() {
      try {
        var c = map.getCenter();
        var bb = map.getBounds();
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'moveend', lat: c.lat, lon: c.lng, zoom: map.getZoom(), b: [bb.getSouth(), bb.getWest(), bb.getNorth(), bb.getEast()] }));
        }
      } catch (e) {}
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
      updateWhenIdle: true,
      keepBuffer: 1
    }).addTo(map);

    let userMarker = L.circleMarker([40.7128, -74.0060], {
      radius: 8,
      fillColor: '#34C759',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);

    let routePolyline = L.polyline([], { color: '#34C759', weight: 14, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    let pickupGroup = L.featureGroup([]).addTo(map);
    let neighborhoodGroup = L.featureGroup([]).addTo(map);

    window.updateLocation = function(lat, lon) {
      userMarker.setLatLng([lat, lon]);
      // In level mode the map is LOCKED to the neighborhood — the dot moves, the
      // frame doesn't. Otherwise recenter only on real movement (constant
      // micro-pans stream fresh tiles for hours — a long-walk memory killer).
      if (levelLocked) return;
      var dist = map.distance(map.getCenter(), [lat, lon]);
      if (dist > 30) {
        map.setView([lat, lon], map.getZoom() || 18);
      }
    };

    window.redrawRoute = function(coords) {
      if (!coords || coords.length === 0) {
        console.log('No coords to draw');
        return;
      }
      // Remove old polyline and draw the swath — a solid bar, not a thread
      map.removeLayer(routePolyline);
      routePolyline = L.polyline(coords, {
        color: '#34C759',
        weight: 14,
        opacity: 0.55,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
      console.log('Route redrawn: ' + coords.length + ' points');
    };

    window.addRoutePoint = function(lat, lon) {
      routePolyline.addLatLng([lat, lon]);
      console.log('Route point added: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
    };

    window.addPickup = function(lat, lon) {
      L.circleMarker([lat, lon], {
        radius: 6,
        fillColor: '#FF3B30',
        color: '#fff',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.7
      }).addTo(pickupGroup);
    };

    window.setInitialLocation = function(lat, lon) {
      map.setView([lat, lon], 16);
      console.log('Map init: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
    };

    // Walks render as freshness-colored route corridors, not center-point blobs.
    // Tiny dot fallback only for legacy cleanups saved before route tracking.
    let historicalGroup = L.featureGroup([]).addTo(map);
    window.addHistoricalRoutes = function(cleanups) {
      historicalGroup.clearLayers();
      cleanups.forEach(function(cleanup) {
        const daysOld = (Date.now() - cleanup.timestamp) / (1000 * 60 * 60 * 24);
        let color, opacity;

        // NYC Scale: fresh=5, dusty=9, attention=13, beyond=not counted
        if (daysOld <= 5) {
          color = '#34C759'; opacity = 0.55; // Fresh
        } else if (daysOld <= 9) {
          color = '#FFCC00'; opacity = 0.5; // Yellow - Getting dusty
        } else if (daysOld <= 13) {
          color = '#FF9500'; opacity = 0.45; // Orange - Needs attention
        } else {
          color = '#FF3B30'; opacity = 0.35; // Red - Not counted
        }

        let drewRoute = false;
        if (cleanup.route_points) {
          try {
            const coords = typeof cleanup.route_points === 'string'
              ? JSON.parse(cleanup.route_points)
              : cleanup.route_points;
            if (Array.isArray(coords) && coords.length > 1) {
              L.polyline(coords, {
                color: color,
                weight: 12,
                opacity: opacity,
                lineCap: 'round',
                lineJoin: 'round'
              }).addTo(historicalGroup);
              drewRoute = true;
            }
          } catch (e) {}
        }
        if (!drewRoute) {
          L.circleMarker([cleanup.location_lat, cleanup.location_lon], {
            radius: 8,
            fillColor: color,
            color: color,
            weight: 0,
            fillOpacity: opacity
          }).addTo(historicalGroup);
        }
      });
      historicalGroup.bringToBack();
    };

    // Street-segment coverage layer (shared across ALL users).
    // Grey dashes = never cleaned; green→red = freshness since last clean.
    // Two coverage sublayers:
    //  - todoGroup: the grey "never cleaned" dashes. Numerous and ambient, so
    //    they stay bubble-scoped (replaced each fetch, skipped when zoomed out)
    //    to protect WebView memory.
    //  - cleanedGroup: your colored progress. Few in number and the whole point,
    //    so they ACCUMULATE across fetches (keyed by segment id) and persist
    //    when you pan or zoom out instead of blinking away with the fetch bubble.
    let todoGroup = L.featureGroup([]).addTo(map);
    let cleanedGroup = L.featureGroup([]).addTo(map);
    var cleanedById = {};
    var CLEANED_CAP = 4000; // hard ceiling so a marathon session can't grow unbounded

    function segFresh(daysOld) {
      if (daysOld <= 5) return ['#34C759', 0.8];
      if (daysOld <= 9) return ['#FFCC00', 0.75];
      if (daysOld <= 13) return ['#FF9500', 0.7];
      return ['#FF3B30', 0.65];
    }

    function redrawCleaned() {
      cleanedGroup.clearLayers();
      var ids = Object.keys(cleanedById);
      if (ids.length > CLEANED_CAP) {
        ids.slice(0, ids.length - CLEANED_CAP).forEach(function(k) { delete cleanedById[k]; });
        ids = Object.keys(cleanedById);
      }
      ids.forEach(function(id) {
        var s = cleanedById[id];
        var c = segFresh(s.daysOld);
        L.polyline(s.coords, { color: c[0], weight: 4, opacity: c[1], lineCap: 'round', lineJoin: 'round' }).addTo(cleanedGroup);
      });
    }

    window.renderSegments = function(segments) {
      todoGroup.clearLayers();
      var cleanedTouched = false;
      segments.forEach(function(seg) {
        if (seg.daysOld === null || seg.daysOld === undefined) {
          L.polyline(seg.coords, { color: '#C7CAC1', weight: 4, opacity: 0.35, dashArray: '2 9', lineCap: 'round', lineJoin: 'round' }).addTo(todoGroup);
        } else {
          cleanedById[seg.id] = { coords: seg.coords, daysOld: seg.daysOld };
          cleanedTouched = true;
        }
      });
      if (cleanedTouched) redrawCleaned();
      // z-order: grey furthest back, green just above it, both under routes/markers
      cleanedGroup.bringToBack();
      todoGroup.bringToBack();
      console.log('Segments: ' + segments.length + ' in view, ' + Object.keys(cleanedById).length + ' cleaned retained');
    };

    window.clearSegments = function() {
      todoGroup.clearLayers();
      cleanedGroup.clearLayers();
      cleanedById = {};
    };

    // Neighborhood outlines layer: every hood in view drawn as a tappable
    // polygon. Tap → focus it (highlight + score). Stored by name so we can
    // re-tint the selected one after a redraw.
    let boundaryGroup = L.featureGroup([]).addTo(map);
    var hoodLayers = {};
    var selectedHoodName = null;
    // Recognizable but light: a soft sage line, transparent (but tappable) fill.
    var HOOD_BASE = { color: '#6F7D64', weight: 1.5, opacity: 0.6, fill: true, fillColor: '#6F7D64', fillOpacity: 0.0, lineJoin: 'round' };
    var HOOD_SEL = { color: '#2D5016', weight: 2.5, opacity: 0.85, fill: true, fillColor: '#2D5016', fillOpacity: 0.06, lineJoin: 'round' };

    window.renderNeighborhoods = function(list) {
      if (!list || !list.length) return;
      list.forEach(function(h) {
        if (hoodLayers[h.name]) return; // already drawn
        var poly = L.polygon(h.ring, HOOD_BASE).addTo(boundaryGroup);
        // Always-on name label at the hood's center — the neighborhood name is
        // the primary wayfinding cue, so it stays visible without a tap.
        poly.bindTooltip(h.name, { permanent: true, direction: 'center', className: 'hood-label', opacity: 1 });
        poly.on('click', function() {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hoodTap', name: h.name }));
          }
        });
        hoodLayers[h.name] = poly;
      });
      boundaryGroup.bringToBack();
    };

    window.highlightNeighborhood = function(name) {
      if (selectedHoodName && hoodLayers[selectedHoodName]) hoodLayers[selectedHoodName].setStyle(HOOD_BASE);
      selectedHoodName = name;
      var layer = hoodLayers[name];
      if (layer) { layer.setStyle(HOOD_SEL); layer.bringToBack(); }
    };

    // ---- Level mode: the whole hood as a bounded "level" you fill in ----
    // North-up. The selected hood is the lit "stage": a dim veil covers the rest
    // of the city with the neighborhood cut out (spotlight). Pane 350 sits above
    // tiles but below all vector overlays + the user dot, so streets and your
    // position stay bright.
    let levelGroup = L.featureGroup([]).addTo(map);
    let spotlightGroup = L.featureGroup([]).addTo(map);
    var levelLocked = false;
    if (!map.getPane('maskPane')) {
      var mp = map.createPane('maskPane');
      mp.style.zIndex = 350;
      mp.style.pointerEvents = 'none';
    }
    var WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];

    function levelColor(daysOld) {
      if (daysOld === null || daysOld === undefined) return ['#BFC4B8', 4, 0.85]; // untouched — soft warm gray, blank territory to claim
      if (daysOld <= 5) return ['#34C759', 5, 0.95];
      if (daysOld <= 9) return ['#FFCC00', 5, 0.9];
      if (daysOld <= 13) return ['#FF9500', 5, 0.9];
      return ['#FF3B30', 5, 0.9];
    }

    function drawSpotlight(ring) {
      spotlightGroup.clearLayers();
      // Veil = world rectangle with the neighborhood as a hole → only the city
      // OUTSIDE the hood is dimmed.
      L.polygon([WORLD_RING, ring], { pane: 'maskPane', stroke: false, fillColor: '#0E140C', fillOpacity: 0.58, interactive: false }).addTo(spotlightGroup);
      L.polygon(ring, { pane: 'maskPane', fill: false, color: '#2D5016', weight: 2.5, opacity: 0.95, lineJoin: 'round', interactive: false }).addTo(spotlightGroup);
    }

    window.enterLevel = function(ring) {
      levelLocked = true;
      try { todoGroup.clearLayers(); cleanedGroup.clearLayers(); } catch (e) {}
      levelGroup.clearLayers();
      drawSpotlight(ring);
      try {
        map.fitBounds(L.latLngBounds(ring), {
          paddingTopLeft: [12, 92],     // clear the level header up top
          paddingBottomRight: [12, 28], // tight margins → fill the screen
          animate: true, duration: 1.1, maxZoom: 18
        });
      } catch (e) {}
    };

    var levelLayersById = {};
    var levelRenderToken = 0;
    // Draw the level's streets in small async chunks. A big neighborhood (e.g.
    // Atlanta's official hoods, which are far larger than NYC's) can hold
    // thousands of segments; drawing them in one synchronous loop froze the UI
    // for seconds. Yielding between chunks keeps the map — and the entry
    // animation — responsive while streets stream in. A new render supersedes
    // any in-flight one via the token.
    window.renderLevel = function(list) {
      levelGroup.clearLayers();
      levelLayersById = {};
      var token = ++levelRenderToken;
      if (!list || !list.length) return;
      var i = 0;
      var CHUNK = 200;
      function step() {
        if (token !== levelRenderToken) return; // superseded by a newer level
        var end = Math.min(i + CHUNK, list.length);
        for (; i < end; i++) {
          var s = list[i];
          var c = levelColor(s.daysOld);
          var pl = L.polyline(s.coords, { color: c[0], weight: c[1], opacity: c[2], lineCap: 'round', lineJoin: 'round' }).addTo(levelGroup);
          if (s.id) levelLayersById[s.id] = pl;
        }
        if (i < list.length) setTimeout(step, 0);
      }
      step();
    };

    // Live recolor a single street to fresh-green as you cover it on a walk.
    window.markLevelClean = function(id) {
      var pl = levelLayersById[id];
      if (pl) pl.setStyle({ color: '#34C759', weight: 5, opacity: 0.95 });
    };

    window.exitLevel = function() {
      levelLocked = false;
      levelGroup.clearLayers();
      spotlightGroup.clearLayers();
    };

    // Parks: filled polygons colored by freshness, drawn under the route.
    let parkGroup = L.featureGroup([]).addTo(map);
    window.renderParks = function(parks) {
      parkGroup.clearLayers();
      parks.forEach(function(park) {
        let color, fill;
        if (park.daysOld === null || park.daysOld === undefined) {
          color = '#8E8E93'; fill = 0.10; // never cleaned
        } else if (park.daysOld <= 5) {
          color = '#34C759'; fill = 0.28;
        } else if (park.daysOld <= 9) {
          color = '#FFCC00'; fill = 0.24;
        } else if (park.daysOld <= 13) {
          color = '#FF9500'; fill = 0.20;
        } else {
          color = '#FF3B30'; fill = 0.18;
        }
        L.polygon(park.polygon, {
          color: color,
          weight: 1.5,
          opacity: 0.7,
          fillColor: color,
          fillOpacity: fill,
        }).addTo(parkGroup);
      });
      parkGroup.bringToBack();
      console.log('Rendered ' + parks.length + ' parks');
    };

    window.showNeighborhoodCoverage = function(cleanups) {
      if (!cleanups || cleanups.length === 0) return;
      console.log('Showing neighborhood coverage: ' + cleanups.length + ' cleanups');
      console.log('First cleanup keys: ' + (cleanups.length > 0 ? Object.keys(cleanups[0]).join(', ') : 'none'));

      let linesDrawn = 0;
      cleanups.forEach(function(cleanup, idx) {
        const daysOld = (Date.now() - cleanup.timestamp) / (1000 * 60 * 60 * 24);
        let color, opacity;

        if (daysOld <= 5) {
          color = '#34C759'; opacity = 0.6;
        } else if (daysOld <= 9) {
          color = '#FFCC00'; opacity = 0.5;
        } else if (daysOld <= 13) {
          color = '#FF9500'; opacity = 0.4;
        } else {
          color = '#FF3B30'; opacity = 0.3;
        }

        // Draw route line if available
        if (cleanup.route_points) {
          try {
            const coords = typeof cleanup.route_points === 'string'
              ? JSON.parse(cleanup.route_points)
              : cleanup.route_points;

            if (Array.isArray(coords) && coords.length > 1) {
              L.polyline(coords, {
                color: color,
                weight: 3,
                opacity: opacity,
                lineCap: 'round',
                lineJoin: 'round'
              }).addTo(neighborhoodGroup);
              linesDrawn++;
            }
          } catch (e) {
            console.log('Route parse error for cleanup ' + idx);
          }
        }
      });
      console.log('Drew ' + linesDrawn + ' route lines');
    };

    window.clearNeighborhoodCoverage = function() {
      neighborhoodGroup.clearLayers();
      console.log('Neighborhood coverage cleared');
    };

    // Show/hide the past-coverage underlay (street freshness shading + dimmed
    // past routes) without destroying it — used by the in-walk coverage toggle.
    window.setCoverageVisible = function(visible) {
      [cleanedGroup, todoGroup, boundaryGroup, historicalGroup].forEach(function(g) {
        if (!g) return;
        if (visible) {
          if (!map.hasLayer(g)) map.addLayer(g);
          g.bringToBack();
        } else if (map.hasLayer(g)) {
          map.removeLayer(g);
        }
      });
    };
  </script>
</body>
</html>`,
            }}
            scrollEnabled={false}
            nestedScrollEnabled={false}
          />
        ) : (
          <View style={styles.mapPlaceholder}>
            <Icon name="pin" size={40} color={COLORS.sage} />
            <Text style={[styles.mapText, { marginTop: 8 }]}>Getting location…</Text>
          </View>
        )}
      </View>

      {/* Main Controls - Always at bottom */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 2 }, isListening && styles.controlsCompact]}>
        {!isListening ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonStart]}
            onPress={startCleanup}
          >
            <Icon name="route" size={20} color="#fff" />
            <Text style={styles.buttonTextLarge}>Start cleanup</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.buttonStop]}
            onPress={stopCleanup}
          >
            <View style={styles.stopSquare} />
            <Text style={styles.buttonTextLarge}>Stop &amp; save</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cleanliness Scale Info Modal */}
      <Modal visible={showScaleInfo} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.scaleInfoModal}>
            <View style={styles.scaleInfoHeader}>
              <Text style={styles.scaleInfoTitle}>Cleanliness scale (NYC)</Text>
              <TouchableOpacity onPress={() => setShowScaleInfo(false)}>
                <Text style={styles.scaleInfoClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scaleInfoContent}>
              <View style={styles.scaleItem}>
                <View style={[styles.scaleDot, { backgroundColor: '#34C759' }]} />
                <View style={styles.scaleText}>
                  <Text style={styles.scaleItemTitle}>Fresh (0-5 days)</Text>
                  <Text style={styles.scaleItemDesc}>Well-maintained, recently cleaned</Text>
                </View>
              </View>

              <View style={styles.scaleItem}>
                <View style={[styles.scaleDot, { backgroundColor: '#FFCC00' }]} />
                <View style={styles.scaleText}>
                  <Text style={styles.scaleItemTitle}>Getting Dusty (6-9 days)</Text>
                  <Text style={styles.scaleItemDesc}>Litter accumulating, cleanup soon</Text>
                </View>
              </View>

              <View style={styles.scaleItem}>
                <View style={[styles.scaleDot, { backgroundColor: '#FF9500' }]} />
                <View style={styles.scaleText}>
                  <Text style={styles.scaleItemTitle}>Needs Attention (10-13 days)</Text>
                  <Text style={styles.scaleItemDesc}>Priority area, significant litter</Text>
                </View>
              </View>

              <View style={styles.scaleItem}>
                <View style={[styles.scaleDot, { backgroundColor: '#FF3B30' }]} />
                <View style={styles.scaleText}>
                  <Text style={styles.scaleItemTitle}>Not Counted (14+ days)</Text>
                  <Text style={styles.scaleItemDesc}>Doesn't count—needs immediate re-cleaning</Text>
                </View>
              </View>

              <View style={styles.scaleInfoNote}>
                <Text style={styles.scaleInfoNoteText}>
                  NYC's aggressive scale forces regular maintenance. Areas beyond 14 days must be re-cleaned to count toward coverage.
                </Text>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.scaleInfoButton2}
              onPress={() => setShowScaleInfo(false)}
            >
              <Text style={styles.scaleInfoButtonText2}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Session Summary Modal */}
      <Modal visible={showSummary} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Tap the dimmed area to dismiss the (done-less) decimal keypad */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => Keyboard.dismiss()} />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Session summary</Text>

            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Detected by Motion:</Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{pickupCount}</Text>
                  <Text style={styles.summaryItemLabel}>Pickups</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{formatTime(elapsedSeconds)}</Text>
                  <Text style={styles.summaryItemLabel}>Duration</Text>
                </View>
              </View>
              <Text style={styles.summaryEstimate}>
                Est. collected: {formatKitchenBags(itemsToBags(pickupCount))}
              </Text>
            </View>

            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Fill a bag? Tell us how big (optional)</Text>

              <View style={styles.bagSizeOptions}>
                {['small', 'medium', 'large', 'xl'].map((size) => (
                  <TouchableOpacity
                    key={size}
                    style={[styles.bagOption, bagReported && bagSize === size && styles.bagOptionActive]}
                    onPress={() => { setBagSize(size as any); setBagReported(true); }}
                  >
                    <Text style={[styles.bagOptionText, bagReported && bagSize === size && styles.bagOptionTextActive]}>
                      {size === 'small' ? 'Small\n(13-15 gal)' :
                       size === 'medium' ? 'Medium\n(30-35 gal)' :
                       size === 'large' ? 'Large\n(45-60 gal)' :
                       'XL\n(60+ gal)'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.fullnessContainer}>
                <Text style={styles.fullnessLabel}>
                  Fullness: {bagFullness}%
                </Text>
                <View style={styles.sliderTrack}>
                  <View
                    style={[
                      styles.sliderFill,
                      { width: `${bagFullness}%` }
                    ]}
                  />
                </View>
                <View style={styles.sliderButtons}>
                  <TouchableOpacity onPress={() => { setBagFullness(Math.max(0, bagFullness - 10)); setBagReported(true); }}>
                    <Text style={styles.sliderButton}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setBagFullness(Math.min(100, bagFullness + 10)); setBagReported(true); }}>
                    <Text style={styles.sliderButton}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.comparisonText}>
                {bagReported
                  ? `Saving ${formatBags(reportedBags(bagSize, bagFullness))} — your report beats our estimate`
                  : `Skip this and we'll estimate from your ${pickupCount} pickups`}
              </Text>
            </View>

            {/* Photo intake */}
            {photoUri ? (
              <View style={styles.photoWrap}>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                <TouchableOpacity style={styles.photoRemove} onPress={() => setPhotoUri(null)}>
                  <Icon name="close" size={16} color="#fff" sw={2.2} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.addPhoto} onPress={pickPhoto}>
                <View style={styles.addPhotoWell}>
                  <Icon name="camera" size={22} color={COLORS.sage} sw={1.7} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.addPhotoTitle}>Add a photo</Text>
                  <Text style={styles.addPhotoSub}>Show the spot you cleaned up</Text>
                </View>
              </TouchableOpacity>
            )}

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.summaryButton, styles.cancelButton]}
                onPress={() => {
                  setShowSummary(false);
                  setPickupCount(0);
                  setElapsedSeconds(0);
                  setPhotoUri(null);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.summaryButton, styles.saveButton]}
                onPress={saveSummary}
              >
                <Text style={styles.saveButtonText}>Save & log</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Session Results Modal */}
      <Modal visible={showResults} animationType="slide">
        <SafeAreaView style={styles.resultsContainer}>
          <ScrollView contentContainerStyle={styles.resultsContent}>
            <View style={styles.resultsHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.resultsTitle}>Cleanup saved</Text>
                <Text style={styles.resultsSavedNote}>Already logged to your impact — this is just your recap.</Text>
              </View>
              <TouchableOpacity
                onPress={finishSession}
              >
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Coverage Stats */}
            <View style={styles.resultsSection}>
              <Text style={styles.resultsSubtitle}>Coverage & activity</Text>
              <View style={styles.statsGrid}>
                <View style={styles.resultStatBox}>
                  <Text style={styles.resultStatValue}>
                    {calculateCoverage().distance}
                  </Text>
                  <Text style={styles.resultStatLabel}>km walked</Text>
                </View>
                <View style={styles.resultStatBox}>
                  <Text style={styles.resultStatValue}>{pickupCount}</Text>
                  <Text style={styles.resultStatLabel}>pickups detected</Text>
                </View>
                <View style={styles.resultStatBox}>
                  <Text style={styles.resultStatValue}>{calculateCoverage().points}</Text>
                  <Text style={styles.resultStatLabel}>location points</Text>
                </View>
              </View>
            </View>

            {/* Pickup Heatmap - Show actual map with route + pickups */}
            <View style={styles.resultsSection}>
              <Text style={styles.resultsSubtitle}>Pickup map</Text>
              {pickupLocations.length > 0 && sessionRoute.length > 0 ? (
                <View style={styles.heatmapBox}>
                  <Text style={styles.heatmapTitle}>
                    {pickupLocations.length} pickups across {calculateCoverage().points} location points
                  </Text>

                  {/* Embedded map showing route + pickups */}
                  <WebView
                    ref={heatmapWebviewRef}
                    style={styles.heatmapMapView}
                    scrollEnabled={false}
                    originWhitelist={['*']}
                    onLoad={() => {
                      console.log('Heatmap WebView loaded');
                      // Wait a moment for Leaflet to load, then inject data
                      setTimeout(() => {
                        if (heatmapWebviewRef.current) {
                          const routeCoords = sessionRoute.map(p => [p.lat, p.lon]);
                          console.log(`📍 Injecting heatmap: ${routeCoords.length} route points, ${pickupLocations.length} pickups`);
                          heatmapWebviewRef.current.injectJavaScript(`
                            try {
                              if (window.L && window.drawRoute && window.drawPickups) {
                                window.drawRoute(${JSON.stringify(routeCoords)});
                                window.drawPickups(${JSON.stringify(pickupLocations)});
                                console.log('Heatmap data injected');
                              } else {
                                console.log('⏳ Waiting for Leaflet: L=' + (typeof window.L) + ', drawRoute=' + (typeof window.drawRoute));
                              }
                            } catch(e) {
                              console.error('Heatmap injection error: ' + e.toString());
                            }
                          `);
                        }
                      }, 500);
                    }}
                    onError={(error) => console.error('Heatmap WebView error:', error)}
                    source={{
                      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; }
    body { background: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
  <script>
    console.log('HTML + Leaflet script loaded');

    let mapInstance = null;
    let ready = false;

    // Wait for Leaflet to be available
    function waitForLeaflet(callback, attempts = 0) {
      if (typeof L !== 'undefined' && document.getElementById('map')) {
        console.log('Leaflet ready');
        callback();
      } else if (attempts < 20) {
        setTimeout(() => waitForLeaflet(callback, attempts + 1), 100);
      } else {
        console.error('Leaflet failed to load');
      }
    }

    waitForLeaflet(function() {
      try {
        mapInstance = L.map('map').setView([40.7128, -74.0060], 17);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap © CARTO',
          subdomains: 'abcd',
          maxZoom: 19,
          updateWhenIdle: true,
          keepBuffer: 1
        }).addTo(mapInstance);
        ready = true;
        console.log('Map initialized');
      } catch(e) {
        console.error('Map init failed: ' + e.toString());
      }
    });

    window.drawRoute = function(coords) {
      console.log('drawRoute called with ' + (coords ? coords.length : 'null'));
      if (!ready) {
        console.log('Map not ready yet');
        return;
      }
      if (!coords || coords.length < 2) return;

      L.polyline(coords, {
        color: '#34C759',
        weight: 3.5,
        opacity: 0.9,
        dashArray: '',
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(mapInstance);
      const group = L.featureGroup(coords.map(c => L.marker(c)));
      mapInstance.fitBounds(group.getBounds().pad(0.1));
      console.log('Route drawn');
    };

    window.drawPickups = function(pickups) {
      console.log('drawPickups called with ' + (pickups ? pickups.length : 'null'));
      if (!ready || !pickups) return;

      pickups.forEach((p, i) => {
        L.circleMarker([p.lat, p.lon], {
          radius: 4,
          fillColor: '#FF3B30',
          color: '#fff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.9
        }).bindPopup('Pickup #' + (i+1)).addTo(mapInstance);
      });
      console.log('Pickups drawn');
    };

    console.log('Functions defined');
  </script>
</body>
</html>`,
                    }}
                  />

                  <Text style={styles.heatmapData}>
                    Red markers = pickup locations{'\n'}
                    Green line = your route
                  </Text>
                </View>
              ) : (
                <Text style={styles.noData}>Need both route and pickups to show map</Text>
              )}
            </View>

            {/* Route Summary */}
            <View style={styles.resultsSection}>
              <Text style={styles.resultsSubtitle}>Route taken</Text>
              <View style={styles.routeBox}>
                <Text style={styles.routeLabel}>Starting Point</Text>
                <Text style={styles.routeCoords}>
                  {sessionRoute[0]?.lat.toFixed(4) || '—'}, {sessionRoute[0]?.lon.toFixed(4) || '—'}
                </Text>

                <Text style={styles.routeLabel}>Ending Point</Text>
                <Text style={styles.routeCoords}>
                  {sessionRoute[sessionRoute.length - 1]?.lat.toFixed(4) || '—'}, {sessionRoute[sessionRoute.length - 1]?.lon.toFixed(4) || '—'}
                </Text>

                <Text style={styles.routeLabel}>Coverage Area (approx)</Text>
                <Text style={styles.routeCoords}>
                  {calculateCoverage().distance} km walked
                </Text>
              </View>
            </View>

            {/* Photo hero (if added) */}
            {photoUri && (
              <View style={styles.resultsSection}>
                <Image source={{ uri: photoUri }} style={styles.resultsPhoto} />
              </View>
            )}

            {/* Share your impact */}
            <View style={styles.resultsSection}>
              <Text style={styles.resultsSubtitle}>Share your impact</Text>
              <TouchableOpacity style={styles.shareCta} onPress={() => setShowShare(true)}>
                <Icon name="share" size={20} color="#fff" sw={2} />
                <Text style={styles.shareCtaText}>Share your cleanup</Text>
              </TouchableOpacity>
              {photoUri && communitySharing && !communityAutoPost && (
                <TouchableOpacity style={styles.communityCta} onPress={() => setShowCommunityCompose(true)}>
                  <Icon name="camera" size={20} color={COLORS.sage} sw={2} />
                  <Text style={styles.communityCtaText}>Share to community</Text>
                </TouchableOpacity>
              )}
              {photoUri && communitySharing && communityAutoPost && (
                <Text style={styles.autoPostNote}>Auto-posted to community. Manage it from the Community tab.</Text>
              )}
            </View>

            {/* Action Buttons */}
            <View style={styles.resultsActions}>
              <TouchableOpacity
                style={[styles.resultButton, styles.resultButtonExport]}
                onPress={exportSession}
              >
                <Text style={styles.resultButtonExportText}>Export session</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.resultsActions}>
              <TouchableOpacity
                style={[styles.resultButton, styles.resultButtonSecondary]}
                onPress={() => {
                  finishSession(); // also exits the level so the map isn't left stuck
                  router.push('/(tabs)/activity');
                }}
              >
                <Text style={styles.resultButtonSecondaryText}>View all sessions</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultButton, styles.resultButtonPrimary]}
                onPress={finishSession}
              >
                <Text style={styles.resultButtonPrimaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Share-to-community composer — rendered INSIDE the results modal as
              an overlay (a separate Modal would stack behind it on iOS, so its
              taps never registered). */}
          {showCommunityCompose && (
            <KeyboardAvoidingView
              style={styles.composeOverlay}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <TouchableOpacity style={styles.composeBackdrop} activeOpacity={1} onPress={() => Keyboard.dismiss()} />
              <View style={styles.composeSheet}>
                <Text style={styles.composeTitle}>Share to community</Text>
                {photoUri && <Image source={{ uri: photoUri }} style={styles.composePhoto} />}
                <TextInput
                  style={styles.composeInput}
                  placeholder="Add a caption (optional)"
                  placeholderTextColor={COLORS.mutedSage}
                  value={communityCaption}
                  onChangeText={setCommunityCaption}
                  multiline
                  maxLength={280}
                  editable={!posting}
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
                <Text style={styles.composeHint}>
                  Shows your neighborhood{neighborhood ? ` (${neighborhood})` : ''} and caption — never your exact location.
                </Text>
                <View style={styles.composeActions}>
                  <TouchableOpacity
                    style={[styles.composeBtn, styles.composeCancel]}
                    onPress={() => {
                      Keyboard.dismiss();
                      setShowCommunityCompose(false);
                    }}
                    disabled={posting}
                  >
                    <Text style={styles.composeCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.composeBtn, styles.composePost]}
                    onPress={() => {
                      Keyboard.dismiss();
                      shareToCommunity();
                    }}
                    disabled={posting}
                  >
                    {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.composePostText}>Post</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </Modal>

      <ShareComposer
        visible={showShare}
        onClose={() => setShowShare(false)}
        pieces={pickupCount}
        bags={bagReported ? reportedBags(bagSize, bagFullness) : itemsToBags(pickupCount)}
        distanceMi={parseFloat(String(calculateCoverage().distance || '0')) * 0.621371}
        photoUri={photoUri}
        fullName={user?.displayName || 'You'}
        initials={((user?.displayName || 'You').trim().split(/\s+/).map((s: string) => s[0]).slice(0, 2).join('') || 'Y').toUpperCase()}
        team={userTeam || ''}
        hood={activeLevel?.name || user?.neighborhood || ''}
        hoodPct={activeLevel?.freshPct}
        inviteUrl={`https://pick.app/join?ref=${user?.uid || ''}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream,
    flexDirection: 'column',
  },
  containerFullscreen: {
    backgroundColor: COLORS.cream,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: COLORS.darkSage,
    textShadowColor: 'rgba(245,245,240,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  coverageText: {
    fontSize: 12,
    color: COLORS.sage,
    fontWeight: '600',
    marginTop: 2,
    textShadowColor: 'rgba(245,245,240,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  completionPill: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginLeft: 10,
    shadowColor: COLORS.sage,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  completionPct: { fontSize: 18, fontWeight: '700', color: COLORS.sage, letterSpacing: -0.3 },
  completionLbl: { fontSize: 9, fontWeight: '600', color: COLORS.mutedSage, textTransform: 'uppercase', letterSpacing: 0.3 },
  levelReveal: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(27,46,26,0.82)',
    alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  levelRevealSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 18 },
  levelRevealName: { color: '#fff', fontSize: 26, fontWeight: '700', letterSpacing: -0.4, marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
  levelBack: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.white,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
    shadowColor: COLORS.sage, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  levelBackIcon: { fontSize: 26, fontWeight: '700', color: COLORS.sage, marginTop: -4 },
  pickingBanner: {
    position: 'absolute', alignSelf: 'center', zIndex: 20,
    backgroundColor: 'rgba(27,46,26,0.88)', borderRadius: 14,
    paddingVertical: 6, paddingHorizontal: 14, maxWidth: '90%',
  },
  pickingBannerText: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  teamOrSuperlative: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.sage,
    overflow: 'hidden',
    backgroundColor: COLORS.white,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    shadowColor: '#1B2E1A',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  topBarWhite: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 6,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: COLORS.darkSage,
    paddingVertical: 16,
    paddingHorizontal: SPACING.lg,
    borderRadius: 16,
    gap: 16,
    shadowColor: COLORS.darkSage,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  topBarStat: {
    alignItems: 'center',
  },
  topBarValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  topBarLabel: {
    fontSize: 11,
    color: '#A8B896',
    fontWeight: '500',
  },
  coverageToggle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 2,
  },
  pocketButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pocketButtonText: {
    fontSize: 16,
  },
  pocketButtonLabel: {
    fontSize: 9,
    color: '#999',
    fontWeight: '600',
  },
  pocketOverlay: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pocketCount: {
    fontSize: 96,
    fontWeight: '200',
    color: '#1f4d2a', // dim green — visible if you peek, minimal OLED battery use
  },
  pocketTimer: {
    fontSize: 18,
    color: '#27331f',
    marginTop: 8,
  },
  pocketHint: {
    fontSize: 12,
    color: '#222',
    position: 'absolute',
    bottom: 40,
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  mapContainerExpanded: {
    borderRadius: 0,
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: COLORS.light,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
  },
  mapPlaceholderFullscreen: {
    backgroundColor: '#1a1a1a',
    borderWidth: 0,
  },
  mapIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  mapText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  mapTextLarge: {
    fontSize: 24,
    color: '#fff',
  },
  mapSubtext: {
    fontSize: 12,
    color: COLORS.mutedSage,
  },
  mapCoordLarge: {
    fontSize: 28,
    fontWeight: '700',
    color: '#34C759',
  },
  mapStatus: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '600',
    marginTop: 12,
  },
  mapRouteInfo: {
    fontSize: 12,
    color: COLORS.mutedSage,
    marginTop: 8,
  },
  mapStatsContainer: {
    marginTop: 16,
    alignItems: 'center',
    gap: 8,
  },
  mapStat: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  batterySaverBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  batterySaverLabel: {
    flex: 1,
  },
  batterySaverText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 2,
  },
  batterySaverSubtext: {
    fontSize: 11,
    color: COLORS.mutedSage,
  },
  toggleSwitch: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e0e0e0',
    padding: 2,
    justifyContent: 'flex-start',
  },
  toggleSwitchActive: {
    backgroundColor: COLORS.accent,
    justifyContent: 'flex-end',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  toggleThumbActive: {
    backgroundColor: '#fff',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  controlsCompact: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  timerDisplay: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  timerLabel: {
    fontSize: 14,
    color: COLORS.mutedSage,
  },
  timerText: {
    fontSize: 48,
    fontWeight: '300',
    color: '#34C759',
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  pickupCountText: {
    fontSize: 14,
    color: COLORS.mutedSage,
    fontWeight: '500',
  },
  button: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonStart: {
    backgroundColor: COLORS.sage,
    shadowColor: COLORS.sage,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  buttonStop: {
    backgroundColor: COLORS.error,
    shadowColor: COLORS.error,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  stopSquare: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  buttonTextLarge: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 20,
    textAlign: 'center',
  },
  summaryBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mutedSage,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#34C759',
    marginBottom: 4,
  },
  summaryItemLabel: {
    fontSize: 12,
    color: COLORS.mutedSage,
  },
  summaryEstimate: {
    fontSize: 12,
    color: COLORS.mutedSage,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  weightInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.darkSage,
    marginBottom: 8,
  },
  comparisonText: {
    fontSize: 12,
    color: COLORS.mutedSage,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.mutedSage,
  },
  saveButton: {
    backgroundColor: COLORS.accent,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  resultsContainer: {
    flex: 1,
    backgroundColor: '#f9f9f9',
  },
  resultsContent: {
    paddingHorizontal: 16,
    paddingTop: 32,
    paddingBottom: 40,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  resultsTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  resultsSavedNote: {
    fontSize: 13,
    color: COLORS.mutedSage,
    marginTop: 2,
  },
  closeButton: {
    fontSize: 24,
    color: COLORS.mutedSage,
    paddingHorizontal: 12,
  },
  resultsSection: {
    marginBottom: 24,
  },
  resultsSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  resultStatBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  resultStatValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#34C759',
    marginBottom: 4,
  },
  resultStatLabel: {
    fontSize: 11,
    color: COLORS.mutedSage,
    textAlign: 'center',
  },
  heatmapBox: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
  },
  heatmapTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 12,
  },
  heatmapMapView: {
    height: 300,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  heatmapData: {
    fontSize: 12,
    color: COLORS.mutedSage,
    lineHeight: 18,
  },
  noData: {
    fontSize: 13,
    color: COLORS.mutedSage,
    textAlign: 'center',
    paddingVertical: 20,
    fontStyle: 'italic',
  },
  routeBox: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
  },
  routeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.mutedSage,
    marginBottom: 4,
    marginTop: 8,
  },
  routeCoords: {
    fontSize: 13,
    color: COLORS.darkSage,
    fontFamily: 'Courier',
    fontWeight: '500',
    marginBottom: 8,
  },
  resultsActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  resultButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  resultButtonPrimary: {
    backgroundColor: COLORS.accent,
  },
  resultButtonPrimaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  resultButtonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  resultButtonSecondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#34C759',
  },
  resultButtonExport: {
    backgroundColor: COLORS.cream,
    borderWidth: 2,
    borderColor: COLORS.mutedSage,
  },
  resultButtonExportText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.mutedSage,
  },
  modeToggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
  },
  modeButtonActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.light,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mutedSage,
  },
  modeButtonTextActive: {
    color: '#34C759',
  },
  bagSizeOptions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  bagOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: '#f9f9f9',
    alignItems: 'center',
  },
  bagOptionActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.light,
  },
  bagOptionText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.darkSage,
    textAlign: 'center',
  },
  bagOptionTextActive: {
    color: '#34C759',
  },
  fullnessContainer: {
    marginBottom: 12,
  },
  fullnessLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 8,
  },
  sliderTrack: {
    height: 8,
    backgroundColor: '#ddd',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  sliderFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  sliderButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderButton: {
    fontSize: 20,
    fontWeight: '700',
    color: '#34C759',
    paddingHorizontal: 12,
  },
  weightEstimate: {
    backgroundColor: COLORS.light,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  weightEstimateLabel: {
    fontSize: 12,
    color: COLORS.mutedSage,
    marginBottom: 4,
  },
  weightEstimateValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#34C759',
  },
  scaleInfoButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    zIndex: 10,
  },
  scaleInfoButtonText: {
    fontSize: 20,
  },
  mapControls: {
    position: 'absolute',
    top: 112,
    right: 16,
    flexDirection: 'column',
    gap: 8,
    zIndex: 10,
  },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapButtonActive: {
    backgroundColor: COLORS.sage,
  },
  mapButtonText: {
    fontSize: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scaleInfoModal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '85%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  scaleInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  scaleInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  scaleInfoClose: {
    fontSize: 20,
    color: COLORS.mutedSage,
  },
  scaleInfoContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  scaleItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
    alignItems: 'flex-start',
  },
  scaleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginTop: 2,
    flexShrink: 0,
  },
  scaleText: {
    flex: 1,
  },
  scaleItemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 2,
  },
  scaleItemDesc: {
    fontSize: 12,
    color: COLORS.mutedSage,
    lineHeight: 16,
  },
  scaleInfoNote: {
    backgroundColor: COLORS.light,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  scaleInfoNoteText: {
    fontSize: 12,
    color: '#558B2F',
    lineHeight: 16,
    fontStyle: 'italic',
  },
  scaleInfoButton2: {
    backgroundColor: COLORS.accent,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  scaleInfoButtonText2: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  // Photo intake (summary)
  addPhoto: {
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#C4CDBA',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  addPhotoWell: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EEF3E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTitle: { fontSize: 14, fontWeight: '700', color: COLORS.darkSage },
  addPhotoSub: { fontSize: 12, color: COLORS.mutedSage, marginTop: 2 },
  photoWrap: {
    position: 'relative',
    marginTop: 4,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  photoPreview: { width: '100%', height: 160, backgroundColor: '#EEF3E6' },
  photoRemove: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(27,46,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Results photo + share CTA
  resultsPhoto: { width: '100%', height: 180, borderRadius: 16, backgroundColor: '#EEF3E6' },
  shareCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.sage,
    borderRadius: 16,
    paddingVertical: 16,
  },
  shareCtaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  communityCta: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: COLORS.sage,
  },
  communityCtaText: { color: COLORS.sage, fontSize: 16, fontWeight: '700' },
  autoPostNote: { marginTop: 10, fontSize: 13, color: COLORS.mutedSage, textAlign: 'center' },
  composeOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 50 },
  composeBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(27,46,26,0.45)' },
  composeSheet: { backgroundColor: COLORS.cream, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 34 },
  composeTitle: { fontSize: 20, fontWeight: '700', color: COLORS.darkSage, marginBottom: 14 },
  composePhoto: { width: '100%', aspectRatio: 1.4, borderRadius: 14, backgroundColor: COLORS.light, marginBottom: 14 },
  composeInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    fontSize: 15,
    color: COLORS.darkSage,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  composeHint: { fontSize: 12, color: COLORS.mutedSage, marginTop: 10, lineHeight: 17 },
  composeActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  composeBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  composeCancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  composeCancelText: { color: COLORS.darkSage, fontSize: 15, fontWeight: '700' },
  composePost: { backgroundColor: COLORS.sage },
  composePostText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
