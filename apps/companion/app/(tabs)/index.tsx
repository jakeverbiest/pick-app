import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function IndexScreen() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to map screen
    router.replace('/(tabs)/map');
  }, []);

  return null;
}
