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

  it('shows the rating with two decimals only in the sunset state (display gate B)', () => {
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
    // Display gate B: when the verdict is "not a sunset", the popup
    // suppresses the numeric rating entirely. The value still exists
    // in the DB; the popup just doesn't surface it.
    expect(notSunset).not.toContain('1.84');
    expect(notSunset).toContain('Not a sunset');
  });

  it('does not render any star SVG in the not-a-sunset state', () => {
    const html = renderAiRatingBlock({
      rating: 1.5,
      modelVersion: 'v4',
      uniqueKey: 1,
    });
    expect(html).toContain('Not a sunset');
    // Sunset state uses a <svg> for the star row; the not-a-sunset state
    // has no rating UI at all.
    expect(html).not.toContain('<svg');
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
    // which has no rating UI at all under display gate B.
    expect(under).toContain('Not a sunset');
    expect(under).not.toContain('clipPath');
  });

  it('renders dual-line footer (binary + rating) when binary version is distinct from regression', () => {
    const html = renderAiRatingBlock({
      rating: 3.66,
      modelVersion: 'v4_regression_llm_with_flickr',
      uniqueKey: 1,
      binaryIsSunset: true,
      binaryModelVersion: '20260601_063518_v4_binary_llm_with_flickr',
    });
    expect(html).toContain('binary');
    expect(html).toContain('rating');
    // Both versions formatted via formatModelLabel — both render as the
    // same "v4 · llm_with_flickr" suffix (because the regex strips the
    // "_regression_" / "_binary_" infix from both). What matters is the
    // two-line layout exists.
    expect(html.match(/v4 · llm_with_flickr/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('collapses to single-line footer when binary version matches regression (legacy stamping)', () => {
    const html = renderAiRatingBlock({
      rating: 3.66,
      modelVersion: 'v4_regression_llm_with_flickr',
      uniqueKey: 1,
      binaryIsSunset: true,
      // Matches modelVersion — no real binary signal.
      binaryModelVersion: 'v4_regression_llm_with_flickr',
    });
    expect(html).not.toContain('binary');
    expect(html).not.toContain('rating&nbsp;');
  });

  it('collapses to single-line footer when binaryModelVersion is omitted', () => {
    const html = renderAiRatingBlock({
      rating: 3.66,
      modelVersion: 'v4_regression_llm_with_flickr',
      uniqueKey: 1,
    });
    expect(html).not.toContain('binary');
  });

  it('two-line footer also renders in the not-a-sunset state', () => {
    const html = renderAiRatingBlock({
      rating: 1.5,
      modelVersion: 'v4_regression_llm_with_flickr',
      uniqueKey: 1,
      binaryIsSunset: false,
      binaryModelVersion: '20260601_063518_v4_binary_llm_with_flickr',
    });
    expect(html).toContain('Not a sunset');
    expect(html).toContain('binary');
    expect(html).toContain('rating');
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
