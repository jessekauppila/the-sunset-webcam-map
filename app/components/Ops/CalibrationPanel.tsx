'use client';

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import type {
  CalibrationCameraRow,
  CalibrationHistoryRow,
  CalibrationFrameRow,
} from '@/app/lib/opsTypes';

/**
 * Per-camera calibration surface.
 * Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
 *
 * Three things, because retained evidence is only useful if it is reachable:
 * the current tempering, the frames behind it (on expand), and how each
 * camera's multiplier has moved over time.
 */
export function CalibrationPanel({
  cameras,
  history,
}: {
  cameras: CalibrationCameraRow[];
  history: CalibrationHistoryRow[];
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [frames, setFrames] = useState<Record<number, CalibrationFrameRow[]>>({});
  const [loading, setLoading] = useState(false);

  async function toggle(webcamId: number) {
    if (openId === webcamId) {
      setOpenId(null);
      return;
    }
    setOpenId(webcamId);
    if (frames[webcamId]) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/calibration-frames?webcamId=${webcamId}`);
      const json = (await res.json()) as { frames?: CalibrationFrameRow[] };
      setFrames((f) => ({ ...f, [webcamId]: json.frames ?? [] }));
    } catch {
      setFrames((f) => ({ ...f, [webcamId]: [] }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" sx={{ color: 'white', mb: 1 }}>
        Camera calibration
      </Typography>

      {cameras.length === 0 ? (
        <Typography sx={{ color: '#9ca3af' }}>
          No cameras tempered. (Neutral until the evidence writer has run and
          the nightly job has computed.)
        </Typography>
      ) : (
        <>
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            {cameras.length} tempered — click a row to see the frames behind it
          </Typography>
          <Box sx={{ mt: 1 }}>
            {cameras.map((c) => (
              <Box key={c.webcam_id} sx={{ mb: 0.5 }}>
                <Box
                  onClick={() => toggle(c.webcam_id)}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'center',
                    p: 1,
                    borderRadius: 1,
                    cursor: 'pointer',
                    backgroundColor: '#374151',
                    '&:hover': { backgroundColor: '#4b5563' },
                  }}
                >
                  <Typography sx={{ color: '#fbbf24', minWidth: 56 }}>
                    {c.multiplier.toFixed(3)}
                  </Typography>
                  <Typography sx={{ color: 'white', flex: 1 }}>
                    {c.title ?? '(untitled)'}{' '}
                    <span style={{ color: '#9ca3af' }}>#{c.webcam_id}</span>
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                    {c.false_shows?.toFixed(1)} / {c.negative_frames?.toFixed(1)} over{' '}
                    {c.false_show_days}d
                  </Typography>
                </Box>

                {openId === c.webcam_id && (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', p: 1 }}>
                    {loading && !frames[c.webcam_id] ? (
                      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                        loading frames…
                      </Typography>
                    ) : (frames[c.webcam_id] ?? []).length === 0 ? (
                      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                        No retained frames for this camera.
                      </Typography>
                    ) : (
                      (frames[c.webcam_id] ?? []).map((f) => (
                        <Box key={f.snapshot_id} sx={{ width: 120 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.firebase_url}
                            alt={`snapshot ${f.snapshot_id}`}
                            style={{ width: '100%', borderRadius: 4 }}
                          />
                          <Typography
                            variant="caption"
                            sx={{ color: '#9ca3af', display: 'block' }}
                          >
                            p {f.p_sunset.toFixed(2)} · tile{' '}
                            {f.tile == null ? '—' : f.tile.toFixed(2)}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{ color: '#6b7280', display: 'block' }}
                          >
                            {f.captured_on}
                          </Typography>
                        </Box>
                      ))
                    )}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </>
      )}

      <Typography variant="subtitle2" sx={{ color: 'white', mt: 2 }}>
        Recent changes
      </Typography>
      {history.length === 0 ? (
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>
          No multiplier changes recorded yet.
        </Typography>
      ) : (
        history.slice(0, 20).map((h, i) => (
          <Typography
            key={`${h.webcam_id}-${h.computed_at}-${i}`}
            variant="caption"
            sx={{ color: '#9ca3af', display: 'block' }}
          >
            #{h.webcam_id}:{' '}
            {h.previous_multiplier == null ? '—' : h.previous_multiplier.toFixed(3)} →{' '}
            {h.multiplier.toFixed(3)} ({h.computed_at})
          </Typography>
        ))
      )}
    </Box>
  );
}
