import { describe, it, expect } from 'vitest';
import {
  renderAiRatingBlock,
  formatModelLabel,
  SUNSET_DETECTION_THRESHOLD,
} from './aiRatingBlock';

describe('renderAiRatingBlock', () => {
  it('returns empty string when rating is null', () => {
    expect(
      renderAiRatingBlock({ rating: null, modelVersion: 'v4', uniqueKey: 1 }),
    ).toBe('');
  });

  it('renders the "Sunset detected" copy when rating is at the threshold', () => {
    const html = renderAiRatingBlock({
      rating: SUNSET_DETECTION_THRESHOLD,
      modelVersion: 'v4_regression_llm_with_flickr',
      uniqueKey: 7,
    });
    expect(html).toContain('Sunset detected');
    expect(html).not.toContain('Not a sunset');
  });

  it('renders the "Not a sunset right now" copy when rating is below the threshold', () => {
    const html = renderAiRatingBlock({
      rating: SUNSET_DETECTION_THRESHOLD - 0.01,
      modelVersion: 'v4',
      uniqueKey: 7,
    });
    expect(html).toContain('Not a sunset right now');
    expect(html).not.toContain('Sunset detected');
  });

  it('binaryIsSunset=true overrides the regression-threshold proxy (low rating still shows sunset)', () => {
    const html = renderAiRatingBlock({
      rating: 1.5,
      modelVersion: 'v4',
      uniqueKey: 1,
      binaryIsSunset: true,
    });
    expect(html).toContain('Sunset detected');
    expect(html).not.toContain('Not a sunset');
  });

  it('binaryIsSunset=false overrides the regression-threshold proxy (high rating still shows not-a-sunset)', () => {
    const html = renderAiRatingBlock({
      rating: 4.5,
      modelVersion: 'v4',
      uniqueKey: 1,
      binaryIsSunset: false,
    });
    expect(html).toContain('Not a sunset');
    expect(html).not.toContain('Sunset detected');
  });

  it('falls back to the regression proxy when binaryIsSunset is null', () => {
    const html = renderAiRatingBlock({
      rating: 3.0,
      modelVersion: 'v4',
      uniqueKey: 1,
      binaryIsSunset: null,
    });
    // 3.0 >= 2.6 → sunset detected by proxy.
    expect(html).toContain('Sunset detected');
  });

  it('shows the rating with two decimals in both states', () => {
    const sunset = renderAiRatingBlock({
      rating: 3.66,
      modelVersion: 'v4',
      uniqueKey: 1,
    });
    expect(sunset).toContain('3.66');

    const notSunset = renderAiRatingBlock({
      rating: 1.84,
      modelVersion: 'v4',
      uniqueKey: 2,
    });
    expect(notSunset).toContain('1.84');
  });

  it('namespaces the clipPath id with the unique key', () => {
    const a = renderAiRatingBlock({ rating: 4.2, modelVersion: 'v4', uniqueKey: 100 });
    const b = renderAiRatingBlock({ rating: 4.2, modelVersion: 'v4', uniqueKey: 200 });
    expect(a).toContain('ai-rating-fill-100');
    expect(b).toContain('ai-rating-fill-200');
    expect(a).not.toContain('ai-rating-fill-200');
  });

  it('clamps the star fill width to the 0..62 range for out-of-range ratings', () => {
    const over = renderAiRatingBlock({ rating: 8, modelVersion: 'v4', uniqueKey: 'x' });
    // 5/5 * 62 = 62 — anything above 5 should still cap at 62.
    expect(over).toContain('width="62.00"');

    const under = renderAiRatingBlock({ rating: -2, modelVersion: 'v4', uniqueKey: 'y' });
    // Negative rating renders the "not a sunset" block (below threshold),
    // which uses the empty-stars helper and has no clipPath at all.
    expect(under).toContain('Not a sunset');
    expect(under).not.toContain('clipPath');
  });

  it('sanitises HTML-special chars from the model version', () => {
    const html = renderAiRatingBlock({
      rating: 4,
      modelVersion: '<script>alert(1)</script>',
      uniqueKey: 1,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('formatModelLabel', () => {
  it('returns an em-dash for null', () => {
    expect(formatModelLabel(null)).toBe('—');
  });

  it('strips a timestamp prefix and splits the regression/binary infix', () => {
    expect(
      formatModelLabel('20260513_113243_v4_regression_llm_with_flickr'),
    ).toBe('v4 · llm_with_flickr');
  });

  it('handles untagged versions without a timestamp', () => {
    expect(formatModelLabel('v4_regression_llm_with_flickr')).toBe(
      'v4 · llm_with_flickr',
    );
  });

  it('falls back to the cleaned string when the pattern does not match', () => {
    expect(formatModelLabel('some-other-name')).toBe('some-other-name');
  });

  it('handles binary-prefixed versions identically', () => {
    expect(formatModelLabel('v4_binary_llm_with_flickr')).toBe(
      'v4 · llm_with_flickr',
    );
  });
});
