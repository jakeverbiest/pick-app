import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, Alert, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import MotionDetector from '../../src/services/motionDetection';
import PickupAggregator from '../../src/services/pickupAggregator';
import weightCalibration, { DEFAULT_LB_PER_PICKUP } from '../../src/services/weightCalibration';
import { weightToBags, formatBags } from '../../src/services/impactMetrics';
import { getCoverage, markRouteCleaned } from '../../src/services/streetSegments';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { startBackgroundSession, stopBackgroundSession } from '../../src/services/backgroundSession';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getBadgeService } from '../../src/services/badgeService';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../src/constants/colors';

export default function MapScreen() {
  const router = useRouter();
  const webviewRef = useRef<WebView>(null);
  const heatmapWebviewRef = useRef<WebView>(null);
  const [pickupCount, setPickupCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selfReportedWeight, setSelfReportedWeight] = useState('');
  const [weightInputMode, setWeightInputMode] = useState<'weight' | 'bag'>('weight');
  const [bagSize, setBagSize] = useState<'small' | 'medium' | 'large' | 'xl'>('large');
  const [bagFullness, setBagFullness] = useState(50);
  const [stats, setStats] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [userTeam, setUserTeam] = useState<string>('');
  const [superlative, setSuperlative] = useState<string>('');
  const [sessionRoute, setSessionRoute] = useState<any[]>([]);
  const [pickupLocations, setPickupLocations] = useState<any[]>([]);
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  const [batterySaver, setBatterySaver] = useState(true); // Optimized for battery
  const pickupCounterRef = useRef(0); // Track pickups since last location record
  const [gpsInterval, setGpsInterval] = useState(20000); // 20s base interval
  const lastPickupTimeRef = useRef(0);
  const highFrequencyEndRef = useRef(0);
  const [historicalCleanups, setHistoricalCleanups] = useState<any[]>([]);
  const [showLayers, setShowLayers] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [showScaleInfo, setShowScaleInfo] = useState(false);
  const [showNeighborhood, setShowNeighborhood] = useState(false);
  const [calFactor, setCalFactor] = useState(DEFAULT_LB_PER_PICKUP);
  const [calSampleCount, setCalSampleCount] = useState(0);
  const [coverageStats, setCoverageStats] = useState<{ freshPct: number; totalSegments: number } | null>(null);
  const coverageLoadedRef = useRef(false);
  const [pocketMode, setPocketMode] = useState(false);
  const pocketTapsRef = useRef<number[]>([]);

  // Keep the screen awake while a cleanup session is running — screen lock
  // kills the motion sensors in this build.
  useEffect(() => {
    if (isListening) {
      activateKeepAwakeAsync('cleanup');
    } else {
      deactivateKeepAwake('cleanup');
      setPocketMode(false);
    }
    return () => {
      deactivateKeepAwake('cleanup');
    };
  }, [isListening]);

  // Pocket mode exits on triple-tap within 1.2s
  const handlePocketTap = () => {
    const now = Date.now();
    pocketTapsRef.current = [...pocketTapsRef.current.filter((t) => now - t < 1200), now];
    if (pocketTapsRef.current.length >= 3) {
      pocketTapsRef.current = [];
      setPocketMode(false);
    }
  };

  useEffect(() => {
    loadUserStats();
    loadHistoricalCleanups();
    requestLocationPermission();
    loadCalibration();
    // Get initial location on mount
    trackLocation();
  }, []);

  const loadCalibration = async () => {
    try {
      await weightCalibration.init();
      const state = weightCalibration.getState();
      setCalFactor(state.factor);
      setCalSampleCount(state.sampleCount);
    } catch (error) {
      console.error('Calibration load error:', error);
    }
  };

  // Street-segment coverage: load once when map + location are ready
  useEffect(() => {
    if (mapReady && currentLocation && !coverageLoadedRef.current) {
      coverageLoadedRef.current = true;
      loadStreetCoverage(currentLocation.lat, currentLocation.lon);
    }
  }, [mapReady, currentLocation]);

  const loadStreetCoverage = async (lat: number, lon: number) => {
    try {
      const segments = await getCoverage(lat, lon);
      if (segments.length > 0 && webviewRef.current) {
        webviewRef.current.injectJavaScript(`
          window.renderSegments(${JSON.stringify(segments)});
        `);
      }
      const fresh = segments.filter((s) => s.daysOld !== null && s.daysOld <= 5).length;
      const stats = {
        freshPct: segments.length > 0 ? Math.round((fresh / segments.length) * 100) : 0,
        totalSegments: segments.length,
      };
      setCoverageStats(stats);
      console.log(`🛣️ Coverage: ${stats.freshPct}% of ${stats.totalSegments} segments fresh`);
    } catch (error) {
      console.error('Street coverage error:', error);
    }
  };

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
      // Battery saver: Low Power, Normal: Balanced
      const accuracy = batterySaver ? Location.Accuracy.Low : Location.Accuracy.Balanced;
      const location = await Location.getCurrentPositionAsync({
        accuracy,
      });

      const { latitude, longitude } = location.coords;
      setCurrentLocation({ lat: latitude, lon: longitude });

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

        // Update map in real-time (inside the updater to access updated array)
        if (isListening && webviewRef.current && mapReady) {
          console.log(`🗺️ Injecting route: routeLength=${updated.length}`);
          const routeCoords = updated.map(p => [p.lat, p.lon]);
          webviewRef.current.injectJavaScript(`
            try {
              if (window.updateLocation && window.redrawRoute) {
                window.updateLocation(${latitude}, ${longitude});
                window.redrawRoute(${JSON.stringify(routeCoords)});
                console.log('✅ Route updated with ${updated.length} points');
              } else {
                console.log('❌ Map functions not ready');
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
    const weight = stats?.total_weight || 0;
    const days = stats?.cleanup_days || 0;

    if (cleanups >= 50) return '🏆 Champion';
    if (cleanups >= 20) return '⭐ Rising Star';
    if (cleanups >= 10) return '💪 Committed';
    if (cleanups >= 5) return '🌱 Growing';
    if (cleanups >= 1) return '🎯 Getting Started';
    return '';
  };

  const calculateBagWeight = (size: string, fullness: number) => {
    const bagWeights: { [key: string]: { min: number; max: number } } = {
      small: { min: 0.5, max: 1.5 },
      medium: { min: 1.5, max: 3 },
      large: { min: 3, max: 5 },
      xl: { min: 5, max: 8 },
    };
    const weights = bagWeights[size] || bagWeights.large;
    const avgWeight = (weights.min + weights.max) / 2;
    return (avgWeight * fullness) / 100;
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

  const loadHistoricalCleanups = async () => {
    try {
      const db = await getDatabase();
      const cleanups = await db.getCleanups(100); // Load recent cleanups
      setHistoricalCleanups(cleanups);

      // Inject into map if available
      if (webviewRef.current && cleanups.length > 0) {
        const cleanupJson = JSON.stringify(cleanups);
        webviewRef.current.injectJavaScript(`
          window.addHistoricalRoutes(${cleanupJson});
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

      // Calculate superlative if no team
      if (!settings?.team_name) {
        const sup = calculateSuperlative(userStats);
        setSuperlative(sup);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const startCleanup = async () => {
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
        console.log('🎯 Pickup detected - HIGH FREQUENCY GPS for 30s');

        // Record pickup location (every pickup for now, can optimize later)
        if (true) { // Changed from % 3 === 0 for dev/testing
          try {
            const accuracy = batterySaver ? Location.Accuracy.Low : Location.Accuracy.Balanced;
            const location = await Location.getCurrentPositionAsync({ accuracy });

            const pickupLoc = {
              lat: location.coords.latitude,
              lon: location.coords.longitude,
              timestamp: Date.now(),
            };

            setPickupLocations((prev) => [...prev, pickupLoc]);

            // Add marker to map
            if (webviewRef.current && mapReady) {
              webviewRef.current.injectJavaScript(`
                try {
                  if (window.addPickup) {
                    window.addPickup(${location.coords.latitude}, ${location.coords.longitude});
                  }
                } catch(e) {
                  console.error('Pickup marker error:', e);
                }
              `);
            }

            const db = await getDatabase();
            await db.addPickupLocation(location.coords.latitude, location.coords.longitude);
          } catch (error) {
            console.error('Pickup location error:', error);
          }
        }
      },
      (error) => console.error(error)
    );
    setIsListening(true);

    // Real builds: register background location so the session survives
    // screen-off. Expo Go: falls back to foreground (keep screen on).
    startBackgroundSession().then((mode) => {
      if (mode === 'foreground') {
        console.log('💡 Screen-off not available in this build — Pocket Mode (🌙) keeps the session safe');
      }
    });
  };

  const stopCleanup = () => {
    stopBackgroundSession();
    MotionDetector.stopListening();
    // Pocket-removal guard: pulling the phone out to tap Stop looks like a pickup
    const correctedCount = MotionDetector.trimRecentPickups(3500);
    setPickupCount(correctedCount);
    setIsListening(false);
    setShowSummary(true);
    setSelfReportedWeight('');

    // Debug logging
    console.log('📍 Session stopped');
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
      let finalWeight: number;
      const scaleWeight = parseFloat(selfReportedWeight);
      if (weightInputMode === 'weight') {
        finalWeight = scaleWeight || weightCalibration.estimateWeight(pickupCount);
      } else {
        finalWeight = calculateBagWeight(bagSize, bagFullness);
      }

      // Feed the scale measurement into calibration so the lb/pickup
      // factor learns from real data (Task #22)
      if (weightInputMode === 'weight' && scaleWeight > 0 && pickupCount > 0) {
        const calState = await weightCalibration.addSample(pickupCount, scaleWeight, 'scale');
        if (calState) {
          setCalFactor(calState.factor);
          setCalSampleCount(calState.sampleCount);
        }
      }

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

      await db.addCleanup({
        timestamp: Date.now(),
        location_lat: centerLat,
        location_lon: centerLon,
        items_count: pickupCount,
        bag_qty: 0,
        bag_size: '30',
        weight_lb: finalWeight,
        duration_seconds: elapsedSeconds,
        team: 'solo',
        fitness_tracked: false,
        route_points: JSON.stringify(sessionRoute.map(p => [p.lat, p.lon])),
        motion_log: JSON.stringify(MotionDetector.getSessionEvents()),
      } as any);

      const updatedStats = await db.getCleanupStats();
      setStats(updatedStats);

      // Mark walked street segments as cleaned (shared coverage, all users)
      if (sessionRoute.length > 0) {
        const marked = await markRouteCleaned(sessionRoute, currentUser.uid);
        if (marked > 0) {
          loadStreetCoverage(centerLat, centerLon); // refresh the layer
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
    const detectedWeight = (pickupCount * calFactor).toFixed(2);
    const selfReported = selfReportedWeight || detectedWeight;

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
  WEIGHT ANALYSIS
═══════════════════════════════════════════════════════════

Detected Weight (calibrated ${calFactor.toFixed(4)} lb/pickup, ${calSampleCount} scale samples): ${detectedWeight} lb
Self-Reported Weight: ${selfReported} lb
Calibration Data: ${detectedWeight !== selfReported ? `VARIANCE: ${(Math.abs(parseFloat(selfReported) - parseFloat(detectedWeight))).toFixed(2)} lb` : 'MATCH'}

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

t(s) | peak(g) | dur(ms) | peakT(ms) | gyro | peaks | conf | result
${MotionDetector.getSessionEvents().map((e) =>
  `${String(e.t).padStart(4)} | ${e.peak.toFixed(2).padStart(7)} | ${String(e.duration).padStart(7)} | ${String(e.peakTime).padStart(9)} | ${e.gyro.toFixed(2).padStart(4)} | ${String(e.peaks).padStart(5)} | ${String(e.confidence).padStart(4)} | ${e.counted ? '✅ counted' : e.accepted ? '🔁 cooldown' : '⛔ ' + e.reason}`
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
      await Clipboard.setString(exportData);
      Alert.alert(
        '✅ Copied!',
        'Session data copied to clipboard. Paste in email, Notes, or Drive.'
      );
    } catch (error) {
      console.error('Copy failed:', error);
      Alert.alert(
        '❌ Copy Failed',
        'Could not copy to clipboard. Try again.'
      );
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.container, isListening && styles.containerFullscreen]}>
      {/* Header - Show when NOT cleaning */}
      {!isListening && (
        <View style={styles.header}>
          <View>
            {user && <Text style={styles.userName}>{user.displayName}</Text>}
            {coverageStats && coverageStats.totalSegments > 0 && (
              <Text style={styles.coverageText}>
                🛣️ {coverageStats.freshPct}% of nearby streets fresh
              </Text>
            )}
          </View>
          {(userTeam || superlative) && (
            <Text style={styles.teamOrSuperlative}>{userTeam || superlative}</Text>
          )}
        </View>
      )}


      {/* Top Bar - Only during cleanup */}
      {isListening && (
        <View style={styles.topBarWhite}>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue}>{formatTime(elapsedSeconds)}</Text>
            <Text style={styles.topBarLabel}>Time</Text>
          </View>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue}>{pickupCount}</Text>
            <Text style={styles.topBarLabel}>Pickups</Text>
          </View>
          <View style={styles.topBarStat}>
            <Text style={styles.topBarValue}>{(pickupCount * calFactor).toFixed(1)} lb</Text>
            <Text style={styles.topBarLabel}>Est. Weight</Text>
          </View>
          <TouchableOpacity style={styles.pocketButton} onPress={() => setPocketMode(true)}>
            <Text style={styles.pocketButtonText}>🌙</Text>
            <Text style={styles.pocketButtonLabel}>Pocket</Text>
          </TouchableOpacity>
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
                        window.showNeighborhoodCoverage(${JSON.stringify(cleanups)});
                      `);
                    }
                  } catch (error) {
                    console.error('Failed to load cleanups:', error);
                  }
                } else if (webviewRef.current) {
                  // Hide neighborhood
                  webviewRef.current.injectJavaScript(`
                    window.clearNeighborhoodCoverage();
                  `);
                }
              }}
            >
              <Text style={styles.mapButtonText}>🗺️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => setShowScaleInfo(true)}
            >
              <Text style={styles.mapButtonText}>ℹ️</Text>
            </TouchableOpacity>
          </View>
        )}

        {currentLocation ? (
          <WebView
            ref={webviewRef}
            originWhitelist={['*']}
            onLoad={() => {
              // Set initial location if available
              if (currentLocation && webviewRef.current) {
                webviewRef.current.injectJavaScript(`
                  window.updateLocation(${currentLocation.lat}, ${currentLocation.lon});
                `);
              }
              setMapReady(true);
              console.log('✅ Map ready');
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
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    // Initialize map with NYC default, will be updated via JavaScript injection
    let map = L.map('map').setView([40.7128, -74.0060], 19);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);

    let userMarker = L.circleMarker([40.7128, -74.0060], {
      radius: 8,
      fillColor: '#34C759',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);

    let routePolyline = L.polyline([], { color: '#34C759', weight: 4, opacity: 0.85 }).addTo(map);
    let pickupGroup = L.featureGroup([]).addTo(map);
    let neighborhoodGroup = L.featureGroup([]).addTo(map);

    window.updateLocation = function(lat, lon) {
      userMarker.setLatLng([lat, lon]);
      map.setView([lat, lon], 19);
      console.log('📍 Location updated: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
    };

    window.redrawRoute = function(coords) {
      if (!coords || coords.length === 0) {
        console.log('❌ No coords to draw');
        return;
      }
      // Remove old polyline and draw new one
      map.removeLayer(routePolyline);
      routePolyline = L.polyline(coords, {
        color: '#34C759',
        weight: 5,
        opacity: 0.9,
        dashArray: ''
      }).addTo(map);
      console.log('✅ Route redrawn: ' + coords.length + ' points');
    };

    window.addRoutePoint = function(lat, lon) {
      routePolyline.addLatLng([lat, lon]);
      console.log('📍 Route point added: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
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
      map.setView([lat, lon], 19);
      console.log('📍 Map init: ' + lat.toFixed(4) + ', ' + lon.toFixed(4));
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
                weight: 6,
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
    };

    // Street-segment coverage layer (shared across ALL users).
    // Grey dashes = never cleaned; green→red = freshness since last clean.
    let segmentGroup = L.featureGroup([]).addTo(map);
    window.renderSegments = function(segments) {
      segmentGroup.clearLayers();
      segments.forEach(function(seg) {
        let color, opacity, dash;
        if (seg.daysOld === null || seg.daysOld === undefined) {
          color = '#8E8E93'; opacity = 0.45; dash = '4 7'; // never cleaned
        } else if (seg.daysOld <= 5) {
          color = '#34C759'; opacity = 0.8; dash = '';
        } else if (seg.daysOld <= 9) {
          color = '#FFCC00'; opacity = 0.75; dash = '';
        } else if (seg.daysOld <= 13) {
          color = '#FF9500'; opacity = 0.7; dash = '';
        } else {
          color = '#FF3B30'; opacity = 0.65; dash = '';
        }
        L.polyline(seg.coords, {
          color: color,
          weight: 4,
          opacity: opacity,
          dashArray: dash,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(segmentGroup);
      });
      segmentGroup.bringToBack();
      console.log('🛣️ Rendered ' + segments.length + ' street segments');
    };

    window.clearSegments = function() {
      segmentGroup.clearLayers();
    };

    window.showNeighborhoodCoverage = function(cleanups) {
      if (!cleanups || cleanups.length === 0) return;
      console.log('🗺️ Showing neighborhood coverage: ' + cleanups.length + ' cleanups');
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
      console.log('✅ Drew ' + linesDrawn + ' route lines');
    };

    window.clearNeighborhoodCoverage = function() {
      neighborhoodGroup.clearLayers();
      console.log('✅ Neighborhood coverage cleared');
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
            <Text style={styles.mapIcon}>📍</Text>
            <Text style={styles.mapText}>Getting location...</Text>
          </View>
        )}
      </View>

      {/* Main Controls - Always at bottom */}
      <View style={[styles.controls, isListening && styles.controlsCompact]}>
        {!isListening ? (
          <TouchableOpacity
            style={[styles.button, styles.buttonStart]}
            onPress={startCleanup}
          >
            <Text style={styles.buttonTextLarge}>▶ START CLEANUP</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, styles.buttonStop]}
            onPress={stopCleanup}
          >
            <Text style={styles.buttonTextLarge}>⏹ STOP SESSION</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Cleanliness Scale Info Modal */}
      <Modal visible={showScaleInfo} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.scaleInfoModal}>
            <View style={styles.scaleInfoHeader}>
              <Text style={styles.scaleInfoTitle}>🗺️ Cleanliness Scale (NYC)</Text>
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
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📊 Session Summary</Text>

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
                Est. Weight: {(pickupCount * calFactor).toFixed(2)} lb · ≈{formatBags(weightToBags(pickupCount * calFactor))}
                {calSampleCount >= 2 ? ` (calibrated · ${calSampleCount} weigh-ins)` : ''}
              </Text>
            </View>

            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>How much trash did you collect?</Text>

              {/* Input Mode Toggle */}
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeButton, weightInputMode === 'weight' && styles.modeButtonActive]}
                  onPress={() => setWeightInputMode('weight')}
                >
                  <Text style={[styles.modeButtonText, weightInputMode === 'weight' && styles.modeButtonTextActive]}>
                    ⚖️ Weight
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeButton, weightInputMode === 'bag' && styles.modeButtonActive]}
                  onPress={() => setWeightInputMode('bag')}
                >
                  <Text style={[styles.modeButtonText, weightInputMode === 'bag' && styles.modeButtonTextActive]}>
                    🛍️ Bag Size
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Weight Mode */}
              {weightInputMode === 'weight' ? (
                <>
                  <TextInput
                    style={styles.weightInput}
                    placeholder="Trash weight only, in lbs (e.g., 0.8)"
                    keyboardType="decimal-pad"
                    value={selfReportedWeight}
                    onChangeText={setSelfReportedWeight}
                  />
                  <Text style={styles.comparisonText}>
                    {selfReportedWeight
                      ? `Estimated ${(pickupCount * calFactor).toFixed(2)} lb, scale says ${parseFloat(selfReportedWeight).toFixed(2)} lb — saving improves calibration ⚖️`
                      : `⚠️ Subtract your bucket/bag weight first! Each net weigh-in tunes the lb/pickup factor (currently ${calFactor.toFixed(3)})`}
                  </Text>
                </>
              ) : (
                /* Bag Size Mode */
                <>
                  <View style={styles.bagSizeOptions}>
                    {['small', 'medium', 'large', 'xl'].map((size) => (
                      <TouchableOpacity
                        key={size}
                        style={[styles.bagOption, bagSize === size && styles.bagOptionActive]}
                        onPress={() => setBagSize(size as any)}
                      >
                        <Text style={[styles.bagOptionText, bagSize === size && styles.bagOptionTextActive]}>
                          {size === 'small' ? '📦 Small\n(13-15 gal)' :
                           size === 'medium' ? '📦 Medium\n(30-35 gal)' :
                           size === 'large' ? '📦 Large\n(45-60 gal)' :
                           '📦 XL\n(60+ gal)'}
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
                      <TouchableOpacity onPress={() => setBagFullness(Math.max(0, bagFullness - 10))}>
                        <Text style={styles.sliderButton}>−</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setBagFullness(Math.min(100, bagFullness + 10))}>
                        <Text style={styles.sliderButton}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.weightEstimate}>
                    <Text style={styles.weightEstimateLabel}>Estimated weight:</Text>
                    <Text style={styles.weightEstimateValue}>
                      {calculateBagWeight(bagSize, bagFullness).toFixed(2)} lb
                    </Text>
                  </View>

                  <Text style={styles.comparisonText}>
                    Detected {(pickupCount * calFactor).toFixed(2)} lb, you estimate {calculateBagWeight(bagSize, bagFullness).toFixed(2)} lb
                  </Text>
                </>
              )}
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.summaryButton, styles.cancelButton]}
                onPress={() => {
                  setShowSummary(false);
                  setPickupCount(0);
                  setElapsedSeconds(0);
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.summaryButton, styles.saveButton]}
                onPress={saveSummary}
              >
                <Text style={styles.saveButtonText}>✅ Save & Log</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Session Results Modal */}
      <Modal visible={showResults} animationType="slide">
        <SafeAreaView style={styles.resultsContainer}>
          <ScrollView contentContainerStyle={styles.resultsContent}>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>🎉 Session Complete</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowResults(false);
                  setPickupCount(0);
                  setElapsedSeconds(0);
                  setSessionRoute([]);
                  setPickupLocations([]);
                }}
              >
                <Text style={styles.closeButton}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Coverage Stats */}
            <View style={styles.resultsSection}>
              <Text style={styles.resultsSubtitle}>📍 Coverage & Activity</Text>
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
              <Text style={styles.resultsSubtitle}>🔥 Pickup Map</Text>
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
                      console.log('🗺️ Heatmap WebView loaded');
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
                                console.log('✅ Heatmap data injected');
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
    console.log('✅ HTML + Leaflet script loaded');

    let mapInstance = null;
    let ready = false;

    // Wait for Leaflet to be available
    function waitForLeaflet(callback, attempts = 0) {
      if (typeof L !== 'undefined' && document.getElementById('map')) {
        console.log('✅ Leaflet ready');
        callback();
      } else if (attempts < 20) {
        setTimeout(() => waitForLeaflet(callback, attempts + 1), 100);
      } else {
        console.error('❌ Leaflet failed to load');
      }
    }

    waitForLeaflet(function() {
      try {
        mapInstance = L.map('map').setView([40.7128, -74.0060], 17);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19
        }).addTo(mapInstance);
        ready = true;
        console.log('✅ Map initialized');
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
      console.log('✅ Route drawn');
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
      console.log('✅ Pickups drawn');
    };

    console.log('✅ Functions defined');
  </script>
</body>
</html>`,
                    }}
                  />

                  <Text style={styles.heatmapData}>
                    🔴 Red markers = pickup locations{'\n'}
                    🟢 Green line = your route
                  </Text>
                </View>
              ) : (
                <Text style={styles.noData}>Need both route and pickups to show map</Text>
              )}
            </View>

            {/* Route Summary */}
            <View style={styles.resultsSection}>
              <Text style={styles.resultsSubtitle}>🗺️ Route Taken</Text>
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

            {/* Action Buttons */}
            <View style={styles.resultsActions}>
              <TouchableOpacity
                style={[styles.resultButton, styles.resultButtonExport]}
                onPress={exportSession}
              >
                <Text style={styles.resultButtonExportText}>📋 Export Session</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.resultsActions}>
              <TouchableOpacity
                style={[styles.resultButton, styles.resultButtonSecondary]}
                onPress={() => {
                  setShowResults(false);
                  router.push('/(tabs)/activity');
                }}
              >
                <Text style={styles.resultButtonSecondaryText}>📊 View All Sessions</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resultButton, styles.resultButtonPrimary]}
                onPress={() => {
                  setShowResults(false);
                  setPickupCount(0);
                  setElapsedSeconds(0);
                  setSessionRoute([]);
                  setPickupLocations([]);
                }}
              >
                <Text style={styles.resultButtonPrimaryText}>✅ Done</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
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
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  coverageText: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  teamOrSuperlative: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'right',
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
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingVertical: 16,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 20,
  },
  topBarStat: {
    alignItems: 'center',
  },
  topBarValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  topBarLabel: {
    fontSize: 12,
    color: COLORS.mutedSage,
    fontWeight: '500',
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
    flex: 1,
    marginHorizontal: 16,
    marginVertical: 12,
    marginBottom: 0,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  mapContainerExpanded: {
    marginHorizontal: 16,
    marginVertical: 12,
    marginBottom: 0,
    borderRadius: 12,
    backgroundColor: '#fff',
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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 12,
  },
  controlsCompact: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
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
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonStart: {
    backgroundColor: COLORS.sage,
  },
  buttonStop: {
    backgroundColor: COLORS.error,
  },
  buttonTextLarge: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
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
    top: 12,
    right: 12,
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
});
