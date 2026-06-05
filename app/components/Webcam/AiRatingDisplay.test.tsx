import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AiRatingDisplay, { ClaudeVerdictDisplay } from './AiRatingDisplay';

describe('ClaudeVerdictDisplay', () => {
  it('renders nothing when quality is null', () => {
    const { container } = render(
      <ClaudeVerdictDisplay quality={null} isSunset model="claude-sonnet-4-5" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Claude quality as a percentage, not 1-5 stars', () => {
    const { container } = render(
      <ClaudeVerdictDisplay
        quality={0.87}
        isSunset
        model="claude-sonnet-4-5"
        phase="sunset"
      />,
    );
    // Percentage readout present.
    expect(screen.getByText('87%')).toBeInTheDocument();
    // The model block's "/5" star scale must NOT appear in the Claude block.
    expect(container.textContent).not.toContain('/5');
    // No star SVG — the % readout replaces stars.
    expect(container.querySelector('svg')).toBeNull();
    // Identified as the Claude judge.
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('uses sunset verdict copy when isSunset is true', () => {
    render(
      <ClaudeVerdictDisplay quality={0.9} isSunset phase="sunset" />,
    );
    expect(screen.getByText('Sunset detected')).toBeInTheDocument();
  });

  it('uses the not-a-sunset verdict copy when isSunset is false', () => {
    render(
      <ClaudeVerdictDisplay quality={0.4} isSunset={false} phase="sunset" />,
    );
    expect(screen.getByText('Not a sunset right now')).toBeInTheDocument();
  });

  it('falls back to a quality-only label when the verdict is unknown', () => {
    render(<ClaudeVerdictDisplay quality={0.55} isSunset={null} />);
    expect(screen.getByText('Claude quality')).toBeInTheDocument();
  });

  it('rounds quality to a whole percent', () => {
    render(<ClaudeVerdictDisplay quality={0.336} isSunset />);
    expect(screen.getByText('34%')).toBeInTheDocument();
  });
});

describe('AiRatingDisplay (model block) — unchanged behavior', () => {
  it('renders the regression rating on a 1-5 scale with stars', () => {
    const { container } = render(
      <AiRatingDisplay
        rating={4.2}
        modelVersion="v4_regression_llm_with_flickr"
        binaryIsSunset={null}
        phase="sunset"
      />,
    );
    // Model block keeps the /5 star scale — distinct from Claude's %.
    expect(container.textContent).toContain('/5');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders nothing when the model rating is null', () => {
    const { container } = render(
      <AiRatingDisplay rating={null} modelVersion={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
