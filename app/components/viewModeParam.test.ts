import { describe, it, expect } from 'vitest';
import { parseViewMode, homeHrefFor } from './viewModeParam';

describe('parseViewMode', () => {
  it('reads a known view out of the query string', () => {
    expect(parseViewMode('?view=my-cameras', 'globe')).toBe('my-cameras');
  });

  it('falls back when the param is absent', () => {
    expect(parseViewMode('', 'globe')).toBe('globe');
  });

  it('ignores a value that is not a view, rather than rendering nothing', () => {
    expect(parseViewMode('?view=studio', 'globe')).toBe('globe');
    expect(parseViewMode('?view=../etc', 'globe')).toBe('globe');
  });

  it('survives other params alongside it', () => {
    expect(parseViewMode('?a=1&view=globe&b=2', 'map')).toBe('globe');
  });
});

describe('homeHrefFor', () => {
  it('round-trips through parseViewMode', () => {
    const href = homeHrefFor('my-cameras');
    expect(parseViewMode(href.slice(href.indexOf('?')), 'globe')).toBe('my-cameras');
  });
});
