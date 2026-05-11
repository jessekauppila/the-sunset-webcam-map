// app/components/ModelAnalysis/FailureGallery.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FailureGallery } from './FailureGallery';
import type { FailureGallery as FailureGalleryType } from '@/app/lib/modelRuns.types';

const gallery: FailureGalleryType = {
  schema_version: 1,
  generated_at: '2026-05-11T00:00:00Z',
  split: 'val',
  target_type: 'regression',
  items: [
    {
      snapshot_id: 's1',
      webcam_id: 1842,
      image_url: 'https://example.com/s1.jpg',
      true_label: 0.85,
      predicted_score: 0.21,
      absolute_error: 0.64,
      captured_at: null,
      llm_explanation: 'Vivid orange',
    },
  ],
};

describe('FailureGallery', () => {
  it('renders an item per entry with true/pred values and error', () => {
    render(<FailureGallery gallery={gallery} />);
    expect(screen.getByText(/true 0\.85/i)).toBeInTheDocument();
    expect(screen.getByText(/pred 0\.21/i)).toBeInTheDocument();
    expect(screen.getByText(/off by 0\.64/i)).toBeInTheDocument();
  });

  it('renders an empty state if no items', () => {
    render(<FailureGallery gallery={{ ...gallery, items: [] }} />);
    expect(screen.getByText(/no failures to show/i)).toBeInTheDocument();
  });

  it('image is wrapped in a link that opens in a new tab', () => {
    render(<FailureGallery gallery={gallery} />);
    const link = screen.getByRole('link', { name: /open snapshot s1/i });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('href')).toBe('https://example.com/s1.jpg');
  });
});
