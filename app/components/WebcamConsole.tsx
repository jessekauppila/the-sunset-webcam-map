'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { WindyWebcam, Orientation } from '@/app/lib/types';
import { useAllWebcamsStore } from '@/app/store/useAllWebcamsStore';
import StarRating from './console/StarRating';

export function WebcamConsole({
  webcams,
  title,
}: {
  webcams: WindyWebcam[];
  title: string;
}) {
  const setRating = useAllWebcamsStore((s) => s.setRating);
  const setOrientation = useAllWebcamsStore((s) => s.setOrientation);
  const [updatingWebcams, setUpdatingWebcams] = useState<Set<number>>(
    new Set()
  );

  const handleRatingChange = async (
    webcamId: number,
    rating: number
  ) => {
    setUpdatingWebcams((prev) => new Set(prev).add(webcamId));
    try {
      await setRating(webcamId, rating);
    } catch (error) {
      console.error('Failed to update rating:', error);
    } finally {
      setUpdatingWebcams((prev) => {
        const newSet = new Set(prev);
        newSet.delete(webcamId);
        return newSet;
      });
    }
  };

  const handleOrientationChange = async (
    webcamId: number,
    orientation: Orientation
  ) => {
    setUpdatingWebcams((prev) => new Set(prev).add(webcamId));
    try {
      await setOrientation(webcamId, orientation);
    } catch (error) {
      console.error('Failed to update orientation:', error);
    } finally {
      setUpdatingWebcams((prev) => {
        const newSet = new Set(prev);
        newSet.delete(webcamId);
        return newSet;
      });
    }
  };
  return (
    <div className="console-container">
      <h3 className="text-lg font-bold text-gray-700 mb-2">
        {title}: {webcams.length} Webcams
      </h3>

      {webcams.length === 0 ? (
        <p className="text-green-700">
          No webcams found in this area.
        </p>
      ) : (
        <div className="console-grid">
          {webcams.map((webcam) => (
            <div key={webcam.webcamId} className="console-card">
              {/* Webcam Image */}
              {webcam.images?.current?.preview && (
                <Image
                  src={webcam.images.current.preview}
                  alt={webcam.title}
                  width={600}
                  height={300}
                  className="console-card-image"
                  unoptimized
                />
              )}

              <h4 className="console-card-title">{webcam.title}</h4>

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

              {/* Rating */}
              <p className="webcam-console-details">
                Saved Rating:{' '}
                {<StarRating rating={webcam.rating ?? 0} />}
              </p>

              {/* Rating Controls */}
              <div className="rating-controls">
                <label className="webcam-console-details">
                  Set Rating:
                </label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      onClick={() =>
                        handleRatingChange(webcam.webcamId, rating)
                      }
                      disabled={updatingWebcams.has(webcam.webcamId)}
                      className={`rating-button ${
                        webcam.rating === rating
                          ? 'rating-button-active'
                          : 'rating-button-inactive'
                      } ${
                        updatingWebcams.has(webcam.webcamId)
                          ? 'rating-button-disabled'
                          : ''
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rating */}
              <p className="webcam-console-details">
                Orientation: {webcam.orientation}
              </p>

              {/* Orientation Controls */}
              <div className="mt-2">
                <label className="webcam-console-details">
                  Orientation:
                </label>
                <select
                  value={webcam.orientation || ''}
                  onChange={(e) =>
                    handleOrientationChange(
                      webcam.webcamId,
                      e.target.value as Orientation
                    )
                  }
                  disabled={updatingWebcams.has(webcam.webcamId)}
                  className={`w-full text-xs p-1 border rounded ${
                    updatingWebcams.has(webcam.webcamId)
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer'
                  }`}
                >
                  <option value="">Select orientation</option>
                  <option value="N">North (N)</option>
                  <option value="NE">Northeast (NE)</option>
                  <option value="E">East (E)</option>
                  <option value="SE">Southeast (SE)</option>
                  <option value="S">South (S)</option>
                  <option value="SW">Southwest (SW)</option>
                  <option value="W">West (W)</option>
                  <option value="NW">Northwest (NW)</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
