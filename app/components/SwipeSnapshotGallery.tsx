'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSnapshotStore } from '@/app/store/useSnapshotStore';
import { SnapshotCard } from './SnapshotCard';
import { SwipeControls } from './SwipeControls';
import { Box, Typography } from '@mui/material';

export function SwipeSnapshotGallery() {
  const {
    snapshots,
    fetchUnrated,
    setRating,
    undoLastRating,
    actionHistory,
  } = useSnapshotStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Fetch unrated snapshots on mount
  useEffect(() => {
    fetchUnrated();
  }, [fetchUnrated]);

  // Get current snapshot
  const currentSnapshot = snapshots?.[currentIndex] || null;

  // Handle swipe actions
  const handleLike = useCallback(async () => {
    if (!currentSnapshot || isAnimating) return;
    setIsAnimating(true);

    try {
      await setRating(currentSnapshot.snapshot.id, 5);
      // Move to next
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        setIsAnimating(false);
      }, 300);
    } catch (error) {
      console.error('Failed to like snapshot:', error);
      setIsAnimating(false);
    }
  }, [currentSnapshot, isAnimating, setRating]);

  const handleDislike = useCallback(async () => {
    if (!currentSnapshot || isAnimating) return;
    setIsAnimating(true);

    try {
      await setRating(currentSnapshot.snapshot.id, 1);
      // Move to next
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        setIsAnimating(false);
      }, 300);
    } catch (error) {
      console.error('Failed to dislike snapshot:', error);
      setIsAnimating(false);
    }
  }, [currentSnapshot, isAnimating, setRating]);

  const handleSkip = useCallback(() => {
    if (!currentSnapshot || isAnimating) return;
    setCurrentIndex((prev) => prev + 1);
  }, [currentSnapshot, isAnimating]);

  const handleUndo = useCallback(async () => {
    if (!actionHistory.length || isAnimating) return;
    setIsAnimating(true);

    try {
      await undoLastRating();
      if (currentIndex > 0) {
        setCurrentIndex((prev) => prev - 1);
      }
      setIsAnimating(false);
    } catch (error) {
      console.error('Failed to undo rating:', error);
      setIsAnimating(false);
    }
  }, [
    actionHistory.length,
    isAnimating,
    undoLastRating,
    currentIndex,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (isAnimating) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleDislike();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleLike();
      } else if (e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleSkip();
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () =>
      window.removeEventListener('keydown', handleKeyPress);
  }, [
    isAnimating,
    handleLike,
    handleDislike,
    handleSkip,
    handleUndo,
  ]);

  // Calculate stats
  const ratedCount =
    snapshots?.filter((s) => s.snapshot.userRating).length || 0;
  const unratedCount = (snapshots?.length || 0) - ratedCount;

  // Loading state
  if (!snapshots || snapshots.length === 0) {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
        }}
      >
        <Typography variant="h5" sx={{ color: 'white' }}>
          Loading snapshots...
        </Typography>
      </Box>
    );
  }

  // No more snapshots
  if (!currentSnapshot) {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          gap: 4,
        }}
      >
        <Typography
          variant="h4"
          sx={{ color: 'white', textAlign: 'center' }}
        >
          🎉 All Done!
        </Typography>
        <Typography
          variant="h6"
          sx={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}
        >
          You've rated all available snapshots.
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}
        >
          Check back later for new sunsets!
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        height: '100vh',
        backgroundColor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Card Stack Effect - Show current and next */}
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 500,
          height: '80vh',
        }}
      >
        {/* Next card (behind current) - disabled for preview only */}
        {snapshots?.[currentIndex + 1] && (
          <Box
            sx={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              opacity: 0.4,
              scale: 0.95,
              zIndex: 1,
              transform: 'translateY(8px)',
              pointerEvents: 'none',
            }}
          >
            <SnapshotCard
              snapshot={snapshots![currentIndex + 1]}
              onSwipe={(dir) => {
                // Disabled - this is just a preview
                console.log('Preview card swipe:', dir);
              }}
            />
          </Box>
        )}

        {/* Current card */}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            zIndex: 2,
          }}
        >
          <SnapshotCard
            snapshot={currentSnapshot}
            onSwipe={(direction) => {
              if (direction === 'like') {
                handleLike();
              } else {
                handleDislike();
              }
            }}
          />
        </Box>
      </Box>

      {/* Controls */}
      <SwipeControls
        onLike={handleLike}
        onDislike={handleDislike}
        onSkip={handleSkip}
        onUndo={handleUndo}
        canUndo={actionHistory.length > 0}
        ratedCount={ratedCount}
        unratedCount={unratedCount}
      />
    </Box>
  );
}
