import { FitnessApp, FitnessWorkout } from '../types';

/**
 * Fitness App Configurations
 * Shows which apps sync to which others for deduplication
 */
export const FITNESS_APPS: Record<
  FitnessApp,
  {
    name: string;
    icon: string;
    platform: 'ios' | 'android' | 'cross';
    syncsTo?: FitnessApp[]; // Apps this syncs to (for deduplication)
  }
> = {
  apple_health: {
    name: 'Apple Health',
    icon: '🫀',
    platform: 'ios',
  },
  google_health: {
    name: 'Google Health Connect',
    icon: '💚',
    platform: 'android',
  },
  strava: {
    name: 'Strava',
    icon: '🏃',
    platform: 'cross',
    syncsTo: ['apple_health', 'google_health'], // Strava syncs to both
  },
  adidas_running: {
    name: 'Adidas Running',
    icon: '👟',
    platform: 'cross',
    syncsTo: ['apple_health', 'google_health'], // Adidas syncs to both
  },
};

/**
 * Recommended fitness app configurations
 * to avoid double-counting
 */
export const RECOMMENDED_CONFIGS = [
  {
    name: 'Apple Health Only',
    description: 'iOS native tracking',
    apps: ['apple_health'],
  },
  {
    name: 'Apple Health + Strava',
    description: 'Strava syncs to Apple Health automatically',
    apps: ['strava'],
  },
  {
    name: 'Google Health Only',
    description: 'Android native tracking',
    apps: ['google_health'],
  },
  {
    name: 'Cross-Platform (Strava)',
    description: 'Works on iOS & Android',
    apps: ['strava'],
  },
  {
    name: 'All Apps',
    description: 'Enable everything (may double-count)',
    apps: ['apple_health', 'google_health', 'strava', 'adidas_running'],
  },
];

class FitnessService {
  /**
   * Get apps that should receive workout data
   * Implements smart deduplication: if Strava is enabled,
   * don't send to Apple Health (Strava will sync it)
   */
  getAppsToSync(enabledApps: FitnessApp[]): FitnessApp[] {
    if (enabledApps.length === 0) return [];

    // If Strava is enabled, it will handle syncing to Apple Health / Google Health
    if (enabledApps.includes('strava')) {
      // Only send to Strava (it syncs to others)
      return ['strava'];
    }

    // If Adidas Running is enabled, it will handle syncing to Apple Health / Google Health
    if (enabledApps.includes('adidas_running')) {
      // Only send to Adidas (it syncs to others)
      return ['adidas_running'];
    }

    // If both Apple Health and Google Health are enabled, send to both
    // (they don't sync to each other)
    if (enabledApps.includes('apple_health') || enabledApps.includes('google_health')) {
      return enabledApps.filter((app) => app === 'apple_health' || app === 'google_health');
    }

    return enabledApps;
  }

  /**
   * Calculate calories burned based on activity metrics
   * Simple formula: weight * intensity * duration
   */
  calculateCalories(
    weight_lb: number,
    duration_minutes: number,
    intensity: 'low' | 'moderate' | 'high' = 'moderate'
  ): number {
    // Rough estimates for outdoor activity
    const intensityMultiplier = {
      low: 3.5, // 3.5 cal/min (leisurely walk)
      moderate: 5, // 5 cal/min (brisk walk/light run)
      high: 7, // 7 cal/min (running)
    };

    const weight_kg = weight_lb / 2.205;
    const mets = intensityMultiplier[intensity];
    const calories = (weight_kg * mets * duration_minutes) / 60;

    return Math.round(calories);
  }

  /**
   * Estimate distance based on duration and speed
   * Cleanup walking speed: ~1.4 m/s (3 mph / 4.8 km/h)
   */
  estimateDistance(duration_seconds: number): number {
    const speed_ms = 1.4; // meters per second (slow walking)
    const distance_meters = duration_seconds * speed_ms;
    const distance_km = distance_meters / 1000;
    return Math.round(distance_km * 100) / 100; // Round to 2 decimals
  }

  /**
   * Create workout data from cleanup session
   */
  createWorkout(
    items_count: number,
    weight_lb: number,
    duration_seconds: number,
    user_weight_lb: number = 150 // Default if not provided
  ): FitnessWorkout {
    const duration_minutes = duration_seconds / 60;
    const distance_km = this.estimateDistance(duration_seconds);

    // Determine intensity based on weight and time
    let intensity: 'low' | 'moderate' | 'high';
    const pace = duration_seconds / weight_lb; // seconds per pound

    if (pace < 3) {
      intensity = 'high'; // Fast pickup
    } else if (pace < 5) {
      intensity = 'moderate'; // Average
    } else {
      intensity = 'low'; // Slow, leisurely
    }

    const calories = this.calculateCalories(user_weight_lb, duration_minutes, intensity);

    return {
      duration_seconds,
      distance_km,
      activity_type: 'walking',
      calories_burned: calories,
      items_collected: items_count,
    };
  }

  /**
   * Format enabled apps for display
   */
  formatEnabledApps(appIds: FitnessApp[]): string {
    return appIds
      .map((app) => {
        const config = FITNESS_APPS[app];
        return `${config.icon} ${config.name}`;
      })
      .join(', ');
  }

  /**
   * Get sync chain explanation
   */
  getSyncChainExplanation(enabledApps: FitnessApp[]): string {
    if (enabledApps.length === 0) {
      return 'No fitness apps enabled';
    }

    const hasStrava = enabledApps.includes('strava');
    const hasAdidas = enabledApps.includes('adidas_running');
    const hasAppleHealth = enabledApps.includes('apple_health');
    const hasGoogleHealth = enabledApps.includes('google_health');

    let explanation = '';

    if (hasStrava) {
      explanation += '🏃 Strava syncs to Apple Health & Google Health automatically\n';
    }
    if (hasAdidas) {
      explanation += '👟 Adidas Running syncs to Apple Health & Google Health automatically\n';
    }
    if (hasAppleHealth && !hasStrava && !hasAdidas) {
      explanation += '🫀 Data logged directly to Apple Health\n';
    }
    if (hasGoogleHealth && !hasStrava && !hasAdidas) {
      explanation += '💚 Data logged directly to Google Health Connect\n';
    }

    explanation += '\n📌 Each cleanup is logged once (no duplicates)';

    return explanation;
  }

  /**
   * Get best recommendation for enabled apps
   */
  getRecommendation(enabledApps: FitnessApp[]): string {
    if (enabledApps.length === 0) {
      return 'Enable at least one fitness app to sync cleanups';
    }

    if (enabledApps.length === 1) {
      const app = enabledApps[0];
      const config = FITNESS_APPS[app];
      return `Perfect! ${config.icon} ${config.name} will receive your workout data.`;
    }

    const hasStrava = enabledApps.includes('strava');
    const hasAdidas = enabledApps.includes('adidas_running');
    const syncingApps = enabledApps.filter((app) => app === 'strava' || app === 'adidas_running');

    if (syncingApps.length > 1) {
      return '⚠️ Strava and Adidas both sync to Apple/Google Health. Consider using just one to avoid confusion.';
    }

    if (hasStrava || hasAdidas) {
      const app = hasStrava ? 'Strava' : 'Adidas Running';
      return `✅ ${app} will sync to Apple Health & Google Health automatically.`;
    }

    if (enabledApps.length === 2) {
      const names = enabledApps.map((app) => FITNESS_APPS[app].name).join(' + ');
      return `✅ Data will sync to ${names}`;
    }

    return `✅ ${enabledApps.length} fitness apps will receive your data`;
  }

  /**
   * Validate fitness configuration
   */
  validateConfig(enabledApps: FitnessApp[]): { valid: boolean; warning?: string } {
    const hasStrava = enabledApps.includes('strava');
    const hasAdidas = enabledApps.includes('adidas_running');
    const hasAppleHealth = enabledApps.includes('apple_health');
    const hasGoogleHealth = enabledApps.includes('google_health');

    // Check for potential double-counting
    if ((hasStrava || hasAdidas) && (hasAppleHealth || hasGoogleHealth)) {
      return {
        valid: true,
        warning:
          'Strava/Adidas syncs to Apple Health & Google Health. Your data may appear in multiple places.',
      };
    }

    if (hasStrava && hasAdidas) {
      return {
        valid: true,
        warning: 'Both Strava and Adidas are enabled. Both sync to Apple/Google Health.',
      };
    }

    return { valid: true };
  }
}

// Singleton instance
let instance: FitnessService | null = null;

export function getFitnessService(): FitnessService {
  if (!instance) {
    instance = new FitnessService();
  }
  return instance;
}

export default FitnessService;
