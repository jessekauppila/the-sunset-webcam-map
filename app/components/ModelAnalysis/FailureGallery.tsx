'use client';

// app/components/ModelAnalysis/FailureGallery.tsx
import { useState } from 'react';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type {
  FailureGallery as Type,
  FailureGalleryItem,
} from '@/app/lib/modelRuns.types';
import { GlossaryTerm } from './GlossaryTerm';

interface Props {
  gallery: Type;
}

export function FailureGallery({ gallery }: Props) {
  const [selected, setSelected] = useState<FailureGalleryItem | null>(null);

  if (gallery.items.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: '#94a3b8' }}>
        No failures to show — either this run has no predictions or every prediction was correct.
      </Typography>
    );
  }

  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 1,
        }}
      >
        {gallery.items.map((item) => (
          <Box
            key={item.snapshot_id}
            component="button"
            type="button"
            onClick={() => setSelected(item)}
            aria-label={`Open snapshot ${item.snapshot_id} details`}
            sx={{
              background: '#0f172a',
              borderRadius: 1,
              overflow: 'hidden',
              border: 'none',
              padding: 0,
              textAlign: 'left',
              cursor: 'pointer',
              color: 'inherit',
              font: 'inherit',
              '&:hover': { outline: '2px solid #475569' },
              '&:focus-visible': { outline: '2px solid #60a5fa' },
            }}
          >
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image_url}
                alt={`webcam ${item.webcam_id ?? 'unknown'} snapshot`}
                loading="lazy"
                style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <Box sx={{ aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', color: '#64748b' }}>
                image unavailable
              </Box>
            )}
            <Box sx={{ p: 1, fontSize: 11 }}>
              <Box sx={{ color: '#94a3b8' }}>
                <GlossaryTerm slug="webcam_id">webcam</GlossaryTerm> #{item.webcam_id ?? '?'}
              </Box>
              <Box sx={{ color: '#22c55e' }}>true {item.true_label.toFixed(2)}</Box>
              <Box sx={{ color: '#ef4444' }}>pred {item.predicted_score.toFixed(2)}</Box>
              <Box sx={{ color: '#cbd5e1' }}>off by {item.absolute_error.toFixed(2)}</Box>
              {item.llm_explanation && (
                <Box sx={{ color: '#64748b', mt: 0.5, fontStyle: 'italic' }}>
                  &ldquo;{item.llm_explanation}&rdquo;
                </Box>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { background: '#0b1220', color: '#e5e7eb' } }}
      >
        {selected && (
          <Box sx={{ position: 'relative' }}>
            <IconButton
              onClick={() => setSelected(null)}
              aria-label="Close"
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                color: '#cbd5e1',
                background: 'rgba(15,23,42,0.7)',
                '&:hover': { background: 'rgba(15,23,42,0.95)' },
              }}
            >
              <CloseIcon />
            </IconButton>
            {selected.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.image_url}
                alt={`webcam ${selected.webcam_id ?? 'unknown'} full snapshot`}
                style={{ width: '100%', display: 'block', maxHeight: '70vh', objectFit: 'contain' }}
              />
            ) : (
              <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center', color: '#64748b' }}>
                image unavailable
              </Box>
            )}
            <Box sx={{ p: 2, display: 'grid', gap: 0.5, fontSize: 13 }}>
              <Box sx={{ color: '#94a3b8' }}>
                webcam #{selected.webcam_id ?? '?'} · snapshot {selected.snapshot_id}
              </Box>
              {selected.captured_at && (
                <Box sx={{ color: '#94a3b8' }}>
                  captured {new Date(selected.captured_at).toLocaleString()}
                </Box>
              )}
              <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                <Box sx={{ color: '#22c55e' }}>true {selected.true_label.toFixed(2)}</Box>
                <Box sx={{ color: '#ef4444' }}>pred {selected.predicted_score.toFixed(2)}</Box>
                <Box sx={{ color: '#cbd5e1' }}>off by {selected.absolute_error.toFixed(2)}</Box>
              </Box>
              {selected.llm_explanation && (
                <Box sx={{ color: '#cbd5e1', mt: 1, fontStyle: 'italic' }}>
                  &ldquo;{selected.llm_explanation}&rdquo;
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Dialog>
    </>
  );
}
