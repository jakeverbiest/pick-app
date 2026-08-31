import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { getAuthService } from '../../src/services/authService';
import { C, Fonts } from '../../src/pick/theme';

export default function LoginScreen() {
  const router = useRouter();
  // Carried over from signup.tsx (see its comment) so someone who already
  // has an account and hits "Login" from a challenge invite still lands on
  // the challenge rather than the generic map tab.
  const { pendingChallenge } = useLocalSearchParams<{ pendingChallenge?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);
  // Apple's own guidance: only show the button where it's actually usable —
  // iOS 13+ on a build that carries the applesignin entitlement. On a build
  // cut before that entitlement lands (see authService.loginWithApple's
  // doc comment), isAvailableAsync() reports false rather than throwing, so
  // this degrades to email/password only rather than a broken button.
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const goToPendingChallengeOrMap = () => {
    if (pendingChallenge) {
      router.replace({ pathname: '/challenge/[id]', params: { id: pendingChallenge, autoJoin: '1' } });
    } else {
      router.replace('/(tabs)/map');
    }
  };

  const handleAppleLogin = async () => {
    try {
      setLoading(true);
      await getAuthService().loginWithApple();
      goToPendingChallengeOrMap();
    } catch (error: any) {
      if (error?.message === '__CANCELED__') return; // user backed out — no alert
      Alert.alert('Sign in with Apple failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing details', 'Please enter your email and password.');
      return;
    }
    try {
      setLoading(true);
      await getAuthService().login(email.trim(), password);
      goToPendingChallengeOrMap();
    } catch (error: any) {
      Alert.alert('Login failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Email required', 'Enter your email to reset your password.');
      return;
    }
    try {
      setLoading(true);
      await getAuthService().sendPasswordReset(email.trim());
      Alert.alert('Check your email', 'A password reset link has been sent.');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        {/* Brand */}
        <View style={styles.header}>
          <Image source={require('../../assets/images/logo-mark.png')} style={styles.logo} resizeMode="contain" />

          <Text style={styles.tagline}>Track your impact.{'\n'}Help keep your streets clean.</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={[styles.field, focus === 'email' && styles.fieldFocused]}>
            <Text style={[styles.fieldLabel, focus === 'email' && { color: C.primary }]}>EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="your@email.com"
              placeholderTextColor={C.muted}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocus('email')}
              onBlur={() => setFocus(null)}
              editable={!loading}
              keyboardType="email-address"
              autoCapitalize="none"
              selectionColor={C.primary}
            />
          </View>

          <View style={[styles.field, focus === 'password' && styles.fieldFocused]}>
            <Text style={[styles.fieldLabel, focus === 'password' && { color: C.primary }]}>PASSWORD</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="••••••••"
                placeholderTextColor={C.muted}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocus('password')}
                onBlur={() => setFocus(null)}
                editable={!loading}
                secureTextEntry={!showPassword}
                selectionColor={C.primary}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} disabled={loading} hitSlop={8}>
                <Text style={styles.showText}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.signIn, loading && styles.disabled, pressed && !loading && { opacity: 0.92 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.signInText}>Sign in</Text>}
          </Pressable>

          <Pressable onPress={handleForgotPassword} disabled={loading} style={styles.forgot}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          {appleAvailable && (
            <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={8}
                style={styles.appleBtn}
                onPress={handleAppleLogin}
              />
            </>
          )}
        </View>

        <Text style={styles.footer}>
          New here?{' '}
          <Text
            style={styles.create}
            onPress={() =>
              !loading &&
              router.push(
                pendingChallenge
                  ? { pathname: '/auth/signup', params: { pendingChallenge } }
                  : '/auth/signup'
              )
            }
          >
            Create account
          </Text>
        </Text>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  header: { alignItems: 'center', marginBottom: 8 },
  logo: { width: 140, height: 140, borderRadius: 28 },
  tagline: { fontFamily: Fonts.body, fontSize: 15, color: C.text3, textAlign: 'center', lineHeight: 21, marginTop: 20 },
  form: { marginTop: 36, gap: 12 },
  field: {
    backgroundColor: C.field,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  fieldFocused: { backgroundColor: C.white, borderWidth: 2, borderColor: C.primary },
  fieldLabel: { fontFamily: Fonts.bodySemibold, fontSize: 11, color: C.muted, letterSpacing: 0.3 },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  input: { fontFamily: Fonts.body, fontSize: 15, color: C.dark, marginTop: 3, padding: 0 },
  showText: { fontFamily: Fonts.bodySemibold, fontSize: 13, color: C.primary, paddingHorizontal: 4 },
  signIn: {
    marginTop: 20,
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  signInText: { fontFamily: Fonts.bodyBold, color: C.creamText, fontSize: 15, textTransform: 'uppercase', letterSpacing: 0.3 },
  disabled: { opacity: 0.6 },
  forgot: { alignItems: 'center', paddingVertical: 10 },
  forgotText: { fontFamily: Fonts.bodyMedium, color: C.muted, fontSize: 13 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 4, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontFamily: Fonts.body, color: C.muted, fontSize: 12 },
  appleBtn: { height: 50, width: '100%' },
  footer: { fontFamily: Fonts.body, textAlign: 'center', marginTop: 18, fontSize: 14, color: C.text3 },
  create: { fontFamily: Fonts.bodyBold, color: C.rust },
});
