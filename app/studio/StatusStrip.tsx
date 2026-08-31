'use client';

import { useEffect, useState } from 'react';
import { stripState, formatPollAge, type StripKind } from './stripState';
import { KIOSK_TICK_INTERVAL_MS } from '@/app/lib/masterConfig';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const green = '#4cc38a';
const amber = '#f5a344';
const red = '#e5484d';

const DOT_COLOR: Record<StripKind, string> = {
  insync: green,
  drift: green,
  deploying: amber,
  stale: red,
};

export interface GatePassCount {
  pass: number;
  total: number;
}

/**
 * The studio's telemetry line (Task 13, mockup §5): liveness dot, glass
 * version + revision the kiosk last confirmed, poll freshness, per-feed
 * detection-gate pass counts, and a right-aligned state word. `nowMs` ticks
 * every second so the poll age and deploy countdown move without a page
 * refresh.
 */
export function StatusStrip({
  glassVersion,
  liveRevision,
  lastPollAt,
  deployedAtMs,
  diffCount,
  sunrisePass,
  sunsetPass,
}: {
  glassVersion: string;
  liveRevision: number;
  lastPollAt: string | null;
  deployedAtMs: number | null;
  diffCount: number;
  sunrisePass: GatePassCount;
  sunsetPass: GatePassCount;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lastPollAtMs = lastPollAt ? Date.parse(lastPollAt) : null;
  const state = stripState({
    diffCount,
    lastPollAtMs,
    deployedAtMs,
    nowMs,
    pollIntervalMs: KIOSK_TICK_INTERVAL_MS,
  });

  const pollAge = formatPollAge(lastPollAtMs, nowMs);
  const pollLabel =
    state.kind === 'stale' ? `polled ${pollAge} — kiosk unreachable?` : `polled ${pollAge}`;

  let stateWord: React.ReactNode;
  switch (state.kind) {
    case 'insync':
      stateWord = <span style={{ color: dim }}>in sync</span>;
      break;
    case 'deploying':
      stateWord = (
        <span style={{ color: amber }}>
          deploying · on glass within {state.secondsToGlass}s
        </span>
      );
      break;
    case 'drift':
      stateWord = <span style={{ color: amber }}>{diffCount} differ</span>;
      break;
    case 'stale':
      stateWord = <span style={{ color: red }}>stale</span>;
      break;
  }

  return (
    <div
      data-testid="status-strip"
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        gap: 16,
        fontFamily: mono,
        fontSize: 11,
      }}
    >
      <span
        aria-label={`status: ${state.kind}`}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: DOT_COLOR[state.kind],
          flexShrink: 0,
        }}
      />
      <span style={{ color: dim }}>glass {glassVersion}</span>
      <span style={{ color: dim }}>rev {liveRevision}</span>
      <span style={{ color: state.kind === 'stale' ? red : dim }}>{pollLabel}</span>
      <span style={{ color: amber }}>
        ↑{sunrisePass.pass}/{sunrisePass.total} ↓{sunsetPass.pass}/{sunsetPass.total} pass
      </span>
      <span style={{ marginLeft: 'auto' }}>{stateWord}</span>
    </div>
  );
}
