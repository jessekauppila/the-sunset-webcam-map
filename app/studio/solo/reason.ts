import type { Stage } from '@/app/lib/solo/stages';
import { formatDetection, formatRating } from '@/app/lib/solo/scores';
import type { BinKind } from '@/app/lib/solo/types';

interface Reasoned {
  bin: BinKind;
  quality: number | null;
  detection: number;
  tally: number;
  lastShownAt?: number | null;
}

function ago(lastShownAt: number, nowMs: number): string {
  const min = Math.floor((nowMs - lastShownAt) / 60_000);
  return min < 1 ? 'last <1 min ago' : `last ${min} min ago`;
}

function history(e: Reasoned, nowMs: number): string {
  return e.lastShownAt == null ? 'never shown' : `shown ×${e.tally} · ${ago(e.lastShownAt, nowMs)}`;
}

/** One line under a studio row saying why the frame is where it is (stages spec §3.3). */
export function reasonLine(stage: Stage, e: Reasoned, nowMs: number): string {
  switch (stage.kind) {
    case 'onGlass':
      return `on glass · shown ×${e.tally}`;
    case 'queued':
      return `draw ${stage.position} · ${history(e, nowMs)}`;
    case 'inLine':
      return stage.position == null ? `in line · ${history(e, nowMs)}` : `draw ${stage.position} · ${history(e, nowMs)}`;
    case 'resting':
      return `back in ${stage.drawsLeft} ${stage.drawsLeft === 1 ? 'draw' : 'draws'} · shown ×${e.tally}`;
    case 'underFloor':
      return e.bin === 'sunset'
        ? `rating ${formatRating(e.quality ?? 0)} < ${formatRating(stage.floor)}`
        : `sunset ${formatDetection(e.detection)} < ${formatDetection(stage.floor)}`;
  }
}
