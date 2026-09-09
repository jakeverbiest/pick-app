import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { getAuthService } from '../../src/services/authService';
import { C, Fonts, radius } from '../../src/pick/theme';
import { readPendingChallengeFromClipboard, consumePendingChallengeMarker } from '../../src/services/pendingChallenge';
import {
  DETECTOR_DISCLOSURE_TEXT,
  DETECTOR_DISCLOSURE_VERSION,
  DETECTOR_DISCLOSURE_DETAIL,
  PRIVACY_POLICY_TEXT,
  TERMS_OF_SERVICE_TEXT,
} from '../../src/constants/legal';

export default function SignupScreen() {
  const router = useRouter();
  // `pendingChallenge`: set when this screen was reached via
  // `app/challenge/[id].tsx`'s auth guard (the person already has the app
  // and followed pickapp://challenge/{id} or a landing-page redirect while
  // signed out). The clipboard marker below is the OTHER arrival path — a
  // first-ever install via the TestFlight detour — see pendingChallenge.ts.
  const { pendingChallenge } = useLocalSearchParams<{ pendingChallenge?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // See login.tsx's identical check — degrades to email/password only on a
  // build that predates the applesignin entitlement (or on non-iOS).
  const [appleAvailable, setAppleAvailable] = useState(false);
  // Email/password starts collapsed behind "Use email instead" whenever Apple
  // is available. Apple is two taps and no password; the form is name + email
  // + password + a 6-char rule. Having the slow path render first made the
  // fast path something you had to scroll past to find, which is backwards for
  // the case this screen actually has to serve — a group of people installing
  // at the same time because their employer asked them to.
  const [showEmailForm, setShowEmailForm] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        setAppleAvailable(ok);
        // No Apple (Android, or a build predating the entitlement): the form is
        // the only way in, so it must be visible rather than behind a toggle.
        if (!ok) setShowEmailForm(true);
      })
      .catch(() => {
        setAppleAvailable(false);
        setShowEmailForm(true);
      });
  }, []);

  // Non-iOS never runs the effect above, so open the form for it here.
  useEffect(() => {
    if (Platform.OS !== 'ios') setShowEmailForm(true);
  }, []);

  /** Shared post-auth routing for both email/password signup and Apple. */
  const routeAfterAuth = async () => {
    // Explicit route param (came from challenge/[id].tsx's auth guard) wins
    // over the clipboard fallback (came from a fresh TestFlight install)
    // since it's a direct signal, not a best-effort one.
    let targetChallengeId = pendingChallenge || null;
    if (!targetChallengeId) {
      targetChallengeId = await readPendingChallengeFromClipboard();
      if (targetChallengeId) await consumePendingChallengeMarker();
    }
    if (targetChallengeId) {
      // autoJoin: arriving via an invite link is treated as consent to
      // join, not just a browse — challenge/[id].tsx reads this to skip
      // the explicit "Join challenge" tap. See its comment for the leave
      // affordance that makes that safe to do silently.
      router.replace({ pathname: '/challenge/[id]', params: { id: targetChallengeId, autoJoin: '1' } });
    } else {
      router.replace('/(tabs)/map');
    }
  };

  // The disclosure is only "shown" if there is copy to show. Both auth paths
  // below pass this, and both pass '' when the copy hasn't landed — which
  // records no consent at all rather than consent to a blank disclosure.
  const shownDisclosureVersion = DETECTOR_DISCLOSURE_TEXT ? DETECTOR_DISCLOSURE_VERSION : '';

  // One modal, three documents. Deliberately a single <Modal> with a switched
  // body rather than three: two RN Modals mounted at once stack behind each
  // other on iOS, which has already produced two real bugs in this app
  // (ShareComposer, RecapHistory). `null` is closed.
  const [legalDoc, setLegalDoc] = useState<'detail' | 'privacy' | 'terms' | null>(null);

  const handleAppleSignup = async () => {
    try {
      setLoading(true);
      await getAuthService().loginWithApple(shownDisclosureVersion);
      console.log('✅ Sign in with Apple successful, navigating to home');
      await routeAfterAuth();
    } catch (error: any) {
      if (error?.message === '__CANCELED__') return; // user backed out — no alert
      Alert.alert('Sign in with Apple failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const validateForm = () => {
    if (!email.trim() || !password.trim() || !displayName.trim()) {
      Alert.alert('❌ Error', 'Please fill in all fields');
      return false;
    }

    if (password.length < 6) {
      Alert.alert('❌ Error', 'Password must be at least 6 characters');
      return false;
    }

    return true;
  };

  const handleSignup = async () => {
    if (!validateForm()) return;

    try {
      setLoading(true);
      const authService = getAuthService();
      // Neighborhood is deferred off signup — it's freeform text with no
      // validation/autocomplete here; set later from the map or Settings
      // once the user's real location is known.
      await authService.signup(email.trim(), password, displayName.trim(), '', shownDisclosureVersion);

      console.log('✅ Signup successful, navigating to home');
      await routeAfterAuth();
    } catch (error: any) {
      Alert.alert('❌ Signup Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Header */}
        <View style={styles.header}>
          <Image source={require('../../assets/images/logo-mark.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Start tracking cleanups</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Fastest path first. See the showEmailForm comment above. */}
          {appleAvailable && (
            <>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radius.button}
                style={styles.appleBtn}
                onPress={handleAppleSignup}
              />
              {!showEmailForm && (
                <TouchableOpacity
                  onPress={() => setShowEmailForm(true)}
                  disabled={loading}
                  style={styles.altToggle}
                  accessibilityRole="button"
                >
                  <Text style={styles.altToggleText}>Use email instead</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {showEmailForm && (
          <>
          {appleAvailable && (
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>
          )}
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Jake"
            placeholderTextColor={C.muted}
            value={displayName}
            onChangeText={setDisplayName}
            editable={!loading}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="your@email.com"
            placeholderTextColor={C.muted}
            value={email}
            onChangeText={setEmail}
            editable={!loading}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor={C.muted}
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
              disabled={loading}
            >
              <Text style={styles.eyeIcon}>{showPassword ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>
          {password.length > 0 && password.length < 6 && (
            <Text style={styles.hint}>At least 6 characters</Text>
          )}

          {/* Signup Button */}
          <TouchableOpacity
            style={[styles.signupButton, loading && styles.buttonDisabled]}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signupButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>
          </>
          )}
        </View>

        {/*
          Detector-telemetry disclosure. Placed OUTSIDE the showEmailForm block
          on purpose: Sign in with Apple sits above that block and creates an
          account in two taps, so a disclosure nested inside the collapsed email
          form would never be seen by the fastest — and most common — signup
          path. Copy and version come from src/constants/legal.ts and are the
          `safety` agent's to write; this renders nothing until they land.
        */}
        {!!DETECTOR_DISCLOSURE_TEXT && (
          <>
            <Text style={styles.disclosure}>{DETECTOR_DISCLOSURE_TEXT}</Text>
            <View style={styles.disclosureLinks}>
              <TouchableOpacity onPress={() => setLegalDoc('detail')} hitSlop={8}>
                <Text style={styles.disclosureLink}>What gets analyzed</Text>
              </TouchableOpacity>
              <Text style={styles.disclosureSep}>·</Text>
              <TouchableOpacity onPress={() => setLegalDoc('privacy')} hitSlop={8}>
                <Text style={styles.disclosureLink}>Privacy Policy</Text>
              </TouchableOpacity>
              <Text style={styles.disclosureSep}>·</Text>
              <TouchableOpacity onPress={() => setLegalDoc('terms')} hitSlop={8}>
                <Text style={styles.disclosureLink}>Terms</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Login Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() =>
              router.push(
                pendingChallenge
                  ? { pathname: '/auth/login', params: { pendingChallenge } }
                  : '/auth/login'
              )
            }
            disabled={loading}
          >
            <Text style={styles.loginLink}>Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/*
        Same shape as the Settings legal viewer, so the two surfaces read as one
        app. onRequestClose is set for the Android hardware back button.
      */}
      <Modal
        visible={legalDoc !== null}
        animationType="slide"
        onRequestClose={() => setLegalDoc(null)}
      >
        <SafeAreaView style={styles.container}>
          <View style={styles.legalHeader}>
            <Text style={styles.legalTitle}>
              {legalDoc === 'detail'
                ? 'What gets analyzed'
                : legalDoc === 'privacy'
                  ? 'Privacy Policy'
                  : 'Terms of Service'}
            </Text>
            <TouchableOpacity onPress={() => setLegalDoc(null)} hitSlop={8}>
              <Text style={styles.legalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.legalContent}>
            <Text style={styles.legalText}>
              {legalDoc === 'detail'
                ? DETECTOR_DISCLOSURE_DETAIL
                : legalDoc === 'privacy'
                  ? PRIVACY_POLICY_TEXT
                  : TERMS_OF_SERVICE_TEXT}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.white,
  },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    minHeight: '100%',
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    marginBottom: 16,
  },
  title: {
    fontFamily: Fonts.displayBold,
    fontSize: 28,
    color: C.dark,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: C.muted,
  },
  form: {
    gap: 14,
    marginBottom: 20,
  },
  label: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13,
    color: C.dark,
    marginBottom: 6,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: C.muted,
    marginTop: -8,
  },
  input: {
    backgroundColor: C.white,
    borderRadius: radius.field,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: C.dark,
    borderWidth: 1,
    borderColor: C.border,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: C.border,
    paddingRight: 8,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: C.dark,
  },
  eyeButton: {
    padding: 8,
  },
  eyeIcon: {
    fontSize: 16,
  },
  signupButton: {
    backgroundColor: C.primary,
    borderRadius: radius.button,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  signupButtonText: {
    fontFamily: Fonts.bodyBold,
    color: C.creamText,
    fontSize: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontFamily: Fonts.body, color: C.muted, fontSize: 12 },
  appleBtn: { height: 50, width: '100%' },
  altToggle: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  altToggleText: { fontFamily: Fonts.body, color: C.muted, fontSize: 14, textDecorationLine: 'underline' },
  disclosure: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: C.muted,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  disclosureLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  disclosureLink: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: C.rust,
    textDecorationLine: 'underline',
  },
  disclosureSep: { fontFamily: Fonts.body, fontSize: 12, color: C.muted, paddingHorizontal: 8 },
  legalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  legalTitle: { fontFamily: Fonts.headlineBold, fontSize: 18, color: C.dark },
  legalClose: { fontSize: 20, color: C.muted, paddingHorizontal: 8 },
  legalContent: { padding: 20, paddingBottom: 40 },
  legalText: { fontFamily: Fonts.body, fontSize: 14, lineHeight: 21, color: C.dark },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  footerText: {
    fontFamily: Fonts.body,
    color: C.muted,
    fontSize: 13,
  },
  loginLink: {
    fontFamily: Fonts.bodyBold,
    color: C.rust,
    fontSize: 13,
  },
});
