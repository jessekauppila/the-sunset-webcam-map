'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import type { Snapshot } from '@/app/lib/types';
import { useSnapshotStore } from '@/app/store/useSnapshotStore';
import StarRating from './console/StarRating';

export function SnapshotConsole({
  mode,
  title,
}: {
  mode: 'archive' | 'curated';
  title: string;
}) {
  const setRating = useSnapshotStore((s) => s.setRating);
  const setPageSize = useSnapshotStore((s) => s.setPageSize);
  const goToPage = useSnapshotStore((s) => s.goToPage);
  const nextPage = useSnapshotStore((s) => s.nextPage);
  const prevPage = useSnapshotStore((s) => s.prevPage);
  const fetchMore = useSnapshotStore((s) => s.fetchMore);
  const loading = useSnapshotStore((s) => s.loading);
  const error = useSnapshotStore((s) => s.error);

  const archive = useSnapshotStore((s) => s.archive);
  const archivePage = useSnapshotStore((s) => s.archivePage);
  const archivePageSize = useSnapshotStore((s) => s.archivePageSize);
  const archiveTotal = useSnapshotStore((s) => s.archiveTotal);

  const curated = useSnapshotStore((s) => s.curated);
  const curatedPage = useSnapshotStore((s) => s.curatedPage);
  const curatedPageSize = useSnapshotStore((s) => s.curatedPageSize);
  const curatedTotal = useSnapshotStore((s) => s.curatedTotal);

  // Get current mode's data
  const snapshots = mode === 'archive' ? archive : curated;
  const currentPage = mode === 'archive' ? archivePage : curatedPage;
  const pageSize =
    mode === 'archive' ? archivePageSize : curatedPageSize;
  const total = mode === 'archive' ? archiveTotal : curatedTotal;

  // Get the current page's slice
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const currentPageSnapshots = snapshots.slice(startIdx, endIdx);

  const [updatingSnapshots, setUpdatingSnapshots] = useState<
    Set<number>
  >(new Set());

  // Initial fetch on mount
  useEffect(() => {
    if (snapshots.length === 0) {
      fetchMore(mode);
    }
  }, [mode, snapshots.length, fetchMore]);

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

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="console-container">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-700">
          {title}: Showing {currentPageSnapshots.length} of {total}{' '}
          Snapshots
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Page size:</label>
          <select
            value={pageSize}
            onChange={(e) =>
              setPageSize(mode, parseInt(e.target.value, 10))
            }
            className="px-2 py-1 border rounded"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          Error: {error}
        </div>
      )}

      {loading && snapshots.length === 0 ? (
        <p className="text-green-700">Loading snapshots...</p>
      ) : currentPageSnapshots.length === 0 ? (
        <p className="text-green-700">No snapshots found.</p>
      ) : (
        <>
          <div className="console-grid">
            {currentPageSnapshots.map((snapshot, index) => (
              <div
                key={`${snapshot.snapshot.id}-${snapshot.webcamId}-${
                  startIdx + index
                }`}
                className="console-card"
              >
                {/* Firebase Snapshot Image */}
                <Image
                  src={snapshot.snapshot.firebaseUrl}
                  alt={snapshot.title}
                  width={600}
                  height={300}
                  className="console-card-image"
                  unoptimized
                />

                <h4 className="console-card-title">
                  {snapshot.title}
                </h4>

                {/* Location Info */}
                <p className="webcam-console-details">
                  {snapshot.location?.city},{' '}
                  {snapshot.location?.region}{' '}
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
                  Views:{' '}
                  {snapshot.viewCount?.toLocaleString() || 'N/A'}
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
                <div className="webcam-console-details">
                  Initial Rating:{' '}
                  {
                    <StarRating
                      rating={snapshot.snapshot.initialRating ?? 0}
                    />
                  }
                </div>

                {/* Calculated Rating (average of user ratings) */}
                <div className="webcam-console-details">
                  Calculated Rating:{' '}
                  {snapshot.snapshot.calculatedRating ? (
                    <>
                      <StarRating
                        rating={Math.round(
                          snapshot.snapshot.calculatedRating
                        )}
                      />{' '}
                      (
                      {Number(
                        snapshot.snapshot.calculatedRating
                      ).toFixed(1)}
                      ) ({snapshot.snapshot.ratingCount} ratings)
                    </>
                  ) : (
                    'Not rated yet'
                  )}
                </div>

                {/* User's Rating */}
                {snapshot.snapshot.userRating && (
                  <div className="webcam-console-details">
                    Your Rating:{' '}
                    <StarRating
                      rating={snapshot.snapshot.userRating}
                    />
                  </div>
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

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => prevPage(mode)}
                disabled={currentPage === 1 || loading}
                className="px-4 py-2 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Previous
              </button>

              <div className="flex gap-1">
                {Array.from(
                  { length: Math.min(totalPages, 10) },
                  (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 10) {
                      pageNum = i + 1;
                    } else if (currentPage <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 4) {
                      pageNum = totalPages - 9 + i;
                    } else {
                      pageNum = currentPage - 5 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => goToPage(mode, pageNum)}
                        disabled={loading}
                        className={`px-3 py-2 border rounded ${
                          currentPage === pageNum
                            ? 'bg-blue-500 text-white'
                            : 'hover:bg-gray-100'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {pageNum}
                      </button>
                    );
                  }
                )}
              </div>

              <button
                onClick={() => nextPage(mode)}
                disabled={currentPage === totalPages || loading}
                className="px-4 py-2 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
