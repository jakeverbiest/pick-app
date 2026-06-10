/**
 * Aggregation Flow Test
 * Validates: GPS → Zone extraction → Hourly bucketing → Aggregation
 * No raw coordinates stored, only aggregated metrics
 */

import PickupAggregator from './pickupAggregator';
import ZoneManager from './zoneManager';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

class AggregationFlowTest {
  private results: TestResult[] = [];

  /**
   * Test 1: Zone mapping from GPS coordinates
   */
  testZoneMapping(): void {
    console.log('\n🧪 TEST 1: Zone Mapping');

    // Lower East Side coordinates
    const les = ZoneManager.getZoneFromCoordinates(40.6750, -73.9850);
    this.logResult('Lower East Side detection', les === 'lower_east_side',
      `Expected 'lower_east_side', got '${les}'`);

    // East Village coordinates
    const ev = ZoneManager.getZoneFromCoordinates(40.7050, -73.9850);
    this.logResult('East Village detection', ev === 'east_village',
      `Expected 'east_village', got '${ev}'`);

    // Midtown coordinates
    const mt = ZoneManager.getZoneFromCoordinates(40.7480, -73.9750);
    this.logResult('Midtown detection', mt === 'midtown',
      `Expected 'midtown', got '${mt}'`);

    // Upper East Side coordinates
    const ues = ZoneManager.getZoneFromCoordinates(40.7850, -73.9550);
    this.logResult('Upper East Side detection', ues === 'upper_east_side',
      `Expected 'upper_east_side', got '${ues}'`);

    // Outside all zones
    const outside = ZoneManager.getZoneFromCoordinates(40.5, -74.0);
    this.logResult('Outside zone detection', outside === null,
      `Expected null, got '${outside}'`);
  }

  /**
   * Test 2: Single pickup aggregation
   */
  testSinglePickup(): void {
    console.log('\n🧪 TEST 2: Single Pickup Aggregation');

    PickupAggregator.resetSession();

    const pickup = {
      timestamp: Date.now(),
      latitude: 40.6750,
      longitude: -73.9850,
      magnitude: 2.5,
      confidence: 75,
    };

    PickupAggregator.addPickup(pickup);

    const aggregates = PickupAggregator.generateAggregates();
    this.logResult('Single aggregate created', aggregates.length === 1,
      `Expected 1 aggregate, got ${aggregates.length}`);

    if (aggregates.length > 0) {
      const agg = aggregates[0];
      this.logResult('Zone ID correct', agg.zone_id === 'lower_east_side',
        `Expected 'lower_east_side', got '${agg.zone_id}'`);
      this.logResult('Pickup count correct', agg.pickups_count === 1,
        `Expected 1, got ${agg.pickups_count}`);
      this.logResult('No raw coordinates in aggregate', !('latitude' in agg) && !('longitude' in agg),
        `Raw coordinates found in aggregate`);
    }

    const byZone = PickupAggregator.getAggregatesByZone();
    this.logResult('Zone display aggregate', byZone['lower_east_side'] === 1,
      `Expected 1 pickup in lower_east_side, got ${byZone['lower_east_side']}`);
  }

  /**
   * Test 3: Multiple pickups in same zone aggregate correctly
   */
  testMultiplePickupsSameZone(): void {
    console.log('\n🧪 TEST 3: Multiple Pickups Same Zone');

    PickupAggregator.resetSession();

    // 3 pickups in Lower East Side, same hour
    for (let i = 0; i < 3; i++) {
      PickupAggregator.addPickup({
        timestamp: Date.now(),
        latitude: 40.6750 + (i * 0.0001), // Tiny variation, same zone
        longitude: -73.9850 + (i * 0.0001),
        magnitude: 2.5,
        confidence: 75,
      });
    }

    const aggregates = PickupAggregator.generateAggregates();
    this.logResult('Single aggregate for same zone/hour', aggregates.length === 1,
      `Expected 1 aggregate, got ${aggregates.length}`);

    if (aggregates.length > 0) {
      this.logResult('Pickup count is 3', aggregates[0].pickups_count === 3,
        `Expected 3, got ${aggregates[0].pickups_count}`);
    }

    const byZone = PickupAggregator.getAggregatesByZone();
    this.logResult('Zone total is 3', byZone['lower_east_side'] === 3,
      `Expected 3, got ${byZone['lower_east_side']}`);
  }

  /**
   * Test 4: Pickups in different zones aggregate separately
   */
  testMultipleZones(): void {
    console.log('\n🧪 TEST 4: Multiple Zones');

    PickupAggregator.resetSession();

    // Pickup in Lower East Side
    PickupAggregator.addPickup({
      timestamp: Date.now(),
      latitude: 40.6750,
      longitude: -73.9850,
      magnitude: 2.5,
      confidence: 75,
    });

    // Pickup in East Village
    PickupAggregator.addPickup({
      timestamp: Date.now(),
      latitude: 40.7050,
      longitude: -73.9850,
      magnitude: 2.5,
      confidence: 75,
    });

    // Pickup in Midtown
    PickupAggregator.addPickup({
      timestamp: Date.now(),
      latitude: 40.7480,
      longitude: -73.9750,
      magnitude: 2.5,
      confidence: 75,
    });

    const aggregates = PickupAggregator.generateAggregates();
    this.logResult('Three separate aggregates', aggregates.length === 3,
      `Expected 3 aggregates, got ${aggregates.length}`);

    const zones = new Set(aggregates.map(a => a.zone_id));
    this.logResult('Three different zones', zones.size === 3,
      `Expected 3 unique zones, got ${zones.size}`);

    const byZone = PickupAggregator.getAggregatesByZone();
    const totalPickups = Object.values(byZone).reduce((a, b) => a + b, 0);
    this.logResult('Total pickups is 3', totalPickups === 3,
      `Expected 3 total, got ${totalPickups}`);
  }

  /**
   * Test 5: Session ID is ephemeral
   */
  testEphemeralSessionId(): void {
    console.log('\n🧪 TEST 5: Ephemeral Session ID');

    PickupAggregator.resetSession();
    const sessionId1 = PickupAggregator.getSessionId();

    PickupAggregator.resetSession();
    const sessionId2 = PickupAggregator.getSessionId();

    this.logResult('Session IDs are different', sessionId1 !== sessionId2,
      `Both sessions got ID: ${sessionId1}`);

    this.logResult('Session ID has session- prefix', sessionId1.startsWith('session-'),
      `Expected session- prefix, got: ${sessionId1}`);
  }

  /**
   * Test 6: Buffer clears after generateAggregates
   */
  testBufferClearance(): void {
    console.log('\n🧪 TEST 6: Buffer Clearance');

    PickupAggregator.resetSession();

    PickupAggregator.addPickup({
      timestamp: Date.now(),
      latitude: 40.6750,
      longitude: -73.9850,
      magnitude: 2.5,
      confidence: 75,
    });

    const before = PickupAggregator.getTotalPickups();
    this.logResult('Buffer has 1 pickup before clear', before === 1,
      `Expected 1, got ${before}`);

    PickupAggregator.generateAggregates();
    PickupAggregator.clearBuffer();

    const after = PickupAggregator.getTotalPickups();
    this.logResult('Buffer is empty after clear', after === 0,
      `Expected 0, got ${after}`);
  }

  /**
   * Test 7: Hourly bucketing
   */
  testHourlyBucketing(): void {
    console.log('\n🧪 TEST 7: Hourly Bucketing');

    PickupAggregator.resetSession();

    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Pickup at current hour
    PickupAggregator.addPickup({
      timestamp: now,
      latitude: 40.6750,
      longitude: -73.9850,
      magnitude: 2.5,
      confidence: 75,
    });

    // Pickup one hour ago (different bucket)
    PickupAggregator.addPickup({
      timestamp: oneHourAgo,
      latitude: 40.6750,
      longitude: -73.9850,
      magnitude: 2.5,
      confidence: 75,
    });

    const aggregates = PickupAggregator.generateAggregates();
    this.logResult('Two aggregates for different hours', aggregates.length === 2,
      `Expected 2 aggregates, got ${aggregates.length}`);

    const hourBuckets = new Set(aggregates.map(a => a.hour_bucket));
    this.logResult('Two different hour buckets', hourBuckets.size === 2,
      `Expected 2 different hours, got ${hourBuckets.size}`);
  }

  /**
   * Log a test result
   */
  private logResult(name: string, passed: boolean, details: string): void {
    const result: TestResult = { name, passed, details };
    this.results.push(result);

    const icon = passed ? '✅' : '❌';
    console.log(`  ${icon} ${name}${passed ? '' : ': ' + details}`);
  }

  /**
   * Print summary
   */
  printSummary(): { passed: number; total: number; results: TestResult[] } {
    console.log('\n' + '='.repeat(60));
    console.log('AGGREGATION FLOW TEST SUMMARY');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;

    this.results.forEach(r => {
      const icon = r.passed ? '✅' : '❌';
      console.log(`${icon} ${r.name}`);
    });

    console.log('='.repeat(60));
    console.log(`RESULT: ${passed}/${total} tests passed`);

    if (passed === total) {
      console.log('✨ Aggregation flow is working correctly!');
    } else {
      console.log(`⚠️ ${total - passed} test(s) failed`);
    }
    console.log('='.repeat(60));

    return {
      passed,
      total,
      results: this.results,
    };
  }
}

// Run tests
export function runAggregationTests() {
  const tester = new AggregationFlowTest();

  tester.testZoneMapping();
  tester.testSinglePickup();
  tester.testMultiplePickupsSameZone();
  tester.testMultipleZones();
  tester.testEphemeralSessionId();
  tester.testBufferClearance();
  tester.testHourlyBucketing();

  const summary = tester.printSummary();
  return summary;
}

export default AggregationFlowTest;
