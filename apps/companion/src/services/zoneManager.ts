/**
 * Zone Manager - Maps GPS coordinates to neighborhood zones
 * Privacy-safe: Uses coarse zones, never stores individual coordinates
 */

interface Zone {
  id: string;
  name: string;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

// NYC neighborhoods (simplified for testing)
// Expanded by 0.005 degrees (~500m) to handle GPS accuracy variation
const ZONES: Zone[] = [
  {
    id: 'lower_east_side',
    name: 'Lower East Side',
    bounds: { minLat: 40.6675, maxLat: 40.6870, minLon: -74.0000, maxLon: -73.9700 },
  },
  {
    id: 'east_village',
    name: 'East Village',
    bounds: { minLat: 40.6770, maxLat: 40.7330, minLon: -74.0000, maxLon: -73.9700 },
  },
  {
    id: 'midtown',
    name: 'Midtown',
    bounds: { minLat: 40.7230, maxLat: 40.7730, minLon: -73.9900, maxLon: -73.9600 },
  },
  {
    id: 'upper_east_side',
    name: 'Upper East Side',
    bounds: { minLat: 40.7630, maxLat: 40.8100, minLon: -73.9700, maxLon: -73.9400 },
  },
];

class ZoneManager {
  /**
   * Determine zone from GPS coordinates
   * Returns zone ID if match found, null otherwise
   */
  getZoneFromCoordinates(latitude: number, longitude: number): string | null {
    for (const zone of ZONES) {
      const { minLat, maxLat, minLon, maxLon } = zone.bounds;
      if (latitude >= minLat && latitude <= maxLat && longitude >= minLon && longitude <= maxLon) {
        return zone.id;
      }
    }
    return null;
  }

  /**
   * Get zone details
   */
  getZone(zoneId: string): Zone | undefined {
    return ZONES.find((z) => z.id === zoneId);
  }

  /**
   * Get all zones
   */
  getAllZones(): Zone[] {
    return [...ZONES];
  }

  /**
   * Add custom zones (for expansion to other cities)
   */
  addZone(zone: Zone): void {
    const exists = ZONES.find((z) => z.id === zone.id);
    if (!exists) {
      ZONES.push(zone);
    }
  }
}

export default new ZoneManager();
export type { Zone };
