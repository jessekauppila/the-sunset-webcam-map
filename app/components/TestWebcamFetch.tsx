'use client';

import { useTestWebCamFetch } from '../hooks/useTestWebCamFetch';

export default function TestWebcamFetch() {
  const { webcams, isLoading, error, totalCount } =
    useTestWebCamFetch();

  if (isLoading) {
    return (
      <div className="p-4 bg-blue-50 rounded-lg">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mx-auto mb-2"></div>
        <p className="text-center text-blue-700">
          Fetching Windy webcams...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded-lg">
        <p className="text-red-700">❌ Error: {error}</p>
      </div>
    );
  }

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
              <p className="text-xs text-gray-600">
                📊 Views:{' '}
                {webcam.viewCount?.toLocaleString() || 'N/A'}
              </p>
              <p className="text-xs text-gray-500">
                🎥 Status: {webcam.status || 'Unknown'}
              </p>
              {webcam.images?.current?.preview && (
                <img
                  src={webcam.images.current.preview}
                  alt={webcam.title}
                  className="w-full h-20 object-cover rounded mt-2"
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
