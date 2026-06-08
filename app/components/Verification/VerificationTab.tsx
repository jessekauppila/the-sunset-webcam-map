'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  CircularProgress,
  Button,
} from '@mui/material';
import RatingCard from '@/app/components/Webcam/RatingCard';
import type { Snapshot, WindyWebcam } from '@/app/lib/types';

const PAGE = 60;
const noop = async () => {};

/**
 * Map a verification snapshot onto the WindyWebcam shape RatingCard renders.
 * The archived frame (snapshot.firebaseUrl) is the image — NOT the webcam's live
 * image — and Claude's judge + Flickr owner already ride on the Snapshot
 * (transformSnapshot wired them). Spreading preserves them; we only swap in the
 * frame image.
 */
function frameToCard(s: Snapshot): WindyWebcam {
  return {
    ...s,
    images: { current: { preview: s.snapshot.firebaseUrl } },
  } as unknown as WindyWebcam;
}

const isFlickr = (s: Snapshot) => s.source === 'flickr';

export function VerificationTab() {
  const [disagreementsOnly, setDisagreementsOnly] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the page size whenever the toggle flips.
  useEffect(() => {
    setLimit(PAGE);
  }, [disagreementsOnly]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/snapshots?mode=verification&disagreements_only=${disagreementsOnly}&limit=${limit}&offset=0`,
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 401 || res.status === 403
              ? 'Owner sign-in required'
              : `Failed to load (${res.status})`,
          );
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshots(data.snapshots ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [disagreementsOnly, limit]);

  const maybeMore = snapshots.length >= limit && snapshots.length < total;

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ color: '#9ca3af', display: 'block', mb: 1 }}
      >
        Verification — the webcam archive and the Flickr set together, each frame
        with all three judges. Toggle on to triage only the model-vs-Claude
        disagreements (ranked); off to browse everything and eyeball judge
        coverage.
      </Typography>

      <FormControlLabel
        sx={{ color: 'white', mb: 1 }}
        control={
          <Switch
            checked={disagreementsOnly}
            onChange={(e) => setDisagreementsOnly(e.target.checked)}
          />
        }
        label={`Disagreements only${
          disagreementsOnly ? ` (${total})` : ''
        }`}
      />

      {error ? (
        <Typography sx={{ color: '#f87171' }}>{error}</Typography>
      ) : loading && snapshots.length === 0 ? (
        <CircularProgress size={20} sx={{ color: 'white' }} />
      ) : snapshots.length === 0 ? (
        <Typography sx={{ color: '#9ca3af' }}>
          {disagreementsOnly
            ? 'No disagreements yet — the model backfill may still be running, or everything has been verdicted.'
            : 'No frames to show.'}
        </Typography>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {snapshots.map((s) => (
              <Box
                key={`${s.source ?? 'webcam'}-${s.snapshot.id}`}
                sx={{ position: 'relative', width: 256 }}
              >
                {isFlickr(s) && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 18,
                      left: 18,
                      zIndex: 2,
                      backgroundColor: 'rgba(124,58,237,0.85)', // violet — Flickr
                      color: 'white',
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      fontSize: 11,
                      fontWeight: 700,
                      maxWidth: 220,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={`Flickr · ${s.title ?? ''}${
                      s.owner ? ` · ${s.owner}` : ''
                    }`}
                  >
                    Flickr · {s.title || 'untitled'}
                    {s.owner ? ` · ${s.owner}` : ''}
                  </Box>
                )}
                <RatingCard webcam={frameToCard(s)} readOnly onRate={noop} />
              </Box>
            ))}
          </Box>

          {maybeMore && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <Button
                variant="outlined"
                onClick={() => setLimit((n) => n + PAGE)}
                disabled={loading}
                sx={{ color: 'white', borderColor: '#4b5563' }}
              >
                {loading ? 'Loading…' : 'Load more'}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

export default VerificationTab;
