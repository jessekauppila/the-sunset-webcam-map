'use client';

import type { WindyWebcam } from '@/app/lib/types';

export default function WebcamConsole({
  webcams,
}: {
  webcams: WindyWebcam[];
}) {
  return (
    <div className="p-4 bg-gray-200 rounded-lg">
      <h3 className="text-lg font-bold text-gray-700 mb-2">
        Windy API Results ({webcams.length} webcams)
      </h3>

      {webcams.length === 0 ? (
        <p className="text-green-700">
          No webcams found in this area.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {webcams.map((webcam) => (
            <div
              key={webcam.webcamId}
              className="bg-white p-3 rounded border"
            >
              <h4 className="font-semibold text-sm mb-1">
                {webcam.title}
              </h4>

              {/* Location Info */}
              <p className="text-xs text-gray-600 mb-1">
                📍 {webcam.location?.city}, {webcam.location?.region}{' '}
                {webcam.location?.country}
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
    </div>
  );
}
