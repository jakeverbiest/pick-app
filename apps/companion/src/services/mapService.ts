import { getDatabase } from './database';

export type ZoneStatus = 'clean' | 'getting_dirty' | 'needs_cleaning' | 'urgent' | 'never_cleaned';

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  status: ZoneStatus;
  daysInStatus: number;
  lastCleanupWeight: number;
  lastCleanupDays: number;
  accumulationRate: number; // lb per day
  recommendedFrequency: string;
  cleanupCount: number;
}

export interface ZoneDetails {
  id: string;
  name: string;
  status: ZoneStatus;
  statusColor: string;
  statusEmoji: string;
  lastCleanup?: {
    days: number;
    weight: number;
    timestamp: number;
  };
  stats: {
    totalCleanups: number;
    totalWeight: number;
    avgWeight: number;
    cleanupDays: number;
  };
  recommendation: string;
  nextCleanup: string;
}

/**
 * Predefined zones/neighborhoods
 * In a real app, this would be dynamic based on user location
 */
const PREDEFINED_ZONES = [
  { id: 'downtown', name: 'Downtown', lat: 40.7128, lon: -74.006 },
  { id: 'waterfront', name: 'Waterfront', lat: 40.702, lon: -74.017 },
  { id: 'parks', name: 'Parks District', lat: 40.785, lon: -73.968 },
  { id: 'harbor', name: 'Harbor Zone', lat: 40.699, lon: -74.044 },
  { id: 'midtown', name: 'Midtown', lat: 40.758, lon: -73.985 },
  { id: 'uptown', name: 'Uptown', lat: 40.818, lon: -73.958 },
  { id: 'westside', name: 'West Side', lat: 40.775, lon: -74.001 },
  { id: 'eastside', name: 'East Side', lat: 40.758, lon: -73.963 },
];

class MapService {
  /**
   * Get all zones with status
   */
  async getZones(): Promise<Zone[]> {
    const db = await getDatabase();
    const zones: Zone[] = [];

    for (const zone of PREDEFINED_ZONES) {
      // Get cleanups for this zone
      const cleanups = await db.getCleanups(1000);

      // Filter cleanups near this zone (simple radius check: 0.05 degrees ≈ 5.5 km)
      const zoneCleanups = cleanups.filter((c) => {
        const latDiff = Math.abs(c.location_lat - zone.lat);
        const lonDiff = Math.abs(c.location_lon - zone.lon);
        return latDiff < 0.05 && lonDiff < 0.05;
      });

      const status = this.calculateZoneStatus(zoneCleanups);
      const lastCleanup = zoneCleanups[0]; // Most recent

      zones.push({
        id: zone.id,
        name: zone.name,
        lat: zone.lat,
        lon: zone.lon,
        status: status.status,
        daysInStatus: status.days,
        lastCleanupWeight: lastCleanup?.weight_lb || 0,
        lastCleanupDays: lastCleanup ? Math.floor((Date.now() - lastCleanup.timestamp * 1000) / (1000 * 60 * 60 * 24)) : 999,
        accumulationRate: this.calculateAccumulationRate(zoneCleanups),
        recommendedFrequency: this.getRecommendedFrequency(zoneCleanups),
        cleanupCount: zoneCleanups.length,
      });
    }

    return zones;
  }

  /**
   * Get details for a specific zone
   */
  async getZoneDetails(zoneId: string): Promise<ZoneDetails | null> {
    const zones = await this.getZones();
    const zone = zones.find((z) => z.id === zoneId);

    if (!zone) return null;

    const statusInfo = this.getStatusInfo(zone.status);

    // Get all cleanups for this zone
    const db = await getDatabase();
    const allCleanups = await db.getCleanups(1000);
    const zoneCleanups = allCleanups.filter((c) => {
      const latDiff = Math.abs(c.location_lat - zone.lat);
      const lonDiff = Math.abs(c.location_lon - zone.lon);
      return latDiff < 0.05 && lonDiff < 0.05;
    });

    const stats = {
      totalCleanups: zoneCleanups.length,
      totalWeight: zoneCleanups.reduce((sum, c) => sum + c.weight_lb, 0),
      avgWeight: zoneCleanups.length > 0 ? zoneCleanups.reduce((sum, c) => sum + c.weight_lb, 0) / zoneCleanups.length : 0,
      cleanupDays: new Set(zoneCleanups.map((c) => Math.floor(c.timestamp / 86400))).size,
    };

    const lastCleanup = zoneCleanups[0];

    return {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      statusColor: statusInfo.color,
      statusEmoji: statusInfo.emoji,
      lastCleanup: lastCleanup
        ? {
            days: zone.lastCleanupDays,
            weight: lastCleanup.weight_lb,
            timestamp: lastCleanup.timestamp,
          }
        : undefined,
      stats,
      recommendation: this.getRecommendation(zone),
      nextCleanup: this.getNextCleanupSuggestion(zone),
    };
  }

  /**
   * Calculate zone status based on cleanups
   */
  private calculateZoneStatus(cleanups: any[]): { status: ZoneStatus; days: number } {
    if (cleanups.length === 0) {
      return { status: 'never_cleaned', days: 999 };
    }

    const lastCleanup = cleanups[0];
    const daysSinceCleanup = Math.floor((Date.now() - lastCleanup.timestamp * 1000) / (1000 * 60 * 60 * 24));

    // Status based on days + last weight
    if (daysSinceCleanup <= 3 && lastCleanup.weight_lb < 0.5) {
      return { status: 'clean', days: daysSinceCleanup };
    }
    if (daysSinceCleanup <= 7 && lastCleanup.weight_lb < 2) {
      return { status: 'getting_dirty', days: daysSinceCleanup };
    }
    if (daysSinceCleanup <= 14 && lastCleanup.weight_lb < 5) {
      return { status: 'needs_cleaning', days: daysSinceCleanup };
    }

    return { status: 'urgent', days: daysSinceCleanup };
  }

  /**
   * Calculate daily accumulation rate
   */
  private calculateAccumulationRate(cleanups: any[]): number {
    if (cleanups.length < 2) return 0;

    const [recent, previous] = [cleanups[0], cleanups[1]];
    const days = (recent.timestamp - previous.timestamp) / 86400;

    return days > 0 ? recent.weight_lb / days : 0;
  }

  /**
   * Get recommended cleanup frequency
   */
  private getRecommendedFrequency(cleanups: any[]): string {
    const rate = this.calculateAccumulationRate(cleanups);

    if (rate >= 1) return 'Daily';
    if (rate >= 0.5) return '2-3x per week';
    if (rate >= 0.1) return '1-2x per week';
    if (rate > 0) return 'Every 2 weeks';

    return 'As needed';
  }

  /**
   * Get status color and emoji
   */
  private getStatusInfo(status: ZoneStatus): { color: string; emoji: string } {
    const info: Record<ZoneStatus, { color: string; emoji: string }> = {
      clean: { color: '#34C759', emoji: '🟢' },
      getting_dirty: { color: '#FFCC00', emoji: '🟡' },
      needs_cleaning: { color: '#FF9500', emoji: '🟠' },
      urgent: { color: '#FF3B30', emoji: '🔴' },
      never_cleaned: { color: '#D0D0D0', emoji: '⚪' },
    };

    return info[status];
  }

  /**
   * Get recommendation text for zone
   */
  private getRecommendation(zone: Zone): string {
    switch (zone.status) {
      case 'clean':
        return `Great! This area was cleaned ${zone.lastCleanupDays} days ago and is in good shape.`;
      case 'getting_dirty':
        return `This area is getting a bit dirty. Consider cleaning within the next few days.`;
      case 'needs_cleaning':
        return `This area needs attention soon. It's been ${zone.lastCleanupDays} days since last cleanup.`;
      case 'urgent':
        return `This area needs immediate attention. It's been ${zone.lastCleanupDays} days and has significant trash.`;
      case 'never_cleaned':
        return 'This area has no cleanup history. Consider starting here!';
      default:
        return 'No data available.';
    }
  }

  /**
   * Get next cleanup suggestion
   */
  private getNextCleanupSuggestion(zone: Zone): string {
    if (zone.status === 'clean') {
      return `Next in ${Math.ceil(zone.accumulationRate > 0 ? 3 / zone.accumulationRate : 7)} days`;
    }
    if (zone.status === 'getting_dirty') {
      return 'Next 1-3 days';
    }
    if (zone.status === 'needs_cleaning') {
      return 'Next 1-2 days';
    }
    if (zone.status === 'urgent') {
      return 'ASAP';
    }
    return 'When possible';
  }

  /**
   * Find nearest zone to coordinates
   */
  async getNearestZone(lat: number, lon: number): Promise<Zone | null> {
    const zones = await this.getZones();

    let nearest = null;
    let nearestDist = Infinity;

    for (const zone of zones) {
      const dist = Math.sqrt(Math.pow(zone.lat - lat, 2) + Math.pow(zone.lon - lon, 2));

      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = zone;
      }
    }

    return nearest;
  }

  /**
   * Get cleanliness score for area (0-100)
   */
  async getCleanliness(): Promise<number> {
    const zones = await this.getZones();

    const cleanCount = zones.filter((z) => z.status === 'clean').length;
    return Math.round((cleanCount / zones.length) * 100);
  }

  /**
   * Get community stats
   */
  async getCommunityStats(): Promise<{
    zonesTotal: number;
    zonesClean: number;
    averageAccumulation: number;
    mostUrgent: Zone | null;
  }> {
    const zones = await this.getZones();

    const zonesClean = zones.filter((z) => z.status === 'clean').length;
    const avgAccumulation = zones.reduce((sum, z) => sum + z.accumulationRate, 0) / zones.length;
    const mostUrgent = zones.find((z) => z.status === 'urgent') || zones.find((z) => z.status === 'needs_cleaning');

    return {
      zonesTotal: zones.length,
      zonesClean,
      averageAccumulation: Math.round(avgAccumulation * 10) / 10,
      mostUrgent: mostUrgent || null,
    };
  }
}

// Singleton instance
let instance: MapService | null = null;

export function getMapService(): MapService {
  if (!instance) {
    instance = new MapService();
  }
  return instance;
}

export default MapService;
