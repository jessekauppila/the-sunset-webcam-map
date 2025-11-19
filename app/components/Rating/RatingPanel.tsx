"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSnapshotStore } from "@/app/store/useSnapshotStore";
import { SnapshotCard } from "./SnapshotCard";
import { SwipeControls } from "./SwipeControls";

type Variant = "fullscreen" | "compact";

export function RatingPanel({ variant = "fullscreen" }: { variant?: Variant }) {
  const curated = useSnapshotStore((s) => s.curated);
  const loading = useSnapshotStore((s) => s.loading);
  const fetchMore = useSnapshotStore((s) => s.fetchMore);
  const setRating = useSnapshotStore((s) => s.setRating);

  const [index, setIndex] = useState(0);
  const [ratedCount, setRatedCount] = useState(0);
  const historyRef = useRef<Array<{ snapshotId: number; prevRating: number | undefined }>>([]);

  // Initial fetch
  useEffect(() => {
    if (curated.length === 0 && !loading) {
      fetchMore("curated");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preload more when near end
  useEffect(() => {
    if (curated.length > 0 && index >= curated.length - 5 && !loading) {
      fetchMore("curated");
    }
  }, [index, curated.length, loading, fetchMore]);

  const current = curated[index] ?? null;
  const unratedCount = useMemo(() => Math.max(curated.length - ratedCount, 0), [curated.length, ratedCount]);

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, Math.max(curated.length - 1, 0))), [curated.length]);

  const rate = useCallback(
    async (value: 1 | 5) => {
      if (!current) return;
      const snapshotId = current.snapshot.id;
      const prevRating = current.snapshot.userRating;

      historyRef.current.push({ snapshotId, prevRating });
      setRatedCount((c) => c + 1);
      await setRating(snapshotId, value);
      next();
    },
    [current, setRating, next]
  );

  const onLike = useCallback(() => rate(5), [rate]);
  const onDislike = useCallback(() => rate(1), [rate]);
  const onSkip = useCallback(() => next(), [next]);

  const onUndo = useCallback(async () => {
    const last = historyRef.current.pop();
    if (!last) return;
    setRatedCount((c) => Math.max(0, c - 1));

    const { snapshotId, prevRating } = last;
    if (prevRating && Number.isInteger(prevRating)) {
      await setRating(snapshotId, prevRating);
    } else {
      try {
        const userSessionId = (await import("@/app/lib/userSession")).getUserSessionId();
        await fetch(`/api/snapshots/${snapshotId}/rate`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userSessionId }),
        });
        // Optimistically clear local userRating by refetching small buffer when convenient
        // or leave to eventual fetchMore; keeping minimal for now
      } catch {}
    }
    setIndex((i) => Math.max(0, i - 1));
  }, [setRating]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onLike();
      else if (e.key === "ArrowLeft") onDislike();
      else if (e.key === " ") onSkip();
      else if (e.key.toLowerCase() === "z") onUndo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onLike, onDislike, onSkip, onUndo]);

  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ position: "relative" }}
    >
      <div
        style={{
          width: variant === "fullscreen" ? "100%" : 320,
          maxWidth: 480,
          paddingBottom: variant === "fullscreen" ? 160 : 16,
        }}
      >
        {current ? (
          <SnapshotCard
            snapshot={current}
            onSwipe={(dir) => (dir === "like" ? onLike() : onDislike())}
          />
        ) : (
          <div className="text-white/70 text-sm text-center">{loading ? "Loading..." : "No more snapshots"}</div>
        )}
      </div>

      <SwipeControls
        onLike={onLike}
        onDislike={onDislike}
        onSkip={onSkip}
        onUndo={onUndo}
        canUndo={historyRef.current.length > 0}
        ratedCount={ratedCount}
        unratedCount={unratedCount}
      />
    </div>
  );
}


