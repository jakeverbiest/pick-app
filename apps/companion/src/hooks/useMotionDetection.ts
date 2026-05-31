/**
 * React Hook for Motion Detection
 *
 * Usage:
 * const { pickupCount, isListening, start, stop, accuracy } = useMotionDetection();
 */

import { useEffect, useRef, useState } from 'react';
import motionDetector, { PickupEvent } from '../services/motionDetection';

interface UseMotionDetectionReturn {
  pickupCount: number;
  isListening: boolean;
  lastPickups: PickupEvent[];
  accuracy: {
    detected: number;
    manual: number;
    percent: number;
  } | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
  recordManualPickup: (count: number) => void;
  error: string | null;
}

/**
 * Hook: useMotionDetection
 * Manages motion detection lifecycle and state
 */
export function useMotionDetection(): UseMotionDetectionReturn {
  const [pickupCount, setPickupCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [lastPickups, setLastPickups] = useState<PickupEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualPickupCount, setManualPickupCount] = useState(0);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Start motion detection
   */
  const start = () => {
    try {
      setError(null);
      motionDetector.reset();
      setPickupCount(0);
      setLastPickups([]);
      setManualPickupCount(0);

      motionDetector.startListening(
        (event) => {
          // On pickup detected
          console.log('Pickup detected via hook:', event);
        },
        (err) => {
          // On error
          setError(err);
        }
      );

      setIsListening(true);

      // Update UI every 500ms with latest counts
      updateIntervalRef.current = setInterval(() => {
        setPickupCount(motionDetector.getPickupCount());
        setLastPickups(motionDetector.getLastPickups(5));
      }, 500);
    } catch (err) {
      setError(String(err));
      setIsListening(false);
    }
  };

  /**
   * Stop motion detection
   */
  const stop = () => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
    motionDetector.stopListening();
    setIsListening(false);
  };

  /**
   * Reset session
   */
  const reset = () => {
    motionDetector.reset();
    setPickupCount(0);
    setLastPickups([]);
    setManualPickupCount(0);
    setError(null);
  };

  /**
   * Record manual pickup count (for field testing accuracy)
   */
  const recordManualPickup = (count: number) => {
    setManualPickupCount(count);
  };

  /**
   * Calculate accuracy if manual count is set
   */
  const accuracy = manualPickupCount > 0
    ? (() => {
        const metrics = motionDetector.getAccuracyMetrics(manualPickupCount);
        return {
          detected: metrics.detected,
          manual: metrics.manual,
          percent: Math.round(metrics.accuracy),
        };
      })()
    : null;

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stop();
    };
  }, []);

  return {
    pickupCount,
    isListening,
    lastPickups,
    accuracy,
    start,
    stop,
    reset,
    recordManualPickup,
    error,
  };
}
