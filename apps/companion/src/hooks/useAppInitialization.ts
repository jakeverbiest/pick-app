import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getAuthService } from '../services/authService';
import { getDatabase } from '../services/database';
import { recoverCrashedSession } from '../services/crashRecorder';
import { stopBackgroundSession } from '../services/backgroundSession';

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

        // Crash recovery + phantom-tracker cleanup.
        // If the last walk didn't end cleanly (a screen-off memory crash, or a
        // force-quit), a sentinel survives on disk and the iOS background
        // location task is left registered — that's the "location arrow on when
        // PICK isn't running" symptom. recoverCrashedSession() files the black-box
        // trace as a crash report; then we stop the orphaned tracker.
        //
        // We only tear the tracker down when this launch is in the FOREGROUND
        // (the user opened the app — no live walk to protect) or when we just
        // recovered a stale crash. A genuine iOS background relaunch mid-walk
        // (AppState 'background', fresh heartbeat) is left running.
        try {
          const report = await recoverCrashedSession(true);
          if (report) {
            console.warn(
              `🛑 Recovered an unclean session: survived ${report.elapsedSec}s, ` +
                `${report.routePoints} route pts, ${report.pickups} pickups, ` +
                `${report.motionEvents} motion events (dead ${report.gapSec}s before launch).`
            );
          }
          const launchedInForeground = AppState.currentState !== 'background';
          if (report || launchedInForeground) {
            await stopBackgroundSession();
          }
        } catch (recoveryError) {
          console.error('⚠️ Crash recovery step failed:', recoveryError);
        }

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
