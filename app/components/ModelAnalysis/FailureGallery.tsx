// app/components/ModelAnalysis/FailureGallery.tsx
import { Box, Typography } from '@mui/material';
import type { FailureGallery as Type } from '@/app/lib/modelRuns.types';
import { GlossaryTerm } from './GlossaryTerm';

interface Props {
  gallery: Type;
}

export function FailureGallery({ gallery }: Props) {
  if (gallery.items.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: '#94a3b8' }}>
        No failures to show — either this run has no predictions or every prediction was correct.
      </Typography>
    );
  }

  return (
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
          sx={{
            background: '#0f172a',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          {item.image_url ? (
            <a
              href={item.image_url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Open snapshot ${item.snapshot_id} in new tab`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image_url}
                alt={`webcam ${item.webcam_id ?? 'unknown'} snapshot`}
                loading="lazy"
                style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }}
              />
            </a>
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
                "{item.llm_explanation}"
              </Box>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
