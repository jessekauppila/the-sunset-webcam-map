'use client';

import { useWebcamFetch } from './hooks/useWebCamFetch';
import type { Location } from '../lib/types';

interface SimpleMapProps {
  userLocation: Location;
}

//export default function SimpleMap({ userLocation }: SimpleMapProps)
export default function WebcamDisplay({ webcams }: SimpleMapProps) {
  //we don't need this as we are importing the webcams directly.

  // const { webcams, isLoading, error, totalCount } = useWebcamFetch(
  //   userLocation.lat,
  //   userLocation.lng
  // );

  return (
    <div className="p-4 bg-green-50 rounded-lg">
      <h3 className="text-lg font-bold text-green-800 mb-2">
        🌐 Windy API Results ({totalCount} webcams)
      </h3>

      {webcams.length === 0 ? (
        <p className="text-green-700">
          No webcams found in this area.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {webcams.slice(0, 6).map((webcam) => (
            <div
              key={webcam.webcamId}
              className="bg-white p-3 rounded border"
            >
              <h4 className="font-semibold text-sm mb-1">
                {webcam.title}
              </h4>

              {/* Location Info */}
              <p className="text-xs text-gray-600 mb-1">
                📍 {webcam.location?.city}, {webcam.location?.country}
              </p>

              {/* Views and Status */}
              <p className="text-xs text-gray-600">
                📊 Views:{' '}
                {webcam.viewCount?.toLocaleString() || 'N/A'}
              </p>
              <p className="text-xs text-gray-500">
                🎥 Status: {webcam.status || 'Unknown'}
              </p>

              {/* Categories */}
              {webcam.categories && webcam.categories.length > 0 && (
                <p className="text-xs text-blue-600">
                  🏷️{' '}
                  {webcam.categories
                    .map((cat) => cat.name)
                    .join(', ')}
                </p>
              )}

              {/* Last Updated */}
              <p className="text-xs text-gray-400">
                🕒 Updated:{' '}
                {webcam.lastUpdatedOn
                  ? new Date(
                      webcam.lastUpdatedOn
                    ).toLocaleDateString()
                  : 'Unknown'}
              </p>

              {/* ID */}
              <p className="text-xs text-gray-400">
                ID: {webcam.webcamId}
              </p>

              {/* Webcam Image */}
              {webcam.images?.current?.preview && (
                <img
                  src={webcam.images.current.preview}
                  alt={webcam.title}
                  className="w-full h-48 object-contain rounded mt-2"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {webcams.length > 6 && (
        <p className="text-sm text-green-600 mt-2">
          ...and {webcams.length - 6} more webcams
        </p>
      )}
    </div>
  );
}
