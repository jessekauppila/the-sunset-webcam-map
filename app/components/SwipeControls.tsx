'use client';

import { Button, Box } from '@mui/material';
import {
  ThumbDown,
  ThumbUp,
  SkipNext,
  Undo,
} from '@mui/icons-material';

interface SwipeControlsProps {
  onLike: () => void;
  onDislike: () => void;
  onSkip: () => void;
  onUndo: () => void;
  canUndo: boolean;
  ratedCount: number;
  unratedCount: number;
}

export function SwipeControls({
  onLike,
  onDislike,
  onSkip,
  onUndo,
  canUndo,
  ratedCount,
  unratedCount,
}: SwipeControlsProps) {
  const totalCount = ratedCount + unratedCount;
  const progressPercentage =
    totalCount > 0 ? (ratedCount / totalCount) * 100 : 0;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background:
          'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%)',
        padding: 4,
        zIndex: 20,
      }}
    >
      {/* Progress Bar */}
      <Box sx={{ mb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 1,
          }}
        >
          <span className="text-white text-sm font-medium">
            {ratedCount} rated · {unratedCount} remaining
          </span>
        </Box>
        <Box
          sx={{
            width: '100%',
            height: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              width: `${progressPercentage}%`,
              height: '100%',
              backgroundColor: '#60a5fa',
              transition: 'width 0.3s ease',
            }}
          />
        </Box>
      </Box>

      {/* Undo Button */}
      {canUndo && (
        <Box
          sx={{ mb: 2, display: 'flex', justifyContent: 'center' }}
        >
          <Button
            onClick={onUndo}
            variant="outlined"
            size="small"
            startIcon={<Undo />}
            sx={{
              color: 'white',
              borderColor: 'rgba(255, 255, 255, 0.3)',
              '&:hover': {
                borderColor: 'rgba(255, 255, 255, 0.5)',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            Undo Last
          </Button>
        </Box>
      )}

      {/* Action Buttons */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <Button
          onClick={onDislike}
          variant="contained"
          size="large"
          startIcon={<ThumbDown />}
          sx={{
            backgroundColor: '#ef4444',
            '&:hover': { backgroundColor: '#dc2626' },
            minWidth: 140,
            py: 1.5,
            fontSize: '1rem',
          }}
        >
          Dislike
        </Button>

        <Button
          onClick={onSkip}
          variant="outlined"
          size="large"
          startIcon={<SkipNext />}
          sx={{
            color: 'white',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            '&:hover': {
              borderColor: 'rgba(255, 255, 255, 0.5)',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
            minWidth: 120,
            py: 1.5,
            fontSize: '1rem',
          }}
        >
          Skip
        </Button>

        <Button
          onClick={onLike}
          variant="contained"
          size="large"
          startIcon={<ThumbUp />}
          sx={{
            backgroundColor: '#10b981',
            '&:hover': { backgroundColor: '#059669' },
            minWidth: 140,
            py: 1.5,
            fontSize: '1rem',
          }}
        >
          Like
        </Button>
      </Box>

      {/* Keyboard Shortcuts Hint */}
      <Box
        sx={{
          mt: 2,
          textAlign: 'center',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '0.75rem',
        }}
      >
        ← Dislike · Space Skip · → Like
      </Box>
    </Box>
  );
}
