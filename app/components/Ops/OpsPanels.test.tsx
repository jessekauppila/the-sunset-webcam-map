import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpsPanels } from './OpsPanels';
import type { OpsStatsResponse } from '@/app/lib/opsTypes';

const data: OpsStatsResponse = {
  dailyStats: [
    {
      date: '2026-07-29',
      model_version: 'v4',
      webcams_scored: 500,
      cache_hits: 400,
      fallbacks: 5,
      score_p50: 0.3,
      score_p90: 0.7,
      source_breakdown: { windy: { scored: 480, avg: 0.4 } },
    },
    {
      date: '2026-07-30',
      model_version: 'v4',
      webcams_scored: 0, // null-score day, like 2026-06-03
      cache_hits: 0,
      fallbacks: 0,
      score_p50: null,
      score_p90: null,
      source_breakdown: null,
    },
  ],
  providerUsage: [],
  costEvents: [],
};

describe('OpsPanels', () => {
  it('renders fallback % and cache-hit % from the latest full day', () => {
    render(<OpsPanels data={data} />);
    // latest day with webcams_scored > 0 is 2026-07-29: 5/500 = 1%, 400/500 = 80%
    expect(screen.getByText(/fallbacks/i).parentElement!.textContent).toContain('1%');
    expect(screen.getByText(/cache hits/i).parentElement!.textContent).toContain('80%');
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('renders an empty state when there is no data', () => {
    render(<OpsPanels data={{ dailyStats: [], providerUsage: [], costEvents: [] }} />);
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });
});
