import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UsageChart } from './UsageChart';

const P = 'noisy-leaf-96391119';
const NWAC = 'rough-resonance-57753560';

describe('UsageChart', () => {
  it('labels the sunset and nwac series separately', () => {
    const { container, getByText } = render(
      <UsageChart
        usage={[
          { day: '2026-08-01', project_id: P, compute_time_s: 36000 },
          { day: '2026-08-02', project_id: P, compute_time_s: 72000 },
          { day: '2026-08-03', project_id: P, compute_time_s: 108000 },
          { day: '2026-08-01', project_id: NWAC, compute_time_s: 3600 },
          { day: '2026-08-02', project_id: NWAC, compute_time_s: 10800 },
          { day: '2026-08-03', project_id: NWAC, compute_time_s: 14400 },
        ]}
        events={[]}
      />,
    );
    expect(getByText('sunrise-sunset (this site)')).toBeInTheDocument();
    expect(getByText('nwac-observations')).toBeInTheDocument();
    const sunset = container.querySelector('polyline[data-series="sunset"]');
    const nwac = container.querySelector('polyline[data-series="nwac"]');
    expect(sunset).not.toBeNull();
    expect(nwac).not.toBeNull();
    // distinct data: sunset delta 10h vs nwac delta 2h -> different y coords
    expect(sunset!.getAttribute('points')).not.toEqual(nwac!.getAttribute('points'));
  });

  it('renders a point per derived day and a marker per event', () => {
    const { container } = render(
      <UsageChart
        usage={[
          { day: '2026-08-01', project_id: P, compute_time_s: 36000 },
          { day: '2026-08-02', project_id: P, compute_time_s: 72000 },
          { day: '2026-08-03', project_id: P, compute_time_s: 90000 },
        ]}
        events={[{ occurred_on: '2026-08-02', sha: null, description: 'autoscale' }]}
      />,
    );
    // 2 derived days (deltas skip the baseline day) -> polyline with 2 points
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('points')?.split(' ')).toHaveLength(2);
    // 1 event marker line with its description in a <title>
    expect(container.querySelectorAll('line.cost-event')).toHaveLength(1);
    expect(container.querySelector('title')?.textContent).toContain('autoscale');
  });

  it('renders an empty state with fewer than 2 snapshot days', () => {
    const { getByText } = render(<UsageChart usage={[]} events={[]} />);
    expect(getByText(/usage snapshots will appear/i)).toBeInTheDocument();
  });
});
