'use client';

import { useCallback, useEffect, useState } from 'react';

export type Orientation = {
  // 0 = North, 90 = East, 180 = South, 270 = West (clockwise from North).
  azimuthDeg: number;
  // Pitch: 0 = level, +90 = pointed straight up, -90 = straight down.
  tiltDeg: number;
};

// DeviceOrientation hook. iOS Safari requires a user gesture to grant
// permission via DeviceOrientationEvent.requestPermission; Android grants
// it implicitly. requestPermission() should be called from a click handler.
//
// The compass-heading question is OS-dependent:
//   - iOS exposes `webkitCompassHeading` (already North-relative, 0-360)
//   - Android only gives `alpha` (rotation around Z), needs absolute=true
//     and a calibration step to be North-relative. Documented under
//     "compass calibration is painful" in the design stub.
//
// This hook returns the best-effort heading without further calibration.
// Future work (sub-project C / brainstorm): MPU6050-style fused readings
// and the "point at a known landmark" calibration UX.

declare global {
  interface DeviceOrientationEventStatic {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  }
  // iOS-only field; not in the standard DeviceOrientationEvent types.
  interface DeviceOrientationEvent {
    webkitCompassHeading?: number;
  }
}

export function useDeviceOrientation(): {
  orientation: Orientation | null;
  permissionState: 'unknown' | 'granted' | 'denied' | 'unsupported';
  requestPermission: () => Promise<void>;
  error: string | null;
} {
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  const [permissionState, setPermissionState] = useState<
    'unknown' | 'granted' | 'denied' | 'unsupported'
  >('unknown');
  const [error, setError] = useState<string | null>(null);

  const startListening = useCallback(() => {
    const handler = (ev: DeviceOrientationEvent) => {
      // iOS: webkitCompassHeading is already North-relative.
      // Android: alpha is from device's reference, needs calibration to map.
      const azimuthDeg =
        typeof ev.webkitCompassHeading === 'number'
          ? ev.webkitCompassHeading
          : ev.alpha != null
            ? (360 - ev.alpha) % 360 // Android: invert + wrap
            : 0;
      // Beta = front-to-back tilt, -180..180. Subtract 90 so "phone held up
      // looking at horizon" reads as 0, level reads as -90.
      const tiltDeg = ev.beta != null ? ev.beta - 90 : 0;
      setOrientation({ azimuthDeg, tiltDeg });
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const DOE = window.DeviceOrientationEvent as unknown as
      | DeviceOrientationEventStatic
      | undefined;
    if (!DOE) {
      setPermissionState('unsupported');
      setError('Device orientation not supported on this browser.');
      return;
    }
    // iOS path: explicit permission request from a user gesture.
    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission();
        if (result === 'granted') {
          setPermissionState('granted');
          startListening();
        } else {
          setPermissionState('denied');
          setError('Permission denied.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    // Non-iOS: no explicit request needed; just attach.
    setPermissionState('granted');
    startListening();
  }, [startListening]);

  useEffect(() => {
    // Auto-attach for non-iOS on mount. iOS won't fire events until
    // requestPermission() is awaited from a user gesture.
    if (typeof window === 'undefined') return;
    const DOE = window.DeviceOrientationEvent as unknown as
      | DeviceOrientationEventStatic
      | undefined;
    if (DOE && typeof DOE.requestPermission !== 'function') {
      setPermissionState('granted');
      return startListening();
    }
  }, [startListening]);

  return { orientation, permissionState, requestPermission, error };
}
