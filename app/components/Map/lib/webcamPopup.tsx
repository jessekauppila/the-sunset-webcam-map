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

  if (hasImage) {
    return `
      <div style="position: relative; width: 200px; height: 150px; overflow: hidden; margin: 0; padding: 0; border-radius: 8px;">
        <img 
          src="${webcam.images!.current!.preview}" 
          alt="${webcam.title}" 
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s ease;" 
          crossorigin="anonymous"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #ff6b35, #f7931e); display: none; align-items: center; justify-content: center; font-size: 48px; color: white;">
          🌅
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.7)); color: white; padding: 8px; font-size: 12px; font-weight: 500;">
          ${webcam.title}
        </div>
      </div>
    `;
  }

  return `
    <div style="position: relative; width: 200px; height: 150px; overflow: hidden; margin: 0; padding: 0; border-radius: 8px;">
      <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #ff6b35, #f7931e); display: flex; align-items: center; justify-content: center; font-size: 48px; color: white;">
        🌅
      </div>
      <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.7)); color: white; padding: 8px; font-size: 12px; font-weight: 500;">
        ${webcam.title}
      </div>
    </div>
  `;
}
