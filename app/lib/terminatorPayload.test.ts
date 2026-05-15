import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/lib/db', () => ({
  sql: vi.fn(),
}));

import { imagesFromCustomSnapshot } from './terminatorPayload';

describe('imagesFromCustomSnapshot', () => {
  it('returns undefined when url is null', () => {
    expect(imagesFromCustomSnapshot(null)).toBeUndefined();
  });

  it('returns undefined when url is an empty string', () => {
    expect(imagesFromCustomSnapshot('')).toBeUndefined();
  });

  it('synthesizes a minimal images object with only current.preview populated', () => {
    const url = 'https://storage.googleapis.com/bucket/snapshots/custom/1/x.jpg';
    const result = imagesFromCustomSnapshot(url);

    expect(result).toEqual({
      current: { preview: url },
    });
  });

  it('does not synthesize fabricated sizes, icon, thumbnail, or daylight', () => {
    const url = 'https://example.com/x.jpg';
    const result = imagesFromCustomSnapshot(url);

    expect(result?.sizes).toBeUndefined();
    expect(result?.daylight).toBeUndefined();
    expect(result?.current.icon).toBeUndefined();
    expect(result?.current.thumbnail).toBeUndefined();
  });
});
