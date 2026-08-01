import { KIOSK_QUIET_DEFAULT } from '@/app/lib/masterConfig';

export type QuietWindow = { start: number; end: number } | null;

export function parseQuietParam(raw: string | null): QuietWindow {
  const value = raw?.trim() || KIOSK_QUIET_DEFAULT;
  if (value === 'off') return null;
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) return parseQuietParam(KIOSK_QUIET_DEFAULT);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 23) return parseQuietParam(KIOSK_QUIET_DEFAULT);
  return { start, end };
}

// Half-open [start, end); a window crossing midnight (23-9) wraps.
export function isInQuietHours(hourLocal: number, quiet: QuietWindow): boolean {
  if (!quiet) return false;
  const { start, end } = quiet;
  if (start === end) return false;
  if (start < end) return hourLocal >= start && hourLocal < end;
  return hourLocal >= start || hourLocal < end;
}

export interface KioskGate {
  visible: boolean;
  localDoze: boolean;
  remoteDoze: boolean;
  quiet: QuietWindow;
  hourLocal: number;
  msSinceInteraction: number | null;
  wakeMinutes: number;
}

export function isDozing(gate: KioskGate): boolean {
  if (gate.localDoze || gate.remoteDoze) return true;
  const awakeByInteraction =
    gate.msSinceInteraction !== null &&
    gate.msSinceInteraction < gate.wakeMinutes * 60_000;
  return isInQuietHours(gate.hourLocal, gate.quiet) && !awakeByInteraction;
}

export function shouldRunTick(gate: KioskGate): boolean {
  return gate.visible && !isDozing(gate);
}
