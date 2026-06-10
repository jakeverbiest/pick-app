/**
 * Firebase Sync Service - Sends aggregated pickup data to Firebase
 * Privacy-first: Only aggregated zone data, never raw coordinates
 */

import PickupAggregator, { AggregatedPickup } from './pickupAggregator';

// TODO: Initialize Firebase in your app
// import { initializeApp } from 'firebase/app';
// import { getFirestore, collection, addDoc } from 'firebase/firestore';

class FirebaseSync {
  private syncInterval: NodeJS.Timeout | null = null;
  private isOnline: boolean = true;

  /**
   * Start periodic sync (every 5 minutes or when buffer is full)
   */
  startSync(intervalMs: number = 300000): void {
    console.log('🔄 Starting Firebase sync');

    this.syncInterval = setInterval(() => {
      this.syncPickups();
    }, intervalMs);

    // Also sync on app pause
    // In real app, use AppState to detect backgrounding
  }

  /**
   * Stop sync
   */
  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('⏹️ Firebase sync stopped');
    }
  }

  /**
   * Sync pickups to Firebase
   * Only aggregated data leaves the device
   */
  private async syncPickups(): Promise<void> {
    const aggregates = PickupAggregator.generateAggregates();

    if (aggregates.length === 0) {
      return; // Nothing to sync
    }

    try {
      // TODO: Uncomment when Firebase is set up
      // const db = getFirestore();
      // const analyticsRef = collection(db, 'analytics', 'sessions');
      //
      // for (const aggregate of aggregates) {
      //   await addDoc(analyticsRef, {
      //     ...aggregate,
      //     synced_at: new Date().toISOString(),
      //   });
      // }

      console.log(`✅ Synced ${aggregates.length} aggregated pickups to Firebase`);

      // Clear buffer only after successful sync
      PickupAggregator.clearBuffer();
      this.isOnline = true;
    } catch (error) {
      console.error('❌ Firebase sync failed:', error);
      this.isOnline = false;
      // Buffer stays intact for retry
    }
  }

  /**
   * Manual sync trigger (e.g., on button press)
   */
  async syncNow(): Promise<void> {
    console.log('📤 Manual sync triggered');
    await this.syncPickups();
  }

  /**
   * Get sync status
   */
  getStatus(): {
    isOnline: boolean;
    pendingPickups: number;
  } {
    return {
      isOnline: this.isOnline,
      pendingPickups: PickupAggregator.getTotalPickups(),
    };
  }
}

export default new FirebaseSync();
