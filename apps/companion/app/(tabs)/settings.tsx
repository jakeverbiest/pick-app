import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { getDatabase } from '../../src/services/database';
import { getAuthService } from '../../src/services/authService';
import { getFitnessService, FITNESS_APPS, RECOMMENDED_CONFIGS } from '../../src/services/fitnessService';
import weightCalibration, { CalibrationState, DEFAULT_LB_PER_PICKUP } from '../../src/services/weightCalibration';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { POCKET_CARRY_KEY } from '../../src/services/motionDetection';
import { HEALTH_SYNC_KEY, setHealthSyncEnabled } from '../../src/services/healthService';
import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from '../../src/constants/legal';
import { FitnessApp } from '../../src/types';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';

export default function SettingsScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [weightUnit, setWeightUnit] = useState('lb');
  const [distanceUnit, setDistanceUnit] = useState('mi');
  const [enabledFitnessApps, setEnabledFitnessApps] = useState<FitnessApp[]>([]);
  const [fitnessRecommendation, setFitnessRecommendation] = useState('');
  const [batterySaver, setBatterySaver] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null);
  const [manualItems, setManualItems] = useState('');
  const [manualWeight, setManualWeight] = useState('');
  const [pocketCarry, setPocketCarry] = useState(true);
  const [healthSync, setHealthSync] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(POCKET_CARRY_KEY).then((v) => {
      if (v !== null) setPocketCarry(v === 'true');
    });
    AsyncStorage.getItem(HEALTH_SYNC_KEY).then((v) => {
      if (v !== null) setHealthSync(v === 'true');
    });
  }, []);

  const toggleHealthSync = async () => {
    const next = !healthSync;
    setHealthSync(next);
    await setHealthSyncEnabled(next);
  };

  const togglePocketCarry = async () => {
    const next = !pocketCarry;
    setPocketCarry(next);
    await AsyncStorage.setItem(POCKET_CARRY_KEY, String(next));
  };

  const addManualWeighIn = async () => {
    const items = parseInt(manualItems, 10);
    const weight = parseFloat(manualWeight);
    if (!items || items <= 0 || !weight || weight <= 0) {
      Alert.alert('⚠️ Check values', 'Enter the detected pickup count and the NET trash weight (bucket subtracted).');
      return;
    }
    const state = await weightCalibration.addSample(items, weight, 'manual');
    if (state) {
      setCalibration(state);
      setManualItems('');
      setManualWeight('');
      Alert.alert('✅ Weigh-in added', `Factor is now ${state.factor.toFixed(3)} lb/pickup (${state.sampleCount} sample${state.sampleCount === 1 ? '' : 's'})`);
    } else {
      Alert.alert('⚠️ Rejected', 'That combination is implausible (factor outside 0.001–2.0 lb/item). Double-check the numbers.');
    }
  };

  useEffect(() => {
    loadSettings();
    loadCalibration();
  }, []);

  const loadCalibration = async () => {
    try {
      await weightCalibration.init();
      setCalibration(weightCalibration.getState());
    } catch (error) {
      console.error('Failed to load calibration:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const userService = getAuthService();
      const currentUser = userService.getCurrentUser();

      if (currentUser) {
        setDisplayName(currentUser.displayName);
        setNeighborhood(currentUser.neighborhood);

        const db = await getDatabase();
        const userSettings = await db.getUserSettings(currentUser.uid);

        if (userSettings) {
          setWeightUnit(userSettings.weight_unit || 'lb');
          setDistanceUnit(userSettings.distance_unit || 'mi');
          setTeamName(userSettings.team_name || '');
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
        weight_unit: weightUnit,
        distance_unit: distanceUnit,
        fitness_apps: JSON.stringify(enabledFitnessApps),
        team_name: teamName,
      } as any);

      setIsEditing(false);
      Alert.alert('✅ Settings Saved', 'Your preferences have been updated');
    } catch (error) {
      console.error('Failed to save settings:', error);
      Alert.alert('❌ Error', 'Failed to save settings. Please try again.');
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
          weight_lb: parseFloat((mock.pickups * 0.05).toFixed(2)),
          team: 'solo',
          bag_qty: 0,
          bag_size: '30',
          fitness_tracked: false,
          route_points: JSON.stringify(routePoints),
        } as any);
      }

      Alert.alert('✅ Dev Mode', '5 mock cleanups added at different ages');
      console.log('✅ Mock data populated');
    } catch (error) {
      console.error('Mock data error:', error);
      Alert.alert('❌ Error', 'Failed to add mock data');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.title}>Settings</Text>
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
          <Text style={styles.title}>Settings</Text>
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
            {/* Row 1: Weight Units */}
            <TouchableOpacity
              style={[
                styles.unitGridButton,
                weightUnit === 'lb' && styles.unitButtonActive,
              ]}
              onPress={() => setWeightUnit('lb')}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  weightUnit === 'lb' && styles.unitButtonTextActive,
                ]}
              >
                lb
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.unitGridButton,
                weightUnit === 'kg' && styles.unitButtonActive,
              ]}
              onPress={() => setWeightUnit('kg')}
            >
              <Text
                style={[
                  styles.unitButtonText,
                  weightUnit === 'kg' && styles.unitButtonTextActive,
                ]}
              >
                kg
              </Text>
            </TouchableOpacity>

            {/* Row 2: Distance Units */}
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

        {/* Weight Calibration Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weight Calibration</Text>
          <Text style={styles.sectionSubtext}>
            Weigh your haul on a scale after a cleanup and enter it in the session summary — each weigh-in tunes the weight estimate
          </Text>

          <View style={styles.calibrationBox}>
            <View style={styles.calibrationRow}>
              <View style={styles.calibrationStat}>
                <Text style={styles.calibrationValue}>
                  {(calibration?.factor ?? DEFAULT_LB_PER_PICKUP).toFixed(3)}
                </Text>
                <Text style={styles.calibrationLabel}>lb per pickup</Text>
              </View>
              <View style={styles.calibrationStat}>
                <Text style={styles.calibrationValue}>{calibration?.sampleCount ?? 0}</Text>
                <Text style={styles.calibrationLabel}>weigh-ins</Text>
              </View>
              <View style={styles.calibrationStat}>
                <Text style={[styles.calibrationValue, { color: calibration?.isCalibrated ? '#34C759' : '#FF9500' }]}>
                  {calibration?.isCalibrated ? 'Active' : 'Default'}
                </Text>
                <Text style={styles.calibrationLabel}>status</Text>
              </View>
            </View>

            {calibration?.factorRange && (
              <Text style={styles.calibrationRangeText}>
                Sample range: {calibration.factorRange.min.toFixed(3)} – {calibration.factorRange.max.toFixed(3)} lb/pickup
              </Text>
            )}
            {!calibration?.isCalibrated && (
              <Text style={styles.calibrationRangeText}>
                Need {2 - (calibration?.sampleCount ?? 0)} more weigh-in{(2 - (calibration?.sampleCount ?? 0)) === 1 ? '' : 's'} to replace the 0.05 default
              </Text>
            )}
          </View>

          {/* Manual weigh-in (e.g., logging a walk after the fact) */}
          <View style={styles.manualWeighInBox}>
            <Text style={styles.calibrationSamplesTitle}>Add a weigh-in manually</Text>
            <View style={styles.manualWeighInRow}>
              <TextInput
                style={styles.manualWeighInInput}
                placeholder="Pickups detected"
                keyboardType="number-pad"
                value={manualItems}
                onChangeText={setManualItems}
              />
              <TextInput
                style={styles.manualWeighInInput}
                placeholder="Net trash lb"
                keyboardType="decimal-pad"
                value={manualWeight}
                onChangeText={setManualWeight}
              />
              <TouchableOpacity style={styles.manualWeighInButton} onPress={addManualWeighIn}>
                <Text style={styles.manualWeighInButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.teamInputHint}>
              Net weight = scale reading minus your bucket/bag
            </Text>
          </View>

          {(calibration?.samples?.length ?? 0) > 0 && (
            <View style={styles.calibrationSamplesBox}>
              <Text style={styles.calibrationSamplesTitle}>Recent weigh-ins</Text>
              {calibration!.samples.slice(-5).reverse().map((s) => (
                <View key={s.id} style={styles.calibrationSampleRow}>
                  <Text style={styles.calibrationSampleText}>
                    {new Date(s.timestamp).toLocaleDateString()} · {s.items_detected} items · {s.measured_weight_lb.toFixed(1)} lb ({s.factor.toFixed(3)}/item)
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert('Remove weigh-in?', 'This sample will no longer affect calibration.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: async () => {
                            const state = await weightCalibration.removeSample(s.id);
                            setCalibration(state);
                          },
                        },
                      ]);
                    }}
                  >
                    <Text style={styles.calibrationSampleDelete}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                style={styles.calibrationResetButton}
                onPress={() => {
                  Alert.alert('Reset calibration?', 'All weigh-ins will be deleted and the estimate returns to the 0.05 lb/pickup default.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: async () => {
                        await weightCalibration.reset();
                        setCalibration(weightCalibration.getState());
                      },
                    },
                  ]);
                }}
              >
                <Text style={styles.calibrationResetText}>Reset calibration</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Carry Mode Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👖 Carry Mode</Text>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.toggleLabel}>
                {pocketCarry ? 'Pocket (recommended)' : 'In hand'}
              </Text>
              <Text style={styles.toggleSubtext}>
                {pocketCarry
                  ? 'Phone rides in your pocket during cleanup — stronger detection, filters out phone-handling motions'
                  : 'Phone stays in your hand — rotation filter off (gentler signals expected)'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.toggleButton, pocketCarry && styles.toggleButtonActive]}
              onPress={togglePocketCarry}
            >
              <View style={[styles.toggleThumb, pocketCarry && styles.toggleThumbActive]} />
            </TouchableOpacity>
          </View>
        </View>

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

        {/* Team/Events Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👥 Team & Events</Text>
          <Text style={styles.sectionSubtext}>
            Join a cleanup challenge or team (school, work, volunteer group)
          </Text>

          {isEditing ? (
            <View>
              <TextInput
                style={styles.teamInput}
                placeholder="Enter team or event name (e.g., 'Lincoln High School', 'Google Volunteer Day')"
                value={teamName}
                onChangeText={setTeamName}
                placeholderTextColor="#ccc"
              />
              <Text style={styles.teamInputHint}>
                Leaving blank will show your achievement badge instead
              </Text>
            </View>
          ) : (
            <View style={styles.teamDisplayBox}>
              {teamName ? (
                <>
                  <Text style={styles.teamBadge}>🏢 {teamName}</Text>
                  <Text style={styles.teamSubtext}>All your cleanups contribute to this team's total!</Text>
                </>
              ) : (
                <>
                  <Text style={styles.teamBadge}>🎯 Solo Cleaner</Text>
                  <Text style={styles.teamSubtext}>Tap Edit to join a team or event</Text>
                </>
              )}
            </View>
          )}

          <View style={styles.teamInfoBox}>
            <Text style={styles.teamInfoTitle}>💡 Why Teams?</Text>
            <Text style={styles.teamInfoText}>
              • School competitions and volunteer days{'\n'}
              • Corporate cleanup challenges{'\n'}
              • Community group initiatives{'\n'}
              • Track team impact together
            </Text>
          </View>
        </View>

        {/* Fitness Apps Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📱 Fitness Apps</Text>
          <Text style={styles.sectionSubtext}>
            Track cleanups as exercise in your favorite fitness apps
          </Text>

          {/* App Toggles */}
          <View style={styles.appsGrid}>
            {Object.entries(FITNESS_APPS).map(([appKey, appConfig]) => {
              const app = appKey as FitnessApp;
              const isEnabled = enabledFitnessApps.includes(app);

              return (
                <TouchableOpacity
                  key={app}
                  style={[styles.appCard, isEnabled && styles.appCardActive]}
                  onPress={() => isEditing && toggleFitnessApp(app)}
                  disabled={!isEditing}
                >
                  <Text style={styles.appIcon}>{appConfig.icon}</Text>
                  <Text style={styles.appName}>{appConfig.name}</Text>
                  <Text style={styles.appPlatform}>{appConfig.platform}</Text>
                  {isEnabled && <Text style={styles.appCheckmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Recommendation Box */}
          <View style={styles.recommendationBox}>
            <Text style={styles.recommendationLabel}>💡 Smart Deduplication</Text>
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

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ℹ️ About</Text>

          <View style={styles.settingRow}>
            <Text style={styles.label}>App Version</Text>
            <Text style={styles.value}>1.0.0</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.label}>Build</Text>
            <Text style={styles.value}>2026.06.01</Text>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.valueBeta}>Beta</Text>
          </View>

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

        {/* Dev Mode */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔧 Developer Mode</Text>
          <Text style={styles.sectionSubtext}>
            For testing neighborhood view without multiple cleanup sessions
          </Text>

          <TouchableOpacity
            style={[styles.button, styles.buttonDev]}
            onPress={() => {
              Alert.alert(
                '📍 Populate Mock Data',
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
            <Text style={styles.buttonText}>📊 Add 5 Mock Cleanups</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: '#FF3B30' }]}>
            ⚠️ Danger Zone
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
                        Alert.alert('✅ Data Cleared', 'All data has been deleted.');
                        loadSettings();
                      } catch (error) {
                        Alert.alert('❌ Error', 'Failed to clear data.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.dangerButtonText}>🗑️ Clear All Data</Text>
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
                        console.log('✅ Logged out successfully');
                        router.replace('/auth/login');
                      } catch (error) {
                        Alert.alert('❌ Error', 'Failed to logout.');
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.logoutButtonText}>🚪 Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    color: '#007AFF',
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 12,
  },
  sectionSubtext: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  settingRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  label: {
    fontSize: 13,
    color: '#666',
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
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#eee',
  },
  appCardActive: {
    borderColor: '#34C759',
    backgroundColor: COLORS.light,
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
  recommendationBox: {
    backgroundColor: COLORS.light,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  recommendationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 6,
  },
  recommendationText: {
    fontSize: 12,
    color: '#558B2F',
    lineHeight: 18,
  },
  configBox: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  configTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1565C0',
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
    color: '#007AFF',
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
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
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
    backgroundColor: COLORS.white,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e8dc',
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
    backgroundColor: COLORS.accent,
    borderRadius: 6,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  manualWeighInButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  calibrationSamplesBox: {
    backgroundColor: COLORS.light,
    borderRadius: 8,
    padding: 12,
  },
  calibrationSamplesTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
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
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
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
    backgroundColor: COLORS.light,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  teamInfoTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 4,
  },
  teamInfoText: {
    fontSize: 11,
    color: '#558B2F',
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
    backgroundColor: COLORS.accent,
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
});
