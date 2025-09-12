'use client';

import type { WindyWebcam } from '@/app/lib/types';

export function WebcamConsole({
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
              <h4 className="font-semibold text-gray-900 text-sm mb-1">
                {webcam.title}
              </h4>

              {/* Location Info */}
              <p className="webcam-console-details">
                {webcam.location?.city}, {webcam.location?.region}{' '}
                {webcam.location?.country}
              </p>

              {/* Views and Status */}
              <p className="webcam-console-details">
                Views: {webcam.viewCount?.toLocaleString() || 'N/A'}
              </p>
              <p className="webcam-console-details">
                Status: {webcam.status || 'Unknown'}
              </p>

              {/* Categories */}
              {webcam.categories && webcam.categories.length > 0 && (
                <p className="webcam-console-details">
                  {' '}
                  {webcam.categories
                    .map((cat) => cat.name)
                    .join(', ')}
                </p>
              )}

              {/* Last Updated */}
              <p className="webcam-console-details">
                Updated:{' '}
                {webcam.lastUpdatedOn
                  ? new Date(
                      webcam.lastUpdatedOn
                    ).toLocaleDateString()
                  : 'Unknown'}
              </p>

              {/* ID */}
              <p className="webcam-console-details">
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
