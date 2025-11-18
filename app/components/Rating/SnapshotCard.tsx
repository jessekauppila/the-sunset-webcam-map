'use client';

import Image from 'next/image';
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import type { Snapshot } from '@/app/lib/types';

interface SnapshotCardProps {
  snapshot: Snapshot;
  onSwipe: (direction: 'like' | 'dislike') => void;
}

export function SnapshotCard({
  snapshot,
  onSwipe,
}: SnapshotCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const opacity = useTransform(
    x,
    [-200, -100, 0, 100, 200],
    [0, 1, 1, 1, 0]
  );

  const likeOpacity = useTransform(x, [0, 100], [0, 1]);
  const dislikeOpacity = useTransform(x, [-100, 0], [1, 0]);

  const handleDragEnd = (
    _e: PointerEvent | TouchEvent | MouseEvent,
    info: PanInfo
  ) => {
    if (info.offset.x > 100) {
      onSwipe('like');
    } else if (info.offset.x < -100) {
      onSwipe('dislike');
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const captured = new Date(timestamp);
    const diffMs = now.getTime() - captured.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0)
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0)
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      style={{ x, rotate, opacity }}
      className="relative w-full max-w-md mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden cursor-grab active:cursor-grabbing"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <motion.div
        style={{ opacity: likeOpacity }}
        className="absolute inset-0 bg-green-500/20 flex items-center justify-center z-10 pointer-events-none"
      >
        <span className="text-7xl animate-pulse">👍</span>
      </motion.div>

      <motion.div
        style={{ opacity: dislikeOpacity }}
        className="absolute inset-0 bg-red-500/20 flex items-center justify-center z-10 pointer-events-none"
      >
        <span className="text-7xl animate-pulse">👎</span>
      </motion.div>

      <div className="relative w-full aspect-[4/3]">
        <Image
          src={snapshot.snapshot.firebaseUrl}
          alt={snapshot.title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 400px"
          priority
          unoptimized
        />
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
        <div className="space-y-2">
          <h3 className="text-2xl font-bold text-white">
            {snapshot.title}
          </h3>
          <div className="flex items-center gap-3 text-white/80 text-sm">
            <span>
              📍 {snapshot.location?.city},{' '}
              {snapshot.location?.region}
            </span>
          </div>
          <div className="flex items-center gap-4 text-white/80 text-sm">
            <span>
              {snapshot.snapshot.phase === 'sunset' ? '🌅' : '🌄'}{' '}
              {snapshot.snapshot.phase.toUpperCase()}
            </span>
            {snapshot.snapshot.rank && (
              <span>Rank #{snapshot.snapshot.rank}</span>
            )}
          </div>
          {snapshot.snapshot.calculatedRating && (
            <div className="flex items-center gap-2 text-white/80">
              <span>⭐</span>
              <span>
                {Number(snapshot.snapshot.calculatedRating).toFixed(
                  1
                )}{' '}
                avg
              </span>
              <span className="text-white/60">
                ({snapshot.snapshot.ratingCount} ratings)
              </span>
            </div>
          )}
          <div className="text-white/60 text-xs">
            Captured {formatTimeAgo(snapshot.snapshot.capturedAt)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
