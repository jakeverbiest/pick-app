import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getFitnessService, FITNESS_APPS, RECOMMENDED_CONFIGS } from '../../src/services/fitnessService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CARRY_MODE_KEY, CarryMode } from '../../src/services/motionDetection';
import { HEALTH_SYNC_KEY, setHealthSyncEnabled } from '../../src/services/healthService';
import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from '../../src/constants/legal';
import { FitnessApp } from '../../src/types';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';
import {
  getCrashReports,
  clearCrashReports,
  formatCrashReports,
  CrashReport,
} from '../../src/services/crashRecorder';
import { stopBackgroundSession } from '../../src/services/backgroundSession';
import { TeamSection } from '../../src/pick/TeamSection';

// A real signal for "did my OTA land?" — the app VERSION (1.0.0) never changes
// on an OTA, only the update bundle does. updateId changes every publish; an
// embedded launch means no OTA has been applied over the installed build yet.
function otaBuildStamp(): string {
  try {
    if (Updates.updateId) {
      const d = Updates.createdAt ? new Date(Updates.createdAt as any) : null;
      return `${Updates.updateId.slice(0, 8)}${d ? ' · ' + d.toISOString().slice(0, 10) : ''}`;
    }
    return Updates.isEmbeddedLaunch ? 'embedded (no OTA yet)' : 'dev';
  } catch {
    return 'dev';
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [geoDebug, setGeoDebug] = useState('');
  const [distanceUnit, setDistanceUnit] = useState('mi');
  const [enabledFitnessApps, setEnabledFitnessApps] = useState<FitnessApp[]>([]);
  const [fitnessRecommendation, setFitnessRecommendation] = useState('');
  const [batterySaver, setBatterySaver] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);
  const [carryMode, setCarryMode] = useState<CarryMode>('auto');
  const [healthSync, setHealthSync] = useState(true);
  const [crashReports, setCrashReports] = useState<CrashReport[]>([]);
  const [uid, setUid] = useState('');
  const [email, setEmail] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [leaderboardHidden, setLeaderboardHidden] = useState(false);
  const [communitySharing, setCommunitySharing] = useState(true);
  const [communityAutoPost, setCommunityAutoPost] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CARRY_MODE_KEY).then((v) => {
      if (v === 'pocket' || v === 'hand' || v === 'auto') setCarryMode(v);
    });
    AsyncStorage.getItem(HEALTH_SYNC_KEY).then((v) => {
      if (v !== null) setHealthSync(v === 'true');
    });
    getCrashReports().then(setCrashReports);
    Promise.all([
      AsyncStorage.getItem('@pick_geodebug'),
      AsyncStorage.getItem('@pick_geo_boundary'),
    ]).then(([v, b]) => {
      if (!v) return;
      try {
        const d = JSON.parse(v);
        setGeoDebug(`apple:${d.district || '—'} · osm:${d.osm || '—'} · city:${d.city || '—'} · bound:${b || '—'}`);
      } catch {}
    });
  }, []);

  const copyCrashReports = () => {
    Clipboard.setStringAsync(formatCrashReports(crashReports));
    Alert.alert('Copied', 'Crash reports copied. Paste them to share with the developer.');
  };

  const sendFeedback = async () => {
    const msg = feedbackText.trim();
    if (!msg) {
      Alert.alert('Add a note', 'Tell us what’s working or what’s broken.');
      return;
    }
    setSendingFeedback(true);
    try {
      const db = await getDatabase();
      const ok = await db.submitFeedback({
        message: msg,
        email,
        displayName,
        appVersion: `${Constants.expoConfig?.version ?? '?'} (${Constants.executionEnvironment ?? '?'})`,
      });
      setSendingFeedback(false);
      if (ok) {
        Keyboard.dismiss();
        setFeedbackOpen(false);
        setFeedbackText('');
        Alert.alert('Thank you!', 'Your feedback was sent — we read every note.');
      } else {
        Alert.alert('Could not send', 'Please try again in a moment.');
      }
    } catch {
      setSendingFeedback(false);
      Alert.alert('Could not send', 'Please try again in a moment.');
    }
  };

  const clearReports = () => {
    Alert.alert('Clear crash reports?', 'This permanently deletes the saved reports on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await clearCrashReports();
          setCrashReports([]);
        },
      },
    ]);
  };

  const forceStopTracking = async () => {
    await stopBackgroundSession();
    Alert.alert(
      'Tracking stopped',
      'Any leftover background location tracking has been turned off. If the iOS location arrow was on with no active cleanup, it should clear now.'
    );
  };

  const toggleHealthSync = async () => {
    const next = !healthSync;
    setHealthSync(next);
    await setHealthSyncEnabled(next);
  };

  const selectCarryMode = async (mode: CarryMode) => {
    setCarryMode(mode);
    await AsyncStorage.setItem(CARRY_MODE_KEY, mode);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();

      if (currentUser) {
        setUid(currentUser.uid);
        setDisplayName(currentUser.displayName);
        setEmail(currentUser.email || '');
        setNeighborhood(currentUser.neighborhood);

        const db = await getDatabase();
        const userSettings = await db.getUserSettings(currentUser.uid);

        if (userSettings) {
          setDistanceUnit(userSettings.distance_unit || 'mi');
          setTeamName(userSettings.team_name || '');
          setLeaderboardHidden(!!userSettings.leaderboard_hidden);
          setCommunitySharing(userSettings.community_sharing_enabled !== false);
          setCommunityAutoPost(!!userSettings.community_auto_post);
          try {
            const apps = JSON.parse(userSettings.fitness_apps || '[]');
            setEnabledFitnessApps(apps);

            const fitnessService = getFitnessService();
            const recommendation = fitnessService.getRecommendation(apps);
            setFitnessRecommendation(recommendation);
          } catch (e) {
            console.error('Failed to parse fitness apps:', e);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();

      if (!currentUser) return;


      // Update database
      const db = await getDatabase();
      await db.updateUserSettings(currentUser.uid, {
        display_name: displayName,
        neighborhood,
        distance_unit: distanceUnit,
        fitness_apps: JSON.stringify(enabledFitnessApps),
        team_name: teamName,
        leaderboard_hidden: leaderboardHidden,
        community_sharing_enabled: communitySharing,
        community_auto_post: communityAutoPost,
      } as any);

      setIsEditing(false);
      Alert.alert('Settings Saved', 'Your preferences have been updated');
    } catch (error) {
      console.error('Failed to save settings:', error);
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  };

  // Leaderboard visibility applies immediately (privacy toggle) and propagates
  // to the public user_stats doc via updateUserSettings → updateUserStats.
  const toggleLeaderboardVisibility = async () => {
    const next = !leaderboardHidden;
    setLeaderboardHidden(next);
    try {
      const db = await getDatabase();
      const currentUser = getAuthService().getCurrentUser();
      if (currentUser) await db.updateUserSettings(currentUser.uid, { leaderboard_hidden: next } as any);
    } catch (error) {
      console.error('Failed to update leaderboard visibility:', error);
      setLeaderboardHidden(!next); // revert on failure
    }
  };

  // Community photo sharing applies immediately and just gates the in-app
  // "Share to community" option — it never auto-posts anything.
  const toggleCommunitySharing = async () => {
    const next = !communitySharing;
    setCommunitySharing(next);
    try {
      const db = await getDatabase();
      const currentUser = getAuthService().getCurrentUser();
      if (currentUser) await db.updateUserSettings(currentUser.uid, { community_sharing_enabled: next } as any);
    } catch (error) {
      console.error('Failed to update community sharing:', error);
      setCommunitySharing(!next); // revert on failure
    }
  };

  const toggleCommunityAutoPost = async () => {
    const next = !communityAutoPost;
    setCommunityAutoPost(next);
    try {
      const db = await getDatabase();
      const currentUser = getAuthService().getCurrentUser();
      if (currentUser) await db.updateUserSettings(currentUser.uid, { community_auto_post: next } as any);
    } catch (error) {
      console.error('Failed to update auto-post:', error);
      setCommunityAutoPost(!next);
    }
  };

  const toggleFitnessApp = (app: FitnessApp) => {
    let updated: FitnessApp[];

    if (enabledFitnessApps.includes(app)) {
      updated = enabledFitnessApps.filter((a) => a !== app);
    } else {
      updated = [...enabledFitnessApps, app];
    }

    setEnabledFitnessApps(updated);

    const fitnessService = getFitnessService();
    const recommendation = fitnessService.getRecommendation(updated);
    setFitnessRecommendation(recommendation);
  };

  const populateMockData = async () => {
    try {
      const db = await getDatabase();
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();

      if (!currentUser) return;

      const mockCleanups = [
        { daysAgo: 0, pickups: 12, label: 'Today' },
        { daysAgo: 2, pickups: 8, label: '2 days ago (Fresh)' },
        { daysAgo: 7, pickups: 15, label: '7 days ago (Dusty)' },
        { daysAgo: 11, pickups: 6, label: '11 days ago (Attention)' },
        { daysAgo: 16, pickups: 10, label: '16 days ago (Not counted)' },
      ];

      for (const mock of mockCleanups) {
        const timestamp = Date.now() - (mock.daysAgo * 24 * 60 * 60 * 1000);
        const startLat = 40.678 + Math.random() * 0.005;
        const startLon = -73.995 + Math.random() * 0.005;

        // Generate a realistic walking route (5-10 GPS points)
        const routePoints: [number, number][] = [];
        const numPoints = 5 + Math.floor(Math.random() * 6);
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2 + Math.random() * 0.3;
          const distance = (i / numPoints) * 0.003;
          const lat = startLat + distance * Math.cos(angle);
          const lon = startLon + distance * Math.sin(angle);
          routePoints.push([lat, lon]);
        }

        await db.addCleanup({
          id: `mock_${mock.daysAgo}_${Date.now()}`,
          user_id: currentUser.uid,
          location_lat: startLat,
          location_lon: startLon,
          timestamp,
          duration_seconds: 600 + Math.random() * 600,
          items_count: mock.pickups,
          bags_est: parseFloat((mock.pickups / 200).toFixed(3)),
          team: 'solo',
          bag_qty: 0,
          bag_size: '30',
          fitness_tracked: false,
          route_points: JSON.stringify(routePoints),
        } as any);
      }

      Alert.alert('Dev Mode', '5 mock cleanups added at different ages');
      console.log('Mock data populated');
    } catch (error) {
      console.error('Mock data error:', error);
      Alert.alert('Error', 'Failed to add mock data');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>You</Text>
          <Text style={styles.subtitle}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>You</Text>
          {!isEditing && (
            <TouchableOpacity onPress={() => setIsEditing(true)}>
              <Text style={styles.editButton}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Profile Section */}
        <View style={styles.section}>
          <View style={styles.settingRow}>
            <Text style={styles.label}>Display Name</Text>
            {isEditing ? (
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
              />
            ) : (
              <Text style={styles.value}>{displayName}</Text>
            )}
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.label}>Neighborhood / Zone</Text>
            {isEditing ? (
              <TextInput
                style={styles.input}
                value={neighborhood}
                onChangeText={setNeighborhood}
                placeholder="Your zone"
              />
            ) : (
              <Text style={styles.value}>{neighborhood}</Text>
            )}
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.valueDisabled}>jlverbie@gmail.com</Text>
          </View>
        </View>

        {/* Units Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Units</Text>

          <View style={styles.unitsGrid}>
            {/* Distance Units */}
            <TouchableOpacity
              style={[
                styles.unitGridButton,
                distanceUnit === 'mi' && styles.unitButtonActive,
              ]}
              onPress={() => setDistanceUnit('mi')}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  distanceUnit === 'mi' && styles.unitButtonTextActive,
                ]}
              >
                mi
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.unitGridButton,
                distanceUnit === 'km' && styles.unitButtonActive,
              ]}
              onPress={() => setDistanceUnit('km')}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  distanceUnit === 'km' && styles.unitButtonTextActive,
                ]}
              >
                km
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Advanced settings toggle */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setAdvancedOpen((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.advancedToggleText}>
            {advancedOpen ? 'Hide advanced settings' : 'Show advanced settings'}
          </Text>
          <Text style={styles.advancedChevron}>{advancedOpen ? '▾' : '▸'}</Text>
        </TouchableOpacity>

        {/* Carry Mode (advanced) */}
        {advancedOpen && (
        <>
        {/* Carry Mode Section (advanced) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Carry Mode</Text>
          <Text style={styles.sectionSubtext}>
            Where the phone rides during cleanup. Auto figures it out from how the phone moves.
          </Text>

          <View style={styles.unitsGrid}>
            {(['auto', 'pocket', 'hand'] as CarryMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[styles.unitGridButton, carryMode === mode && styles.unitButtonActive]}
                onPress={() => selectCarryMode(mode)}
              >
                <Text style={[styles.unitButtonText, carryMode === mode && styles.unitButtonTextActive]}>
                  {mode === 'auto' ? 'Auto' : mode === 'pocket' ? 'Pocket' : 'In hand'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        </>
        )}

        {/* Apple Health Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Apple Health</Text>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleLabel}>Log cleanups as workouts</Text>
              <Text style={styles.toggleSubtext}>
                Each cleanup becomes a walking workout — counts toward your rings and exercise minutes. (adidas Running closed its API in 2025, so Health is where the credit lives.)
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toggleButton, healthSync && styles.toggleButtonActive]}
              onPress={toggleHealthSync}
            >
              <View style={[styles.toggleThumb, healthSync && styles.toggleThumbActive]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Team Section — directory + create/join/leave */}
        {uid ? <TeamSection userId={uid} currentTeam={teamName} onChange={setTeamName} /> : null}

        {/* Leaderboard visibility */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Leaderboard</Text>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleLabel}>Show me on the leaderboard</Text>
              <Text style={styles.toggleSubtext}>
                When on, your display name and totals appear on the individual leaderboard so others can see your impact. Turn off to stay private — only you will see your numbers.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toggleButton, !leaderboardHidden && styles.toggleButtonActive]}
              onPress={toggleLeaderboardVisibility}
            >
              <View style={[styles.toggleThumb, !leaderboardHidden && styles.toggleThumbActive]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Community sharing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Community</Text>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleLabel}>Share cleanups to community</Text>
              <Text style={styles.toggleSubtext}>
                Shows the “Share to community” option after a cleanup so you can post a photo. Turn off to hide it entirely — nothing is ever posted automatically.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toggleButton, communitySharing && styles.toggleButtonActive]}
              onPress={toggleCommunitySharing}
            >
              <View style={[styles.toggleThumb, communitySharing && styles.toggleThumbActive]} />
            </TouchableOpacity>
          </View>

          {communitySharing && (
            <View style={[styles.toggleRow, { marginTop: 14 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.toggleLabel}>Auto-post photos</Text>
                <Text style={styles.toggleSubtext}>
                  When you add a photo to a cleanup, post it to the community automatically on save — no extra tap. Off by default; you can always delete a post.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.toggleButton, communityAutoPost && styles.toggleButtonActive]}
                onPress={toggleCommunityAutoPost}
              >
                <View style={[styles.toggleThumb, communityAutoPost && styles.toggleThumbActive]} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Fitness Apps Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fitness Apps</Text>
          <Text style={styles.sectionSubtext}>
            Track cleanups as exercise in your favorite fitness apps
          </Text>

          {/* App toggles — same pill style as Units, no emoji */}
          <View style={styles.fitnessGrid}>
            {Object.entries(FITNESS_APPS).map(([appKey, appConfig]) => {
              const app = appKey as FitnessApp;
              const isEnabled = enabledFitnessApps.includes(app);
              const platformLabel =
                appConfig.platform === 'ios'
                  ? 'iOS'
                  : appConfig.platform === 'android'
                  ? 'Android'
                  : 'iOS & Android';

              return (
                <TouchableOpacity
                  key={app}
                  style={[styles.fitnessButton, isEnabled && styles.unitButtonActive]}
                  onPress={() => isEditing && toggleFitnessApp(app)}
                  disabled={!isEditing}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[styles.fitnessName, isEnabled && styles.unitButtonTextActive]}
                    numberOfLines={1}
                  >
                    {appConfig.name}
                  </Text>
                  <Text style={[styles.fitnessPlatform, isEnabled && styles.fitnessPlatformActive]}>
                    {platformLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Recommendation Box */}
          <View style={styles.recommendationBox}>
            <Text style={styles.recommendationLabel}>Smart deduplication</Text>
            <Text style={styles.recommendationText}>{fitnessRecommendation}</Text>
          </View>

          {/* Recommended Configs */}
          <View style={styles.configBox}>
            <Text style={styles.configTitle}>Recommended Configurations</Text>
            {RECOMMENDED_CONFIGS.map((config, index) => (
              <View key={index} style={styles.configItem}>
                <Text style={styles.configName}>{config.name}</Text>
                <Text style={styles.configDesc}>{config.description}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Diagnostics (advanced) */}
        {advancedOpen && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Diagnostics</Text>
          <Text style={styles.sectionSubtext}>
            If a cleanup crashes with the screen off, PICK saves a black-box trace here showing how
            far the walk got. Share it with the developer to help fix long-walk crashes.
          </Text>

          {crashReports.length === 0 ? (
            <View style={styles.settingRow}>
              <Text style={styles.label}>Crash reports</Text>
              <Text style={styles.value}>None — clean so far</Text>
            </View>
          ) : (
            <>
              {crashReports.map((r, i) => {
                const mins = Math.floor(r.elapsedSec / 60);
                const secs = r.elapsedSec % 60;
                return (
                  <View
                    key={r.startedAt + '-' + i}
                    style={{
                      backgroundColor: COLORS.cream,
                      borderRadius: RADIUS.md,
                      padding: SPACING.md,
                      marginTop: SPACING.sm,
                      borderLeftWidth: 3,
                      borderLeftColor: '#FF3B30',
                    }}
                  >
                    <Text style={{ fontWeight: '700', color: COLORS.darkSage }}>
                      {new Date(r.startedAt).toLocaleString()}
                    </Text>
                    <Text style={{ color: COLORS.mutedSage, marginTop: 2 }}>
                      Survived {mins}m {secs}s · {r.routePoints} route pts · {r.pickups} pickups ·{' '}
                      {r.motionEvents} motion events
                    </Text>
                    <Text style={{ color: COLORS.mutedSage, marginTop: 2, fontSize: 12 }}>
                      Battery saver {r.batterySaver ? 'on' : 'off'} · detected {r.gapSec}s after last
                      heartbeat
                    </Text>
                  </View>
                );
              })}

              <TouchableOpacity style={[styles.button, styles.buttonDev]} onPress={copyCrashReports}>
                <Text style={styles.buttonText}>Copy reports to share</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.button, styles.buttonDev]} onPress={clearReports}>
                <Text style={styles.buttonText}>Clear crash reports</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={[styles.button, styles.buttonDev]} onPress={forceStopTracking}>
            <Text style={styles.buttonText}>Force-stop background tracking</Text>
          </TouchableOpacity>
          <Text style={[styles.sectionSubtext, { marginTop: SPACING.xs }]}>
            Use this if the iOS location arrow stays on when no cleanup is running.
          </Text>
        </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Feedback</Text>
          <Text style={styles.sectionSubtext}>Found a bug or have an idea? Tell Jake directly.</Text>
          <TouchableOpacity style={styles.feedbackButton} onPress={() => setFeedbackOpen(true)}>
            <Text style={styles.feedbackButtonText}>Send feedback</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <View style={styles.settingRow}>
            <Text style={styles.label}>App Version</Text>
            <Text style={styles.value}>{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.label}>Update</Text>
            <Text style={styles.value}>{otaBuildStamp()}</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.valueBeta}>Beta</Text>
          </View>

          {geoDebug ? (
            <View style={styles.settingRow}>
              <Text style={styles.label}>Geo debug</Text>
              <Text style={[styles.value, { flex: 1, textAlign: 'right', fontSize: 11 }]} numberOfLines={2}>{geoDebug}</Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.settingRow} onPress={() => setLegalDoc('privacy')}>
            <Text style={styles.label}>Privacy Policy</Text>
            <Text style={styles.legalLink}>View →</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow} onPress={() => setLegalDoc('terms')}>
            <Text style={styles.label}>Terms of Service</Text>
            <Text style={styles.legalLink}>View →</Text>
          </TouchableOpacity>

          <Text style={styles.aboutText}>
            Pick is a motion detection app for tracking trash pickups autonomously. Data is stored
            locally on your device and synced to fitness apps when enabled.
          </Text>
        </View>

        {/* Legal Document Viewer */}
        <Modal visible={legalDoc !== null} animationType="slide">
          <SafeAreaView style={styles.container}>
            <View style={styles.legalHeader}>
              <Text style={styles.legalTitle}>
                {legalDoc === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
              </Text>
              <TouchableOpacity onPress={() => setLegalDoc(null)}>
                <Text style={styles.legalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.legalContent}>
              <Text style={styles.legalText}>
                {legalDoc === 'privacy' ? PRIVACY_POLICY_TEXT : TERMS_OF_SERVICE_TEXT}
              </Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>

        {/* Action Buttons */}
        {isEditing && (
          <View style={styles.actionButtons}>
            <TouchableOpacity style={[styles.button, styles.buttonCancel]} onPress={() => setIsEditing(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonSave]} onPress={saveSettings}>
              <Text style={styles.buttonTextWhite}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Developer Mode (advanced) */}
        {advancedOpen && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Developer Mode</Text>
          <Text style={styles.sectionSubtext}>
            For testing neighborhood view without multiple cleanup sessions
          </Text>

          <TouchableOpacity
            style={[styles.button, styles.buttonDev]}
            onPress={() => {
              Alert.alert(
                'Populate Mock Data',
                'Add 5 mock cleanups at different ages to test the neighborhood view.\n\n• Today (Fresh)\n• 2 days (Fresh)\n• 7 days (Dusty)\n• 11 days (Attention)\n• 16 days (Not counted)',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Add Mock Data',
                    onPress: populateMockData,
                  },
                ]
              );
            }}
          >
            <Text style={styles.buttonText}>Add 5 mock cleanups</Text>
          </TouchableOpacity>
        </View>
        )}

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: '#FF3B30' }]}>
            Danger Zone
          </Text>

          <TouchableOpacity
            style={styles.dangerButton}
            onPress={() => {
              Alert.alert(
                'Clear All Data',
                'This will permanently delete all your cleanups, stats, and badges. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete All Data',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const db = await getDatabase();
                        await db.clearAllData();
                        Alert.alert('Data Cleared', 'All data has been deleted.');
                        loadSettings();
                      } catch (error) {
                        Alert.alert('Error', 'Failed to clear data.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.dangerButtonText}>Clear All Data</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dangerButton, { marginBottom: 12 }]}
            onPress={() => {
              Alert.alert(
                'Delete Account?',
                'This permanently deletes your account AND all your data — cleanups, stats, badges. There is no undo.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete Forever',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const authService = getAuthService();
                        await authService.deleteAccount();
                        router.replace('/auth/signup');
                      } catch (error: any) {
                        Alert.alert('Could not delete account', error.message);
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.dangerButtonText}>Delete Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => {
              Alert.alert(
                'Logout',
                'Are you sure you want to logout?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Logout',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const authService = getAuthService();
                        await authService.logout();
                        console.log('Logged out successfully');
                        router.replace('/auth/login');
                      } catch (error) {
                        Alert.alert('Error', 'Failed to logout.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.logoutButtonText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Feedback composer */}
      <Modal visible={feedbackOpen} transparent animationType="slide" onRequestClose={() => setFeedbackOpen(false)}>
        <KeyboardAvoidingView style={styles.fbOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={styles.fbBackdrop} activeOpacity={1} onPress={() => Keyboard.dismiss()} />
          <View style={styles.fbSheet}>
            <Text style={styles.fbTitle}>Send feedback</Text>
            <Text style={styles.fbSub}>Bugs, ideas, anything — it goes straight to Jake.</Text>
            <TextInput
              style={styles.fbInput}
              placeholder="What's working, what's broken, what you'd change…"
              placeholderTextColor="#8B9B7F"
              value={feedbackText}
              onChangeText={setFeedbackText}
              multiline
              maxLength={2000}
              editable={!sendingFeedback}
              autoFocus
            />
            <View style={styles.fbActions}>
              <TouchableOpacity style={[styles.fbBtn, styles.fbCancel]} onPress={() => { Keyboard.dismiss(); setFeedbackOpen(false); }} disabled={sendingFeedback}>
                <Text style={styles.fbCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fbBtn, styles.fbSend]} onPress={sendFeedback} disabled={sendingFeedback}>
                <Text style={styles.fbSendText}>{sendingFeedback ? 'Sending…' : 'Send'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    paddingBottom: 40,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  editButton: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#1B2E1A',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  sectionSubtext: {
    fontSize: 12,
    color: COLORS.mutedSage,
    marginBottom: 12,
    lineHeight: 17,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  advancedToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mutedSage,
    letterSpacing: 0.2,
  },
  advancedChevron: {
    fontSize: 14,
    color: COLORS.mutedSage,
  },
  settingRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0EA',
  },
  label: {
    fontSize: 13,
    color: COLORS.mutedSage,
    marginBottom: 4,
    fontWeight: '500',
  },
  value: {
    fontSize: 14,
    color: COLORS.darkSage,
    fontWeight: '600',
  },
  valueDisabled: {
    fontSize: 14,
    color: '#999',
  },
  valueBeta: {
    fontSize: 14,
    color: '#FF9500',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.darkSage,
    marginTop: 4,
  },
  buttonGroup: {
    gap: 8,
  },
  unitButton: {
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  unitButtonActive: {
    backgroundColor: COLORS.sage,
    borderColor: COLORS.sage,
  },
  unitButtonDisabled: {
    opacity: 0.6,
  },
  unitButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  unitButtonTextActive: {
    color: '#fff',
  },
  unitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  unitGridButton: {
    paddingVertical: 5,
    paddingHorizontal: 18,
    borderRadius: 6,
    backgroundColor: COLORS.light,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  appsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  appCard: {
    width: '48%',
    backgroundColor: '#F7F8F3',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  appCardActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#EEF3E6',
  },
  appIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  appName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.darkSage,
    textAlign: 'center',
    marginBottom: 4,
  },
  appPlatform: {
    fontSize: 10,
    color: '#999',
    textTransform: 'capitalize',
  },
  appCheckmark: {
    fontSize: 18,
    color: '#34C759',
    position: 'absolute',
    top: 8,
    right: 8,
  },
  fitnessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  fitnessButton: {
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fitnessName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  fitnessPlatform: {
    fontSize: 11,
    color: COLORS.mutedSage,
    marginTop: 3,
  },
  fitnessPlatformActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  recommendationBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  recommendationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.sage,
    marginBottom: 6,
  },
  recommendationText: {
    fontSize: 12,
    color: '#5C6B54',
    lineHeight: 18,
  },
  configBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
  },
  configTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.sage,
    marginBottom: 8,
  },
  configItem: {
    paddingVertical: 8,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#e3f2fd',
  },
  configName: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 2,
  },
  configDesc: {
    fontSize: 11,
    color: '#999',
  },
  aboutText: {
    fontSize: 12,
    color: '#666',
    lineHeight: 18,
    marginTop: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 2,
  },
  toggleSubtext: {
    fontSize: 11,
    color: '#999',
  },
  toggleButton: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.border,
    padding: 2,
    justifyContent: 'flex-start',
  },
  toggleButtonActive: {
    backgroundColor: COLORS.accent,
    justifyContent: 'flex-end',
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.white,
  },
  toggleThumbActive: {
    backgroundColor: COLORS.white,
  },
  legalLink: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '600',
  },
  legalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  legalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  legalClose: {
    fontSize: 20,
    color: '#666',
    paddingHorizontal: 8,
  },
  legalContent: {
    padding: 16,
    paddingBottom: 40,
  },
  legalText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#444',
  },
  calibrationBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  calibrationRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  calibrationStat: {
    alignItems: 'center',
  },
  calibrationValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkSage,
  },
  calibrationLabel: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  calibrationRangeText: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  manualWeighInBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  manualWeighInRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  manualWeighInInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 12,
    color: COLORS.darkSage,
  },
  manualWeighInButton: {
    backgroundColor: COLORS.sage,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  manualWeighInButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  calibrationSamplesBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
  },
  calibrationSamplesTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.sage,
    marginBottom: 8,
  },
  calibrationSampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e8dc',
  },
  calibrationSampleText: {
    fontSize: 11,
    color: '#558B2F',
    flex: 1,
  },
  calibrationSampleDelete: {
    fontSize: 14,
    color: '#FF3B30',
    paddingHorizontal: 8,
  },
  calibrationResetButton: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 8,
  },
  calibrationResetText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF3B30',
  },
  batteryInfoBox: {
    backgroundColor: COLORS.light,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  batteryInfoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 4,
  },
  batteryInfoText: {
    fontSize: 12,
    color: '#558B2F',
  },
  teamInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.darkSage,
    marginBottom: 8,
  },
  teamInputHint: {
    fontSize: 11,
    color: '#999',
    fontStyle: 'italic',
  },
  teamDisplayBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  teamBadge: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  teamSubtext: {
    fontSize: 12,
    color: '#666',
  },
  teamInfoBox: {
    backgroundColor: '#EEF3E6',
    borderRadius: 14,
    padding: 14,
  },
  teamInfoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.sage,
    marginBottom: 4,
  },
  teamInfoText: {
    fontSize: 11,
    color: '#5C6B54',
    lineHeight: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonCancel: {
    backgroundColor: COLORS.light,
  },
  buttonSave: {
    backgroundColor: COLORS.sage,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.darkSage,
  },
  buttonTextWhite: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  buttonDev: {
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.sage,
  },
  dangerButton: {
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: '#FF3B30',
    alignItems: 'center',
    marginBottom: 12,
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF3B30',
  },
  logoutButton: {
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: '#FF3B30',
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF3B30',
  },

  feedbackButton: {
    marginTop: 12,
    backgroundColor: COLORS.sage,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  feedbackButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  fbOverlay: { flex: 1, justifyContent: 'flex-end' },
  fbBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(27,46,26,0.45)' },
  fbSheet: { backgroundColor: COLORS.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 },
  fbTitle: { fontSize: 20, fontWeight: '700', color: COLORS.darkSage },
  fbSub: { fontSize: 13, color: COLORS.mutedSage, marginTop: 2, marginBottom: 14 },
  fbInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    fontSize: 15,
    color: COLORS.darkSage,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  fbActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  fbBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  fbCancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  fbCancelText: { color: COLORS.darkSage, fontSize: 15, fontWeight: '700' },
  fbSend: { backgroundColor: COLORS.sage },
  fbSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
