import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { getAuthService } from '../../src/services/authService';
import { COLORS, SPACING, RADIUS } from '../../src/constants/colors';
import { Icon } from '../../src/pick/Icon';

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const validateForm = () => {
    if (!email.trim() || !password.trim() || !confirmPassword.trim() || !displayName.trim() || !neighborhood.trim()) {
      Alert.alert('❌ Error', 'Please fill in all fields');
      return false;
    }

    if (password !== confirmPassword) {
      Alert.alert('❌ Error', 'Passwords do not match');
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
      await authService.signup(email.trim(), password, displayName.trim(), neighborhood.trim());

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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logo}>
            <Icon name="leaf" size={34} color="#fff" sw={1.7} />
          </View>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Start tracking cleanups</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Jake"
            placeholderTextColor={COLORS.mutedSage}
            value={displayName}
            onChangeText={setDisplayName}
            editable={!loading}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Neighborhood</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Lower East Side"
            placeholderTextColor={COLORS.mutedSage}
            value={neighborhood}
            onChangeText={setNeighborhood}
            editable={!loading}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="your@email.com"
            placeholderTextColor={COLORS.mutedSage}
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
              placeholderTextColor={COLORS.mutedSage}
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

          <Text style={styles.label}>Confirm Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="••••••••"
              placeholderTextColor={COLORS.mutedSage}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              editable={!loading}
              secureTextEntry={!showConfirm}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowConfirm(!showConfirm)}
              disabled={loading}
            >
              <Text style={styles.eyeIcon}>{showConfirm ? '👁️' : '👁️‍🗨️'}</Text>
            </TouchableOpacity>
          </View>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream,
  },
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
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: COLORS.sage,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: COLORS.sage,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mutedSage,
  },
  form: {
    gap: 14,
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkSage,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    color: COLORS.darkSage,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingRight: 8,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    color: COLORS.darkSage,
  },
  eyeButton: {
    padding: 8,
  },
  eyeIcon: {
    fontSize: 16,
  },
  signupButton: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  signupButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
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
    color: COLORS.mutedSage,
    fontSize: 13,
  },
  loginLink: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});
