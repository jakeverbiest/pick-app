/**
 * Pickup Aggregator - Groups pickups by zone + hour (privacy-safe)
 * Never stores raw coordinates, only aggregated metrics
 */

import ZoneManager from './zoneManager';

interface AggregatedPickup {
  session_id: string;
  zone_id: string;
  pickups_count: number;
  hour_bucket: string; // ISO format: "2026-05-31T14:00:00Z"
  app_version: string;
  device_type: string; // iOS or Android
  created_at: number; // timestamp
}

interface PickupEvent {
  timestamp: number;
  latitude: number;
  longitude: number;
  magnitude: number;
  confidence: number;
}

class PickupAggregator {
  private sessionId: string;
  private currentHour: string | null = null;
  private currentZone: string | null = null;
  private pickupBuffer: PickupEvent[] = [];
  private aggregatedData: AggregatedPickup[] = [];

  constructor() {
    // Generate random session ID (never persists, changes on app restart)
    this.sessionId = this.generateSessionId();
  }

  /**
   * Generate ephemeral session ID
   */
  private generateSessionId(): string {
    return 'session-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
  }

  /**
   * Get current hour bucket (e.g., "2026-05-31T14:00:00Z")
   */
  private getHourBucket(timestamp: number): string {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }

  /**
   * Add a pickup to the aggregation buffer
   * Called by motion detection service when a pickup is detected
   */
  addPickup(pickup: PickupEvent): void {
    // Extract zone from GPS coordinates
    const zone = ZoneManager.getZoneFromCoordinates(pickup.latitude, pickup.longitude);

    if (!zone) {
      console.warn(`Pickup at (${pickup.latitude}, ${pickup.longitude}) outside all zones`);
      return;
    }

    const hourBucket = this.getHourBucket(pickup.timestamp);

    // Add to buffer (will be sent in batch later)
    this.pickupBuffer.push(pickup);

    // Log aggregated view (not individual coordinates)
    console.log(
      `📊 Pickup aggregated - Zone: ${zone}, Hour: ${hourBucket}, Total this hour: ${this.countPickupsInHour(
        zone,
        hourBucket
      )}`
    );
  }

  /**
   * Count pickups for a zone in a specific hour
   */
  private countPickupsInHour(zoneId: string, hourBucket: string): number {
    return this.pickupBuffer.filter((p) => {
      const zone = ZoneManager.getZoneFromCoordinates(p.latitude, p.longitude);
      return zone === zoneId && this.getHourBucket(p.timestamp) === hourBucket;
    }).length;
  }

  /**
   * Generate aggregated data ready to send to server
   * This is what gets sent to Firebase (no raw coordinates)
   */
  generateAggregates(): AggregatedPickup[] {
    const aggregates = new Map<string, AggregatedPickup>();

    for (const pickup of this.pickupBuffer) {
      const zone = ZoneManager.getZoneFromCoordinates(pickup.latitude, pickup.longitude);
      if (!zone) continue;

      const hourBucket = this.getHourBucket(pickup.timestamp);
      const key = `${zone}-${hourBucket}`;

      if (!aggregates.has(key)) {
        aggregates.set(key, {
          session_id: this.sessionId,
          zone_id: zone,
          pickups_count: 0,
          hour_bucket: hourBucket,
          app_version: '1.0.0',
          device_type: 'iOS',
          created_at: Date.now(),
        });
      }

      const agg = aggregates.get(key)!;
      agg.pickups_count += 1;
    }

    return Array.from(aggregates.values());
  }

  /**
   * Get aggregates for display (local view)
   */
  getAggregatesByZone(): { [zoneId: string]: number } {
    const totals: { [zoneId: string]: number } = {};

    for (const pickup of this.pickupBuffer) {
      const zone = ZoneManager.getZoneFromCoordinates(pickup.latitude, pickup.longitude);
      if (zone) {
        totals[zone] = (totals[zone] || 0) + 1;
      }
    }

    return totals;
  }

  /**
   * Get total pickup count (across all zones)
   */
  getTotalPickups(): number {
    return this.pickupBuffer.length;
  }

  /**
   * Clear buffer after successful upload
   */
  clearBuffer(): void {
    this.pickupBuffer = [];
    console.log('✅ Pickup buffer cleared after upload');
  }

  /**
   * Reset session (new app launch)
   */
  resetSession(): void {
    this.sessionId = this.generateSessionId();
    this.pickupBuffer = [];
    this.aggregatedData = [];
  }

  /**
   * Get session ID (for debugging)
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

export default new PickupAggregator();
export type { AggregatedPickup, PickupEvent };
