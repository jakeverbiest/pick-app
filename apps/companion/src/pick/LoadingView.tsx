/**
 * Branded loading + error screens for app startup.
 *
 * Themed to match the native splash (navy background, cream mark) so the
 * OS splash → JS loading handoff is seamless — it reads as one continuous
 * splash that then transitions into the app. On-brand for the Civic
 * Blueprint design (navy/cream, no emoji).
 */
import { View, Text, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { C, Fonts } from './theme';

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
      <ActivityIndicator color={C.creamText} style={styles.spinner} />
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
      <Text style={[styles.errorTitle, { marginTop: 22 }]}>Something went wrong starting up</Text>
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
    backgroundColor: C.primary,
    paddingHorizontal: 32,
  },
  logo: {
    width: 220,
    height: 220,
  },
  spinner: { marginTop: 28 },
  errorTitle: {
    fontFamily: Fonts.headlineBold,
    fontSize: 17,
    color: C.creamText,
    marginTop: 20,
    textAlign: 'center',
  },
  message: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: C.heroSub,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
  },
});
