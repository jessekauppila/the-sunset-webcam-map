import type { WindyWebcam } from '../../../lib/types';
import { renderAiRatingBlock } from './aiRatingBlock';

/**
 * Format an ISO timestamp as a short relative-time label for the popup.
 * Thresholds: <60s → "Ns ago", <60min → "Nm ago", <24h → "Nh ago",
 * else absolute YYYY-MM-DD date.
 */
function formatCapturedAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const deltaSec = Math.max(0, Math.floor((now - then) / 1000));

  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 60 * 60) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 24 * 60 * 60) return `${Math.floor(deltaSec / 3600)}h ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Creates HTML content for a Mapbox popup displaying webcam information.
 * Returns a string of HTML markup that Mapbox GL JS can render.
 *
 * Features enhanced image handling similar to WebcamDisplay component:
 * - Better error handling for failed image loads
 * - CORS support
 * - Fallback UI with gradient background
 * - Responsive design with title overlay
 *
 * @param webcam - The webcam data to display
 * @returns HTML string for the popup content
 */
export function createWebcamPopupContent(
  webcam: WindyWebcam
): string {
  const hasImage = webcam.images?.current?.preview;

  const capturedSection =
    webcam.liveAssetKind === 'custom_snapshot' && webcam.latestSnapshotCapturedAt
      ? `<p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;line-height: 1;">Captured ${formatCapturedAgo(webcam.latestSnapshotCapturedAt)}</p>`
      : '';

  // Helper function to format location
  const formatLocation = () => {
    const parts = [];
    if (webcam.location?.city) parts.push(webcam.location.city);
    if (webcam.location?.region) parts.push(webcam.location.region);
    if (webcam.location?.country) parts.push(webcam.location.country);
    return parts.length > 0 ? parts.join(', ') : 'Unknown location';
  };

  // Helper function to format categories
  // const formatCategories = () => {
  //   if (webcam.categories && webcam.categories.length > 0) {
  //     return webcam.categories.map((cat) => cat.name).join(', ');
  //   }
  //   return null;
  // };

  // Helper function to format last updated
  const formatLastUpdated = () => {
    if (webcam.lastUpdatedOn) {
      return new Date(webcam.lastUpdatedOn).toLocaleDateString();
    }
    return 'Unknown';
  };

  // The popup currently shows a single rating + verdict. The "Binary" line
  // we used to render was a duplicate of regression (route.ts still writes
  // the same value to both columns). When the two-tier classifier ships
  // (see memory/project_two_tier_sunset_classification.md), the verdict
  // inside renderAiRatingBlock will swap from regression-threshold to
  // binary-score without changing the visual structure here.
  const aiRegression =
    typeof webcam.aiRatingRegression === 'number'
      ? webcam.aiRatingRegression
      : typeof webcam.aiRating === 'number'
      ? webcam.aiRating
      : null;
  const aiSection = renderAiRatingBlock({
    rating: aiRegression,
    modelVersion: webcam.aiModelVersionRegression ?? webcam.aiModelVersion ?? null,
    uniqueKey: webcam.webcamId,
  });

  if (hasImage) {
    return `
    <div style="width: 200px; background: #374151; border-radius: 2px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
        <!-- Image Section -->
        <div style="position: relative; width: 100%; height: 120px; padding: 8px; overflow: hidden;">
          <img 
            src="${webcam.images!.current!.preview}" 
            alt="${webcam.title}" 
            style="width: 100%; height: 100%; object-fit: contain; transition: opacity 0.3s ease;" 
            crossorigin="anonymous"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          />
          <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #ff6b35, #f7931e); display: none; align-items: center; justify-content: center; font-size: 48px; color: white;">
            🌅
          </div>
        </div>
        
        <!-- Details Section -->
        <div style="padding: 12px; background: #374151;">
          <!-- Title -->
          <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #f9fafb; line-height: 1;">
            ${webcam.title}
          </h3>
          
          <!-- Location -->
          <p style="margin: 0 0 6px 0; font-size: 11px; color: #d1d5db;line-height: 1;">
            ${formatLocation()}
          </p>
          
          <!-- Last Updated -->
          <p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;line-height: 1;">
            Updated: ${formatLastUpdated()}
          </p>
          ${capturedSection}
          ${aiSection}
          
          <!-- ID -->
          <p style="margin: 0; font-size: 10px; color: #9ca3af;line-height: 1;">
            ID: ${webcam.webcamId}
          </p>
        </div>
    </div>
    `;
  }

  return `
    <div style="width: 200px; background: #374151; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
      <!-- Image Section -->
      <div style="position: relative; width: 100%; height: 160px; padding: 8px; overflow: hidden;">
        <div style="position: absolute; top: 8px; left: 8px; right: 8px; bottom: 8px; background: linear-gradient(135deg, #ff6b35, #f7931e); display: flex; align-items: center; justify-content: center; font-size: 48px; color: white; border-radius: 4px;">
          🌅
        </div>
      </div>
      
      <!-- Details Section -->
      <div style="padding: 12px;">
        <!-- Title -->
        <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #f9fafb; line-height: 1;">
          ${webcam.title}
        </h3>
        
        <!-- Location -->
        <p style="margin: 0 0 6px 0; font-size: 11px; color: #d1d5db;line-height: 1;">
          ${formatLocation()}
        </p>
        
        <!-- Last Updated -->
        <p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;line-height: 1;">
          Updated: ${formatLastUpdated()}
        </p>
        ${aiSection}
        
        <!-- ID -->
        <p style="margin: 0; font-size: 10px; color: #9ca3af;line-height: 1;">
          ID: ${webcam.webcamId}
        </p>
      </div>
    </div>
  `;
}
