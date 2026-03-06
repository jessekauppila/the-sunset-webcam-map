'use client';

import Image from 'next/image';
import StarRating from '@/app/components/console/StarRating';
import type { Snapshot } from '@/app/lib/types';

type SnapshotQueueCardProps = {
  snapshot: Snapshot;
  onRate: (rating: number) => Promise<void>;
  onSkip: () => void;
  onUndo: () => Promise<void>;
  canUndo: boolean;
  disabled?: boolean;
  ratedCount: number;
  remainingCount: number;
  nextSnapshot?: Snapshot | null;
};

function formatLocation(snapshot: Snapshot): string {
  const parts = [
    snapshot.location?.city,
    snapshot.location?.region,
    snapshot.location?.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}

export function SnapshotQueueCard({
  snapshot,
  onRate,
  onSkip,
  onUndo,
  canUndo,
  disabled = false,
  ratedCount,
  remainingCount,
  nextSnapshot,
}: SnapshotQueueCardProps) {
  return (
    <div className="w-full flex justify-center">
      <div className="w-full max-w-md rounded-md bg-gray-200 text-gray-800 shadow-xl border border-gray-300 overflow-hidden">
        <div className="px-3 pt-3">
          <div className="relative h-60 w-full rounded overflow-hidden">
            <Image
              src={snapshot.snapshot.firebaseUrl}
              alt={snapshot.title}
              fill
              className="object-cover"
              unoptimized
              sizes="(max-width: 900px) 100vw, 700px"
              priority
            />
          </div>
        </div>

        <div className="space-y-3 px-4 pt-5 pb-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Unrated queue
            </p>
            <p className="text-xs text-gray-500">
              Rated {ratedCount} · Remaining {remainingCount}
            </p>
          </div>

          <h3 className="text-lg font-semibold text-gray-800">
            {snapshot.title}
          </h3>

          <p className="text-sm text-gray-600 leading-tight">
            {formatLocation(snapshot)}
          </p>

          <p className="text-xs text-gray-500">
            {snapshot.snapshot.phase.toUpperCase()} · Captured{' '}
            {new Date(snapshot.snapshot.capturedAt).toLocaleString()}
          </p>

          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              Rate this snapshot
            </p>
            <StarRating
              rating={snapshot.snapshot.userRating ?? 0}
              onRate={onRate}
              disabled={disabled}
              size={30}
              name={snapshot.title}
            />
          </div>

          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                key={rating}
                type="button"
                onClick={() => onRate(rating)}
                disabled={disabled}
                className="px-3 py-1 rounded border border-gray-400 text-sm font-medium hover:bg-gray-300 disabled:opacity-50"
              >
                {rating}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSkip}
              disabled={disabled}
              className="px-3 py-1 rounded border border-gray-400 text-sm hover:bg-gray-300 disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo || disabled}
              className="px-3 py-1 rounded border border-gray-400 text-sm hover:bg-gray-300 disabled:opacity-50"
            >
              Undo
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Hotkeys: 1-5 rate · Space skip · Z undo
          </p>

          {nextSnapshot ? (
            <p className="text-xs text-gray-500">
              Next: {nextSnapshot.title}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

