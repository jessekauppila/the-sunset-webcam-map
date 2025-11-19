'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSnapshotStore } from '@/app/store/useSnapshotStore';
import { SnapshotCard } from './SnapshotCard';
import { SwipeControls } from './SwipeControls';
import {
  Box,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';

export function SwipeSnapshotGallery() {
  const [viewMode, setViewMode] = useState<'unrated' | 'curated'>('unrated');
  const {
    archive,
    curated,
    fetchMore,
    setRating,
    loading,
  } = useSnapshotStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Get snapshots based on current mode
  const snapshots = viewMode === 'curated' ? curated : archive;

  // Fetch snapshots on mount or when view mode changes
  useEffect(() => {
    const mode = viewMode === 'curated' ? 'curated' : 'archive';
    if (snapshots.length === 0) {
      fetchMore(mode);
    }
  }, [viewMode, fetchMore, snapshots.length]);

  // Handle mode toggle
  const handleModeChange = useCallback(
    (newMode: 'unrated' | 'curated') => {
      setViewMode(newMode);
      setCurrentIndex(0); // Reset to first card
    },
    []
  );

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

  const handleUndo = useCallback(() => {
    // Undo functionality not available in current store implementation
    // Could be implemented later if needed
    console.warn('Undo functionality not available');
  }, []);

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
      }
      // Undo disabled - functionality not available in current store
    };

    window.addEventListener('keydown', handleKeyPress);
    return () =>
      window.removeEventListener('keydown', handleKeyPress);
  }, [
    isAnimating,
    handleLike,
    handleDislike,
    handleSkip,
  ]);

  // Calculate stats - show progress through loaded snapshots
  const totalLoaded = snapshots?.length || 0;

  // Count snapshots with user ratings (rated by current user)
  const ratedByUser =
    snapshots?.filter((s) => s.snapshot.userRating).length || 0;
  const remainingCount = Math.max(0, totalLoaded - ratedByUser);

  // Loading state
  if (loading || (!snapshots || snapshots.length === 0)) {
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
          You&apos;ve rated all available snapshots.
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
      {/* Mode Toggle - Top Left */}
      <Box
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 10,
        }}
      >
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, newMode) => {
            if (newMode !== null) {
              handleModeChange(newMode);
            }
          }}
          size="small"
          sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            '& .MuiToggleButton-root': {
              color: 'white',
              borderColor: 'rgba(255, 255, 255, 0.3)',
              padding: '8px 16px',
              fontSize: '14px',
              '&.Mui-selected': {
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                },
              },
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              },
            },
          }}
        >
          <ToggleButton value="unrated">Unrated</ToggleButton>
          <ToggleButton value="curated">Curated Mix</ToggleButton>
        </ToggleButtonGroup>
      </Box>

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
        canUndo={false}
        ratedCount={ratedByUser}
        unratedCount={remainingCount}
      />
    </Box>
  );
}
