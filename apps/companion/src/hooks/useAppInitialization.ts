import { useEffect, useState } from 'react';
import { getAuthService } from '../services/simpleAuthService';
import { getDatabase } from '../services/database';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Hook to initialize the app on first load
 * - Initializes Firebase Auth
 * - Listens for auth state changes
 * - Initializes database when user is authenticated
 */
export function useAppInitialization() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initialize = async () => {
      try {
        console.log('🚀 Initializing app...');

        // Initialize auth service (deferred initialization)
        const authService = getAuthService();
        await authService.initialize();

        // Listen for auth state changes
        authService.onAuthStateChanged(async (user) => {
          console.log('👤 Auth state changed:', user ? user.email : 'logged out');
          setAuthUser(user);

          if (user) {
            // Initialize database for authenticated user
            console.log('🚀 Initializing Firebase database for:', user.email);
            try {
              const database = await getDatabase();
              await (database as any).initialize(user.uid);
            } catch (dbError) {
              console.error('⚠️ Database init failed:', dbError);
            }
          }
        });

        setIsInitialized(true);
        console.log('✅ App initialization complete');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('❌ App initialization failed:', errorMessage);
        setError(errorMessage);
      }
    };

    initialize();
  }, []);

  return { isInitialized, authUser, error };
}
