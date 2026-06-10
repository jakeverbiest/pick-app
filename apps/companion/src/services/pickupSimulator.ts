/**
 * Pickup Simulator - For testing aggregation without motion detection
 * Allows manual simulation of pickups at specific coordinates
 */

import PickupAggregator from './pickupAggregator';

interface SimulationConfig {
  zone: 'lower_east_side' | 'east_village' | 'midtown' | 'upper_east_side';
  count: number;
  delay?: number; // ms between pickups
}

// Zone coordinates for simulation
const ZONE_COORDINATES: { [key: string]: { lat: number; lon: number } } = {
  lower_east_side: { lat: 40.6750, lon: -73.9850 },
  east_village: { lat: 40.7050, lon: -73.9850 },
  midtown: { lat: 40.7480, lon: -73.9750 },
  upper_east_side: { lat: 40.7850, lon: -73.9550 },
};

class PickupSimulator {
  /**
   * Simulate a single pickup
   */
  simulatePickup(zone: string): void {
    const coords = ZONE_COORDINATES[zone];
    if (!coords) {
      console.warn(`Unknown zone: ${zone}`);
      return;
    }

    // Add slight random variation to coordinates
    const lat = coords.lat + (Math.random() * 0.0002 - 0.0001);
    const lon = coords.lon + (Math.random() * 0.0002 - 0.0001);

    PickupAggregator.addPickup({
      timestamp: Date.now(),
      latitude: lat,
      longitude: lon,
      magnitude: 2.5 + Math.random() * 1.0,
      confidence: 70 + Math.random() * 25,
    });

    console.log(`🎯 Simulated pickup in ${zone}`);
  }

  /**
   * Simulate multiple pickups with delay
   */
  async simulatePickups(config: SimulationConfig): Promise<void> {
    const delay = config.delay || 500;

    console.log(`🎬 Starting simulation: ${config.count} pickups in ${config.zone}`);

    for (let i = 0; i < config.count; i++) {
      this.simulatePickup(config.zone);
      if (i < config.count - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.log(`✅ Simulation complete`);
  }

  /**
   * Simulate a pickup journey (multiple zones)
   */
  async simulateJourney(): Promise<void> {
    console.log('🗺️ Simulating a collection route...');

    // Start in Lower East Side
    await this.simulatePickups({ zone: 'lower_east_side', count: 3, delay: 300 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Move to East Village
    await this.simulatePickups({ zone: 'east_village', count: 4, delay: 300 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Move to Midtown
    await this.simulatePickups({ zone: 'midtown', count: 2, delay: 300 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Move to Upper East Side
    await this.simulatePickups({ zone: 'upper_east_side', count: 3, delay: 300 });

    console.log('✨ Route simulation complete');
  }

  /**
   * Get available zones
   */
  getAvailableZones(): string[] {
    return Object.keys(ZONE_COORDINATES);
  }
}

export default new PickupSimulator();
