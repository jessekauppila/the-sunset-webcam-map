import { describe, it, expect } from 'vitest';
import { parseSceneInstant, clampWindowMinutes } from './sceneTime';

describe('parseSceneInstant', () => {
  it('accepts a UTC instant', () => {
    const r = parseSceneInstant('2026-03-20T18:30:00Z');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.toISOString()).toBe('2026-03-20T18:30:00.000Z');
  });

  it('accepts an explicit offset and normalises it', () => {
    const r = parseSceneInstant('2026-03-20T18:30:00-07:00');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.toISOString()).toBe('2026-03-21T01:30:00.000Z');
  });

  it('REJECTS a bare wall-clock time, which would shift the scene silently', () => {
    const r = parseSceneInstant('2026-03-20T18:30:00');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no-timezone');
  });

  it('rejects a date with no time, which is a whole-day ambiguity', () => {
    const r = parseSceneInstant('2026-03-20');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no-timezone');
  });

  it('rejects a garbage string that carries an offset', () => {
    const r = parseSceneInstant('not-a-date+00:00');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unparseable');
  });

  it('reports a missing value distinctly from a malformed one', () => {
    expect(parseSceneInstant(undefined)).toEqual({ ok: false, error: 'missing' });
    expect(parseSceneInstant('   ')).toEqual({ ok: false, error: 'missing' });
  });
});

describe('clampWindowMinutes', () => {
  it('defaults to 45 for anything unusable', () => {
    expect(clampWindowMinutes(undefined)).toBe(45);
    expect(clampWindowMinutes('nonsense')).toBe(45);
  });

  it('clamps to the range the endpoint accepts', () => {
    expect(clampWindowMinutes(1)).toBe(5);
    expect(clampWindowMinutes(9999)).toBe(180);
    expect(clampWindowMinutes(60)).toBe(60);
  });
});
