import { it, expect } from 'vitest';
import { reasonLine } from './reason';

const base = { bin: 'sunset' as const, quality: 0.43, detection: 0.21, tally: 4, lastShownAt: 100_000 };
const NOW = 100_000 + 14 * 60_000;

it('on glass', () => {
  expect(reasonLine({ kind: 'onGlass' }, base, NOW)).toBe('on glass · shown ×4');
});
it('queued and in line say the draw, the tally, and how long since shown', () => {
  expect(reasonLine({ kind: 'queued', position: 3 }, base, NOW)).toBe('draw 3 · shown ×4 · last 14 min ago');
  expect(reasonLine({ kind: 'inLine', position: 12 }, { ...base, tally: 13 }, NOW)).toBe('draw 12 · shown ×13 · last 14 min ago');
  expect(reasonLine({ kind: 'inLine', position: 12 }, { ...base, tally: 0, lastShownAt: null }, NOW)).toBe('draw 12 · never shown');
  expect(reasonLine({ kind: 'inLine', position: null }, base, NOW)).toBe('in line · shown ×4 · last 14 min ago');
  expect(reasonLine({ kind: 'queued', position: 1 }, { ...base, lastShownAt: NOW - 20_000 }, NOW)).toBe('draw 1 · shown ×4 · last <1 min ago');
});
it('resting says when it is back', () => {
  expect(reasonLine({ kind: 'resting', drawsLeft: 3 }, base, NOW)).toBe('back in 3 draws · shown ×4');
  expect(reasonLine({ kind: 'resting', drawsLeft: 1 }, base, NOW)).toBe('back in 1 draw · shown ×4');
});
it('under floor names the miss on the bin\'s own scale', () => {
  expect(reasonLine({ kind: 'underFloor', floor: 0.55 }, base, NOW)).toBe('rating 2.7 < 3.2');
  expect(reasonLine({ kind: 'underFloor', floor: 0.3 }, { ...base, bin: 'non_sunset', quality: null }, NOW)).toBe('sunset 21% < 30%');
});
