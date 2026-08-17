import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { getAuthService } from '../../src/services/authService';
import { C, Fonts, radius } from '../../src/pick/theme';

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      await authService.signup(email.trim(), password, displayName.trim());

      console.log('✅ Signup successful, navigating to home');
      router.replace('/(tabs)/map');
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
        </View>

        {/* Login Link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() => router.push('/auth/login')}
            disabled={loading}
          >
            <Text style={styles.loginLink}>Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
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
