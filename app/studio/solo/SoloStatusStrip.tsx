'use client';

import type { StateView } from '@/app/api/kiosk/solo/view';
import type { Zone } from '@/app/lib/solo/zone';
import { formatCountdown, nextCronMs } from './countdown';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const item = { marginRight: 18, cursor: 'help' } as const;
const fmtDeg = (d: number) => `${d < 0 ? '−' : '+'}${Math.abs(d)}°`;

/** The solo studio's telemetry line: the cron clock, what it last brought in, the glass revision, the zone. */
export function SoloStatusStrip({ nowMs, sunrise, sunset, liveRevision, diffCount, zone }: {
  nowMs: number;
  sunrise?: StateView;
  sunset?: StateView;
  liveRevision: number;
  diffCount: number;
  zone?: Zone;
}) {
  const pull = (v?: StateView) => (v ? `${v.lastPull.admitted.sunset} + ${v.lastPull.admitted.nonSunset}` : '–');
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: mono, fontSize: 12, color: '#9aa3b2', height: '100%' }}>
      <span style={item} title="The cron pulls every camera in the sweep from Windy on this clock. New frames enter the bins right after it runs.">
        next pull in <b style={{ color: '#f5a344' }}>{formatCountdown(nextCronMs(nowMs) - nowMs)}</b>
      </span>
      <span style={item} title="Frames the last pull admitted, sunsets + non-sunsets, per feed (↑ sunrise, ↓ sunset).">
        last pull: <b style={{ color: '#e5e7eb' }}>↑ {pull(sunrise)} · ↓ {pull(sunset)}</b>
      </span>
      <span style={item} title="The live settings revision the glass reads, and how many studio dials differ from it.">
        glass <b style={{ color: '#e5e7eb' }}>rev {liveRevision}</b>
        {diffCount > 0 ? ` · ${diffCount} differ` : ' · dials match glass'}
      </span>
      {zone && (
        <span style={item} title="The sweep zone in solar altitude; cameras outside it leave the bins after the grace.">
          zone <b style={{ color: '#e5e7eb' }}>{fmtDeg(zone.minDeg)} … {fmtDeg(zone.maxDeg)}</b>
        </span>
      )}
    </div>
  );
}
