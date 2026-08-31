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
import { itemsToBags, reportedBags, formatBags, formatKitchenBags, BAG_SIZE_OPTIONS, BAG_SIZE_FACTORS } from '../../src/services/impactMetrics';
import { BagDetails } from '../../src/pick/BagDetails';
import { getCoverage, markRouteCleaned, getParkCoverage, markParksCleaned, getTileStats, tileId, getCoverageForRing, routeCoverageFraction, nearestStreetSegment, assignRoutePointsToNearestSegment, SNAP_DISTANCE_M, COVERAGE_THRESHOLD, type RenderSegment } from '../../src/services/streetSegments';
import { saveAdoptedBlock, listMyAdoptions } from '../../src/services/adoptions';
import { osmNeighborhood, getHoodsInBounds, getOsmHoodsInBounds, hoodLabelsNeeded, hasNeighborhoods, polygonStats, HoodShape, citySlug, isFallbackCityWithNoSubdivision } from '../../src/services/neighborhoods';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../src/services/firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import Constants from 'expo-constants';
import { startBackgroundSession, stopBackgroundSession, drainBackgroundLocations } from '../../src/services/backgroundSession';
import { beginSessionTrace, heartbeat, endSessionTrace, isSessionActiveFresh } from '../../src/services/crashRecorder';
import { saveWalkDraft, loadWalkDraft, clearWalkDraft } from '../../src/services/sessionRecovery';
import { startPresence, pingPresence, endPresence, getLiveWalks } from '../../src/services/presence';
import { computeNeed, parseRoute, needColor, needTileKey, type NeedTile } from '../../src/services/needMap';
import { syncWorkoutToHealth, isHealthSyncEnabled } from '../../src/services/healthService';
import { simplifyRoute, simplifyCoordPairs, privacyTrimRoute } from '../../src/services/routeUtils';
import { walkPaceProfile } from '../../src/services/motionEvaluation';
import { getFitnessService } from '../../src/services/fitnessService';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getBadgeService } from '../../src/services/badgeService';
import { SPACING } from '../../src/constants/colors';
import { C, Fonts, radius } from '../../src/pick/theme';
import { Icon } from '../../src/pick/Icon';
import { addWatchCommandListener, sendStatsToWatch } from '../../modules/watch-session';
import { groundTruthModeSync, isGroundTruthMode } from '../../src/services/groundTruthMode';
import { startCleanupActivity, updateCleanupActivity, endCleanupActivity } from '../../modules/live-activity';
import { findMyLiveEvent, subscribeEventTotal, reportSessionPickups, commitSessionPickups, LiveEvent } from '../../src/services/challengeLive';
import { refreshMyChallengeContributions } from '../../src/services/challenges';
import { getWeeklyGoal, syncWeeklyGoalReminder } from '../../src/services/weeklyGoal';
import { computeStreak } from '../../src/services/streaks';
import { isSegmentHapticsEnabled, segmentHapticsEnabledSync, segmentCompleteHaptic } from '../../src/services/haptics';
import { ShareComposer } from '../../src/pick/ShareComposer';
import { TESTFLIGHT_URL } from '../../src/services/recap';
import { postToBluesky } from '../../src/services/bluesky';

const LAST_BAG_SIZE_KEY = '@pick_last_bag_size';
const LOCATION_EXPLAINER_SHOWN_KEY = '@pick_location_explainer_shown';

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webviewRef = useRef<WebView>(null);
  const [pickupCount, setPickupCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock anchor for the timer: elapsed is derived from this, not counted
  // tick-by-tick, so a suspended app (screen locked in pocket) shows the true
  // duration on resume instead of under-counting.
  const sessionStartRef = useRef(0);
  // Show the "foreground-only" heads-up at most once per app launch.
  const fgWarnedRef = useRef(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState('');
  const [communitySharing, setCommunitySharing] = useState(true);
  const [communityAutoPost, setCommunityAutoPost] = useState(false);
  const [blueskyAutoPost, setBlueskyAutoPost] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // 'background' = OS keeps the walk alive screen-off (real build + Always loc);
  // 'foreground' = screen must stay on (Expo Go / permission denied); null = unknown.
  const [sessionMode, setSessionMode] = useState<'background' | 'foreground' | null>(null);
  const startingRef = useRef(false);
  const [showCommunityCompose, setShowCommunityCompose] = useState(false);
  const [communityCaption, setCommunityCaption] = useState('');
  const [posting, setPosting] = useState(false);

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
  // Bag size persists across walks: someone who uses yard bags uses them
  // every time, and re-picking it after every walk is pure friction. Written
  // through to disk on every change, restored on mount.
  const [bagSize, setBagSize] = useState<string>('kitchen');
  const chooseBagSize = (key: string) => {
    setBagSize(key);
    AsyncStorage.setItem(LAST_BAG_SIZE_KEY, key).catch(() => {});
  };
  useEffect(() => {
    AsyncStorage.getItem(LAST_BAG_SIZE_KEY)
      .then((v) => { if (v && BAG_SIZE_FACTORS[v]) setBagSize(v); })
      .catch(() => {});
  }, []);
  const [bagCount, setBagCount] = useState(1);
  // User's correction to the detected pickup count. null = untouched, so the
  // detector's number stands. Deliberately separate from pickupCount: that
  // stays the RAW sensor figure and is stored as items_detected for tuning.
  const [userCount, setUserCount] = useState<number | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [bagFullness, setBagFullness] = useState(50);
  // True once the user touches the bag report — their report then wins over the estimate.
  const [bagReported, setBagReported] = useState(false);
  // Plain-language "how much did you collect?" chips — fullness and quantity
  // only, RELATIVE to whichever bag size is selected above them.
  //
  // These used to hardcode size: 'kitchen'. Someone filling a 30-gallon yard
  // bag tapped "A full bag" and was credited one kitchen bag — a 2.3x
  // under-credit falling hardest on the people doing the most work. Size is
  // now its own always-visible control and these express amount against it.
  const AMOUNT_OPTIONS: { key: string; label: string; fullness: number; count: number }[] = [
    { key: 'handful', label: 'Just a handful', fullness: 25, count: 1 },
    { key: 'half', label: 'Half a bag', fullness: 50, count: 1 },
    { key: 'full', label: 'A full bag', fullness: 100, count: 1 },
    { key: 'multi', label: '2 bags', fullness: 100, count: 2 },
  ];
  const [stats, setStats] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [userTeam, setUserTeam] = useState<string>('');
  // User's preferred distance unit ('mi' | 'km'), loaded from settings.
  const [distanceUnit, setDistanceUnit] = useState<'mi' | 'km'>('mi');
  // Bumped to remount the map WebView after a session ends — works around the
  // RN/iOS quirk where a WebView stops receiving touches once a Modal (the
  // results recap) has been shown over it.
  const [mapKey, setMapKey] = useState(0);
  // "Need" map: overlay that colors blocks by how much they need a cleanup.
  const [needMode, setNeedMode] = useState(false);
  const [needTop, setNeedTop] = useState<NeedTile[]>([]);
  // "My impact" overlay: which blocks you've touched + pickups over a window.
  const [impactWindow, setImpactWindow] = useState<null | '24h' | '7d'>(null);
  const [impactStats, setImpactStats] = useState({ pickups: 0, blocks: 0, walks: 0 });
  // The consolidated map-tools button (press/hold to reveal Impact + Adopt).
  const [toolsOpen, setToolsOpen] = useState(false);
  const [superlative, setSuperlative] = useState<string>('');
  const [sessionRoute, setSessionRoute] = useState<any[]>([]);
  // Drives unmounting the heavy map WebView when backgrounded mid-cleanup
  // (iOS gives backgrounded apps a tiny memory budget — the WebView was the
  // prime suspect for the ~7-min long-walk kills).
  const [appActive, setAppActive] = useState(true);
  const [pickupLocations, setPickupLocations] = useState<any[]>([]);
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  // True when moving too fast to be picking litter (biking/vehicle) — the
  // detector gates pickups out; we surface it so the user knows why.
  const [tooFast, setTooFast] = useState(false);
  const [batterySaver, setBatterySaver] = useState(true); // Optimized for battery
  const pickupCounterRef = useRef(0); // Track pickups since last location record
  /** Tester ground truth: walk-seconds of each LOG PICK tap on the watch.
   *  Never feeds the count — it is the measuring stick, not a measurement. */
  const groundTruthRef = useRef<number[]>([]);
  /** The walk's power path, kept in a ref because the state version is reset to
   *  null the moment `isListening` goes false — which happens in finishCleanup,
   *  BEFORE the summary sheet's Save reads it. The first version of this logged
   *  "unresolved" on every walk (A9, 25 Aug) for exactly that reason. Set once
   *  when the mode resolves, cleared only at the START of the next walk. */
  const sessionModeRef = useRef<'background' | 'foreground' | null>(null);
  const currentLocationRef = useRef<{ lat: number; lon: number } | null>(null); // latest fix — pickup-pin fallback
  const [gpsInterval, setGpsInterval] = useState(20000); // 20s base interval
  const lastPickupTimeRef = useRef(0);
  const highFrequencyEndRef = useRef(0);
  const [historicalCleanups, setHistoricalCleanups] = useState<any[]>([]);
  const [showLayers, setShowLayers] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [showScaleInfo, setShowScaleInfo] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [citySearching, setCitySearching] = useState(false);
  const citySearchTimer = useRef<any>(null);
  // true where we have neighborhood polygons; false → "your area" radius fallback
  const [neighborhoodMode, setNeighborhoodMode] = useState(true);
  // adopt-a-block now lives inside the street-tap popup (no separate mode)
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
  // How many other pickers are live in this neighborhood right now — the
  // "shared" counterpart to the personal toGo/freshPct stats above.
  const [liveNowCount, setLiveNowCount] = useState<number | null>(null);
  const [activating, setActivating] = useState<string | null>(null); // hood name during reveal
  // Set when activateHood's outer timeout fires — street detail is still
  // loading in the background, but we've stopped blocking on it. Dismissible;
  // cleared automatically once the deferred fetch actually resolves.
  const [slowLoadBanner, setSlowLoadBanner] = useState<string | null>(null);
  // "Request my city" card — shown once per session per fallback city, the
  // first time loadHoodsInView resolves the OSM fallback to a single shape
  // (the city itself, no real subdivision). { city, slug } while visible.
  const [cityRequestCard, setCityRequestCard] = useState<{ city: string; slug: string } | null>(null);
  const [cityRequestSent, setCityRequestSent] = useState(false);
  // Cities already offered THIS session (in-memory), so a re-pan over the
  // same fallback city doesn't re-show the card after an in-session dismiss
  // before the AsyncStorage write has had a chance to matter.
  const cityRequestOfferedRef = useRef<Set<string>>(new Set());
  const activeLevelRef = useRef<boolean>(false);
  const activationTokenRef = useRef<number>(0); // invalidates stale in-flight activations
  // Live recolor: the active level's segments + a throttle clock.
  const levelSegmentsRef = useRef<Array<{ id: string; coords: [number, number][]; daysOld: number | null; cleaned: boolean }>>([]);
  const lastRecolorRef = useRef<number>(0);
  // Same live recolor, but for the normal (non-level) overview map: the street
  // segments last fetched around you, so blocks you finish flip bright green
  // under the live route instead of waiting for the post-walk refresh.
  const coverageSegmentsRef = useRef<Array<{ id: string; coords: [number, number][]; daysOld: number | null; cleaned: boolean }>>([]);
  // Street segments finished on this walk — drives the completion haptic and is
  // mirrored to the watch so it can buzz too.
  const [segmentsCompleted, setSegmentsCompleted] = useState(0);
  // The watch is "active" from the moment Start is tapped, not from when
  // `isListening` flips — see startCleanup.
  const [walkIntent, setWalkIntent] = useState(false);
  // Guards the watch-broadcast effect below from firing a false "idle" the
  // instant this component mounts. A remount mid-walk (backgrounding, tab
  // switch, memory pressure — anything React Navigation does) resets
  // `walkIntent` to its useState(false) default even though the background
  // location task and motion detector singleton are still genuinely running.
  // Stays false until the one-time mount check below has resolved.
  const [walkIntentChecked, setWalkIntentChecked] = useState(false);
  const watchSessionRef = useRef('');
  const [currentArea, setCurrentArea] = useState<{ city: string; neighborhood: string }>({ city: '', neighborhood: '' });
  const coverageLoadedRef = useRef(false);
  const panLoadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appActiveRef = useRef(true);

  // Recover walkIntent after a remount mid-walk: check the crash-recorder's
  // sentinel (same start/stop window as walkIntent — see startCleanup /
  // stopCleanup) for a heartbeat recent enough to trust as "still walking
  // right now," not just "crashed at some point and never cleaned up."
  useEffect(() => {
    let canceled = false;
    isSessionActiveFresh().then((active) => {
      if (canceled) return;
      if (active) setWalkIntent(true);
      setWalkIntentChecked(true);
    });
    return () => { canceled = true; };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActiveRef.current = state === 'active';
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);

  // The map must NOT render during screen-off/background stretches — hours of
  // invisible tile streaming + redraws is what memory-killed long walks.
  const mapVisible = () => appActiveRef.current;

  // When the map WebView unmounts on background-during-cleanup, reset mapReady
  // so coverage + route re-inject cleanly once it remounts on return.
  useEffect(() => {
    if (!appActive && isListening) setMapReady(false);
  }, [appActive, isListening]);

  // Keep-awake is a LAST RESORT, not the default (24 Aug 2026, Jake's call:
  // the screen must not be on during walks — battery is the constraint).
  //
  // Only 'foreground' forces it now. That state has exactly one realistic cause
  // on a real build: the user never granted "Always" location, so
  // startLocationUpdatesAsync was never reached. It is a fixable permission
  // problem, not an unavoidable technical state — and startCleanup already
  // tells the user so and points at Settings. Burning their battery silently
  // was paying for a prompt nobody had shown them.
  //
  // The unresolved window (mode still null) NO LONGER forces it. That was the
  // expensive default: "unknown" meant "keep the screen lit", and for anyone
  // whose mode never resolved that meant the entire walk. The window itself is
  // seconds long and spans a permission sheet the user is looking at, so the
  // screen cannot auto-lock inside it — iOS's shortest Auto-Lock is 30s and it
  // restarts on the tap that began the walk. And if the mode does resolve to
  // 'foreground', this effect re-runs on that change and lights the screen back
  // up before anything is lost.
  useEffect(() => {
    if (isListening && sessionMode === 'foreground') {
      activateKeepAwakeAsync('cleanup');
    } else {
      deactivateKeepAwake('cleanup');
    }
    if (!isListening) {
      setSessionMode(null);
    }
    return () => {
      deactivateKeepAwake('cleanup');
    };
  }, [isListening, sessionMode]);

  useEffect(() => {
    loadUserStats();
    loadHistoricalCleanups();
    requestLocationPermission();
    // Warm the haptics preference cache so the in-walk path stays synchronous.
    void isSegmentHapticsEnabled();
    // Same for ground-truth mode: the watch push reads it synchronously.
    void isGroundTruthMode();
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

  // Persistent "these are mine" markers — loaded once the map can accept
  // injected JS, and re-pulled after adopting a new block (see
  // handleAdoptBlockTap) so a fresh adoption shows up without a reload.
  const refreshAdoptedMarkers = async () => {
    try {
      const mine = await listMyAdoptions();
      webviewRef.current?.injectJavaScript(`
        if (window.renderMyAdoptions) { window.renderMyAdoptions(${JSON.stringify(mine.map((a) => ({ lat: a.lat, lon: a.lon, label: a.label })))}); }
        true;
      `);
    } catch {}
  };

  useEffect(() => {
    if (mapReady) void refreshAdoptedMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // The WebView unmounts when the app backgrounds mid-walk (see the mapReady
  // reset above), which wipes the coverage layers. Repaint them from the
  // segments we still hold as soon as the map is back, so returning to a walk
  // never shows a bare basemap — the history you're adding to stays on screen.
  useEffect(() => {
    if (!mapReady || !isListening) return;
    const segs = coverageSegmentsRef.current;
    if (!segs.length) return;
    const payload = segs.map((s) => ({ id: s.id, coords: s.coords, daysOld: s.daysOld }));
    webviewRef.current?.injectJavaScript(`
      if (window.renderSegments) { window.renderSegments(${JSON.stringify(payload)}); }
      true;
    `);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, isListening]);

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
      // Keep the fetched segments for live in-walk recoloring. A refetch mid-walk
      // must not un-green blocks we've already finished (Firestore hasn't caught
      // up yet), so carry the `cleaned` flags forward by id.
      if (segments.length > 0) {
        const alreadyClean = new Set(
          coverageSegmentsRef.current.filter((s) => s.cleaned).map((s) => s.id),
        );
        coverageSegmentsRef.current = segments.map((s) => ({
          id: s.id,
          coords: s.coords,
          daysOld: alreadyClean.has(s.id) ? 0 : s.daysOld,
          cleaned: alreadyClean.has(s.id),
        }));
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

  // "Request my city": offered once per session per fallback city, the first
  // time the OSM fallback resolves to the "one shape, no real subdivision"
  // case (never for "nothing came back" and never for real fine districts —
  // see isFallbackCityWithNoSubdivision). Persists the ack per city slug
  // (AsyncStorage), reusing the pattern from safety.tsx's SAFETY_ACK_KEY, so
  // dismissing in one fallback city doesn't suppress a different one later.
  const maybeOfferCityRequest = async (hoods: HoodShape[], hasFineSubdivision: boolean, cLat: number, cLon: number) => {
    if (!isFallbackCityWithNoSubdivision(hoods.length, hasFineSubdivision)) return;
    const city = currentArea.city || hoods[0]?.name || '';
    if (!city) return;
    const slug = citySlug(city);
    if (cityRequestOfferedRef.current.has(slug)) return; // already offered this session
    cityRequestOfferedRef.current.add(slug);
    try {
      const seen = await AsyncStorage.getItem(`pick_city_request_seen_${slug}`);
      if (seen) return; // acknowledged (prioritized or dismissed) in a prior session
    } catch {}
    setCityRequestSent(false);
    setCityRequestCard({ city, slug });
  };

  const dismissCityRequestCard = async () => {
    const slug = cityRequestCard?.slug;
    setCityRequestCard(null);
    if (!slug) return;
    try {
      await AsyncStorage.setItem(`pick_city_request_seen_${slug}`, String(Date.now()));
    } catch {}
  };

  const requestCityPrioritization = async () => {
    if (!cityRequestCard) return;
    const { city, slug } = cityRequestCard;
    try {
      await AsyncStorage.setItem(`pick_city_request_seen_${slug}`, String(Date.now()));
    } catch {}
    setCityRequestSent(true);
    try {
      const fn = httpsCallable(getFunctions(app), 'requestCity');
      await fn({ city, citySlug: slug });
    } catch {
      // Best-effort — the local ack already stands regardless, so a failed
      // network call just means this request doesn't reach the tally; it
      // doesn't re-prompt the user or block the UI.
    }
    setTimeout(() => setCityRequestCard(null), 1400);
  };

  // Draw all neighborhood outlines intersecting the current view as a tappable
  // layer. Rings are stashed so a tap can score that hood from coverage.
  const loadHoodsInView = (b: [number, number, number, number]) => {
    const cLat = (b[0] + b[2]) / 2;
    const cLon = (b[1] + b[3]) / 2;

    // Where we have real neighborhood polygons, use them (richer + more valuable).
    // Everywhere else, try OSM administrative boundaries (works in any city, no
    // per-city registry — see getOsmHoodsInBounds). No fake fallback boundary
    // anymore: a made-up circle with no real enclosing area produced a
    // meaningless "% complete" (a fixed 800m radius isn't a real place), and
    // was confusing/unwanted. Where no real border exists at all, the app
    // just stays in normal (non-level) overview mode — street-by-street
    // freshness coloring and pickup tracking already work with no boundary
    // needed at all (see loadStreetCoverage's tile-based stats, scoped to a
    // fixed universal tile rather than any city-specific shape) — you can
    // still walk, pick, and track your own work, just without a bounded
    // "neighborhood" percentage that a real area never actually backed.
    if (!hasNeighborhoods(cLat, cLon)) {
      if (neighborhoodMode) setNeighborhoodMode(false);
      getOsmHoodsInBounds(b[0], b[1], b[2], b[3])
        .then(({ hoods, hasFineSubdivision }: { hoods: HoodShape[]; hasFineSubdivision: boolean }) => {
          if (!hoods.length) return;
          if (!neighborhoodMode) setNeighborhoodMode(true);
          hoods.forEach((h) => { hoodRingsRef.current[h.name] = h.ring; });
          const payload = hoods.map((h) => ({ name: h.name, ring: h.ring }));
          webviewRef.current?.injectJavaScript(`
            if (window.renderNeighborhoods) { window.renderNeighborhoods(${JSON.stringify(payload)}, true); }
            ${selectedHood ? `if (window.highlightNeighborhood) { window.highlightNeighborhood(${JSON.stringify(selectedHood.name)}); }` : ''}
            true;
          `);
          maybeOfferCityRequest(hoods, hasFineSubdivision, cLat, cLon);
        })
        .catch(() => {});
      return;
    }

    if (!neighborhoodMode) setNeighborhoodMode(true);
    // Draw our own hood name labels only where the basemap doesn't (Atlanta);
    // NYC's names are already printed by the CARTO tiles.
    const withLabels = hoodLabelsNeeded(cLat, cLon);
    getHoodsInBounds(b[0], b[1], b[2], b[3]).then((hoods: HoodShape[]) => {
      if (!hoods.length) return;
      hoods.forEach((h) => { hoodRingsRef.current[h.name] = h.ring; });
      const payload = hoods.map((h) => ({ name: h.name, ring: h.ring }));
      webviewRef.current?.injectJavaScript(`
        if (window.renderNeighborhoods) { window.renderNeighborhoods(${JSON.stringify(payload)}, ${withLabels}); }
        ${selectedHood ? `if (window.highlightNeighborhood) { window.highlightNeighborhood(${JSON.stringify(selectedHood.name)}); }` : ''}
        true;
      `);
    });
  };

  // Activate a hood as a level: frame + lock the map on it, reveal all its
  // streets (untouched in soft gray, cleaned on the freshness scale), show
  // completion stats. reveal=true plays the 2s "entering" beat (tap to browse);
  // reveal=false enters quietly (used when you start a cleanup inside a hood).
  // Street detail can take a long time on a cold cache (sparse OSM sidewalk
  // data + Overpass mirror retries) — this ceiling stops the "activating"
  // spinner from blocking indefinitely. On timeout we still show the
  // neighborhood (outline already drawn via enterLevel below, stats start at
  // zero) and keep waiting for the real segments in the background.
  const ACTIVATE_TIMEOUT_MS = 22000;

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

    // Applies fetched segments to the level UI — shared by the normal path
    // and the deferred (post-timeout) path so they stay in sync.
    const finish = (segments: RenderSegment[]) => {
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
      setActiveLevel({ name, total, fresh, freshPct, toGo, untouched });
      setActivating(null);
      setSlowLoadBanner(null);
      setLiveNowCount(null);
      getLiveWalks()
        .then((walks) => { if (activeLevelRef.current) setLiveNowCount(walks.filter((w) => w.neighborhood === name).length); })
        .catch(() => {});
    };

    const coveragePromise = getCoverageForRing(ring);
    const timedOut: unique symbol = Symbol('activate-timeout') as any;
    const raced = await Promise.race([
      coveragePromise,
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), ACTIVATE_TIMEOUT_MS)),
    ]);
    // Bail if we've since exited the level (or started a different one) — stops a
    // stale fetch from re-drawing the spotlight/level after the user left.
    if (activationTokenRef.current !== token || !activeLevelRef.current) return;

    if (raced === timedOut) {
      // Don't leave the user stuck on a blocking spinner — drop into the
      // level now (boundary already drawn) and fill in real coverage
      // whenever the still-in-flight fetch actually resolves.
      setActivating(null);
      setLiveNowCount(null);
      setSlowLoadBanner(name);
      coveragePromise
        .then(finish)
        .catch(() => { if (activationTokenRef.current === token) setSlowLoadBanner(null); });
      return;
    }

    const segments = raced as RenderSegment[];
    if (reveal) setTimeout(() => finish(segments), Math.max(400, 2000 - (Date.now() - started)));
    else finish(segments);
  };

  // Tap a neighborhood outline → browse it with the full 2s reveal.
  const focusHood = (name: string) => {
    const ring = hoodRingsRef.current[name];
    if (ring) activateHood(name, ring, true);
  };

  // Live recolor: while picking, flip each street bright green the moment your
  // route covers ≥80% of it — you watch the map fill in as you walk. Runs in
  // level mode (the hood's own streets) AND on the normal overview map (the
  // shared coverage layer), so the background of past cleanings stays up and
  // simply gains a fresh-green block. Throttled, and only segments near you are
  // checked, so it stays cheap.
  useEffect(() => {
    if (!isListening) return;
    const pts = sessionRoute;
    if (pts.length < 2) return;
    const now = Date.now();
    if (now - lastRecolorRef.current < 2500) return;
    lastRecolorRef.current = now;
    const inLevel = activeLevelRef.current;
    const segs = inLevel ? levelSegmentsRef.current : coverageSegmentsRef.current;
    if (!segs.length) return;
    const last = pts[pts.length - 1];
    // Only segments within ~90m of you are candidates at all (perf) — this
    // same nearby set doubles as the comparison pool for nearest-segment
    // classification below, so parallel/opposite sidewalks in range compete
    // for each route point instead of both being credited independently.
    const nearby = segs.filter((s) => {
      if (s.cleaned) return false;
      const m = s.coords[Math.floor(s.coords.length / 2)];
      const dx = (m[1] - last.lon) * 111320 * Math.cos((last.lat * Math.PI) / 180);
      const dy = (m[0] - last.lat) * 110540;
      return dx * dx + dy * dy <= 90 * 90;
    });
    const newlyClean: string[] = [];
    if (nearby.length) {
      // Same nearest-segment classification used by markRouteCleaned(), so
      // what's shown live while walking matches what gets persisted at the
      // end of the walk (see streetSegments.ts's both-sides-cleaned fix).
      const buckets = assignRoutePointsToNearestSegment(pts, nearby, SNAP_DISTANCE_M);
      nearby.forEach((s, i) => {
        if (routeCoverageFraction(s.coords, buckets[i], SNAP_DISTANCE_M) >= COVERAGE_THRESHOLD) {
          s.cleaned = true;
          // Age it to day 0 too, so a WebView remount mid-walk repaints it green
          // rather than reverting to its pre-walk color.
          s.daysOld = 0;
          newlyClean.push(s.id);
        }
      });
    }
    if (newlyClean.length) {
      if (inLevel) {
        webviewRef.current?.injectJavaScript(
          newlyClean.map((id) => `if(window.markLevelClean){window.markLevelClean(${JSON.stringify(id)});}`).join('') + ' true;'
        );
      } else if (mapVisible()) {
        // One batched call: promoting a never-cleaned street means redrawing
        // both the gray "to do" layer and the colored one.
        webviewRef.current?.injectJavaScript(
          `if(window.markSegmentsClean){window.markSegmentsClean(${JSON.stringify(newlyClean)});} true;`
        );
      }
      // A finished block is the one moment worth feeling through a pocket.
      segmentCompleteHaptic();
      setSegmentsCompleted((n) => n + newlyClean.length);

      if (inLevel) {
        const total = segs.length;
        const fresh = segs.filter((s) => s.cleaned || (s.daysOld !== null && s.daysOld <= 5)).length;
        const untouched = segs.filter((s) => !s.cleaned && s.daysOld === null).length;
        setActiveLevel((prev) => prev ? { ...prev, fresh, freshPct: total > 0 ? Math.round((fresh / total) * 100) : 0, toGo: Math.max(0, total - fresh), untouched } : prev);
      } else {
        // Header stats are tile-scoped, so recompute them the same way
        // loadStreetCoverage does — with this walk's blocks counted as day 0.
        const tile = getTileStats(
          last.lat,
          last.lon,
          segs.map((s) => ({ id: s.id, coords: s.coords, daysOld: s.cleaned ? 0 : s.daysOld })),
        );
        if (tile.total > 0) {
          setCoverageStats({ freshPct: tile.freshPct, totalSegments: tile.total, toGo: tile.toGo });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRoute, isListening]);

  // Restore an unsaved walk on launch. If the last walk was stopped but never
  // saved (summary dismissed, app force-quit, or a crash at the summary), a
  // draft survived on disk — offer to bring it back so it can be logged.
  useEffect(() => {
    let canceled = false;
    (async () => {
      const draft = await loadWalkDraft();
      if (canceled || !draft || isListening) return;
      Alert.alert(
        'Recover your last walk?',
        `A walk from ${new Date(draft.startedAt).toLocaleString()} with ${draft.pickupCount} pickup${draft.pickupCount === 1 ? '' : 's'} was never saved. Restore it so you can log it?`,
        [
          { text: 'Discard', style: 'destructive', onPress: () => { clearWalkDraft(); } },
          {
            text: 'Restore',
            onPress: () => {
              setSessionRoute(draft.route || []);
              setPickupLocations(draft.pickups || []);
              setPickupCount(draft.pickupCount || 0);
              setElapsedSeconds(draft.elapsedSeconds || 0);
              setShowSummary(true);
            },
          },
        ],
      );
    })();
    return () => { canceled = true; };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuous autosave (throttled to ~20s) so even a mid-walk crash leaves the
  // full route + pickups recoverable — not just the crash-recorder's counts.
  const lastAutosaveRef = useRef(0);
  useEffect(() => {
    if (!isListening) return;
    const now = Date.now();
    if (now - lastAutosaveRef.current < 20000) return;
    lastAutosaveRef.current = now;
    saveWalkDraft({
      startedAt: now - elapsedSeconds * 1000,
      savedAt: now,
      pickupCount,
      elapsedSeconds,
      route: sessionRoute,
      pickups: pickupLocations,
    });
  }, [sessionRoute, pickupLocations, isListening, elapsedSeconds, pickupCount]);

  // Re-draw the tappable hood outlines + coverage around a point (used when
  // returning to the overview so neighborhoods are immediately selectable).
  const refreshOverviewAround = (lat: number, lon: number) => {
    loadStreetCoverage(lat, lon);
    loadHoodsInView([lat - 0.012, lon - 0.016, lat + 0.012, lon + 0.016]);
  };

  // Close the results recap and return to a fresh, tappable overview where you
  // are now — so you can immediately pick a new neighborhood after submitting.
  const finishSession = () => {
    // Walk is fully done and saved — make sure no recovery draft lingers.
    clearWalkDraft();
    setShowResults(false);
    setPickupCount(0);
    setElapsedSeconds(0);
    setSessionRoute([]);
    setPickupLocations([]);
    setPhotoUri(null);
    if (activeLevelRef.current) exitLevel();
    else if (currentLocation) refreshOverviewAround(currentLocation.lat, currentLocation.lon);
    // Remount the map WebView so it regains touch after the results Modal
    // (RN/iOS quirk). Reset readiness + coverage flags so the fresh map reloads
    // its hoods/coverage on load.
    coverageLoadedRef.current = false;
    setMapReady(false);
    setMapKey((k) => k + 1);
    // Remounted map starts clean — drop any Need/Impact overlays.
    setNeedMode(false);
    setNeedTop([]);
    setImpactWindow(null);
    setCoverageVisible(true);
  };

  // Normalize a stored cleanup timestamp (ms, seconds, or Firestore Timestamp) to ms.
  const toMs = (v: any): number => {
    if (!v) return 0;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (typeof v?._seconds === 'number') return v._seconds * 1000;
    const p = Date.parse(v);
    return Number.isNaN(p) ? 0 : p;
  };

  // Toggle the "Need" layer: recolors ~110m tiles by how much they need a
  // cleanup (overdue + often-cleaned), computed from your walk history.
  const toggleNeed = async () => {
    const next = !needMode;
    setNeedMode(next);
    if (!next) {
      webviewRef.current?.injectJavaScript('if (window.clearNeed) { window.clearNeed(); } true;');
      setNeedTop([]);
      return;
    }
    try {
      const db = await getDatabase();
      const cleanups = await db.getCleanups(1000);
      const lite = cleanups.map((c: any) => ({
        timestamp: toMs(c.timestamp),
        items: c.items_count || 0,
        route: parseRoute(c.route_points),
        userId: c.userId,
      }));
      const tiles = computeNeed(lite);
      setNeedTop(tiles.slice(0, 5));
      const payload = tiles.slice(0, 400).map((t) => ({ lat: t.lat, lon: t.lon, color: needColor(t.needScore) }));
      webviewRef.current?.injectJavaScript(
        `if (window.renderNeed) { window.renderNeed(${JSON.stringify(payload)}); } true;`,
      );
    } catch (e) {
      console.error('Need map failed:', e);
    }
  };

  // Show "My impact": the routes you've touched + your pickups over a window
  // (last 24h or last 7 days), with a quick stat line.
  const showImpact = async (win: '24h' | '7d') => {
    setImpactWindow(win);
    // My Impact shows ONLY your streets — hide the community coverage layer
    // (everyone's cleaned streets) so what's left is just your own routes.
    setCoverageVisible(false);
    webviewRef.current?.injectJavaScript('if (window.setCoverageVisible) { window.setCoverageVisible(false); } true;');
    if (needMode) {
      setNeedMode(false);
      setNeedTop([]);
      webviewRef.current?.injectJavaScript('if (window.clearNeed) { window.clearNeed(); } true;');
    }
    try {
      const db = await getDatabase();
      const cleanups = await db.getCleanups(1000);
      const cutoff = Date.now() - (win === '24h' ? 86_400_000 : 7 * 86_400_000);
      const routes: [number, number][][] = [];
      const pickups: [number, number][] = [];
      const tiles = new Set<string>();
      let items = 0;
      let walks = 0;
      for (const c of cleanups as any[]) {
        if (toMs(c.timestamp) < cutoff) continue;
        walks++;
        const r = parseRoute(c.route_points);
        if (r.length) routes.push(r);
        for (const p of parseRoute(c.pickups)) pickups.push(p);
        items += c.items_count || 0;
        for (const [la, lo] of r) tiles.add(needTileKey(la, lo));
      }
      setImpactStats({ pickups: items, blocks: tiles.size, walks });
      webviewRef.current?.injectJavaScript(
        `if (window.renderImpact) { window.renderImpact(${JSON.stringify(routes)}, ${JSON.stringify(pickups)}); } true;`,
      );
    } catch (e) {
      console.error('Impact view failed:', e);
    }
  };

  const hideImpact = () => {
    setImpactWindow(null);
    // Bring the community coverage layer back and redraw the normal overview so
    // it reliably reappears (not just an add/remove of possibly-stale layers).
    setCoverageVisible(true);
    webviewRef.current?.injectJavaScript('if (window.clearImpact) { window.clearImpact(); } if (window.setCoverageVisible) { window.setCoverageVisible(true); } true;');
    if (currentLocation) refreshOverviewAround(currentLocation.lat, currentLocation.lon);
  };

  // Leave level mode → back to the overview of all hoods, recentered on you.
  const exitLevel = () => {
    activationTokenRef.current++; // cancel any in-flight activation
    activeLevelRef.current = false;
    setActiveLevel(null);
    setActivating(null);
    setSelectedHood(null);
    setLiveNowCount(null);
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
      if (msg.type === 'adoptTap') {
        // Sent by the "Adopt" link in a street's tap popup.
        if (!isListening) handleAdoptBlockTap(msg.lat, msg.lon);
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
      // Anchor "now minus already-elapsed" so a restored/continued walk keeps
      // its clock. Each tick recomputes from wall-clock time, so if iOS suspended
      // us while locked, the timer snaps to the correct value on resume rather
      // than losing the pocket seconds.
      sessionStartRef.current = Date.now() - elapsedSeconds * 1000;
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.round((Date.now() - sessionStartRef.current) / 1000));
      }, 1000);

      // Dense GPS during active cleanup: 20s gaps (~25m walking) skip street
      // segments when snapping routes. 5s normal / 10s battery saver.
      const activeInterval = batterySaver ? 10000 : 5000;
      trackLocation(); // Get initial location immediately
      locationRef.current = setInterval(() => {
        trackLocation();
      }, activeInterval);

      // "Who's cleaning now" presence — announce the walk (neighborhood name
      // only, never coordinates) and heartbeat so it stays counted as live.
      startPresence(currentArea.neighborhood || neighborhood || '');
      presenceRef.current = setInterval(() => { void pingPresence(); }, 45000);

      // Live Activity — the "cleanup in progress" lock-screen / Dynamic Island
      // card. Heartbeat updates ride the ~3s watch-stats block below.
      startCleanupActivity({
        timeText: formatTime(elapsedSeconds),
        pickups: pickupCount,
        distanceText: '',
        progressText: currentArea.neighborhood || neighborhood || '',
      });
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationRef.current) clearInterval(locationRef.current);
      if (presenceRef.current) clearInterval(presenceRef.current);
      void endPresence();
      endCleanupActivity();
      setTooFast(false);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (locationRef.current) clearInterval(locationRef.current);
      if (presenceRef.current) clearInterval(presenceRef.current);
      void endPresence();
      endCleanupActivity();
      setTooFast(false);
    };
  }, [isListening]);

  useEffect(() => {
    return () => {
      if (isListening) {
        MotionDetector.stopListening();
      }
    };
  }, []);

  // One-line explainer before the OS location prompt fires, first "Start
  // cleanup" tap only. iOS's system dialog is cold — just our Info.plist
  // usage string, no room for us to add anything to it — so this is the one
  // chance to say why before that sheet appears. Skipped entirely once the
  // OS has already recorded a decision (granted or denied) so we're never
  // showing our own dialog with nothing behind it.
  const explainLocationPermissionIfNeeded = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== Location.PermissionStatus.UNDETERMINED) return;
      const shown = await AsyncStorage.getItem(LOCATION_EXPLAINER_SHOWN_KEY);
      if (shown) return;
      await AsyncStorage.setItem(LOCATION_EXPLAINER_SHOWN_KEY, '1');
      await new Promise<void>((resolve) => {
        Alert.alert(
          'One quick thing',
          'PICK uses your location to map the streets you clean. The next prompt is the standard iOS location request — allow it to start tracking.',
          [{ text: 'Continue', onPress: () => resolve() }],
        );
      });
    } catch {
      // A failed permission-status check shouldn't block the walk — just
      // skip the explainer and let the OS prompt happen (or not) as normal.
    }
  };

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
      let fixAccuracy: number | undefined;
      let evSpeed = -1;
      if (MotionDetector.isActive()) {
        const last = MotionDetector.getLastLocation();
        if (last) {
          latitude = last.latitude;
          longitude = last.longitude;
          fixAccuracy = last.accuracy;
          evSpeed = (last as any).speed ?? -1;
        }
      }
      if (latitude === undefined || longitude === undefined) {
        // Idle path (map centering before a session): one-off fix
        // Street-level accuracy for cleanup tracking. Balanced (~100m) was
        // landing pickups across the street; High (~5-10m) keeps them on the
        // right block. Battery-saver eases off to Balanced.
        const accuracy = batterySaver ? Location.Accuracy.Balanced : Location.Accuracy.High;
        const location = await Location.getCurrentPositionAsync({ accuracy });
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
        fixAccuracy = location.coords.accuracy ?? undefined;
      }
      setCurrentLocation({ lat: latitude, lon: longitude });
      currentLocationRef.current = { lat: latitude, lon: longitude };

      // Mirror the detector's speed gate (3.3 m/s) so the walk UI can tell the
      // user pickups are paused while they're moving too fast (biking/vehicle).
      setTooFast(MotionDetector.isActive() && evSpeed >= 0 && evSpeed > 3.3);

      // Noisy fixes (>25m) still move the on-map dot, but never enter the
      // route — one bad ping can spill the route across the street and poison
      // sidewalk-level segment snapping (11m snap radius). Same threshold
      // applied to queued background points below.
      const ACCURACY_LIMIT_M = 25;
      const newPoints: { lat: number; lon: number; timestamp: number }[] = [];

      // While backgrounded, this function is driven by a setInterval that iOS
      // can throttle or pause outright — but backgroundSession.ts's OS-level
      // location task keeps receiving real fixes regardless, queuing them
      // since nothing used to read them. Draining it here means a rare/late
      // tick still recovers every point the OS actually delivered in the
      // meantime, not just whatever's cached right now — this was the root
      // cause of walks recording only 2-7 GPS points for a whole session.
      if (sessionMode === 'background') {
        for (const q of drainBackgroundLocations()) {
          if (q.accuracy !== undefined && q.accuracy > ACCURACY_LIMIT_M) continue;
          newPoints.push({ lat: q.lat, lon: q.lon, timestamp: q.timestamp });
        }
      }

      if (fixAccuracy !== undefined && fixAccuracy > ACCURACY_LIMIT_M) {
        console.log(`📍 Skipped low-accuracy fix (${Math.round(fixAccuracy)}m)`);
      } else {
        newPoints.push({ lat: latitude, lon: longitude, timestamp: Date.now() });
      }

      if (newPoints.length === 0) return;

      setSessionRoute((prev) => {
        const updated = [...prev, ...newPoints];
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
      // Pickup heatmap removed from the app — litter hotspots now live on the web dashboard.
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
      setBlueskyAutoPost(!!(settings as any)?.bluesky_auto_post);
      setDistanceUnit((settings?.distance_unit as 'mi' | 'km') || 'mi');

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
    // Claim the walk for the watch NOW. `isListening` doesn't flip until GPS and
    // the motion listener are up (seconds later) — and until it did, the watch
    // bridge below kept pushing `idle`, which bounced the watch straight back to
    // its Start screen right after you tapped Start on it.
    watchSessionRef.current = `w${Date.now()}`;
    setWalkIntent(true);
    try {
    // One-line context before the cold OS location dialog — first tap only.
    // trackLocation() below is what actually triggers the system prompt (via
    // getCurrentPositionAsync), so this has to run before it, not inside it.
    await explainLocationPermissionIfNeeded();
    setPickupCount(0);
    // Per-SESSION counter. Was never reset (found 19 Aug 2026): it feeds
    // commitSessionPickups() for the challenge live counter and the crash
    // heartbeat, so the 2nd+ walk in one app lifetime over-reported both.
    pickupCounterRef.current = 0;
    groundTruthRef.current = [];
    sessionModeRef.current = null;
    setSegmentsCompleted(0);
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

    // Walk 1b (24 Aug 2026) saved as a clean-looking 6-minute walk with an
    // empty motion_log — startListening() had failed partway and never attached
    // the accelerometer, but the timer ran and the route drew from the watch
    // below, so nothing on screen said otherwise. A silent zero-count walk is
    // worse than a visible error: the user finishes, sees 0, and concludes the
    // app doesn't work. Ask up front rather than let them walk for nothing.
    if (!MotionDetector.sensorsAttached()) {
      Alert.alert(
        'Motion sensors did not start',
        "This walk won't count pickups automatically. You can still walk and add your count at the end, or stop and try starting again.",
        [{ text: 'OK' }]
      );
    }

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
      sessionModeRef.current = mode;
      if (mode === 'foreground') {
        console.log('💡 Foreground-only (Expo Go or "Always" location not granted) — keeping screen on for this walk.');
        // Tell the user why locking the screen will pause their walk, and how to
        // fix it. Once per launch so it never becomes a nag.
        if (!fgWarnedRef.current) {
          fgWarnedRef.current = true;
          Alert.alert(
            'Keep the screen on for this walk',
            'This phone hasn’t granted “Always” location, so PICK can’t track with the screen locked — locking it will pause your timer and pickups.\n\nThe screen will stay on during this walk, or enable Settings → PICK → Location → Always to walk with the phone locked.',
            [{ text: 'Got it' }],
          );
        }
      } else {
        console.log('🌙 Background session active — screen may sleep; no keep-awake or Pocket Mode needed.');
      }
    });
    } catch (e) {
      // Start failed (permissions, sensors) — release the watch so it doesn't
      // sit on a "starting" screen for a walk that never began.
      console.error('Start cleanup failed:', e);
      setWalkIntent(false);
      watchSessionRef.current = '';
      Alert.alert('Could not start', 'Please try again in a moment.');
    } finally {
      startingRef.current = false;
    }
  };

  /**
   * Confirm before ending a walk.
   *
   * WHY (19 Aug 2026): three walks in one afternoon ended by themselves in a
   * pocket — one died at 22s with a single pickup and saved itself. `Stop &
   * save` was a single unguarded tap at the bottom of the screen, and the
   * summary sheet's Save button lands in roughly the same region, so one
   * sustained fabric contact could do both. The screen is live for this the
   * whole time: keep-awake is forced on while `sessionMode` is null, and after
   * it releases the phone still waits out the user's iOS Auto-Lock (which may
   * be "Never").
   *
   * MIN_CLEANUP_SECONDS does NOT cover this — its guard is
   * `elapsed < MIN && pickupCount === 0`, so any walk with one stray pickup
   * saves regardless of length.
   *
   * A miscount is recoverable via the correction panel. A walk that ends itself
   * is not, so this is deliberately a hard confirm on every stop rather than a
   * heuristic that could misfire.
   */
  const stopCleanup = () => {
    Alert.alert(
      'End this cleanup?',
      'Your walk will be saved and the timer will stop.',
      [
        { text: 'Keep walking', style: 'cancel' },
        { text: 'End cleanup', onPress: finishCleanup },
      ],
      { cancelable: true }
    );
  };

  const finishCleanup = () => {
    setWalkIntent(false);
    watchSessionRef.current = '';
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
    // NB: bagSize deliberately NOT reset — it carries over from the last walk.
    setBagFullness(50);
    setBagCount(1);
    setUserCount(null);
    setShowAdjust(false);

    // SAVE-FIRST: persist the whole walk to disk the instant Stop is pressed —
    // BEFORE the summary sheet renders. If the summary is dismissed, the app is
    // killed, or it crashes here, the walk is recoverable on next launch. The
    // draft is only cleared after a durable DB save or a confirmed discard.
    saveWalkDraft({
      startedAt: Date.now() - elapsedSeconds * 1000,
      savedAt: Date.now(),
      pickupCount: correctedCount,
      elapsedSeconds,
      route: sessionRoute,
      pickups: pickupLocations,
    });

    // Debug logging
    console.log('Session stopped');
    console.log(`Route points: ${sessionRoute.length}`);
    console.log(`Pickup locations: ${pickupLocations.length}`);
    if (sessionRoute.length > 0) {
      console.log(`First point: ${sessionRoute[0].lat}, ${sessionRoute[0].lon}`);
      console.log(`Last point: ${sessionRoute[sessionRoute.length-1].lat}, ${sessionRoute[sessionRoute.length-1].lon}`);
    }
  };

  // ── Apple Watch bridge ──────────────────────────────────────────────────
  // The watch is a remote control + mirror: start/end commands come in as
  // events; stats go out every few seconds. All no-ops without the native
  // module (Android / Expo Go).
  const startCleanupRef = useRef(startCleanup);
  // Points at finishCleanup, NOT stopCleanup: the watch's End button already
  // has its own two-tap confirmation, and routing it through the phone's
  // confirm would pop an Alert on a phone that is in a pocket — the walk would
  // simply never end. (Would have been introduced 19 Aug with the stop confirm.)
  const finishCleanupRef = useRef(finishCleanup);
  startCleanupRef.current = startCleanup;
  finishCleanupRef.current = finishCleanup;
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;
  // Last snapshot actually pushed, so a pickup can jump the 3s throttle queue.
  const lastWatchPushRef = useRef<{ pickups: number; segments: number }>({ pickups: -1, segments: -1 });
  // Wall-clock timestamps of the last watch push / Live Activity update. These
  // replace an `elapsedSeconds % 3` test — see the throttle below for why.
  const lastWatchPushAtRef = useRef(0);
  const lastActivityPushAtRef = useRef(0);

  // Live team event (challenge): find my active pickup challenge when a walk
  // starts, stream my session count in, subscribe to everyone's total.
  const [liveEvent, setLiveEvent] = useState<LiveEvent | null>(null);
  const [eventTotal, setEventTotal] = useState(0);
  const liveEventRef = useRef<LiveEvent | null>(null);
  liveEventRef.current = liveEvent;

  useEffect(() => {
    if (!isListening) {
      setLiveEvent(null);
      setEventTotal(0);
      return;
    }
    let unsubTotal: (() => void) | null = null;
    let canceled = false;
    (async () => {
      const uid = getAuthService().getCurrentUser()?.uid;
      if (!uid) return;
      const event = await findMyLiveEvent(uid);
      if (canceled || !event) return;
      setLiveEvent(event);
      unsubTotal = subscribeEventTotal(event.id, (total) => setEventTotal(total));
      void reportSessionPickups(event.id, uid, 0, true);
    })();
    return () => {
      canceled = true;
      if (unsubTotal) unsubTotal();
      // Fold this session into my standing contribution on walk end.
      const uid = getAuthService().getCurrentUser()?.uid;
      const ev = liveEventRef.current;
      if (uid && ev) void commitSessionPickups(ev.id, uid, pickupCounterRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  // Stream my count to the event as pickups happen (throttled inside).
  useEffect(() => {
    if (!isListening || !liveEvent) return;
    const uid = getAuthService().getCurrentUser()?.uid;
    if (uid) void reportSessionPickups(liveEvent.id, uid, pickupCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupCount, isListening, liveEvent]);

  useEffect(() => {
    const sub = addWatchCommandListener((cmd, atMs) => {
      if (cmd === 'startWalk' && !isListeningRef.current) {
        void startCleanupRef.current();
      } else if (cmd === 'endWalk' && isListeningRef.current) {
        finishCleanupRef.current();
      } else if (cmd === 'logPick' && isListeningRef.current) {
        // Tester ground truth. Stored as walk-seconds so it lines up directly
        // against motion_log.t, and derived from the WATCH's capture time
        // (atMs) rather than arrival: transferUserInfo is queued, so a tap can
        // land here seconds late and would otherwise misalign by exactly the
        // amount the analysis is trying to resolve. Falls back to arrival time
        // only if the watch sent none.
        const startedAt = sessionStartRef.current;
        if (startedAt > 0) {
          const at = atMs > 0 ? atMs : Date.now();
          groundTruthRef.current.push(Math.round((at - startedAt) / 1000));
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Don't broadcast anything until the mount-time recovery check above has
    // resolved — otherwise a remount mid-walk would fire a false "idle" on
    // the very first render, before we've had a chance to learn the walk is
    // actually still running.
    if (!walkIntentChecked) return;
    // `walkIntent`, not `isListening`: the watch goes active the instant Start is
    // tapped. Sending idle during the GPS warm-up is what made the watch flash a
    // count and then fall back to the Start screen.
    if (!walkIntent) {
      lastWatchPushRef.current = { pickups: -1, segments: -1 };
      lastWatchPushAtRef.current = 0;
      lastActivityPushAtRef.current = 0;
      // Zeroes, so a cached applicationContext can never resurrect an old count.
      sendStatsToWatch(0, 0, 'idle', { sessionId: '' });
      return;
    }
    // Counts push immediately (that number is what you're looking at); the 1Hz
    // clock tick stays throttled to every 3s.
    const countsChanged =
      pickupCount !== lastWatchPushRef.current.pickups ||
      segmentsCompleted !== lastWatchPushRef.current.segments;
    // Throttle on WALL CLOCK, not `elapsedSeconds % 3`.
    //
    // WHY (24 Aug 2026): this effect is driven by the 1Hz setInterval that
    // updates elapsedSeconds, and iOS throttles JS timers while backgrounded —
    // which is every real walk. elapsedSeconds is recomputed from
    // sessionStartRef on each tick, so when ticks are dropped it JUMPS rather
    // than counting, and the `% 3 === 0` test can miss for long stretches. The
    // watch's clock then starves for as long as the phone stays quiet, and a
    // quiet phone on a live walk is exactly the ambiguity PhoneLink.swift's
    // staleness branch has to guess about. A wall-clock check fires on the
    // first tick after 3s of real time however the ticks land.
    //
    // Counts are unaffected either way: countsChanged bypasses the throttle
    // entirely, so a pickup still pushes on the same tick it happens.
    const nowMs = Date.now();
    if (!countsChanged && nowMs - lastWatchPushAtRef.current < 3000) return;
    lastWatchPushAtRef.current = nowMs;
    lastWatchPushRef.current = { pickups: pickupCount, segments: segmentsCompleted };

    sendStatsToWatch(pickupCount, elapsedSeconds, 'active', {
      sessionId: watchSessionRef.current,
      segments: String(segmentsCompleted),
      haptics: segmentHapticsEnabledSync() ? '1' : '0',
      groundTruth: groundTruthModeSync() ? '1' : '0',
      distance: fmtDistance(parseFloat(String(calculateCoverage().distance || '0'))),
      progress: activeLevel
        ? `${activeLevel.freshPct}%${activeLevel.toGo > 0 ? ` · ${activeLevel.toGo} to go` : ' · complete!'}`
        : '',
      // Competition mode: the event area's % cleaned → watch top-right.
      // Only sent while in an active competition (liveEvent).
      eventName: liveEvent?.name ?? '',
      eventPct: liveEvent && activeLevel ? `${activeLevel.freshPct}%` : '',
    });
    // Same wall-clock reasoning as the watch push above. Kept on its own timer
    // so the Live Activity's update cadence stays ~3s and does not inherit the
    // watch's push-on-every-pickup behaviour — ActivityKit budgets updates.
    if (nowMs - lastActivityPushAtRef.current >= 3000) {
      lastActivityPushAtRef.current = nowMs;
      updateCleanupActivity({
        timeText: formatTime(elapsedSeconds),
        pickups: pickupCount,
        distanceText: fmtDistance(parseFloat(String(calculateCoverage().distance || '0'))),
        progressText: activeLevel ? `${activeLevel.name} · ${activeLevel.freshPct}%` : (currentArea.neighborhood || ''),
      });
    }
  }, [walkIntent, walkIntentChecked, pickupCount, segmentsCompleted, elapsedSeconds, liveEvent, eventTotal]);

  // A walk must run this long OR log ≥1 pickup to count as a cleanup —
  // filters out tap-start-tap-stop test walks without ever losing a real one.
  // TEMPORARY (17 Aug 2026): dropped 120 -> 20 for detector field testing.
  // Short single-behavior test walks (60s of walking with zero pickups, etc.)
  // were being rejected, which forced padding the clock with standing-still
  // minutes — and that padding contaminated the very false-positive counts the
  // walks existed to measure. RESTORE TO 120 BEFORE LAUNCH.
  const MIN_CLEANUP_SECONDS = 60;

  const saveSummary = async () => {
    if (elapsedSeconds < MIN_CLEANUP_SECONDS && pickupCount === 0) {
      Alert.alert(
        'Too short to count',
        `Walks under ${
          MIN_CLEANUP_SECONDS < 60
            ? `${MIN_CLEANUP_SECONDS} seconds`
            : `${Math.round(MIN_CLEANUP_SECONDS / 60)} minutes`
        } with no pickups aren't saved as cleanups.`,
        [
          { text: 'Back', style: 'cancel' },
          {
            text: 'Discard walk',
            style: 'destructive',
            onPress: () => {
              clearWalkDraft();
              setShowSummary(false);
              setPickupCount(0);
              setElapsedSeconds(0);
              setPhotoUri(null);
              setSessionRoute([]);
              setPickupLocations([]);
              finishSession();
            },
          },
        ],
      );
      return;
    }
    setShowSummary(false);
    // One-screen close (design audit): no "Cleanup saved" recap step. If a
    // photo needs a manual community post, open that sheet; otherwise the
    // walk just finishes. The recap modal remains only as the community
    // compose host + session export (dev).
    if (photoUri && communitySharing && !communityAutoPost) {
      setShowResults(true);
    } else {
      finishSession();
    }

    try {
      // The user's bag report wins; otherwise derive bags from the pickup count.
      const finalBags = bagReported
        ? reportedBags(bagSize, bagFullness, bagCount)
        : itemsToBags(pickupCount);

      // Pace context for the whole walk. A stroll makes the detector's number
      // untrustworthy: A7a at 0.73 m/s produced 9.7 false positives/min, C6a at
      // 1.19 m/s produced 2.0 (same tester, same phone, 90 minutes apart).
      // Persisted on every walk so future tuning never has to reconstruct pace
      // by hand, and used ONLY to invite a correction — never to suppress a count.
      const pace = walkPaceProfile(MotionDetector.getSessionEvents());

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
        // What the user says they picked up — their correction wins if they
        // made one, otherwise the detector's figure.
        items_count: userCount ?? pickupCount,
        // What the sensors actually counted, always. Never shown; this is the
        // labeled training data that lets thresholds be tuned against real
        // users instead of one tester's walks.
        items_detected: pickupCount,
        // Walk-level pace summary — see walkPaceProfile() for the field evidence.
        pace_median_mps: pace.medianMps,
        pace_slow_share: pace.slowShare,
        pace_low_confidence: pace.lowConfidence,
        bag_qty: bagCount,
        bag_size: bagReported ? bagSize : '',
        bag_fullness: bagFullness,
        bags_est: finalBags,
        duration_seconds: elapsedSeconds,
        // Record the user's actual team so it counts toward the team leaderboard
        // (falls back to 'solo' when they're not on a team).
        team: userTeam || 'solo',
        fitness_tracked: false,
        city: area.city,
        neighborhood: area.neighborhood,
        route_points: JSON.stringify(simplifyRoute(privacyTrimRoute(sessionRoute)).map(p => [p.lat, p.lon])),
        // Where pickups actually happened — powers the litter-hotspot layer.
        // Rounded to ~11m so it maps a block, never a doorstep.
        pickups: JSON.stringify(
          // Dedupe pickups to unique ~11m cells (privacy + doc size) but keep
          // them from across the WHOLE walk — the old slice(0,60) truncated to
          // the first 60, starving the litter-need map of spatial coverage on
          // long walks.
          Array.from(
            new Map(
              pickupLocations.map((p) => {
                const cell: number[] = [Number(p.lat.toFixed(4)), Number(p.lon.toFixed(4))];
                return [cell.join(','), cell] as [string, number[]];
              }),
            ).values(),
          ).slice(0, 300),
        ),
        motion_log: JSON.stringify(MotionDetector.getSessionEvents()),
        // Tester ground truth: walk-seconds of each LOG PICK tap on the watch,
        // empty for everyone else. This is what makes a count scoreable —
        // "39 counted for 20 real" is equally consistent with every pick being
        // counted twice and with twelve double-counts plus fifteen false
        // positives, and those need opposite fixes.
        ground_truth: JSON.stringify(groundTruthRef.current),
        // Which power path this walk actually took: 'background' = screen was
        // free to sleep, 'foreground' = we had to hold it on because "Always"
        // location was missing. Never recorded before, so there has never been
        // any evidence about how often the expensive path is taken — which is
        // exactly what made the keep-awake question feel like a judgment call.
        session_mode: sessionModeRef.current ?? 'unresolved',
      } as any);

      const updatedStats = await db.getCleanupStats();
      setStats(updatedStats);

      // Republish my contribution to every challenge I've joined. Cleanups are
      // owner-only reads, so nobody else can tally my work — this is how the
      // group total learns about the walk that just ended. Non-blocking: a
      // failure here must never cost the user their saved cleanup.
      void refreshMyChallengeContributions().catch((e) =>
        console.warn('Challenge contribution refresh failed (non-fatal):', e)
      );

      // Weekly goal: the reminder is scheduled against this week's count, so
      // finishing a walk may mean there's nothing left to nag about.
      void (async () => {
        try {
          const all = await db.getCleanups(500);
          const ts = (all || []).map((c: any) => c.timestamp).filter((n: any) => typeof n === 'number');
          await syncWeeklyGoalReminder({ done: computeStreak(ts).thisCalendarWeek, goal: await getWeeklyGoal() });
        } catch {}
      })();

      // Walk is now durably saved (the DB layer caches offline with synced=false
      // and syncs later), so the recovery draft can be dropped. If addCleanup
      // above threw, we skip this and the draft survives for next-launch restore.
      clearWalkDraft();

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

      // Auto-post to Bluesky if the user connected an account and opted in.
      // Fire-and-forget — a slow or failed external post must never hold up
      // or break the save flow the user is already waiting on.
      if (blueskyAutoPost && photoUri) {
        const place = area.neighborhood || 'my neighborhood';
        const text = `${pickupCount} pieces of litter (${formatKitchenBags(finalBags)}) off the streets of ${place} today with Pick. Join me: ${TESTFLIGHT_URL}`;
        void postToBluesky({ text, photoUri }).then((ok) =>
          console.log(ok ? '✅ Auto-posted cleanup to Bluesky' : 'ℹ️ Bluesky auto-post skipped or failed')
        );
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

  // Format a distance given in KM into the user's chosen unit, e.g. "0.42 mi".
  const fmtDistance = (km: number) => {
    const n = distanceUnit === 'mi' ? km * 0.621371 : km;
    return `${n.toFixed(2)} ${distanceUnit}`;
  };
  // Just the number, for stat boxes that show the unit as a separate label.
  const distanceValue = (km: number) =>
    (distanceUnit === 'mi' ? km * 0.621371 : km).toFixed(2);

  const exportSession = async () => {
    const coverage = calculateCoverage();
    const estBags = itemsToBags(pickupCount);
    const reported = bagReported ? reportedBags(bagSize, bagFullness) : null;

    // Instant "why picks did/didn't count" tally for tuning.
    const _evs = MotionDetector.getSessionEvents();
    const _counted = _evs.filter((e) => e.counted).length;
    const _cooldown = _evs.filter((e) => e.accepted && !e.counted).length;
    const _rejected = _evs.filter((e) => !e.accepted);
    const _byReason: Record<string, number> = {};
    _rejected.forEach((e) => {
      const k = String(e.reason || 'other').split(':')[0].split('(')[0].trim();
      _byReason[k] = (_byReason[k] || 0) + 1;
    });
    const tallyBlock = `═══════════════════════════════════════════════════════════
  REASON TALLY (why picks did / didn't count)
═══════════════════════════════════════════════════════════

Total motion events recorded: ${_evs.length}
Counted (what you saw):       ${_counted}
Suppressed by cooldown:       ${_cooldown}
Rejected:                     ${_rejected.length}
${Object.entries(_byReason).map(([k, v]) => `  • ${k}: ${v}`).join('\n') || '  (none)'}
Note: pickups gentler than the recording gate never create an event, so they
don't appear here — those are the invisible misses.
`;

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
Distance Walked: ${fmtDistance(parseFloat(String(coverage.distance || '0')))}
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

${tallyBlock}
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

  // Search any city by name (OpenStreetMap / Nominatim); fly there on select.
  const runCitySearch = async (q: string) => {
    const query = q.trim();
    if (query.length < 2) { setCityResults([]); return; }
    setCitySearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'PICK-cleanup-app/1.0 (city search)', Accept: 'application/json' },
      });
      if (res.ok) {
        const arr: any[] = await res.json();
        const results = (arr || [])
          .map((r) => {
            const a = r.address || {};
            const place = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || r.name || '';
            const label = [place, a.state, a.country].filter(Boolean).join(', ') || (r.display_name || query);
            return { label, lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
          })
          .filter((r) => isFinite(r.lat) && isFinite(r.lon));
        setCityResults(results);
      }
    } catch {
      // network hiccup — leave prior results, no crash
    } finally {
      setCitySearching(false);
    }
  };

  // Debounced as-you-type search.
  const onCityQueryChange = (t: string) => {
    setCityQuery(t);
    if (citySearchTimer.current) clearTimeout(citySearchTimer.current);
    citySearchTimer.current = setTimeout(() => runCitySearch(t), 350);
  };

  const openCityPicker = () => {
    setCityQuery('');
    setCityResults([]);
    setCityPickerOpen(true);
  };

  // Jump the map to a city center; its hood outlines load on the move.
  const goToCity = (c: { label: string; lat: number; lon: number; zoom: number }) => {
    setCityPickerOpen(false);
    setSelectedHood(null);
    // Show the city name immediately; the arrival geocode then refines it to the
    // precise local name (e.g. "New York City" → "Brooklyn").
    setCurrentArea({ city: c.label, neighborhood: '' });
    webviewRef.current?.injectJavaScript(`try { map.setView([${c.lat}, ${c.lon}], ${c.zoom}); } catch (e) {} true;`);
    refreshArea(c.lat, c.lon);
    loadHoodsInView([c.lat - 0.012, c.lon - 0.016, c.lat + 0.012, c.lon + 0.016]);
  };

  // Snap back to where you actually are.
  const recenter = () => {
    const loc = currentLocation;
    if (!loc) return;
    webviewRef.current?.injectJavaScript(`try { map.setView([${loc.lat}, ${loc.lon}], 16); } catch (e) {} true;`);
    refreshArea(loc.lat, loc.lon);
    loadHoodsInView([loc.lat - 0.012, loc.lon - 0.016, loc.lat + 0.012, loc.lon + 0.016]);
  };

  // Long-press (contextmenu) on the map → snap to the nearest block and offer to
  // adopt it. Works in overview and inside a neighborhood; ignored mid-cleanup.
  const handleAdoptBlockTap = async (lat: number, lon: number) => {
    const clear = () => webviewRef.current?.injectJavaScript('if (window.clearBlockHighlight) { window.clearBlockHighlight(); } true;');
    try {
      const seg = await nearestStreetSegment(lat, lon);
      if (!seg) { Alert.alert('No block there', 'Press and hold right on a street.'); return; }
      webviewRef.current?.injectJavaScript(`if (window.highlightBlock) { window.highlightBlock(${JSON.stringify(seg.coords)}); } true;`);
      let label = 'this block';
      try {
        const mid = seg.coords[Math.floor(seg.coords.length / 2)];
        const g = (await Location.reverseGeocodeAsync({ latitude: mid[0], longitude: mid[1] }))[0];
        if (g) { const p = [g.street || g.name, g.city].filter(Boolean); if (p.length) label = p.join(', '); }
      } catch {}
      Alert.alert(
        'Adopt this block?',
        `${label} — we'll email you if it goes 7 days without a cleanup nearby.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: clear },
          {
            text: 'Adopt',
            onPress: async () => {
              try {
                await saveAdoptedBlock(seg, label);
                Alert.alert('Block adopted', `You'll get an email if ${label} goes stale.`);
                void refreshAdoptedMarkers();
              } catch (e: any) {
                Alert.alert('Could not adopt', e?.message || 'Please try again.');
              }
              clear();
            },
          },
        ]
      );
    } catch {
      Alert.alert('Error', 'Could not read that block. Try again.');
      clear();
    }
  };

  return (
    <View style={styles.container}>
      {/* Header - Show when NOT cleaning and not in a neighborhood level */}
      {!isListening && !activeLevel && !activating && (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* The title names the CONTAINER (borough/city) and doubles as a city
                switcher; a hood name is the reward for tapping into one. */}
            {selectedHood ? (
              <Text style={styles.userName} numberOfLines={1}>{selectedHood.name}</Text>
            ) : (
              <TouchableOpacity
                onPress={openCityPicker}
                activeOpacity={0.7}
                style={styles.citySwitch}
                accessibilityLabel="Search for a city"
              >
                <Text style={styles.userName} numberOfLines={1}>
                  {currentArea.city || user?.displayName || 'Your area'}
                </Text>
                <Text style={styles.citySwitchChevron}> ⌄</Text>
              </TouchableOpacity>
            )}
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
              <Text style={styles.coverageText}>
                {neighborhoodMode ? 'Tap a neighborhood to see its progress' : 'Tap your area to see its progress'}
              </Text>
            )}
          </View>
          <View style={styles.headerControls}>
            {selectedHood && selectedHood.total > 0 && (
              <View style={styles.completionPill}>
                <Text style={styles.completionPct}>{selectedHood.freshPct}%</Text>
                <Text style={styles.completionLbl}>green</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* My impact — blocks touched + pickups over 24h / 7d */}
      {impactWindow && !isListening && (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 100, backgroundColor: '#fff', borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: C.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 14, fontFamily: Fonts.bodyBold, color: C.dark }}>Your impact</Text>
            <View style={{ flexDirection: 'row', backgroundColor: C.tint, borderRadius: 999, padding: 2 }}>
              {(['24h', '7d'] as const).map((w) => (
                <TouchableOpacity
                  key={w}
                  onPress={() => showImpact(w)}
                  style={{ paddingVertical: 5, paddingHorizontal: 14, borderRadius: 999, backgroundColor: impactWindow === w ? C.primary : 'transparent' }}
                >
                  <Text style={{ fontSize: 12, fontFamily: Fonts.bodyBold, color: impactWindow === w ? '#fff' : C.muted }}>{w === '24h' ? '24h' : '7 days'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={hideImpact} hitSlop={8} style={{ marginLeft: 8 }}>
              <Icon name="close" size={18} color={C.muted} sw={2.2} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[
              { n: impactStats.pickups, l: 'pickups' },
              { n: impactStats.blocks, l: 'blocks touched' },
              { n: impactStats.walks, l: 'walks' },
            ].map((s) => (
              <View key={s.l} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontSize: 22, fontFamily: Fonts.displayBold, color: C.dark }}>{s.n}</Text>
                <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{s.l}</Text>
              </View>
            ))}
          </View>
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

      {/* Shown when activateHood's outer timeout fires — street detail is
          still loading in the background; dismissible, auto-clears once it lands. */}
      {slowLoadBanner && !activating && (
        <TouchableOpacity
          style={[styles.slowLoadBanner, { top: insets.top + 8 }]}
          onPress={() => setSlowLoadBanner(null)}
          accessibilityLabel="Dismiss slow-load notice"
        >
          <ActivityIndicator size="small" color={C.dark} />
          <Text style={styles.slowLoadBannerText} numberOfLines={1}>Still loading street detail…</Text>
          <Text style={styles.slowLoadBannerDismiss}>✕</Text>
        </TouchableOpacity>
      )}

      {/* "Request my city" — shown once per fallback city (see
          maybeOfferCityRequest) when OSM only gave us the city's own outline,
          no real neighborhood subdivision. Same banner pattern as
          slowLoadBanner, stacked below it via top offset. */}
      {cityRequestCard && !activating && (
        <View style={[styles.cityRequestCard, { top: insets.top + (slowLoadBanner ? 56 : 8) }]}>
          <Text style={styles.cityRequestText}>
            We don't have detailed neighborhoods mapped here yet — for now you'll see all of{' '}
            {cityRequestCard.city} as one area. Want us to prioritize adding real neighborhoods for
            your city?
          </Text>
          <View style={styles.cityRequestRow}>
            <TouchableOpacity
              style={styles.cityRequestCta}
              onPress={requestCityPrioritization}
              disabled={cityRequestSent}
              accessibilityLabel="Yes, prioritize my city"
            >
              <Text style={styles.cityRequestCtaText}>
                {cityRequestSent ? 'Thanks — noted!' : 'Yes, prioritize my city'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={dismissCityRequestCard} hitSlop={10} accessibilityLabel="Dismiss">
              <Text style={styles.slowLoadBannerDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
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
                : `${activeLevel.toGo} to go${liveNowCount ? `  ·  ${liveNowCount} cleaning now` : ''}`}
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
            <Text style={styles.topBarValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatTime(elapsedSeconds)}</Text>
            <Text style={styles.topBarLabel}>Time</Text>
          </View>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{pickupCount}</Text>
            <Text style={styles.topBarLabel}>Pickups</Text>
          </View>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmtDistance(parseFloat(String(calculateCoverage().distance || '0')))}</Text>
            <Text style={styles.topBarLabel}>Distance</Text>
          </View>
        </View>
      )}

      {isListening && tooFast && (
        <View style={[styles.tooFastPill, { top: insets.top + 62 }]} pointerEvents="none">
          <Icon name="bolt" size={14} color="#8A3B12" sw={2.2} />
          <Text style={styles.tooFastText}>Moving too fast — pickups paused</Text>
        </View>
      )}

      {/* Completion focus while picking — which hood you're filling in */}
      {isListening && activeLevel && (
        <View style={[styles.pickingBanner, { top: insets.top + (tooFast ? 104 : 66) }]} pointerEvents="none">
          <Text style={styles.pickingBannerText} numberOfLines={1}>
            {activeLevel.name} · {activeLevel.freshPct}% done
            {activeLevel.toGo > 0 ? ` · ${activeLevel.toGo} to go` : ' · complete!'}
          </Text>
        </View>
      )}

{/* Real Map - Expands when cleaning */}
      <View style={[styles.mapContainer, isListening && styles.mapContainerExpanded]}>
        {/* Map tools — one button; press or hold to reveal options. Sits where
            the adopt button used to. */}
        {!isListening && !activating && (
          <>
            {toolsOpen && (
              <>
                <View style={[styles.toolOption, { bottom: 190 + 58 * 3 }]}>
                  <Text style={styles.toolOptionLabel}>My impact</Text>
                  <TouchableOpacity
                    style={[styles.toolOptionBtn, impactWindow && styles.adoptButtonActive]}
                    onPress={() => { setToolsOpen(false); if (impactWindow) { hideImpact(); } else { showImpact('7d'); } }}
                    accessibilityLabel="My impact"
                  >
                    <Icon name="route" size={20} color={impactWindow ? '#fff' : C.primary} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.toolOption, { bottom: 190 + 58 * 2 }]}>
                  <Text style={styles.toolOptionLabel}>Recenter</Text>
                  <TouchableOpacity
                    style={styles.toolOptionBtn}
                    onPress={() => { setToolsOpen(false); recenter(); }}
                    accessibilityLabel="Recenter on my location"
                  >
                    <Icon name="target" size={20} color={C.primary} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.toolOption, { bottom: 190 + 58 }]}>
                  <Text style={styles.toolOptionLabel}>Guide</Text>
                  <TouchableOpacity
                    style={styles.toolOptionBtn}
                    onPress={() => { setToolsOpen(false); setShowScaleInfo(true); }}
                    accessibilityLabel="Cleanliness guide"
                  >
                    <Icon name="leaf" size={20} color={C.primary} />
                  </TouchableOpacity>
                </View>
              </>
            )}
            <TouchableOpacity
              style={[styles.adoptButton, (toolsOpen || !!impactWindow) && styles.adoptButtonActive]}
              onPress={() => setToolsOpen((v) => !v)}
              onLongPress={() => setToolsOpen(true)}
              delayLongPress={220}
              accessibilityLabel="Map tools"
            >
              <Icon name={toolsOpen ? 'close' : 'plus'} size={22} color={(toolsOpen || !!impactWindow) ? '#fff' : C.primary} />
            </TouchableOpacity>
          </>
        )}

        {(currentLocation && (appActive || !isListening)) ? (
          <WebView
            key={mapKey}
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
    .leaflet-bottom.leaflet-right { margin-bottom: 84px; margin-right: 8px; }
    /* Attribution anchored to the very bottom-left corner of the map */
    .leaflet-bottom.leaflet-left { margin-bottom: 0; margin-left: 0; }
    .leaflet-control-attribution { font-size: 10px; padding: 1px 5px; background: rgba(255,255,255,0.7) !important; }
    .leaflet-control-zoom { margin: 0 !important; border: none !important; box-shadow: 0 2px 8px rgba(27,46,26,0.18) !important; border-radius: 12px !important; overflow: hidden; }
    .leaflet-control-zoom a { width: 38px !important; height: 38px !important; line-height: 38px !important; color: #0F2F66 !important; font-size: 20px !important; font-weight: 600 !important; background: #fff !important; }
    .leaflet-control-zoom a:hover { background: #EEF3E6 !important; }
    /* Our own neighborhood labels (cities the basemap doesn't label, e.g. Atlanta).
       Styled to echo the soft grayscale place labels the basemap draws elsewhere. */
    .hood-label { background: transparent !important; border: none !important; box-shadow: none !important; }
    .hood-label-text { display: inline-block; transform: translate(-50%, -50%);
      color: #7C8A74; font-weight: 600; font-size: 12px; letter-spacing: 1px; text-transform: uppercase;
      white-space: nowrap; pointer-events: none;
      text-shadow: 0 0 3px #F5F5F0, 0 0 3px #F5F5F0, 0 0 4px #F5F5F0; }
    .seg-popup .leaflet-popup-content-wrapper { background: #1B2E1A; color: #fff; border-radius: 10px; box-shadow: 0 4px 14px rgba(27,46,26,0.28); }
    .seg-popup .leaflet-popup-content { margin: 8px 12px; font-size: 13px; font-weight: 600; line-height: 1.2; }
    .seg-popup .leaflet-popup-tip { background: #1B2E1A; }
    .seg-popup a.leaflet-popup-close-button { display: none; }
    .seg-popup-text { white-space: nowrap; }
    .seg-popup-adopt { display: inline-block; margin-top: 5px; color: #7BE495; font-weight: 700; text-decoration: none; white-space: nowrap; }
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

    // Adopt-a-block: while adopt mode is on, a tap selects the nearest block.
    var adoptGroup = L.featureGroup([]).addTo(map);
    window.__adoptMode = false;
    window.setAdoptMode = function(on) { window.__adoptMode = !!on; };
    map.on('click', function(e) {
      if (window.__adoptMode && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'adoptTap', lat: e.latlng.lat, lon: e.latlng.lng }));
      }
    });
    window.highlightBlock = function(coords) {
      adoptGroup.clearLayers();
      try { L.polyline(coords, { color: '#4B7A54', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(adoptGroup); } catch (e) {}
    };
    window.clearBlockHighlight = function() { adoptGroup.clearLayers(); };

    // Persistent "these are mine" layer — small navy dots, always on, one per
    // adopted block. Deliberately NOT a colored line: the street underneath
    // is already colored by freshness (green→red), and covering that with a
    // second color would hide whether an adopted block still needs a
    // cleanup. Navy doesn't appear anywhere in that freshness gradient, so a
    // dot reads unambiguously as "you adopted this," not "here's its status."
    var myAdoptedGroup = L.featureGroup([]).addTo(map);
    window.renderMyAdoptions = function(items) {
      myAdoptedGroup.clearLayers();
      (items || []).forEach(function(a) {
        if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return;
        try {
          L.circleMarker([a.lat, a.lon], {
            radius: 6, color: '#FFFFFF', weight: 2,
            fillColor: '#0F2F66', fillOpacity: 1
          }).bindPopup('<b>' + (a.label || 'Adopted block') + '</b><br>You adopted this — you\\'ll get a nudge if it goes stale.', { className: 'seg-popup' })
            .addTo(myAdoptedGroup);
        } catch (e) {}
      });
    };
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${process.env.EXPO_PUBLIC_CARTO_API_KEY}', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
      updateWhenIdle: true,
      keepBuffer: 1
    }).addTo(map);

    let userMarker = L.circleMarker([40.7128, -74.0060], {
      radius: 8,
      fillColor: '#4B7A54',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);

    let routePolyline = L.polyline([], { color: '#4B7A54', weight: 14, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    let pickupGroup = L.featureGroup([]).addTo(map);

    // "Need" layer — ~110m tiles colored by how much a block needs a cleanup.
    let needGroup = L.featureGroup([]).addTo(map);
    window.renderNeed = function(tiles) {
      needGroup.clearLayers();
      (tiles || []).forEach(function(t) {
        L.circleMarker([t.lat, t.lon], {
          radius: 11, color: '#ffffff', weight: 1, fillColor: t.color, fillOpacity: 0.6
        }).addTo(needGroup);
      });
    };
    window.clearNeed = function() { needGroup.clearLayers(); };

    // "My impact" layer — routes touched + pickups over a time window.
    let impactGroup = L.featureGroup([]).addTo(map);
    window.renderImpact = function(routes, pickups) {
      impactGroup.clearLayers();
      (routes || []).forEach(function(r) {
        if (r && r.length > 1) L.polyline(r, { color: '#4B7A54', weight: 5, opacity: 0.7, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(impactGroup);
      });
      (pickups || []).forEach(function(p) {
        L.circleMarker(p, { radius: 5, color: '#ffffff', weight: 1, fillColor: '#4B7A54', fillOpacity: 0.95, interactive: false }).addTo(impactGroup);
      });
      try { if (routes && routes.length) map.fitBounds(impactGroup.getBounds().pad(0.25)); } catch (e) {}
    };
    window.clearImpact = function() { impactGroup.clearLayers(); };
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
        color: '#4B7A54',
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

    // ── Freshness: one shared ramp for every layer ──────────────────────────
    // Clean → deteriorating → unclean: vivid green the day it's cleaned, through
    // yellow and orange as it deteriorates, to a strong RED once it's unclean —
    // the "worst" state stays boldly visible (the whole point: go clean it). Only
    // NEVER-cleaned streets are the faint dashed "blank". Old cleaned blocks dim
    // slightly with age but keep their color, so the worst never disappears.
    var FADE_START_DAYS = 12; // opacity eases down a touch from here…
    var FADE_END_DAYS = 30;   // …to a still-visible floor (not gone)
    var NEVER_COLOR = '#C4C8BD'; // never cleaned — the faint, dashed "blank"
    function _lerp(a, b, t) { return Math.round(a + (b - a) * t); }
    function freshRGB(daysOld) {
      var stops = [
        [0,  [47, 180, 87]],    // just cleaned — vivid green (#2FB457)
        [6,  [242, 197, 0]],    // deteriorating — yellow (#F2C500)
        [12, [238, 122, 30]],   // getting bad — orange (#EE7A1E)
        [20, [210, 50, 28]]     // worst — strong, visible red (#D2321C)
      ];
      var last = stops[stops.length - 1];
      var d = daysOld < 0 ? 0 : daysOld;
      if (d >= last[0]) return last[1];
      for (var i = 1; i < stops.length; i++) {
        if (d <= stops[i][0]) {
          var t = (d - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
          return [
            _lerp(stops[i - 1][1][0], stops[i][1][0], t),
            _lerp(stops[i - 1][1][1], stops[i][1][1], t),
            _lerp(stops[i - 1][1][2], stops[i][1][2], t)
          ];
        }
      }
      return last[1];
    }
    function freshColor(daysOld) { var c = freshRGB(daysOld); return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
    // Full strength while fresh, easing to a still-clearly-visible floor as a
    // block ages — the worst (red) blocks must stay legible, not dissolve.
    function tailFade(daysOld) {
      var d = daysOld < 0 ? 0 : daysOld;
      if (d <= FADE_START_DAYS) return 1;
      if (d >= FADE_END_DAYS) return 0.6;
      return 1 - 0.4 * ((d - FADE_START_DAYS) / (FADE_END_DAYS - FADE_START_DAYS));
    }

    // Walks render as freshness-colored route corridors, not center-point blobs.
    // Tiny dot fallback only for legacy cleanups saved before route tracking.
    let historicalGroup = L.featureGroup([]).addTo(map);
    window.addHistoricalRoutes = function(cleanups) {
      historicalGroup.clearLayers();
      cleanups.forEach(function(cleanup) {
        const daysOld = (Date.now() - cleanup.timestamp) / (1000 * 60 * 60 * 24);
        // Vitality fade: bright green when fresh, quietly graying as it ages.
        const color = freshColor(daysOld);
        const opacity = 0.55 * tailFade(daysOld);

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

    // Litter-hotspot (pickup heatmap) removed from the app — it now lives on the
    // web dashboard. Stub kept so any stray call is a harmless no-op.
    window.drawHotspots = function() {};

    // Street-segment coverage layer (shared across ALL users).
    // Gray dashes = never cleaned; green→red = freshness since last clean.
    // Two coverage sublayers:
    //  - todoGroup: the gray "never cleaned" dashes. Numerous and ambient, so
    //    they stay bubble-scoped (replaced each fetch, skipped when zoomed out)
    //    to protect WebView memory.
    //  - cleanedGroup: your colored progress. Few in number and the whole point,
    //    so they ACCUMULATE across fetches (keyed by segment id) and persist
    //    when you pan or zoom out instead of blinking away with the fetch bubble.
    let todoGroup = L.featureGroup([]).addTo(map);
    let cleanedGroup = L.featureGroup([]).addTo(map);
    var cleanedById = {};
    // Never-cleaned streets are kept by id too, so a block finished mid-walk can
    // be promoted out of the gray dashes and into the colored layer live.
    var todoById = {};
    var CLEANED_CAP = 4000; // hard ceiling so a marathon session can't grow unbounded

    function segFresh(daysOld) {
      return [freshColor(daysOld), 0.85 * tailFade(daysOld)];
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
        // Cleaned on THIS walk (day 0): brighter and heavier, so the block you
        // just finished pops out of the surrounding history.
        var justNow = s.daysOld !== null && s.daysOld <= 0;
        var c = segFresh(s.daysOld);
        L.polyline(s.coords, {
          color: justNow ? '#2FB457' : c[0],
          weight: justNow ? 6 : 4,
          opacity: justNow ? 0.95 : c[1],
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(cleanedGroup);
      });
    }

    function redrawTodo() {
      todoGroup.clearLayers();
      Object.keys(todoById).forEach(function(id) {
        L.polyline(todoById[id].coords, { color: NEVER_COLOR, weight: 4, opacity: 0.4, dashArray: '2 9', lineCap: 'round', lineJoin: 'round' }).addTo(todoGroup);
      });
    }

    window.renderSegments = function(segments) {
      todoById = {};
      var cleanedTouched = false;
      segments.forEach(function(seg) {
        if (seg.daysOld === null || seg.daysOld === undefined) {
          // Already flipped green earlier in this walk? Don't demote it back to
          // a gray dash just because the shared data hasn't synced yet.
          if (cleanedById[seg.id]) return;
          todoById[seg.id] = { coords: seg.coords };
        } else {
          cleanedById[seg.id] = { coords: seg.coords, daysOld: seg.daysOld };
          cleanedTouched = true;
        }
      });
      redrawTodo();
      if (cleanedTouched) redrawCleaned();
      // z-order: gray furthest back, green just above it, both under routes/markers
      cleanedGroup.bringToBack();
      todoGroup.bringToBack();
      console.log('Segments: ' + segments.length + ' in view, ' + Object.keys(cleanedById).length + ' cleaned retained');
    };

    // Live in-walk recolor for the overview map: flip finished blocks to
    // bright fresh-green without disturbing the rest of the coverage history.
    window.markSegmentsClean = function(ids) {
      if (!ids || !ids.length) return;
      var promoted = false;
      var changed = false;
      ids.forEach(function(id) {
        if (cleanedById[id]) {
          cleanedById[id].daysOld = 0;
          changed = true;
        } else if (todoById[id]) {
          cleanedById[id] = { coords: todoById[id].coords, daysOld: 0 };
          delete todoById[id];
          promoted = true;
          changed = true;
        }
      });
      if (!changed) return;
      if (promoted) redrawTodo();
      redrawCleaned();
      cleanedGroup.bringToBack();
      todoGroup.bringToBack();
    };

    window.clearSegments = function() {
      todoGroup.clearLayers();
      cleanedGroup.clearLayers();
      cleanedById = {};
      todoById = {};
    };

    // Neighborhood outlines layer: every hood in view drawn as a tappable
    // polygon. Tap → focus it (highlight + score). Stored by name so we can
    // re-tint the selected one after a redraw.
    let boundaryGroup = L.featureGroup([]).addTo(map);
    var hoodLayers = {};
    var hoodLabels = {};
    var selectedHoodName = null;
    // Recognizable but light: a soft sage line, transparent (but tappable) fill.
    var HOOD_BASE = { color: '#5A6B8C', weight: 1.5, opacity: 0.6, fill: true, fillColor: '#5A6B8C', fillOpacity: 0.0, lineJoin: 'round' };
    var HOOD_SEL = { color: '#0F2F66', weight: 2.5, opacity: 0.85, fill: true, fillColor: '#0F2F66', fillOpacity: 0.06, lineJoin: 'round' };

    window.renderNeighborhoods = function(list, withLabels) {
      if (!list || !list.length) return;
      list.forEach(function(h) {
        if (!hoodLayers[h.name]) {
          var poly = L.polygon(h.ring, HOOD_BASE).addTo(boundaryGroup);
          poly.on('click', function() {
            if (window.__adoptMode) return; // adopt mode: tap selects a block, not a hood
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'hoodTap', name: h.name }));
            }
          });
          hoodLayers[h.name] = poly;
        }
        // Draw our own soft name label only where the basemap doesn't already
        // print one (Atlanta). Styled to echo the grayscale basemap labels.
        if (withLabels && !hoodLabels[h.name]) {
          try {
            var lc = hoodLayers[h.name].getBounds().getCenter();
            var safe = String(h.name).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            hoodLabels[h.name] = L.marker(lc, {
              interactive: false, keyboard: false,
              icon: L.divIcon({ className: 'hood-label', html: '<span class="hood-label-text">' + safe + '</span>', iconSize: [0, 0] })
            }).addTo(boundaryGroup);
          } catch (e) {}
        }
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
    // Level streets render just BELOW the veil so any part of a street that
    // crosses the neighborhood boundary is masked — only what's inside the hood
    // shows. (The veil is a world-with-a-hole, so the hole keeps inside crisp.)
    if (!map.getPane('levelPane')) {
      var lvp = map.createPane('levelPane');
      lvp.style.zIndex = 340;
      lvp.style.pointerEvents = 'none';
    }
    var WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];

    function levelColor(daysOld) {
      if (daysOld === null || daysOld === undefined) return [NEVER_COLOR, 2, 0.35]; // untouched — thin, faint (dashed) so it reads as "blank / nothing"
      var tf = tailFade(daysOld);
      return [freshColor(daysOld), 2.6 + 2.4 * tf, 0.95 * tf];
    }

    // Overview layers we fade out on entry so the neighborhood is the only focus.
    var LEVEL_HIDDEN = [];
    function hideOutsideLayers() {
      LEVEL_HIDDEN = [historicalGroup, boundaryGroup, parkGroup];
      LEVEL_HIDDEN.forEach(function (g) { try { if (g && map.hasLayer(g)) map.removeLayer(g); } catch (e) {} });
    }
    function showOutsideLayers() {
      LEVEL_HIDDEN.forEach(function (g) { try { if (g && !map.hasLayer(g)) { map.addLayer(g); g.bringToBack(); } } catch (e) {} });
    }

    function drawSpotlight(ring) {
      spotlightGroup.clearLayers();
      // Veil = world rectangle with the neighborhood as a hole → the city OUTSIDE
      // the hood fades to soft cream so the neighborhood alone reads clearly
      // (a light scrim, not a dark one).
      L.polygon([WORLD_RING, ring], { pane: 'maskPane', stroke: false, fillColor: '#FFFFFF', fillOpacity: 0.55, interactive: false }).addTo(spotlightGroup);
      L.polygon(ring, { pane: 'maskPane', fill: false, color: '#0F2F66', weight: 2.5, opacity: 0.95, lineJoin: 'round', interactive: false }).addTo(spotlightGroup);
    }

    window.enterLevel = function(ring) {
      levelLocked = true;
      // Drop everything outside the hood: overview street shading, other hood
      // outlines + their name labels, past routes, and parks. Only this
      // neighborhood's own streets remain.
      try { todoGroup.clearLayers(); cleanedGroup.clearLayers(); } catch (e) {}
      hideOutsideLayers();
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
    var levelDaysById = {}; // id → { daysOld } so a tap can report last-cleaned age (mutable: live-cleaning updates it)
    var levelRenderToken = 0;

    // Human "last cleaned" phrasing for a block's age (in days), for tap popups.
    function freshnessText(d) {
      if (d === null || d === undefined) return 'Not cleaned yet';
      var n = Math.round(d);
      if (n <= 0) return 'Cleaned today';
      if (n === 1) return 'Cleaned 1 day ago';
      return 'Cleaned ' + n + ' days ago';
    }
    // Draw the level's streets in small async chunks. A big neighborhood (e.g.
    // Atlanta's official hoods, which are far larger than NYC's) can hold
    // thousands of segments; drawing them in one synchronous loop froze the UI
    // for seconds. Yielding between chunks keeps the map — and the entry
    // animation — responsive while streets stream in. A new render supersedes
    // any in-flight one via the token.
    // Adopt lives in the popup now (no separate adopt mode): tap a street →
    // last-cleaned + an Adopt link that hands the latlng to RN.
    window.__adoptFromPopup = function(lat, lon) {
      map.closePopup();
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'adoptTap', lat: lat, lon: lon }));
      }
    };
    function openSegPopup(id, latlng) {
      var rec = levelDaysById[id];
      var days = rec ? rec.daysOld : null;
      L.popup({ closeButton: false, className: 'seg-popup', offset: [0, -1], autoPan: true })
        .setLatLng(latlng)
        .setContent(
          '<span class="seg-popup-text">' + freshnessText(days) + '</span>' +
          '<br><a class="seg-popup-adopt" onclick="window.__adoptFromPopup(' + latlng.lat + ',' + latlng.lng + ')">Adopt this block</a>'
        )
        .openOn(map);
    }

    window.renderLevel = function(list) {
      levelGroup.clearLayers();
      levelLayersById = {};
      levelDaysById = {};
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
          var untouched = (s.daysOld === null || s.daysOld === undefined);
          var pl = L.polyline(s.coords, { pane: 'levelPane', color: c[0], weight: c[1], opacity: c[2], dashArray: untouched ? '2 9' : null, lineCap: 'round', lineJoin: 'round' }).addTo(levelGroup);
          if (s.id) { levelLayersById[s.id] = pl; levelDaysById[s.id] = { daysOld: s.daysOld }; }
          // Invisible fat tap target so thin blocks are easy to hit → tap shows
          // when this block was last cleaned.
          if (s.id) {
            var hit = L.polyline(s.coords, { pane: 'levelPane', color: '#000', weight: 18, opacity: 0, lineCap: 'round', lineJoin: 'round' }).addTo(levelGroup);
            hit.on('click', (function (segId) { return function (ev) { openSegPopup(segId, ev.latlng); }; })(s.id));
          }
        }
        if (i < list.length) setTimeout(step, 0);
      }
      step();
    };

    // Live recolor a single street to fresh-green as you cover it on a walk.
    window.markLevelClean = function(id) {
      var pl = levelLayersById[id];
      if (pl) pl.setStyle({ color: '#2FB457', weight: 5, opacity: 0.95 });
      if (levelDaysById[id]) levelDaysById[id].daysOld = 0; // tapping it now says "Cleaned today"
    };

    window.exitLevel = function() {
      levelLocked = false;
      levelGroup.clearLayers();
      spotlightGroup.clearLayers();
      showOutsideLayers(); // bring back the overview outlines, labels, routes, parks
      // enterLevel emptied the coverage layers; repaint them from what we still
      // hold so the overview isn't blank while a refetch is in flight.
      redrawTodo();
      redrawCleaned();
      cleanedGroup.bringToBack();
      todoGroup.bringToBack();
    };

    // Parks: filled polygons colored by freshness, drawn under the route.
    let parkGroup = L.featureGroup([]).addTo(map);
    window.renderParks = function(parks) {
      parkGroup.clearLayers();
      parks.forEach(function(park) {
        let color, fill;
        if (park.daysOld === null || park.daysOld === undefined) {
          color = NEVER_COLOR; fill = 0.08; // never cleaned — faint neutral gray
        } else {
          color = freshColor(park.daysOld);
          fill = 0.28 * tailFade(park.daysOld); // full when fresh → dissolves as it ages
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
        const color = freshColor(daysOld);
        const opacity = 0.6 * tailFade(daysOld);

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
            <Icon name="pin" size={40} color={C.primary} />
            <Text style={[styles.mapText, { marginTop: 8 }]}>Getting location…</Text>
          </View>
        )}
      </View>

      {/* Main Controls - Always at bottom */}
      <View style={[styles.controls, { paddingBottom: Math.max(6, insets.bottom - 8) }, isListening && styles.controlsCompact]}>
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

      {/* City search */}
      <Modal visible={cityPickerOpen} transparent animationType="fade" onRequestClose={() => setCityPickerOpen(false)}>
        <TouchableOpacity style={styles.cityBackdrop} activeOpacity={1} onPress={() => setCityPickerOpen(false)}>
          <TouchableOpacity style={styles.citySheet} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.citySheetTitle}>Search for a city</Text>
            <TextInput
              style={styles.citySearchInput}
              value={cityQuery}
              onChangeText={onCityQueryChange}
              placeholder="Type a city name…"
              placeholderTextColor={C.muted}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => runCitySearch(cityQuery)}
            />
            {citySearching && <Text style={styles.cityHint}>Searching…</Text>}
            {!citySearching && cityQuery.trim().length >= 2 && cityResults.length === 0 && (
              <Text style={styles.cityHint}>No matches</Text>
            )}
            {cityResults.map((c, i) => (
              <TouchableOpacity key={`${c.label}-${i}`} style={styles.cityRow} onPress={() => goToCity({ ...c, zoom: 13 })} activeOpacity={0.7}>
                <Icon name="pin" size={18} color={C.primary} sw={1.8} />
                <Text style={styles.cityRowText} numberOfLines={1}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
              {/* Vertical gradient — mirrors the map's continuous freshness
                  ramp (freshRGB in the WebView): green 0d → yellow 6d →
                  orange 12d → red 20d+. Keep the stops in sync. */}
              <View style={styles.scaleRampRow}>
                <View style={styles.scaleRamp}>
                  {['#2FB457', '#8DBE2E', '#F2C500', '#F0A012', '#EE7A1E', '#E0561D', '#D2321C', '#D2321C'].map((c, i) => (
                    <View key={i} style={{ flex: 1, backgroundColor: c }} />
                  ))}
                </View>
                <View style={styles.scaleRampLabels}>
                  <View>
                    <Text style={styles.scaleItemTitle}>Just cleaned</Text>
                    <Text style={styles.scaleItemDesc}>Day 0 — vivid green</Text>
                  </View>
                  <View>
                    <Text style={styles.scaleItemTitle}>Deteriorating</Text>
                    <Text style={styles.scaleItemDesc}>~Day 6 — litter accumulating</Text>
                  </View>
                  <View>
                    <Text style={styles.scaleItemTitle}>Getting bad</Text>
                    <Text style={styles.scaleItemDesc}>~Day 12 — cleanup needed</Text>
                  </View>
                  <View>
                    <Text style={styles.scaleItemTitle}>Unclean</Text>
                    <Text style={styles.scaleItemDesc}>Day 20+ — stays boldly red</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.scaleItem, { marginTop: 14 }]}>
                <View style={styles.scaleNeverSwatch}>
                  <View style={styles.scaleNeverDash} />
                  <View style={styles.scaleNeverDash} />
                  <View style={styles.scaleNeverDash} />
                </View>
                <View style={styles.scaleText}>
                  <Text style={styles.scaleItemTitle}>Never cleaned</Text>
                  <Text style={styles.scaleItemDesc}>Faint dashed gray — no one has picked here yet</Text>
                </View>
              </View>

              <View style={styles.scaleInfoNote}>
                <Text style={styles.scaleInfoNoteText}>
                  A block counts toward your neighborhood % for 5 days after a cleanup — then it needs another pick to count again. Old blocks dim slightly with age but never disappear.
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
        {/* Deliberately NOT a KeyboardAvoidingView. This sheet is bottom-anchored
            and, with "Adjust details" open, taller than the display — so padding
            the container by the keyboard height shoved the top of the card off
            the top of the screen, taking the piece-count field you had just
            tapped with it. The ScrollView below absorbs the keyboard inset
            instead and scrolls the focused field into view, which is what you
            actually wanted. */}
        <View style={styles.modalContainer}>
          {/* Tap the dimmed area to dismiss the (done-less) decimal keypad */}
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => Keyboard.dismiss()} />
          <View style={styles.modalContent}>
            <ScrollView
              contentContainerStyle={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.grabber} />
              <Text style={styles.doneTitle}>Nice walk!</Text>
              <Text style={styles.doneSub}>Here’s what you logged.</Text>

              <View style={styles.heroRow}>
                <TouchableOpacity style={styles.heroStat} activeOpacity={0.7} onPress={() => setShowAdjust(true)}>
                  <Text style={styles.heroNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{userCount ?? pickupCount}</Text>
                  <Text style={styles.heroLabel}>{(userCount ?? pickupCount) === 1 ? 'pickup' : 'pickups'}</Text>
                </TouchableOpacity>
                <View style={styles.heroDivider} />
                <View style={styles.heroStat}>
                  <Text style={styles.heroNum} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{formatTime(elapsedSeconds)}</Text>
                  <Text style={styles.heroLabel}>on the walk</Text>
                </View>
              </View>
              <Text style={styles.estLine}>
                Est. {formatKitchenBags(itemsToBags(userCount ?? pickupCount))} collected
              </Text>

              {/* Bag size first, always visible, never behind a disclosure —
                  everything below is expressed relative to it. */}
              <Text style={styles.qLabel}>What were you filling?</Text>
              <View style={styles.amountGrid}>
                {BAG_SIZE_OPTIONS.map((o) => {
                  const on = bagSize === o.key;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.amountChip, styles.sizeChip, on && styles.amountChipActive]}
                      onPress={() => chooseBagSize(o.key)}
                    >
                      <Text style={[styles.amountChipText, on && styles.amountChipTextActive]}>{o.label}</Text>
                      <Text style={[styles.adjustChipHint, on && styles.amountChipTextActive]}>{o.hint}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.qLabel, styles.qLabel2]}>How much did you collect?</Text>
              <View style={styles.amountGrid}>
                {AMOUNT_OPTIONS.map((a) => {
                  const active = bagReported && bagFullness === a.fullness && bagCount === a.count;
                  return (
                    <TouchableOpacity
                      key={a.key}
                      style={[styles.amountChip, active && styles.amountChipActive]}
                      onPress={() => { setBagFullness(a.fullness); setBagCount(a.count); setBagReported(true); }}
                    >
                      <Text style={[styles.amountChipText, active && styles.amountChipTextActive]}>{a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.optionalNote}>
                {bagReported
                  ? `That’s ${formatKitchenBags(reportedBags(bagSize, bagFullness, bagCount))}.`
                  : 'Optional — we’ll estimate from your pickups if you skip.'}
              </Text>

              {/* Count correction. The detector runs well over on a slow stroll and
                  that is a sensor limit, not a bug we can filter away — so the
                  honest thing is to let people fix the number. Tucked behind a
                  disclosure so the one-tap path above stays the default. */}
              <TouchableOpacity style={styles.adjustToggle} activeOpacity={0.7} onPress={() => setShowAdjust((v) => !v)}>
                <Text style={styles.adjustToggleText}>{showAdjust ? 'Hide details' : 'Adjust details'}</Text>
              </TouchableOpacity>

              {showAdjust ? (
                <BagDetails
                  value={{ count: userCount ?? pickupCount, size: bagSize, qty: bagCount, fullness: bagFullness }}
                  detectedCount={pickupCount}
                  showSize={false}
                  onChange={(v) => {
                    setUserCount(v.count);
                    setBagCount(v.qty);
                    setBagFullness(v.fullness);
                    // Touching anything here is an explicit report, so it wins
                    // over the pickup-derived estimate from here on.
                    setBagReported(true);
                  }}
                />
              ) : null}

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
                    <Icon name="camera" size={22} color={C.primary} sw={1.7} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addPhotoTitle}>Add a photo</Text>
                    <Text style={styles.addPhotoSub}>Show the spot you cleaned up</Text>
                  </View>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.primarySave} onPress={saveSummary} activeOpacity={0.85}>
                <Text style={styles.primarySaveText}>Save & log</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.discardLink}
                onPress={() => {
                  // Guarded discard — a single mistap must never throw away a
                  // walk. Require an explicit, counted confirmation.
                  Alert.alert(
                    'Discard this walk?',
                    `You logged ${pickupCount} pickup${pickupCount === 1 ? '' : 's'}${elapsedSeconds ? ` over ${formatTime(elapsedSeconds)}` : ''}. This can’t be undone.`,
                    [
                      { text: 'Keep walk', style: 'cancel' },
                      {
                        text: 'Discard',
                        style: 'destructive',
                        onPress: () => {
                          clearWalkDraft();
                          setShowSummary(false);
                          setPickupCount(0);
                          setElapsedSeconds(0);
                          setPhotoUri(null);
                          setSessionRoute([]);
                          setPickupLocations([]);
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.discardLinkText}>Discard walk</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
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
                    {distanceValue(parseFloat(String(calculateCoverage().distance || '0')))}
                  </Text>
                  <Text style={styles.resultStatLabel}>{distanceUnit} walked</Text>
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
                  {fmtDistance(parseFloat(String(calculateCoverage().distance || '0')))} walked
                </Text>
              </View>
            </View>

            {/* Photo hero (if added) */}
            {photoUri && (
              <View style={styles.resultsSection}>
                <Image source={{ uri: photoUri }} style={styles.resultsPhoto} />
              </View>
            )}

            {/* Share your impact — both destinations offered right here, at
                the moment of highest intent, instead of a separate trip to
                the Community tab. */}
            <View style={styles.resultsSection}>
              {photoUri && communitySharing && !communityAutoPost && (
                <TouchableOpacity style={styles.communityCta} onPress={() => setShowCommunityCompose(true)}>
                  <Icon name="camera" size={20} color={C.primary} sw={2} />
                  <Text style={styles.communityCtaText}>Share to community</Text>
                </TouchableOpacity>
              )}
              {photoUri && communitySharing && communityAutoPost && (
                <Text style={styles.autoPostNote}>Auto-posted to community. Manage it from the Community tab.</Text>
              )}

              <TouchableOpacity
                style={[styles.communityCta, { marginTop: 10 }]}
                onPress={() => {
                  // A second <Modal> can't stack over this one on iOS (same
                  // issue documented for the community composer and recap
                  // share) — close this screen first, then open ShareComposer.
                  setShowResults(false);
                  setTimeout(() => setShareOpen(true), 400);
                }}
              >
                <Icon name="share" size={20} color={C.primary} sw={2} />
                <Text style={styles.communityCtaText}>Share externally</Text>
              </TouchableOpacity>
              {blueskyAutoPost && photoUri && (
                <Text style={styles.autoPostNote}>Auto-shared to Bluesky. Manage it from Settings.</Text>
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
                  placeholderTextColor={C.muted}
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
        visible={shareOpen}
        onClose={() => { setShareOpen(false); finishSession(); }}
        pieces={pickupCount}
        bags={bagReported ? reportedBags(bagSize, bagFullness) : itemsToBags(pickupCount)}
        distanceMi={parseFloat(String(calculateCoverage().distance || '0')) * 0.621371}
        photoUri={photoUri}
        fullName={user?.displayName || 'A Pick user'}
        initials={(user?.displayName || 'PK').trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
        team={userTeam || 'Solo'}
        hood={neighborhood || currentArea.neighborhood || ''}
        hoodPct={activeLevel?.freshPct}
        inviteUrl={TESTFLIGHT_URL}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.white,
    flexDirection: 'column',
  },
  containerFullscreen: {
    backgroundColor: C.white,
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
    fontFamily: Fonts.bodyBold,
    letterSpacing: -0.2,
    color: C.dark,
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  coverageText: {
    fontSize: 12,
    color: C.primary,
    fontFamily: Fonts.bodySemibold,
    marginTop: 2,
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  completionPill: {
    backgroundColor: C.white,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginLeft: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  completionPct: { fontSize: 18, fontFamily: Fonts.displayBold, color: C.primary, letterSpacing: -0.3 },
  completionLbl: { fontSize: 9, fontFamily: Fonts.bodySemibold, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  levelReveal: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15,47,102,0.82)',
    alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  levelRevealSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontFamily: Fonts.bodySemibold, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 18 },
  levelRevealName: { color: '#fff', fontSize: 26, fontFamily: Fonts.headlineBold, letterSpacing: -0.4, marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
  slowLoadBanner: {
    position: 'absolute', left: 12, right: 12, zIndex: 60,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.white, borderRadius: radius.field,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  slowLoadBannerText: { flex: 1, fontSize: 13, fontFamily: Fonts.bodySemibold, color: C.dark },
  slowLoadBannerDismiss: { fontSize: 13, color: C.muted, paddingHorizontal: 4 },
  cityRequestCard: {
    position: 'absolute', left: 12, right: 12, zIndex: 59,
    backgroundColor: C.white, borderRadius: radius.field,
    paddingVertical: 12, paddingHorizontal: 14, gap: 10,
    borderWidth: 1.5, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  cityRequestText: { fontSize: 13, fontFamily: Fonts.body, color: C.dark, lineHeight: 18 },
  cityRequestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cityRequestCta: {
    flex: 1, backgroundColor: C.primary, borderRadius: radius.field,
    paddingVertical: 9, alignItems: 'center',
  },
  cityRequestCtaText: { fontFamily: Fonts.bodySemibold, fontSize: 13, color: C.creamText },
  levelBack: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
    borderWidth: 1.5, borderColor: C.border,
  },
  levelBackIcon: { fontSize: 26, fontFamily: Fonts.bodyBold, color: C.primary, marginTop: -4 },
  pickingBanner: {
    position: 'absolute', alignSelf: 'center', zIndex: 20,
    backgroundColor: 'rgba(15,47,102,0.88)', borderRadius: 14,
    paddingVertical: 6, paddingHorizontal: 14, maxWidth: '90%',
  },
  pickingBannerText: { color: '#fff', fontSize: 13, fontFamily: Fonts.bodySemibold, letterSpacing: 0.2 },
  tooFastPill: {
    position: 'absolute', alignSelf: 'center', zIndex: 21,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FCE8CE', borderRadius: 14,
    paddingVertical: 6, paddingHorizontal: 14, maxWidth: '92%',
  },
  tooFastText: { color: '#8A3B12', fontSize: 13, fontFamily: Fonts.bodyBold },
  teamOrSuperlative: {
    fontSize: 13,
    fontFamily: Fonts.bodySemibold,
    color: C.primary,
    overflow: 'hidden',
    backgroundColor: C.white,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.border,
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
    alignItems: 'center',
    backgroundColor: C.dark,
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
    borderRadius: 16,
    gap: 6,
  },
  topBarStat: {
    flex: 1,
    alignItems: 'center',
  },
  topBarValue: {
    fontSize: 22,
    fontFamily: Fonts.displayBold,
    color: '#fff',
    marginBottom: 4,
  },
  topBarLabel: {
    fontSize: 11,
    color: '#A8B896',
    fontFamily: Fonts.bodyMedium,
  },
  coverageToggle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    flexShrink: 0,
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
    backgroundColor: C.tint,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: C.accent,
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
    fontFamily: Fonts.bodySemibold,
    color: C.dark,
    marginBottom: 4,
  },
  mapTextLarge: {
    fontSize: 24,
    color: '#fff',
  },
  mapSubtext: {
    fontSize: 12,
    color: C.muted,
  },
  mapCoordLarge: {
    fontSize: 28,
    fontFamily: Fonts.displayBold,
    color: C.accent,
  },
  mapStatus: {
    fontSize: 14,
    color: C.accent,
    fontFamily: Fonts.bodySemibold,
    marginTop: 12,
  },
  mapRouteInfo: {
    fontSize: 12,
    color: C.muted,
    marginTop: 8,
  },
  mapStatsContainer: {
    marginTop: 16,
    alignItems: 'center',
    gap: 8,
  },
  mapStat: {
    fontSize: 16,
    fontFamily: Fonts.bodySemibold,
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
    borderLeftColor: C.accent,
  },
  batterySaverLabel: {
    flex: 1,
  },
  batterySaverText: {
    fontSize: 14,
    fontFamily: Fonts.bodySemibold,
    color: C.dark,
    marginBottom: 2,
  },
  batterySaverSubtext: {
    fontSize: 11,
    color: C.muted,
  },
  toggleSwitch: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.toggleOff,
    padding: 2,
    justifyContent: 'flex-start',
  },
  toggleSwitchActive: {
    backgroundColor: C.accent,
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
    color: C.muted,
  },
  timerText: {
    fontSize: 48,
    fontFamily: Fonts.displayBold,
    color: C.accent,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  pickupCountText: {
    fontSize: 14,
    color: C.muted,
    fontFamily: Fonts.bodyMedium,
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
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  buttonStop: {
    backgroundColor: C.danger,
    shadowColor: C.danger,
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
    fontFamily: Fonts.bodyBold,
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
    // Bounded so the sheet can never grow past the screen and strand its own
    // top edge. Anything longer scrolls.
    maxHeight: '90%',
  },
  modalScroll: {
    padding: 20,
    paddingBottom: 30,
  },
  modalTitle: {
    fontSize: 24,
    fontFamily: Fonts.headlineBold,
    color: C.dark,
    marginBottom: 20,
    textAlign: 'center',
  },

  // ── Redesigned session summary ──────────────────────────────────────────
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 14,
  },
  doneTitle: {
    fontSize: 26,
    fontFamily: Fonts.displayBold,
    color: C.dark,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  doneSub: {
    fontSize: 14,
    color: C.muted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Civic Blueprint: navy surface + cream numerals, matching the Impact hero.
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 18,
  },
  heroStat: { flex: 1, alignItems: 'center', minWidth: 0, paddingHorizontal: 8 },
  heroDivider: { width: 1, height: 40, backgroundColor: 'rgba(254,252,221,0.22)' },
  heroNum: { fontSize: 44, fontFamily: Fonts.displayBold, color: C.creamText, letterSpacing: -1 },
  heroLabel: { fontSize: 13, color: C.heroSub, marginTop: 3 },
  estLine: {
    fontSize: 13,
    color: C.muted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 22,
  },
  qLabel: {
    fontSize: 16,
    fontFamily: Fonts.bodyBold,
    color: C.dark,
    marginBottom: 12,
  },
  qLabel2: { marginTop: 22 },
  // Three across rather than two — size is a quick, low-stakes pick.
  sizeChip: { width: '30%', paddingVertical: 12 },
  amountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  amountChip: {
    width: '47.8%',
    flexGrow: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  // Navy is the selected state everywhere else in the app (settings pills,
  // adopt button, leaderboard). Green is progress/success, not selection.
  amountChipActive: {
    borderColor: C.primary,
    backgroundColor: C.tint,
  },
  amountChipText: { fontSize: 15, fontFamily: Fonts.bodyBold, color: C.dark },
  amountChipTextActive: { color: C.primary },
  optionalNote: {
    fontSize: 12.5,
    color: C.muted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  // "Adjust details" — count/bag correction, tucked behind a disclosure so the
  // one-tap chips stay the default path.
  adjustToggle: { alignItems: 'center', paddingVertical: 6, marginBottom: 8 },
  adjustToggleText: {
    fontSize: 14,
    fontFamily: Fonts.bodySemibold,
    color: C.primary,
    textDecorationLine: 'underline',
  },
  adjustChipHint: { fontSize: 11.5, color: C.muted, marginTop: 2 },
  // Every other primary CTA in the app is navy (login, signup, settings save,
  // leaderboard join, adopt). This one was the last green holdout.
  primarySave: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySaveText: { fontSize: 17, fontFamily: Fonts.bodyBold, color: '#fff' },
  discardLink: { alignItems: 'center', paddingVertical: 14, marginTop: 2 },
  discardLinkText: { fontSize: 14, fontFamily: Fonts.bodySemibold, color: C.muted },
  summaryBox: {
    backgroundColor: C.tint,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: Fonts.bodySemibold,
    color: C.muted,
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
    fontFamily: Fonts.displayBold,
    color: C.accent,
    marginBottom: 4,
  },
  summaryItemLabel: {
    fontSize: 12,
    color: C.muted,
  },
  summaryEstimate: {
    fontSize: 12,
    color: C.muted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  weightInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: C.dark,
    marginBottom: 8,
  },
  comparisonText: {
    fontSize: 12,
    color: C.muted,
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
    backgroundColor: C.tint,
  },
  cancelButtonText: {
    fontSize: 14,
    fontFamily: Fonts.bodySemibold,
    color: C.muted,
  },
  saveButton: {
    backgroundColor: C.accent,
  },
  saveButtonText: {
    fontSize: 14,
    fontFamily: Fonts.bodySemibold,
    color: '#fff',
  },
  resultsContainer: {
    flex: 1,
    backgroundColor: C.white,
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
    fontFamily: Fonts.headlineBold,
    color: C.dark,
  },
  resultsSavedNote: {
    fontSize: 13,
    color: C.muted,
    marginTop: 2,
  },
  closeButton: {
    fontSize: 24,
    color: C.muted,
    paddingHorizontal: 12,
  },
  resultsSection: {
    marginBottom: 24,
  },
  resultsSubtitle: {
    fontSize: 16,
    fontFamily: Fonts.bodySemibold,
    color: C.dark,
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
    borderWidth: 1.5,
    borderColor: C.border,
  },
  resultStatValue: {
    fontSize: 20,
    fontFamily: Fonts.displayBold,
    color: C.accent,
    marginBottom: 4,
  },
  resultStatLabel: {
    fontSize: 11,
    color: C.muted,
    textAlign: 'center',
  },
  noData: {
    fontSize: 13,
    color: C.muted,
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
    fontFamily: Fonts.bodySemibold,
    color: C.muted,
    marginBottom: 4,
    marginTop: 8,
  },
  routeCoords: {
    fontSize: 13,
    color: C.dark,
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
    backgroundColor: C.accent,
  },
  resultButtonPrimaryText: {
    fontSize: 16,
    fontFamily: Fonts.bodySemibold,
    color: '#fff',
  },
  resultButtonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: C.accent,
  },
  resultButtonSecondaryText: {
    fontSize: 16,
    fontFamily: Fonts.bodySemibold,
    color: C.accent,
  },
  resultButtonExport: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.muted,
  },
  resultButtonExportText: {
    fontSize: 16,
    fontFamily: Fonts.bodySemibold,
    color: C.muted,
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
    borderColor: C.border,
    backgroundColor: C.white,
    alignItems: 'center',
  },
  modeButtonActive: {
    borderColor: C.accent,
    backgroundColor: C.tint,
  },
  modeButtonText: {
    fontSize: 13,
    fontFamily: Fonts.bodySemibold,
    color: C.muted,
  },
  modeButtonTextActive: {
    color: C.accent,
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
    borderColor: C.border,
    backgroundColor: C.white,
    alignItems: 'center',
  },
  bagOptionActive: {
    borderColor: C.accent,
    backgroundColor: C.tint,
  },
  bagOptionText: {
    fontSize: 11,
    fontFamily: Fonts.bodySemibold,
    color: C.dark,
    textAlign: 'center',
  },
  bagOptionTextActive: {
    color: C.accent,
  },
  fullnessContainer: {
    marginBottom: 12,
  },
  fullnessLabel: {
    fontSize: 13,
    fontFamily: Fonts.bodySemibold,
    color: C.dark,
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
    backgroundColor: C.accent,
  },
  sliderButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderButton: {
    fontSize: 20,
    fontFamily: Fonts.bodyBold,
    color: C.accent,
    paddingHorizontal: 12,
  },
  weightEstimate: {
    backgroundColor: C.tint,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  weightEstimateLabel: {
    fontSize: 12,
    color: C.muted,
    marginBottom: 4,
  },
  weightEstimateValue: {
    fontSize: 24,
    fontFamily: Fonts.displayBold,
    color: C.accent,
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
    borderWidth: 1.5,
    borderColor: C.border,
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
  headerControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  citySwitch: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  citySwitchChevron: {
    fontSize: 22,
    fontFamily: Fonts.bodyBold,
    color: C.dark,
    marginTop: -2,
    textShadowColor: 'rgba(255,255,255,0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  locateButton: {
    position: 'absolute',
    right: 16,
    bottom: 184,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  adoptButton: {
    position: 'absolute',
    // Centered over the Leaflet zoom control below it. That control's own
    // margin is zeroed in CSS, so it sits 8px from the right at 38px wide →
    // center = 8 + 19 = 27px from the right edge. This 44px button matches:
    // right = 27 − 22 = 5.
    right: 5,
    bottom: 170,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  adoptButtonActive: { backgroundColor: C.primary },
  toolOption: { position: 'absolute', right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 11 },
  toolOptionLabel: { backgroundColor: '#fff', color: C.dark, fontSize: 13, fontFamily: Fonts.bodyBold, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: C.border },
  toolOptionBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border },
  adoptBanner: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  adoptBannerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
  },
  adoptBannerText: { color: '#fff', fontSize: 14, fontFamily: Fonts.bodyBold },
  adoptBannerCancel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontFamily: Fonts.bodyBold },
  cityBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,47,102,0.35)',
    justifyContent: 'flex-start',
    paddingTop: 110,
    paddingHorizontal: 20,
  },
  citySheet: {
    backgroundColor: C.white,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  citySheetTitle: {
    fontSize: 12,
    fontFamily: Fonts.bodySemibold,
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
  },
  citySearchInput: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.dark,
    marginHorizontal: 4,
    marginBottom: 4,
  },
  cityHint: { fontSize: 13, color: C.muted, paddingHorizontal: 14, paddingVertical: 10 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 10 },
  cityRowText: { fontSize: 16, fontFamily: Fonts.bodySemibold, color: C.dark, flex: 1 },
  mapButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.border,
  },
  mapButtonActive: {
    backgroundColor: C.primary,
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
    borderWidth: 1.5,
    borderColor: C.border,
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
    fontFamily: Fonts.headlineBold,
    color: C.dark,
  },
  scaleInfoClose: {
    fontSize: 20,
    color: C.muted,
  },
  scaleInfoContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  scaleRampRow: { flexDirection: 'row', gap: 14, marginTop: 4 },
  scaleRamp: {
    width: 14,
    borderRadius: 7,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  scaleRampLabels: { flex: 1, justifyContent: 'space-between', paddingVertical: 2, gap: 10 },
  scaleNeverSwatch: { width: 22, flexDirection: 'column', gap: 3, alignItems: 'center', marginTop: 4 },
  scaleNeverDash: { width: 14, height: 3, borderRadius: 2, backgroundColor: '#C4C8BD' },
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
    fontFamily: Fonts.bodySemibold,
    color: C.dark,
    marginBottom: 2,
  },
  scaleItemDesc: {
    fontSize: 12,
    color: C.muted,
    lineHeight: 16,
  },
  scaleInfoNote: {
    backgroundColor: C.tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  scaleInfoNoteText: {
    fontSize: 12,
    color: C.accent,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  scaleInfoButton2: {
    backgroundColor: C.accent,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  scaleInfoButtonText2: {
    fontSize: 14,
    fontFamily: Fonts.bodySemibold,
    color: '#fff',
  },
  // Photo intake (summary)
  addPhoto: {
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.border,
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
    backgroundColor: C.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTitle: { fontSize: 14, fontFamily: Fonts.bodyBold, color: C.dark },
  addPhotoSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  photoWrap: {
    position: 'relative',
    marginTop: 4,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  photoPreview: { width: '100%', height: 160, backgroundColor: C.tint },
  photoRemove: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15,47,102,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Results photo + share CTA
  resultsPhoto: { width: '100%', height: 180, borderRadius: 16, backgroundColor: C.tint },
  shareCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  shareCtaText: { color: '#fff', fontSize: 16, fontFamily: Fonts.bodyBold },
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
    borderColor: C.primary,
  },
  communityCtaText: { color: C.primary, fontSize: 16, fontFamily: Fonts.bodyBold },
  autoPostNote: { marginTop: 10, fontSize: 13, color: C.muted, textAlign: 'center' },
  composeOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 50 },
  composeBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,47,102,0.45)' },
  composeSheet: { backgroundColor: C.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 34 },
  composeTitle: { fontSize: 20, fontFamily: Fonts.headlineBold, color: C.dark, marginBottom: 14 },
  composePhoto: { width: '100%', aspectRatio: 1.4, borderRadius: 14, backgroundColor: C.tint, marginBottom: 14 },
  composeInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    fontSize: 15,
    color: C.dark,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  composeHint: { fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 17 },
  composeActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  composeBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  composeCancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  composeCancelText: { color: C.dark, fontSize: 15, fontFamily: Fonts.bodyBold },
  composePost: { backgroundColor: C.primary },
  composePostText: { color: '#fff', fontSize: 15, fontFamily: Fonts.bodyBold },
});
