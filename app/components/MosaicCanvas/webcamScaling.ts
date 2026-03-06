import type { WindyWebcam } from '@/app/lib/types';

/**
 * Calculate scale factor for a webcam based on its rating and view count
 *
 * @param webcam - The webcam to calculate scale for
 * @param maxViews - Maximum view count across all webcams (for normalization)
 * @param ratingSizeEffect - How much low ratings reduce size (0-1, default 0.75)
 * @param viewSizeEffect - How much low views reduce size (0-1, default 0.1)
 * @returns Scale factor between 0.2 and 1.0
 */
export function getWebcamScale(
  webcam: WindyWebcam,
  maxViews: number,
  ratingSizeEffect: number,
  viewSizeEffect: number
): number {
  // Start with maximum size (1.0) and scale DOWN based on lower ratings/views
  const maxSize = 1.0;

  // Prefer AI regression rating first, then legacy AI rating, then manual rating.
  const sourceRating =
    webcam.aiRatingRegression ?? webcam.aiRating ?? webcam.rating;

  // Calculate rating penalty (0-1 scale, where 0 = worst rating, 1 = best rating)
  let ratingPenalty = 0;
  if (sourceRating !== undefined && sourceRating !== null) {
    const clampedRating = Math.max(0, Math.min(5, sourceRating));
    ratingPenalty = 1 - clampedRating / 5; // Invert: 0 = best rating, 1 = worst rating
  }

  // Calculate view penalty (0-1 scale, where 0 = most views, 1 = least views)
  let viewPenalty = 0;
  if (maxViews > 0) {
    viewPenalty = 1 - Math.min(1, webcam.viewCount / maxViews); // Invert: 0 = most views, 1 = least views
  }

  // Debug logging for first few webcams
  if (webcam.webcamId <= 3) {
    console.log(
      `Webcam ${webcam.webcamId}: viewCount=${webcam.viewCount}, maxViews=${maxViews}, viewPenalty=${viewPenalty}, ratingPenalty=${ratingPenalty}`
    );
  }

  // Final scale: max size - penalties
  // Higher ratingSizeEffect/viewSizeEffect means more penalty for low ratings/views
  const finalScale =
    maxSize -
    ratingPenalty * ratingSizeEffect -
    viewPenalty * viewSizeEffect;

  // Ensure minimum scale to prevent images from becoming too small
  return Math.max(0.2, finalScale); // Minimum 20% of max size
}

function applyScaleMode(
  normalizedScale: number,
  scaleMode: 'linear',
  scaleStrength: number
): number {
  if (scaleMode === 'linear') {
    // Strength=1 keeps baseline linear mapping.
    // >1 increases spread, <1 compresses spread.
    const centered = (normalizedScale - 0.5) * scaleStrength + 0.5;
    return Math.max(0, Math.min(1, centered));
  }
  return normalizedScale;
}

/**
 * Calculate maximum view count from a list of webcams
 */
export function calculateMaxViews(webcams: WindyWebcam[]): number {
  if (webcams.length === 0) return 1;
  return Math.max(...webcams.map((w) => w.viewCount));
}

/**
 * Calculate dimensions for a single webcam image
 */
export function calculateWebcamDimensions(
  img: HTMLImageElement,
  webcam: WindyWebcam,
  baseHeight: number,
  maxViews: number,
  ratingSizeEffect: number,
  viewSizeEffect: number,
  maxWidth: number,
  minImageHeight: number,
  maxImageHeight: number,
  sizeScaleStrength: number,
  sizeScaleMode: 'linear'
): { width: number; height: number } {
  // Get combined rating and view-based scale factor
  const webcamScale = getWebcamScale(
    webcam,
    maxViews,
    ratingSizeEffect,
    viewSizeEffect
  );

  // Map normalized score into configured min/max height bounds.
  const boundedScale = applyScaleMode(
    webcamScale,
    sizeScaleMode,
    sizeScaleStrength
  );
  const targetHeight =
    minImageHeight + (maxImageHeight - minImageHeight) * boundedScale;

  // Calculate base dimensions preserving source aspect ratio.
  const imgAR = img.naturalWidth / img.naturalHeight;
  let imgHeight = Math.min(baseHeight, targetHeight);
  imgHeight = Math.max(minImageHeight, Math.min(maxImageHeight, imgHeight));
  let imgWidth = imgHeight * imgAR;

  // If image is too wide, scale down to fit (but maintain rating scale proportion)
  if (imgWidth > maxWidth) {
    const scaleDownFactor = maxWidth / imgWidth;
    imgWidth = maxWidth;
    imgHeight *= scaleDownFactor;
  }

  return { width: imgWidth, height: imgHeight };
}
