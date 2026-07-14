import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthService } from '../src/services/authService';
import { SAFETY_ACK_KEY } from './safety';
import { LoadingView } from '../src/pick/LoadingView';

export default function RootIndexScreen() {
  const router = useRouter();

  useEffect(() => {
    const route = async () => {
      const authService = getAuthService();
      const user = authService.getCurrentUser();

      if (!user) {
        console.log('📱 No user, routing to login');
        router.replace('/auth/login');
        return;
      }

      // First-run safety acknowledgement gate
      const ack = await AsyncStorage.getItem(SAFETY_ACK_KEY);
      if (!ack) {
        console.log('🦺 First run — routing to safety briefing');
        router.replace('/safety');
        return;
      }

      console.log('✅ User logged in, routing to map');
      router.replace('/(tabs)/map');
    };
    route();
  }, []);

  // Branded splash while we decide where to send the user (no blank flash).
  return <LoadingView />;
}
