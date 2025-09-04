// //Early version, may not be best...

// import { useState, useEffect, useCallback } from 'react';
// import {
//   fetchWebcamsNearSunset,
//   fetchAllWebcams,
// } from '../lib/webcam-api';
// import type { Location, Webcam } from '../lib/types';

// interface UseWebcamsReturn {
//   webcams: Webcam[];
//   isLoading: boolean;
//   error: string | null;
//   selectedWebcam: Webcam | null;
//   selectWebcam: (webcam: Webcam | null) => void;
//   refresh: () => void;
// }

// interface UseWebcamsOptions {
//   radiusKm?: number;
//   onlySunset?: boolean;
//   autoRefresh?: boolean;
// }

// /**
//  * Custom hook to manage webcam data and selection
//  * Fetches webcams based on location and sunset status
//  */
// export function useWebcams(
//   userLocation?: Location,
//   options: UseWebcamsOptions = {}
// ): UseWebcamsReturn {
//   const { radiusKm, onlySunset = true, autoRefresh = true } = options;

//   const [webcams, setWebcams] = useState<Webcam[]>([]);
//   const [isLoading, setIsLoading] = useState(true);
//   const [error, setError] = useState<string | null>(null);
//   const [selectedWebcam, setSelectedWebcam] = useState<Webcam | null>(
//     null
//   );

//   const fetchWebcams = useCallback(async () => {
//     try {
//       setIsLoading(true);
//       setError(null);

//       let result;
//       if (onlySunset && userLocation) {
//         result = await fetchWebcamsNearSunset(userLocation, radiusKm);
//       } else {
//         result = await fetchAllWebcams();
//       }

//       setWebcams(result.webcams);
//     } catch (err) {
//       setError('Failed to fetch webcams');
//       console.error('Webcam fetch error:', err);
//     } finally {
//       setIsLoading(false);
//     }
//   }, [userLocation, radiusKm, onlySunset]);

//   // Fetch webcams on mount and when dependencies change
//   useEffect(() => {
//     fetchWebcams();
//   }, [fetchWebcams]);

//   // Set up auto-refresh every 2 minutes if enabled
//   useEffect(() => {
//     if (!autoRefresh) return;

//     const interval = setInterval(fetchWebcams, 2 * 60 * 1000);
//     return () => clearInterval(interval);
//   }, [fetchWebcams, autoRefresh]);

//   const selectWebcam = useCallback((webcam: Webcam | null) => {
//     setSelectedWebcam(webcam);
//   }, []);

//   const refresh = useCallback(() => {
//     fetchWebcams();
//   }, [fetchWebcams]);

//   return {
//     webcams,
//     isLoading,
//     error,
//     selectedWebcam,
//     selectWebcam,
//     refresh,
//   };
// }
