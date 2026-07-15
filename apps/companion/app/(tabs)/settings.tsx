import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Alert, TextInput, Modal, KeyboardAvoidingView, Platform, Keyboard, Linking, Share } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
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
import { C, radius, shadow } from '../../src/pick/theme';
import { Icon, IconName } from '../../src/pick/Icon';
import {
  getCrashReports,
  clearCrashReports,
  formatCrashReports,
  CrashReport,
} from '../../src/services/crashRecorder';
import { stopBackgroundSession } from '../../src/services/backgroundSession';
import { TeamSection } from '../../src/pick/TeamSection';

// Beta invite (TestFlight public link) + the public community dashboard.
const TESTFLIGHT_URL = 'https://testflight.apple.com/join/6753UhuM';
const DASHBOARD_URL = 'https://pickdashboard.netlify.app';

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

// Grouped-card header: small line icon + uppercase label.
function GroupHead({ icon, label, danger }: { icon?: IconName; label: string; danger?: boolean }) {
  return (
    <View style={styles.groupHead}>
      {icon ? <Icon name={icon} size={15} color={danger ? C.danger : C.primary} sw={1.9} /> : null}
      <Text style={[styles.groupTitle, danger && { color: C.danger }]}>{label}</Text>
    </View>
  );
}

// One switch row — used across Privacy & sharing and Integrations.
function Toggle({ label, sub, value, onPress }: { label: string; sub?: string; value: boolean; onPress: () => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {sub ? <Text style={styles.toggleSubtext}>{sub}</Text> : null}
      </View>
      <TouchableOpacity
        style={[styles.toggleButton, value && styles.toggleButtonActive]}
        onPress={onPress}
        activeOpacity={0.9}
      >
        <View style={[styles.toggleThumb, value && styles.toggleThumbActive]} />
      </TouchableOpacity>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [geoDebug, setGeoDebug] = useState('');
  const [distanceUnit, setDistanceUnit] = useState('mi');
  const [enabledFitnessApps, setEnabledFitnessApps] = useState<FitnessApp[]>([]);
  const [fitnessRecommendation, setFitnessRecommendation] = useState('');
  const [teamName, setTeamName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);
  const [carryMode, setCarryMode] = useState<CarryMode>('auto');
  const [healthSync, setHealthSync] = useState(true);
  const [crashReports, setCrashReports] = useState<CrashReport[]>([]);
  const [uid, setUid] = useState('');
  const [email, setEmail] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [fitnessOpen, setFitnessOpen] = useState(false);
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

  const confirmLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await getAuthService().logout();
            router.replace('/auth/login');
          } catch (error) {
            Alert.alert('Error', 'Failed to logout.');
          }
        },
      },
    ]);
  };

  const confirmClearData = () => {
    Alert.alert(
      'Clear all data',
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
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account AND all your data — cleanups, stats, badges. There is no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            try {
              await getAuthService().deleteAccount();
              router.replace('/auth/signup');
            } catch (error: any) {
              Alert.alert('Could not delete account', error.message);
            }
          },
        },
      ]
    );
  };

  const shareInvite = async () => {
    try {
      await Share.share({
        message: `Try PICK — pop your phone in your pocket and it counts the litter you pick up automatically, then maps how clean your neighborhood is getting. Install on iPhone: ${TESTFLIGHT_URL}`,
      });
    } catch {}
  };

  const copyInvite = async () => {
    await Clipboard.setStringAsync(TESTFLIGHT_URL);
    Alert.alert('Copied', 'Invite link copied — paste it to a friend.');
  };

  const openDashboard = () => {
    Linking.openURL(DASHBOARD_URL).catch(() => Alert.alert('Could not open', DASHBOARD_URL));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>You</Text>
          <Text style={styles.subtitle}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initial = (displayName || 'You').trim().charAt(0).toUpperCase() || 'Y';
  const connectedFitness = enabledFitnessApps.length;
  const teamLabel = teamName && teamName.toLowerCase() !== 'solo' ? teamName : 'Solo picker';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ---------- Identity header ---------- */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {isEditing ? (
              <TextInput
                style={styles.profileNameInput}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={C.muted}
              />
            ) : (
              <Text style={styles.profileName} numberOfLines={1}>{displayName || 'Your name'}</Text>
            )}
            <Text style={styles.profileMeta} numberOfLines={1}>
              {teamLabel}{neighborhood ? '  ·  ' + neighborhood : ''}
            </Text>
          </View>
          {!isEditing && (
            <Pressable hitSlop={10} onPress={() => setIsEditing(true)}>
              <Text style={styles.editButton}>Edit</Text>
            </Pressable>
          )}
        </View>

        {/* Editable extras + save/cancel — only in edit mode */}
        {isEditing && (
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Home area (optional)</Text>
            <TextInput
              style={styles.input}
              value={neighborhood}
              onChangeText={setNeighborhood}
              placeholder="Your neighborhood"
              placeholderTextColor={C.muted}
            />
            <View style={styles.actionButtons}>
              <TouchableOpacity style={[styles.button, styles.buttonCancel]} onPress={() => setIsEditing(false)}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.buttonSave]} onPress={saveSettings}>
                <Text style={styles.buttonTextWhite}>Save changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ---------- Community ---------- */}
        <View style={styles.section}>
          <GroupHead icon="share" label="Community" />
          <Pressable style={styles.rowLink} onPress={() => setInviteOpen(true)}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLinkLabel}>Invite a friend</Text>
              <Text style={styles.rowLinkSub}>Share a QR code or link to join the beta</Text>
            </View>
            <Text style={styles.chev}>▸</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.rowLink} onPress={openDashboard}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLinkLabel}>See your city's impact</Text>
              <Text style={styles.rowLinkSub}>Live community stats for every city</Text>
            </View>
            <Text style={styles.rowLinkValue}>Open →</Text>
          </Pressable>
        </View>

        {/* ---------- Preferences & privacy ---------- */}
        <View style={styles.section}>
          <GroupHead icon="user" label="Preferences & privacy" />
          <View style={[styles.prefRow, { paddingVertical: 6 }]}>
            <Text style={styles.prefLabel}>Distance units</Text>
            <View style={styles.pillRow}>
              {(['mi', 'km'] as const).map((u) => (
                <Pressable key={u} style={[styles.pill, distanceUnit === u && styles.pillActive]} onPress={() => setDistanceUnit(u)}>
                  <Text style={[styles.pillText, distanceUnit === u && styles.pillTextActive]}>{u}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.divider} />
          <Toggle
            label="Show me on the leaderboard"
            sub="Your name and totals appear on the individual leaderboard. Off keeps you private."
            value={!leaderboardHidden}
            onPress={toggleLeaderboardVisibility}
          />
          <View style={styles.divider} />
          <Toggle
            label="Share cleanups to community"
            sub="Shows the “Share to community” option after a cleanup. Nothing is ever posted automatically."
            value={communitySharing}
            onPress={toggleCommunitySharing}
          />
          {communitySharing && (
            <>
              <View style={styles.divider} />
              <Toggle
                label="Auto-post photos"
                sub="When you add a photo to a cleanup, post it to the community on save — no extra tap."
                value={communityAutoPost}
                onPress={toggleCommunityAutoPost}
              />
            </>
          )}
        </View>

        {/* ---------- Team ---------- */}
        {uid ? <TeamSection userId={uid} currentTeam={teamName} onChange={setTeamName} /> : null}

        {/* ---------- Integrations ---------- */}
        <View style={styles.section}>
          <GroupHead icon="link" label="Integrations" />
          <Toggle
            label="Log cleanups to Apple Health"
            sub="Each cleanup becomes a walking workout — counts toward your rings and exercise minutes."
            value={healthSync}
            onPress={toggleHealthSync}
          />
          <View style={styles.divider} />
          <Pressable style={styles.rowLink} onPress={() => setFitnessOpen((v) => !v)}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLinkLabel}>Fitness apps</Text>
              <Text style={styles.rowLinkSub}>
                {connectedFitness > 0 ? `${connectedFitness} connected` : 'None connected'}
                {!isEditing ? ' · tap Edit to change' : ''}
              </Text>
            </View>
            <Text style={styles.chev}>{fitnessOpen ? '▾' : '▸'}</Text>
          </Pressable>

          {fitnessOpen && (
            <>
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

              <View style={styles.recommendationBox}>
                <Text style={styles.recommendationLabel}>Smart deduplication</Text>
                <Text style={styles.recommendationText}>{fitnessRecommendation}</Text>
              </View>

              <View style={styles.configBox}>
                <Text style={styles.configTitle}>Recommended configurations</Text>
                {RECOMMENDED_CONFIGS.map((config, index) => (
                  <View key={index} style={styles.configItem}>
                    <Text style={styles.configName}>{config.name}</Text>
                    <Text style={styles.configDesc}>{config.description}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        {/* ---------- Support ---------- */}
        <View style={styles.section}>
          <GroupHead icon="flag" label="Support" />
          <Pressable style={styles.rowLink} onPress={() => setFeedbackOpen(true)}>
            <Text style={styles.rowLinkLabel}>Send feedback</Text>
            <Text style={styles.rowLinkValue}>Bugs & ideas →</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.rowLink} onPress={() => setLegalDoc('privacy')}>
            <Text style={styles.rowLinkLabel}>Privacy policy</Text>
            <Text style={styles.rowLinkValue}>View →</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.rowLink} onPress={() => setLegalDoc('terms')}>
            <Text style={styles.rowLinkLabel}>Terms of service</Text>
            <Text style={styles.rowLinkValue}>View →</Text>
          </Pressable>
        </View>

        {/* ---------- Advanced (collapsed) ---------- */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setAdvancedOpen((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.advancedToggleText}>{advancedOpen ? 'Hide advanced' : 'Advanced settings'}</Text>
          <Text style={styles.advancedChevron}>{advancedOpen ? '▾' : '▸'}</Text>
        </TouchableOpacity>

        {advancedOpen && (
          <>
            {/* Carry mode */}
            <View style={styles.section}>
              <GroupHead icon="pin" label="Carry mode" />
              <Text style={styles.sectionSubtext}>
                Where the phone rides during cleanup. Auto figures it out from how the phone moves.
              </Text>
              <View style={styles.pillRow}>
                {(['auto', 'pocket', 'hand'] as CarryMode[]).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.pill, carryMode === mode && styles.pillActive]}
                    onPress={() => selectCarryMode(mode)}
                  >
                    <Text style={[styles.pillText, carryMode === mode && styles.pillTextActive]}>
                      {mode === 'auto' ? 'Auto' : mode === 'pocket' ? 'Pocket' : 'In hand'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Diagnostics */}
            <View style={styles.section}>
              <GroupHead icon="bolt" label="Diagnostics" />
              <Text style={styles.sectionSubtext}>
                If a cleanup crashes with the screen off, PICK saves a black-box trace here showing how
                far the walk got. Share it with the developer to help fix long-walk crashes.
              </Text>

              {crashReports.length === 0 ? (
                <Text style={styles.value}>No crash reports — clean so far</Text>
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

              <TouchableOpacity style={[styles.button, styles.buttonDev, { marginTop: SPACING.sm }]} onPress={forceStopTracking}>
                <Text style={styles.buttonText}>Force-stop background tracking</Text>
              </TouchableOpacity>
              <Text style={[styles.sectionSubtext, { marginTop: SPACING.xs, marginBottom: 0 }]}>
                Use this if the iOS location arrow stays on when no cleanup is running.
              </Text>
            </View>

            {/* Developer mode */}
            <View style={styles.section}>
              <GroupHead icon="bag" label="Developer mode" />
              <Text style={styles.sectionSubtext}>
                For testing neighborhood view without multiple cleanup sessions.
              </Text>
              <TouchableOpacity
                style={[styles.button, styles.buttonDev]}
                onPress={() => {
                  Alert.alert(
                    'Populate Mock Data',
                    'Add 5 mock cleanups at different ages to test the neighborhood view.\n\n• Today (Fresh)\n• 2 days (Fresh)\n• 7 days (Dusty)\n• 11 days (Attention)\n• 16 days (Not counted)',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Add Mock Data', onPress: populateMockData },
                    ]
                  );
                }}
              >
                <Text style={styles.buttonText}>Add 5 mock cleanups</Text>
              </TouchableOpacity>
            </View>

            {geoDebug ? (
              <View style={styles.section}>
                <GroupHead label="Geo debug" />
                <Text style={{ fontSize: 11, color: C.muted }} numberOfLines={3}>{geoDebug}</Text>
              </View>
            ) : null}
          </>
        )}

        {/* ---------- Account ---------- */}
        <View style={styles.section}>
          <GroupHead icon="user" label="Account" />
          <View style={styles.rowLink}>
            <Text style={styles.rowLinkLabel}>Email</Text>
            <Text style={styles.rowLinkValue} numberOfLines={1}>{email || '—'}</Text>
          </View>
          <TouchableOpacity style={styles.neutralBtn} onPress={confirmLogout} activeOpacity={0.85}>
            <Text style={styles.neutralBtnText}>Log out</Text>
          </TouchableOpacity>
        </View>

        {/* ---------- Danger zone ---------- */}
        <View style={styles.section}>
          <GroupHead icon="trash" label="Danger zone" danger />
          <TouchableOpacity style={styles.dangerButton} onPress={confirmClearData}>
            <Text style={styles.dangerButtonText}>Clear all data</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dangerButton, { marginBottom: 0 }]} onPress={confirmDeleteAccount}>
            <Text style={styles.dangerButtonText}>Delete account</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.aboutText}>
          PICK · v{Constants.expoConfig?.version ?? '1.0.0'} · {otaBuildStamp()} · Beta{'\n'}
          Made for cleaner neighborhoods.
        </Text>
      </ScrollView>

      {/* Legal document viewer */}
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

      {/* Invite a friend — QR + share */}
      <Modal visible={inviteOpen} transparent animationType="slide" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.fbOverlay}>
          <Pressable style={styles.fbBackdrop} onPress={() => setInviteOpen(false)} />
          <View style={styles.inviteSheet}>
            <Text style={styles.fbTitle}>Invite a friend</Text>
            <Text style={styles.inviteSub}>Have them point their iPhone camera at this code to join the PICK beta.</Text>
            <View style={styles.qrWrap}>
              <QRCode value={TESTFLIGHT_URL} size={196} color={COLORS.darkSage} backgroundColor="#ffffff" />
            </View>
            <Text style={styles.inviteUrl} numberOfLines={1}>{TESTFLIGHT_URL}</Text>
            <View style={[styles.fbActions, { width: '100%' }]}>
              <TouchableOpacity style={[styles.fbBtn, styles.fbCancel]} onPress={copyInvite}>
                <Text style={styles.fbCancelText}>Copy link</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fbBtn, styles.fbSend]} onPress={shareInvite}>
                <Text style={styles.fbSendText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.cream,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 44,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: C.dark,
  },
  subtitle: {
    fontSize: 16,
    color: C.muted,
  },

  // ---------- identity header ----------
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.white,
    borderRadius: radius.cardLg,
    padding: 18,
    marginTop: 8,
    marginBottom: 14,
    ...shadow.card,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 24, fontWeight: '800', color: C.primary },
  profileName: { fontSize: 20, fontWeight: '700', color: C.dark, letterSpacing: -0.3 },
  profileNameInput: {
    fontSize: 18,
    fontWeight: '700',
    color: C.dark,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileMeta: { fontSize: 13, color: C.muted, marginTop: 3 },
  editButton: { fontSize: 14, color: C.accent, fontWeight: '700' },

  // ---------- cards & groups ----------
  section: {
    backgroundColor: C.white,
    borderRadius: radius.cardLg,
    padding: 16,
    marginBottom: 14,
    ...shadow.card,
  },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: C.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionSubtext: {
    fontSize: 12,
    color: C.muted,
    marginBottom: 12,
    lineHeight: 17,
  },
  divider: { height: 1, backgroundColor: C.border2 },

  fieldLabel: { fontSize: 13, color: C.muted, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: C.dark,
  },
  value: { fontSize: 14, color: C.dark, fontWeight: '600' },
  valueBeta: { fontSize: 14, color: C.warning, fontWeight: '700' },

  // ---------- link rows ----------
  rowLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLinkLabel: { fontSize: 14, color: C.dark, fontWeight: '600' },
  rowLinkSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  rowLinkValue: { fontSize: 13, color: C.muted, fontWeight: '600', flexShrink: 1, textAlign: 'right', paddingLeft: 12 },
  chev: { fontSize: 15, color: C.chevron, fontWeight: '700' },

  // ---------- preference pills ----------
  prefRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  prefLabel: { fontSize: 14, fontWeight: '600', color: C.dark },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 20,
    borderRadius: radius.chip,
    backgroundColor: C.tint,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillActive: { backgroundColor: C.primary, borderColor: C.primary },
  pillText: { fontSize: 13, fontWeight: '700', color: C.text2 },
  pillTextActive: { color: '#fff' },

  // ---------- advanced disclosure ----------
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 6,
    marginBottom: 6,
  },
  advancedToggleText: { fontSize: 13, fontWeight: '700', color: C.muted, letterSpacing: 0.2 },
  advancedChevron: { fontSize: 14, color: C.muted, fontWeight: '700' },

  // ---------- toggles ----------
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: C.dark, marginBottom: 2 },
  toggleSubtext: { fontSize: 11, color: C.muted, lineHeight: 15 },
  toggleButton: {
    width: 50,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.toggleOff,
    padding: 2,
    justifyContent: 'flex-start',
  },
  toggleButtonActive: { backgroundColor: C.accent, justifyContent: 'flex-end' },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.white },
  toggleThumbActive: { backgroundColor: C.white },

  // ---------- fitness (collapsed) ----------
  fitnessGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 14 },
  fitnessButton: {
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: C.tint,
    borderWidth: 1,
    borderColor: C.border,
  },
  fitnessName: { fontSize: 13, fontWeight: '700', color: C.dark },
  fitnessPlatform: { fontSize: 11, color: C.muted, marginTop: 3 },
  fitnessPlatformActive: { color: 'rgba(255,255,255,0.85)' },
  unitButtonActive: { backgroundColor: C.primary, borderColor: C.primary },
  unitButtonTextActive: { color: '#fff' },
  recommendationBox: { backgroundColor: C.tint, borderRadius: 14, padding: 14, marginBottom: 12 },
  recommendationLabel: { fontSize: 12, fontWeight: '700', color: C.primary, marginBottom: 6 },
  recommendationText: { fontSize: 12, color: C.text2, lineHeight: 18 },
  configBox: { backgroundColor: C.tint, borderRadius: 14, padding: 14 },
  configTitle: { fontSize: 12, fontWeight: '700', color: C.primary, marginBottom: 8 },
  configItem: { paddingVertical: 8, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: C.border },
  configName: { fontSize: 12, fontWeight: '600', color: C.dark, marginBottom: 2 },
  configDesc: { fontSize: 11, color: C.muted },

  aboutText: { fontSize: 12, color: C.muted, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12, marginTop: 4 },

  // ---------- buttons ----------
  actionButtons: { flexDirection: 'row', gap: 12, marginTop: 16 },
  button: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  buttonCancel: { backgroundColor: C.tint, marginTop: 0 },
  buttonSave: { backgroundColor: C.primary, marginTop: 0 },
  buttonText: { fontSize: 14, fontWeight: '700', color: C.dark },
  buttonTextWhite: { fontSize: 14, fontWeight: '700', color: '#fff' },
  buttonDev: { backgroundColor: C.tint, borderWidth: 1, borderColor: C.primary },

  neutralBtn: {
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: C.tint,
    alignItems: 'center',
  },
  neutralBtnText: { fontSize: 14, fontWeight: '700', color: C.primary },

  dangerButton: {
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.danger,
    alignItems: 'center',
    marginBottom: 10,
  },
  dangerButtonText: { fontSize: 14, fontWeight: '700', color: C.danger },

  // ---------- legal modal ----------
  legalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border2,
  },
  legalTitle: { fontSize: 18, fontWeight: '700', color: C.dark },
  legalClose: { fontSize: 20, color: C.muted, paddingHorizontal: 8 },
  legalContent: { padding: 16, paddingBottom: 40 },
  legalText: { fontSize: 13, lineHeight: 20, color: C.text2 },

  // ---------- feedback sheet ----------
  fbOverlay: { flex: 1, justifyContent: 'flex-end' },
  fbBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(27,46,26,0.45)' },
  fbSheet: { backgroundColor: C.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 },
  fbTitle: { fontSize: 20, fontWeight: '700', color: C.dark },
  fbSub: { fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 14 },
  fbInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    fontSize: 15,
    color: C.dark,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  fbActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  fbBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  fbCancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  fbCancelText: { color: C.dark, fontSize: 15, fontWeight: '700' },
  fbSend: { backgroundColor: C.primary },
  fbSendText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  inviteSheet: {
    backgroundColor: C.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 22, paddingBottom: 34, alignItems: 'center',
  },
  inviteSub: { fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 4, textAlign: 'center' },
  qrWrap: { backgroundColor: '#fff', padding: 16, borderRadius: 18, marginTop: 16, marginBottom: 12, ...shadow.card },
  inviteUrl: { fontSize: 12, color: C.muted, marginBottom: 16, maxWidth: '100%' },
});
