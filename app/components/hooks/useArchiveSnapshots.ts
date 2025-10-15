'use client';

import { useEffect, useRef } from 'react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';

const DEBOUNCE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Hook that automatically captures and archives terminator webcam snapshots
 * Filters for webcams with rating >= 4 and debounces captures to every 15 minutes
 */
export function useArchiveSnapshots() {
  const combined = useTerminatorStore((state) => state.combined);
  const lastCaptureTimeRef = useRef<number>(0);
  const captureInProgressRef = useRef<boolean>(false);

  useEffect(() => {
    const captureSnapshots = async () => {
      // Skip if capture is already in progress
      if (captureInProgressRef.current) {
        console.log(
          'Snapshot capture already in progress, skipping...'
        );
        return;
      }

      // Check debounce
      const now = Date.now();
      const timeSinceLastCapture = now - lastCaptureTimeRef.current;

      if (timeSinceLastCapture < DEBOUNCE_MS) {
        const remainingMinutes = Math.ceil(
          (DEBOUNCE_MS - timeSinceLastCapture) / 60000
        );
        console.log(
          `Skipping snapshot capture. Next capture in ${remainingMinutes} minutes`
        );
        return;
      }

      // Filter webcams with rating >= 4
      const webcamsToCapture = combined.filter(
        (webcam) => webcam.rating && webcam.rating >= 4
      );

      if (webcamsToCapture.length === 0) {
        console.log('No webcams with rating >= 4 to capture');
        return;
      }

      console.log(
        `Capturing ${webcamsToCapture.length} webcam snapshots with rating >= 4...`
      );

      try {
        captureInProgressRef.current = true;

        const response = await fetch('/api/snapshots/capture', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webcams: webcamsToCapture,
          }),
        });

        if (!response.ok) {
          throw new Error(`Capture failed: ${response.statusText}`);
        }

        const result = await response.json();

        console.log(
          `Snapshot capture complete. Success: ${result.success}, Failed: ${result.failed}`
        );

        if (result.errors && result.errors.length > 0) {
          console.error('Capture errors:', result.errors);
        }

        // Update last capture time on success
        lastCaptureTimeRef.current = Date.now();
      } catch (error) {
        console.error('Error capturing snapshots:', error);
      } finally {
        captureInProgressRef.current = false;
      }
    };

    // Only trigger if we have webcams
    if (combined.length > 0) {
      captureSnapshots();
    }
  }, [combined]);
}
