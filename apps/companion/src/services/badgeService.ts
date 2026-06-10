import { getDatabase } from './database';
import { BadgeDefinition, Cleanup } from '../types';

/**
 * Badge definitions with unlock criteria
 */
export const BADGE_DEFINITIONS: Record<string, BadgeDefinition> = {
  pioneer: {
    type: 'pioneer',
    name: '👑 Pioneer',
    description: 'First person to clean in a new city/state/country',
    icon: '👑',
    rarity: 'legendary',
  },
  first_steps: {
    type: 'explorer',
    name: '🌍 First Steps',
    description: 'Clean in your first neighborhood',
    icon: '🌍',
    rarity: 'common',
  },
  explorer: {
    type: 'explorer',
    name: '🗺️ Explorer',
    description: 'Clean in 3+ neighborhoods',
    icon: '🗺️',
    rarity: 'uncommon',
  },
  city_mapper: {
    type: 'explorer',
    name: '🏙️ City Mapper',
    description: 'Clean in 5+ cities',
    icon: '🏙️',
    rarity: 'rare',
  },
  collector: {
    type: 'collector',
    name: '🎁 Collector',
    description: '10+ lbs of trash collected',
    icon: '🎁',
    rarity: 'uncommon',
  },
  heavy_lifter: {
    type: 'heavy_lifter',
    name: '💪 Heavy Lifter',
    description: '50+ lbs of trash collected',
    icon: '💪',
    rarity: 'rare',
  },
  king_queen: {
    type: 'king_queen',
    name: '👑 King/Queen',
    description: '500+ lbs of trash collected',
    icon: '👑',
    rarity: 'epic',
  },
  consistent: {
    type: 'consistent',
    name: '🔥 Consistent',
    description: '7-day cleanup streak',
    icon: '🔥',
    rarity: 'uncommon',
  },
  dedicated: {
    type: 'dedicated',
    name: '🎯 Dedicated',
    description: '30-day cleanup streak',
    icon: '🎯',
    rarity: 'rare',
  },
  unstoppable: {
    type: 'unstoppable',
    name: '⚡ Unstoppable',
    description: '90-day cleanup streak',
    icon: '⚡',
    rarity: 'epic',
  },
};

class BadgeService {
  /**
   * Check and award badges based on cleanup stats
   */
  async checkAndAwardBadges(userId: string): Promise<string[]> {
    try {
      const db = await getDatabase();
      const stats = await db.getCleanupStats();
      const cleanups = await db.getCleanups(1000); // Get all for streak calculation

      const newBadges: string[] = [];

      // Check weight-based badges
      const totalWeight = (stats?.total_weight as number) || 0;

      if (totalWeight >= 500 && !(await db.getBadgeCount(userId, 'king_queen'))) {
        await db.addBadge({
          userId,
          badge_type: 'king_queen',
          unlocked_at: Date.now(),
        });
        newBadges.push('king_queen');
      } else if (totalWeight >= 50 && !(await db.getBadgeCount(userId, 'heavy_lifter'))) {
        await db.addBadge({
          userId,
          badge_type: 'heavy_lifter',
          unlocked_at: Date.now(),
        });
        newBadges.push('heavy_lifter');
      } else if (totalWeight >= 10 && !(await db.getBadgeCount(userId, 'collector'))) {
        await db.addBadge({
          userId,
          badge_type: 'collector',
          unlocked_at: Date.now(),
        });
        newBadges.push('collector');
      }

      // Check cleanup count
      const totalCleanups = (stats?.total_cleanups as number) || 0;
      if (totalCleanups >= 1 && !(await db.getBadgeCount(userId, 'first_steps'))) {
        await db.addBadge({
          userId,
          badge_type: 'first_steps',
          unlocked_at: Date.now(),
        });
        newBadges.push('first_steps');
      }

      // Check streak badges
      const streak = this.calculateCurrentStreak(cleanups);
      if (streak >= 90 && !(await db.getBadgeCount(userId, 'unstoppable'))) {
        await db.addBadge({
          userId,
          badge_type: 'unstoppable',
          unlocked_at: Date.now(),
        });
        newBadges.push('unstoppable');
      } else if (streak >= 30 && !(await db.getBadgeCount(userId, 'dedicated'))) {
        await db.addBadge({
          userId,
          badge_type: 'dedicated',
          unlocked_at: Date.now(),
        });
        newBadges.push('dedicated');
      } else if (streak >= 7 && !(await db.getBadgeCount(userId, 'consistent'))) {
        await db.addBadge({
          userId,
          badge_type: 'consistent',
          unlocked_at: Date.now(),
        });
        newBadges.push('consistent');
      }

      if (newBadges.length > 0) {
        console.log(`✅ Badges awarded: ${newBadges.join(', ')}`);
      }

      return newBadges;
    } catch (error) {
      console.error('❌ Badge check failed:', error);
      return [];
    }
  }

  /**
   * Calculate current cleanup streak (consecutive days)
   */
  private calculateCurrentStreak(cleanups: Cleanup[]): number {
    if (cleanups.length === 0) return 0;

    // Sort by timestamp descending (most recent first)
    const sorted = [...cleanups].sort((a, b) => b.timestamp - a.timestamp);

    // Get unique days
    const days = new Set<string>();
    sorted.forEach((cleanup) => {
      const date = new Date(cleanup.timestamp * 1000);
      const dateStr = date.toISOString().split('T')[0];
      days.add(dateStr);
    });

    const sortedDays = Array.from(days)
      .sort()
      .reverse();

    // Check consecutive days from today backwards
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < sortedDays.length; i++) {
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);
      const expectedStr = expectedDate.toISOString().split('T')[0];

      if (sortedDays[i] === expectedStr) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Get all earned badges for user
   */
  async getUserBadges(userId: string) {
    try {
      const db = await getDatabase();
      const badges = await db.getBadges(userId);

      return badges.map((badge) => ({
        ...badge,
        definition: BADGE_DEFINITIONS[badge.badge_type],
      }));
    } catch (error) {
      console.error('❌ Failed to get badges:', error);
      return [];
    }
  }

  /**
   * Get badge definition
   */
  getBadgeDefinition(badgeType: string): BadgeDefinition | undefined {
    return BADGE_DEFINITIONS[badgeType];
  }

  /**
   * Get all available badges
   */
  getAllBadges(): BadgeDefinition[] {
    return Object.values(BADGE_DEFINITIONS);
  }

  /**
   * Get badge progress for user (how close to next badge)
   */
  async getBadgeProgress(userId: string) {
    try {
      const db = await getDatabase();
      const stats = await db.getCleanupStats();
      const cleanups = await db.getCleanups(1000);

      const totalWeight = (stats?.total_weight as number) || 0;
      const totalCleanups = (stats?.total_cleanups as number) || 0;
      const streak = this.calculateCurrentStreak(cleanups);

      return {
        weight: {
          current: totalWeight,
          targets: [10, 50, 500],
          labels: ['Collector (10 lb)', 'Heavy Lifter (50 lb)', 'King/Queen (500 lb)'],
        },
        cleanups: {
          current: totalCleanups,
          targets: [1, 3, 5],
          labels: ['First Steps (1)', 'Explorer (3)', 'City Mapper (5)'],
        },
        streak: {
          current: streak,
          targets: [7, 30, 90],
          labels: ['Consistent (7 days)', 'Dedicated (30 days)', 'Unstoppable (90 days)'],
        },
      };
    } catch (error) {
      console.error('❌ Failed to get badge progress:', error);
      return null;
    }
  }
}

// Singleton instance
let instance: BadgeService | null = null;

export function getBadgeService(): BadgeService {
  if (!instance) {
    instance = new BadgeService();
  }
  return instance;
}

export default BadgeService;
