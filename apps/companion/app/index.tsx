import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { getAuthService } from '../src/services/authService';

export default function RootIndexScreen() {
  const router = useRouter();

  useEffect(() => {
    const authService = getAuthService();
    const user = authService.getCurrentUser();

    // Navigate based on auth state
    if (user) {
      console.log('✅ User logged in, routing to map');
      router.replace('/(tabs)/map');
    } else {
      console.log('📱 No user, routing to login');
      router.replace('/auth/login');
    }
  }, []);

  return null;
}
