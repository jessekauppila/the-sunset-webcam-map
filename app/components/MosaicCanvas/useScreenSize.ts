import { useEffect, useState } from 'react';
import type { ScreenSize, ResponsiveConfig } from './types';

/**
 * Hook to detect screen size and return responsive configuration
 */
export function useScreenSize(
  canvasWidth: number,
  canvasHeight: number
): ResponsiveConfig {
  const [screenSize, setScreenSize] = useState<ScreenSize>('desktop');

  useEffect(() => {
    const determineScreenSize = () => {
      const width = window.innerWidth;

      if (width < 640) {
        setScreenSize('mobile');
      } else if (width < 1024) {
        setScreenSize('tablet');
      } else if (width < 1920) {
        setScreenSize('desktop');
      } else {
        setScreenSize('large');
      }
    };

    // Initial check
    determineScreenSize();

    // Listen for window resize
    window.addEventListener('resize', determineScreenSize);
    return () =>
      window.removeEventListener('resize', determineScreenSize);
  }, []);

  // Return responsive configuration based on screen size
  return getResponsiveConfig(screenSize, canvasWidth, canvasHeight);
}

/**
 * Get responsive configuration based on screen size
 */
export function getResponsiveConfig(
  screenSize: ScreenSize,
  canvasWidth: number,
  canvasHeight: number
): ResponsiveConfig {
  switch (screenSize) {
    case 'mobile':
      return {
        screenSize,
        baseHeight: Math.min(60, canvasHeight / 8), // Smaller images on mobile
        minRows: 2,
        maxRows: 8,
        padding: 1,
        maxImages: 40,
      };

    case 'tablet':
      return {
        screenSize,
        baseHeight: Math.min(80, canvasHeight / 10),
        minRows: 3,
        maxRows: 12,
        padding: 2,
        maxImages: 60,
      };

    case 'desktop':
      return {
        screenSize,
        baseHeight: Math.min(100, canvasHeight / 12),
        minRows: 3,
        maxRows: 15,
        padding: 2,
        maxImages: 90,
      };

    case 'large':
      return {
        screenSize,
        baseHeight: Math.min(150, canvasHeight / 15),
        minRows: 4,
        maxRows: 20,
        padding: 3,
        maxImages: 120,
      };

    default:
      return {
        screenSize: 'desktop',
        baseHeight: 100,
        minRows: 3,
        maxRows: 15,
        padding: 2,
        maxImages: 90,
      };
  }
}
