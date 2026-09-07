'use client';

import { useEffect } from 'react';
import { Box, FormControlLabel, Switch, Typography } from '@mui/material';
import {
  TERMINATOR_POOL_COVERAGE_DEG,
  TERMINATOR_SUN_ALTITUDE_DEG,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from '@/app/lib/masterConfig';
import { useSweepOverlayStore, type SweepOverlayToggles } from '@/app/store/useSweepOverlayStore';

const fmt = (deg: number) => `${deg > 0 ? '+' : ''}${deg}°`;

/**
 * Owner switches that draw the sweep on the globe. Each row names the ring
 * by the solar altitude it sits at, because that is the number the pool
 * spec and the axis dials talk in; the offset is an implementation detail.
 */
export function SweepOverlayControl() {
  const store = useSweepOverlayStore();
  useEffect(() => { store.hydrate(); }, [store]);
  const dayOffset = TERMINATOR_WIDEN_OFFSETS_DEG.find((o) => o > 0);
  const nightOffset = TERMINATOR_WIDEN_OFFSETS_DEG.find((o) => o < 0);

  const row = (key: keyof SweepOverlayToggles, label: string) => (
    <FormControlLabel
      key={key}
      control={
        <Switch
          size="small"
          checked={store[key]}
          onChange={(e) => store.set(key, e.target.checked)}
          inputProps={{ 'aria-label': label }}
        />
      }
      label={<Typography sx={{ color: '#d1d5db', fontSize: 14 }}>{label}</Typography>}
    />
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        Sweep on the globe (pool gathers {fmt(TERMINATOR_POOL_COVERAGE_DEG.min)} to{' '}
        {fmt(TERMINATOR_POOL_COVERAGE_DEG.max)} solar altitude)
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
        {row('showBase', `base ring ${fmt(TERMINATOR_SUN_ALTITUDE_DEG)}`)}
        {dayOffset !== undefined && row('showDay', `day ring ${fmt(TERMINATOR_SUN_ALTITUDE_DEG + dayOffset)}`)}
        {nightOffset !== undefined && row('showNight', `night ring ${fmt(TERMINATOR_SUN_ALTITUDE_DEG + nightOffset)}`)}
        {row('showBoxes', 'Windy boxes')}
      </Box>
      <Typography variant="caption" sx={{ color: '#6b7280' }}>
        Escalation rings draw faint until the last tick actually swept them.
      </Typography>
    </Box>
  );
}
