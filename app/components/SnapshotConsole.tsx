'use client';

import Image from 'next/image';
import { useState, useEffect, useCallback } from 'react';
import { useSnapshotStore } from '@/app/store/useSnapshotStore';
import StarRating from './console/StarRating';
import { SnapshotQueueCard } from './SnapshotQueueCard';
import { getUserSessionId } from '@/app/lib/userSession';

export function SnapshotConsole({
  mode,
  title,
  hotkeysEnabled = true,
}: {
  mode: 'archive' | 'curated' | 'unrated' | 'hard-examples';
  title: string;
  hotkeysEnabled?: boolean;
}) {
  const setRating = useSnapshotStore((s) => s.setRating);
  const removeUnratedSnapshot = useSnapshotStore(
    (s) => s.removeUnratedSnapshot
  );
  const removeHardExample = useSnapshotStore((s) => s.removeHardExample);
  const insertUnratedSnapshot = useSnapshotStore(
    (s) => s.insertUnratedSnapshot
  );
  const insertHardExample = useSnapshotStore((s) => s.insertHardExample);
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

  const hardExamples = useSnapshotStore((s) => s.hardExamples);
  const hardExamplesPage = useSnapshotStore((s) => s.hardExamplesPage);
  const hardExamplesPageSize = useSnapshotStore(
    (s) => s.hardExamplesPageSize
  );
  const hardExamplesTotal = useSnapshotStore((s) => s.hardExamplesTotal);

  const unrated = useSnapshotStore((s) => s.unrated);
  const unratedArchiveTotal = useSnapshotStore(
    (s) => s.unratedArchiveTotal
  );
  const unratedRatedTotal = useSnapshotStore(
    (s) => s.unratedRatedTotal
  );

  // Get current mode's data
  const snapshots =
    mode === 'archive'
      ? archive
      : mode === 'curated'
      ? curated
      : mode === 'hard-examples'
      ? hardExamples
      : unrated;
  const currentPage =
    mode === 'archive'
      ? archivePage
      : mode === 'curated'
      ? curatedPage
      : mode === 'hard-examples'
      ? hardExamplesPage
      : 1;
  const pageSize =
    mode === 'archive'
      ? archivePageSize
      : mode === 'curated'
      ? curatedPageSize
      : mode === 'hard-examples'
      ? hardExamplesPageSize
      : 24;
  const total =
    mode === 'archive'
      ? archiveTotal
      : mode === 'curated'
      ? curatedTotal
      : mode === 'hard-examples'
      ? hardExamplesTotal
      : 0;

  // Get the current page's slice
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const currentPageSnapshots = snapshots.slice(startIdx, endIdx);

  const [updatingSnapshots, setUpdatingSnapshots] = useState<
    Set<number>
  >(new Set());
  const [queueIndex, setQueueIndex] = useState(0);
  const [isQueueSubmitting, setIsQueueSubmitting] = useState(false);
  const [queueRatedCount, setQueueRatedCount] = useState(0);
  const [queueHistory, setQueueHistory] = useState<
    Array<{ snapshot: (typeof unrated)[number]; index: number }>
  >([]);
  // Both the unrated queue and the hard-examples queue use the one-card verdict
  // flow (image + Yes/No + stars). Hard examples writes is_sunset_verdict as the
  // gold label; the verdict is given blind (no model/Claude scores shown) to
  // avoid anchoring — the three-judge comparison lives in the verification view.
  const isQueueMode = mode === 'unrated' || mode === 'hard-examples';

  // Initial fetch on mount
  useEffect(() => {
    if (snapshots.length === 0) {
      fetchMore(mode);
    }
  }, [mode, snapshots.length, fetchMore]);

  // Preload more for queue mode when buffer gets low
  useEffect(() => {
    if (!isQueueMode || !hotkeysEnabled) return;
    const remainingInBuffer = snapshots.length - queueIndex;
    if (remainingInBuffer <= 10 && !loading) {
      fetchMore(mode);
    }
  }, [
    isQueueMode,
    hotkeysEnabled,
    mode,
    snapshots.length,
    queueIndex,
    loading,
    fetchMore,
  ]);

  // Keep queue index valid after removals/refills
  useEffect(() => {
    if (!isQueueMode) return;
    if (queueIndex >= snapshots.length && snapshots.length > 0) {
      setQueueIndex(snapshots.length - 1);
    }
  }, [isQueueMode, queueIndex, snapshots.length]);

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

  const queueCurrent = snapshots[queueIndex];
  const queueNext = snapshots[queueIndex + 1];
  const queueRemainingCount = Math.max(snapshots.length - queueIndex, 0);
  const queueProgressLabel =
    unratedArchiveTotal > 0
      ? `${title}: ${unratedRatedTotal} of ${unratedArchiveTotal} Snapshots Rated`
      : title;

  const handleQueueRate = useCallback(
    async (rating: number, opts?: { isSunsetVerdict?: boolean }) => {
      if (!queueCurrent || isQueueSubmitting) return;

      const snapshotId = queueCurrent.snapshot.id;
      setIsQueueSubmitting(true);
      setUpdatingSnapshots((prev) => new Set(prev).add(snapshotId));

      try {
        const userSessionId = getUserSessionId();
        const body: Record<string, unknown> = { userSessionId };
        if (opts?.isSunsetVerdict !== undefined) {
          body.isSunsetVerdict = opts.isSunsetVerdict;
        }
        if (opts?.isSunsetVerdict !== false) {
          body.rating = rating;
        }
        const res = await fetch(`/api/snapshots/${snapshotId}/rate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`Rate request failed: ${res.status}`);
        }
        setQueueHistory((prev) => [
          ...prev,
          { snapshot: queueCurrent, index: queueIndex },
        ]);
        if (mode === 'hard-examples') {
          removeHardExample(snapshotId);
        } else {
          removeUnratedSnapshot(snapshotId);
        }
        setQueueRatedCount((prev) => prev + 1);
      } catch (error) {
        console.error('Failed to update rating:', error);
      } finally {
        setUpdatingSnapshots((prev) => {
          const next = new Set(prev);
          next.delete(snapshotId);
          return next;
        });
        setIsQueueSubmitting(false);
      }
    },
    [
      queueCurrent,
      queueIndex,
      isQueueSubmitting,
      mode,
      removeUnratedSnapshot,
      removeHardExample,
    ]
  );

  const handleQueueSkip = useCallback(() => {
    if (isQueueSubmitting) return;
    setQueueIndex((prev) =>
      Math.min(prev + 1, Math.max(snapshots.length - 1, 0))
    );
  }, [isQueueSubmitting, snapshots.length]);

  const handleQueueUndo = useCallback(async () => {
    if (isQueueSubmitting) return;
    const last = queueHistory[queueHistory.length - 1];
    if (!last) return;

    setIsQueueSubmitting(true);
    try {
      const userSessionId = getUserSessionId();
      const response = await fetch(
        `/api/snapshots/${last.snapshot.snapshot.id}/rate`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userSessionId }),
        }
      );
      if (!response.ok) {
        throw new Error('Failed to undo rating');
      }

      // Put the frame back into the queue it came from. Hard examples live in
      // the hardExamples buffer; routing undo to insertUnratedSnapshot would
      // drop it from the operator queue and pollute the unrated labeling queue.
      if (mode === 'hard-examples') {
        insertHardExample(last.snapshot, last.index);
      } else {
        insertUnratedSnapshot(last.snapshot, last.index);
      }
      setQueueHistory((prev) => prev.slice(0, -1));
      setQueueRatedCount((prev) => Math.max(0, prev - 1));
      setQueueIndex(last.index);
    } catch (error) {
      console.error('Failed to undo queue rating:', error);
    } finally {
      setIsQueueSubmitting(false);
    }
  }, [
    isQueueSubmitting,
    queueHistory,
    mode,
    insertUnratedSnapshot,
    insertHardExample,
  ]);

  // Scoped keyboard shortcuts for queue mode
  useEffect(() => {
    if (!isQueueMode || !hotkeysEnabled) return;

    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target.isContentEditable
      );
    };

    const handler = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      if (isQueueSubmitting) return;

      if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        void handleQueueRate(Number(event.key));
        return;
      }

      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        handleQueueSkip();
        return;
      }

      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        void handleQueueUndo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    isQueueMode,
    hotkeysEnabled,
    isQueueSubmitting,
    handleQueueRate,
    handleQueueSkip,
    handleQueueUndo,
  ]);

  const totalPages = Math.ceil(total / pageSize);

  if (isQueueMode) {
    return (
      <div className="console-container">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-gray-700">
            {queueProgressLabel}
          </h3>
          <p className="text-sm text-gray-600">
            Loaded {snapshots.length}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            Error: {error}
          </div>
        )}

        {loading && snapshots.length === 0 ? (
          <p className="text-green-700">Loading snapshots...</p>
        ) : !queueCurrent ? (
          <p className="text-green-700">
            {mode === 'hard-examples'
              ? 'No disagreements to verdict — backfill still running or all verdicted.'
              : 'No unrated snapshots found.'}
          </p>
        ) : (
          <SnapshotQueueCard
            snapshot={queueCurrent}
            nextSnapshot={queueNext || null}
            onRate={handleQueueRate}
            onSkip={handleQueueSkip}
            onUndo={handleQueueUndo}
            canUndo={queueHistory.length > 0}
            disabled={isQueueSubmitting}
            ratedCount={queueRatedCount}
            remainingCount={queueRemainingCount}
            archiveTotal={unratedArchiveTotal}
            archiveRatedTotal={unratedRatedTotal}
          />
        )}
      </div>
    );
  }

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
