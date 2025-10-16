'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { Snapshot } from '@/app/lib/types';
import { useSnapshotStore } from '@/app/store/useSnapshotStore';
import StarRating from './console/StarRating';

export function SnapshotConsole({
  snapshots,
  title,
}: {
  snapshots: Snapshot[];
  title: string;
}) {
  const setRating = useSnapshotStore((s) => s.setRating);
  const [updatingSnapshots, setUpdatingSnapshots] = useState<
    Set<number>
  >(new Set());

  const handleRatingChange = async (
    snapshotId: number,
    rating: number
  ) => {
    setUpdatingSnapshots((prev) => new Set(prev).add(snapshotId));
    try {
      await setRating(snapshotId, rating);
    } catch (error) {
      console.error('Failed to update rating:', error);
    } finally {
      setUpdatingSnapshots((prev) => {
        const newSet = new Set(prev);
        newSet.delete(snapshotId);
        return newSet;
      });
    }
  };

  return (
    <div className="console-container">
      <h3 className="text-lg font-bold text-gray-700 mb-2">
        {title}: {snapshots.length} Snapshots
      </h3>

      {snapshots.length === 0 ? (
        <p className="text-green-700">No snapshots found.</p>
      ) : (
        <div className="console-grid">
          {snapshots.map((snapshot) => (
            <div key={snapshot.snapshot.id} className="console-card">
              {/* Firebase Snapshot Image */}
              <Image
                src={snapshot.snapshot.firebaseUrl}
                alt={snapshot.title}
                width={600}
                height={300}
                className="console-card-image"
                unoptimized
              />

              <h4 className="console-card-title">{snapshot.title}</h4>

              {/* Location Info */}
              <p className="webcam-console-details">
                {snapshot.location?.city}, {snapshot.location?.region}{' '}
                {snapshot.location?.country}
              </p>

              {/* Snapshot Metadata */}
              <p className="webcam-console-details">
                Phase: {snapshot.snapshot.phase} | Rank:{' '}
                {snapshot.snapshot.rank || 'N/A'}
              </p>

              <p className="webcam-console-details">
                Captured:{' '}
                {new Date(
                  snapshot.snapshot.capturedAt
                ).toLocaleString()}
              </p>

              {/* Views and Status */}
              <p className="webcam-console-details">
                Views: {snapshot.viewCount?.toLocaleString() || 'N/A'}
              </p>
              <p className="webcam-console-details">
                Status: {snapshot.status || 'Unknown'}
              </p>

              {/* Categories */}
              {snapshot.categories &&
                snapshot.categories.length > 0 && (
                  <p className="webcam-console-details">
                    {snapshot.categories
                      .map((cat) => cat.name)
                      .join(', ')}
                  </p>
                )}

              {/* Webcam ID */}
              <p className="webcam-console-details">
                Webcam ID: {snapshot.webcamId}
              </p>

              {/* Initial Rating (when captured) */}
              <p className="webcam-console-details">
                Initial Rating:{' '}
                {
                  <StarRating
                    rating={snapshot.snapshot.initialRating ?? 0}
                  />
                }
              </p>

              {/* Calculated Rating (average of user ratings) */}
              <p className="webcam-console-details">
                Calculated Rating:{' '}
                {snapshot.snapshot.calculatedRating ? (
                  <>
                    <StarRating
                      rating={Math.round(
                        snapshot.snapshot.calculatedRating
                      )}
                    />{' '}
                    ({snapshot.snapshot.calculatedRating.toFixed(1)}){' '}
                    ({snapshot.snapshot.ratingCount} ratings)
                  </>
                ) : (
                  'Not rated yet'
                )}
              </p>

              {/* User's Rating */}
              {snapshot.snapshot.userRating && (
                <p className="webcam-console-details">
                  Your Rating:{' '}
                  <StarRating rating={snapshot.snapshot.userRating} />
                </p>
              )}

              {/* Rating Controls */}
              <div className="rating-controls">
                <label className="webcam-console-details">
                  {snapshot.snapshot.userRating
                    ? 'Update Rating:'
                    : 'Rate This Snapshot:'}
                </label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      onClick={() =>
                        handleRatingChange(
                          snapshot.snapshot.id,
                          rating
                        )
                      }
                      disabled={updatingSnapshots.has(
                        snapshot.snapshot.id
                      )}
                      className={`rating-button ${
                        snapshot.snapshot.userRating === rating
                          ? 'rating-button-active'
                          : 'rating-button-inactive'
                      } ${
                        updatingSnapshots.has(snapshot.snapshot.id)
                          ? 'rating-button-disabled'
                          : ''
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </div>

              {/* Snapshot ID */}
              <p className="webcam-console-details">
                Snapshot ID: {snapshot.snapshot.id}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
