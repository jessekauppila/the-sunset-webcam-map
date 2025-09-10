import type { WindyWebcam } from '../../../lib/types';

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

  // Helper function to format location
  const formatLocation = () => {
    const parts = [];
    if (webcam.location?.city) parts.push(webcam.location.city);
    if (webcam.location?.region) parts.push(webcam.location.region);
    if (webcam.location?.country) parts.push(webcam.location.country);
    return parts.length > 0 ? parts.join(', ') : 'Unknown location';
  };

  // Helper function to format categories
  const formatCategories = () => {
    if (webcam.categories && webcam.categories.length > 0) {
      return webcam.categories.map((cat) => cat.name).join(', ');
    }
    return null;
  };

  // Helper function to format last updated
  const formatLastUpdated = () => {
    if (webcam.lastUpdatedOn) {
      return new Date(webcam.lastUpdatedOn).toLocaleDateString();
    }
    return 'Unknown';
  };

  if (hasImage) {
    return `
        <!-- Image Section -->
        <div style="position: relative; width: 100%; height: 120px; overflow: hidden;">
          <img 
            src="${webcam.images!.current!.preview}" 
            alt="${webcam.title}" 
            style="width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s ease;" 
            crossorigin="anonymous"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          />
          <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #ff6b35, #f7931e); display: none; align-items: center; justify-content: center; font-size: 48px; color: white;">
            🌅
          </div>
        </div>
        
        <!-- Details Section -->
        <div style="padding: 12px;">
          <!-- Title -->
          <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #1f2937; line-height: 1.3;">
            ${webcam.title}
          </h3>
          
          <!-- Location -->
          <p style="margin: 0 0 6px 0; font-size: 11px; color: #6b7280;">
            📍 ${formatLocation()}
          </p>
          
          <!-- Views and Status -->
          <p style="margin: 0 0 4px 0; font-size: 11px; color: #6b7280;">
            📊 Views: ${webcam.viewCount?.toLocaleString() || 'N/A'}
          </p>
          <p style="margin: 0 0 6px 0; font-size: 11px; color: #9ca3af;">
            🎥 Status: ${webcam.status || 'Unknown'}
          </p>
          
          <!-- Categories -->
          ${
            formatCategories()
              ? `
            <p style="margin: 0 0 6px 0; font-size: 11px; color: #2563eb;">
              🏷️ ${formatCategories()}
            </p>
          `
              : ''
          }
          
          <!-- Last Updated -->
          <p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;">
            🕒 Updated: ${formatLastUpdated()}
          </p>
          
          <!-- ID -->
          <p style="margin: 0; font-size: 10px; color: #9ca3af;">
            ID: ${webcam.webcamId}
          </p>
        </div>
    `;
  }

  return `
    <div style="width: 280px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
      <!-- Image Section -->
      <div style="position: relative; width: 100%; height: 160px; overflow: hidden;">
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #ff6b35, #f7931e); display: flex; align-items: center; justify-content: center; font-size: 48px; color: white;">
          🌅
        </div>
      </div>
      
      <!-- Details Section -->
      <div style="padding: 12px;">
        <!-- Title -->
        <h3 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #1f2937; line-height: 1.3;">
          ${webcam.title}
        </h3>
        
        <!-- Location -->
        <p style="margin: 0 0 6px 0; font-size: 11px; color: #6b7280;">
          📍 ${formatLocation()}
        </p>
        
        <!-- Views and Status -->
        <p style="margin: 0 0 4px 0; font-size: 11px; color: #6b7280;">
          📊 Views: ${webcam.viewCount?.toLocaleString() || 'N/A'}
        </p>
        <p style="margin: 0 0 6px 0; font-size: 11px; color: #9ca3af;">
          🎥 Status: ${webcam.status || 'Unknown'}
        </p>
        
        <!-- Categories -->
        ${
          formatCategories()
            ? `
          <p style="margin: 0 0 6px 0; font-size: 11px; color: #2563eb;">
            🏷️ ${formatCategories()}
          </p>
        `
            : ''
        }
        
        <!-- Last Updated -->
        <p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;">
          🕒 Updated: ${formatLastUpdated()}
        </p>
        
        <!-- ID -->
        <p style="margin: 0; font-size: 10px; color: #9ca3af;">
          ID: ${webcam.webcamId}
        </p>
      </div>
    </div>
  `;
}
