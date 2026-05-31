import { View, Text, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>🗑️ PICK</Text>
      <Text style={styles.subtitle}>Environmental Wellness</Text>
      <Text style={styles.message}>Motion detection ready for Week 1 field testing</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 24,
    color: '#666',
    marginBottom: 24,
  },
  message: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
});
