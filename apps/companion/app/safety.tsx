import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../src/constants/colors';

export const SAFETY_ACK_KEY = 'pick_safety_ack_v1';

const TIPS: Array<{ icon: string; title: string; body: string }> = [
  { icon: '🧤', title: 'Wear gloves', body: 'Always. A grabber tool keeps your hands even further from trouble.' },
  { icon: '🚗', title: 'Watch traffic', body: 'Stay on sidewalks, face oncoming traffic near roads, and never reach into the street for an item.' },
  { icon: '💉', title: 'Never pick up sharps or hazards', body: 'Needles, broken glass, chemicals, dead animals, or anything biological — leave them and report to 311.' },
  { icon: '🌡️', title: 'Mind the weather', body: 'Hydrate in heat, watch for ice, and skip the walk in storms. The trash will wait.' },
  { icon: '🏠', title: 'Respect property', body: 'Public spaces only — no reaching into private yards, vehicles, or posted areas.' },
  { icon: '🧼', title: 'Wash up after', body: 'Soap and water when you get home, every time, gloves or not.' },
];

export default function SafetyScreen() {
  const router = useRouter();

  const acknowledge = async () => {
    await AsyncStorage.setItem(SAFETY_ACK_KEY, String(Date.now()));
    router.replace('/(tabs)/map');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={require('../assets/images/logo-mark.png')} style={styles.logo} />
        <Text style={styles.title}>Before your first cleanup</Text>
        <Text style={styles.subtitle}>
          Picking up litter is a real-world activity with real-world risks. A few rules keep it fun:
        </Text>

        {TIPS.map((tip) => (
          <View key={tip.title} style={styles.tipCard}>
            <Text style={styles.tipIcon}>{tip.icon}</Text>
            <View style={styles.tipText}>
              <Text style={styles.tipTitle}>{tip.title}</Text>
              <Text style={styles.tipBody}>{tip.body}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.disclaimer}>
          You participate at your own risk — PICK tracks your impact but can't assess the safety of any
          location or item. Full details in Settings → Terms of Service.
        </Text>

        <TouchableOpacity style={styles.ackButton} onPress={acknowledge}>
          <Text style={styles.ackButtonText}>I understand — let's pick 🛍️</Text>
        </TouchableOpacity>
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
    padding: 24,
    paddingBottom: 48,
    alignItems: 'center',
  },
  logo: {
    width: 72,
    height: 72,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  tipCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  tipIcon: {
    fontSize: 26,
    marginRight: 12,
  },
  tipText: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.darkSage,
    marginBottom: 2,
  },
  tipBody: {
    fontSize: 12,
    color: '#666',
    lineHeight: 17,
  },
  disclaimer: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 20,
    lineHeight: 16,
  },
  ackButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  ackButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
