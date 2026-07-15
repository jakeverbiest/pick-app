import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getAuthService } from '../../src/services/authService';
import { COLORS } from '../../src/constants/colors';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing details', 'Please enter your email and password.');
      return;
    }
    try {
      setLoading(true);
      await getAuthService().login(email.trim(), password);
      router.replace('/(tabs)/map');
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

          <Text style={styles.brand}>Pick</Text>
          <Text style={styles.tagline}>Track your impact.{'\n'}Help keep your streets clean.</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <View style={[styles.field, focus === 'email' && styles.fieldFocused]}>
            <Text style={[styles.fieldLabel, focus === 'email' && { color: COLORS.sage }]}>EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="your@email.com"
              placeholderTextColor={COLORS.mutedSage}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocus('email')}
              onBlur={() => setFocus(null)}
              editable={!loading}
              keyboardType="email-address"
              autoCapitalize="none"
              selectionColor={COLORS.sage}
            />
          </View>

          <View style={[styles.field, focus === 'password' && styles.fieldFocused]}>
            <Text style={[styles.fieldLabel, focus === 'password' && { color: COLORS.sage }]}>PASSWORD</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="••••••••"
                placeholderTextColor={COLORS.mutedSage}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocus('password')}
                onBlur={() => setFocus(null)}
                editable={!loading}
                secureTextEntry={!showPassword}
                selectionColor={COLORS.sage}
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
        </View>

        <Text style={styles.footer}>
          New here?{' '}
          <Text style={styles.create} onPress={() => !loading && router.push('/auth/signup')}>
            Create account
          </Text>
        </Text>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  header: { alignItems: 'center', marginBottom: 8 },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    shadowColor: COLORS.sage,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  brand: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, color: COLORS.darkSage, marginTop: 22, marginBottom: 6 },
  tagline: { fontSize: 15, color: '#6B7A62', textAlign: 'center', lineHeight: 21 },
  form: { marginTop: 36, gap: 12 },
  field: {
    backgroundColor: '#FAFAF8',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  fieldFocused: { backgroundColor: COLORS.white, borderWidth: 2, borderColor: COLORS.sage },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: COLORS.mutedSage, letterSpacing: 0.3 },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  input: { fontSize: 15, color: COLORS.darkSage, marginTop: 3, padding: 0 },
  showText: { fontSize: 13, fontWeight: '600', color: COLORS.sage, paddingHorizontal: 4 },
  signIn: {
    marginTop: 20,
    backgroundColor: COLORS.sage,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: COLORS.sage,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  signInText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  forgot: { alignItems: 'center', paddingVertical: 10 },
  forgotText: { color: COLORS.mutedSage, fontSize: 13, fontWeight: '500' },
  footer: { textAlign: 'center', marginTop: 18, fontSize: 14, color: '#6B7A62' },
  create: { color: COLORS.accent, fontWeight: '600' },
});
