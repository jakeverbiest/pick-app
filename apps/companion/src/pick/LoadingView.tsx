/**
 * Branded loading + error screens for app startup.
 *
 * Themed to match the native splash (sage background, white mark) so the
 * OS splash → JS loading handoff is seamless — it reads as one continuous
 * splash that then transitions into the app. On-brand for the Trail design
 * (sage/cream, no emoji).
 */
import { View, Text, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '../constants/colors';

function Logo() {
  // The trash-bag "G" mark — same asset as the native splash, so the OS
  // splash → JS loading handoff reads as one continuous screen.
  return (
    <Image
      source={require('../../assets/images/splash-icon.png')}
      style={styles.logo}
      resizeMode="contain"
    />
  );
}

/** Full-screen branded loading state (used while the app initializes / routes). */
export function LoadingView({ message }: { message?: string }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Logo />
      <Text style={styles.brand}>Pick</Text>
      <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

/** Full-screen branded error state (used if initialization fails). */
export function ErrorView({ message }: { message?: string }) {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Logo />
      <Text style={styles.brand}>Pick</Text>
      <Text style={styles.errorTitle}>Something went wrong starting up</Text>
      <Text style={styles.message}>
        {message || 'Please close and reopen the app. If it keeps happening, reinstall.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.sage,
    paddingHorizontal: 32,
  },
  logo: {
    width: 104,
    height: 104,
  },
  brand: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: COLORS.white,
    marginTop: 22,
  },
  spinner: { marginTop: 20 },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    marginTop: 20,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
  },
});
