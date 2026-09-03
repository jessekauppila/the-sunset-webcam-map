// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  sendDailyUsageDigest,
  formatCalibrationLine,
  formatSweepLine,
  sweptAltitudeSpan,
} from './dailyDigest';
import type { SweepDigestSummary, SweepRingStats } from './sweepStats';

const NOW = new Date('2026-08-03T00:20:00Z');
const SUNSET = 'noisy-leaf-96391119';
const NWAC = 'rough-resonance-57753560';

const usageRows = [
  { day: '2026-08-01', project_id: SUNSET, compute_time_s: '18000' }, // 5h MTD
  { day: '2026-08-02', project_id: SUNSET, compute_time_s: '39600' }, // 11h MTD (+6h)
  { day: '2026-08-01', project_id: NWAC, compute_time_s: '3600' }, // 1h MTD
  { day: '2026-08-02', project_id: NWAC, compute_time_s: '7200' }, // 2h MTD (+1h)
];
const eventRows = [
  { occurred_on: '2026-08-01', sha: null, description: 'autoscale 0.25-1 CU' },
];

describe('sendDailyUsageDigest', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    sqlMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.RESEND_API_KEY = 'test-key';
    process.env.DIGEST_EMAIL_TO = 'jesse@example.com';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.DIGEST_EMAIL_TO;
  });

  it('skips without RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendDailyUsageDigest(NOW);
    expect(result).toEqual({ skipped: 'no-resend-key' });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips without DIGEST_EMAIL_TO', async () => {
    delete process.env.DIGEST_EMAIL_TO;
    const result = await sendDailyUsageDigest(NOW);
    expect(result).toEqual({ skipped: 'no-recipient' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends an email whose html carries per-project deltas, dollars, and events', async () => {
    sqlMock
      .mockResolvedValueOnce(usageRows) // provider_usage_daily
      .mockResolvedValueOnce(eventRows); // cost_events
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_1' }) });

    const result = await sendDailyUsageDigest(NOW);
    expect(result).toEqual({ sent: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['jesse@example.com']);
    // subject leads with yesterday's sunset-site hours
    expect(body.subject).toContain('6');
    // html: named series, yesterday's deltas, MTD dollar estimate, cost event
    expect(body.html).toContain('sunrise-sunset');
    expect(body.html).toContain('nwac-observations');
    expect(body.html).toContain('6.0'); // sunset delta hours on 08-02
    expect(body.html).toContain('$'); // dollar estimate present
    expect(body.html).toContain('autoscale 0.25-1 CU');
  });

  it('returns skipped when the send fails, never throws', async () => {
    sqlMock.mockResolvedValueOnce(usageRows).mockResolvedValueOnce([]);
    fetchMock.mockRejectedValueOnce(new Error('resend down'));
    const result = await sendDailyUsageDigest(NOW);
    expect(result).toEqual({ skipped: 'send-failed' });
  });
});

describe('calibration section is isolated from the cost email', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    sqlMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.RESEND_API_KEY = 'test-key';
    process.env.DIGEST_EMAIL_TO = 'jesse@example.com';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.DIGEST_EMAIL_TO;
  });

  // The digest's job is the cost email. If the calibration tables are missing
  // (migration not run on some environment) the email must still go out.
  it('still sends the cost email when the calibration query throws', async () => {
    sqlMock
      .mockResolvedValueOnce(usageRows)
      .mockResolvedValueOnce(eventRows)
      .mockRejectedValue(new Error('relation "camera_calibration_history" does not exist'));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_1' }) });

    const result = await sendDailyUsageDigest(NOW);

    expect(result).toEqual({ sent: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toContain('CU-hr');        // cost content survived
    expect(body.html).not.toContain('Calibration:'); // section degraded to silence
  });

  it('includes the calibration line when the data is available', async () => {
    sqlMock
      .mockResolvedValueOnce(usageRows)
      .mockResolvedValueOnce(eventRows)
      .mockResolvedValueOnce([{ tempered: 17 }])
      .mockResolvedValueOnce([
        { webcam_id: 4057187, title: 'Broome International Airport', multiplier: 0.59 },
      ])
      .mockResolvedValueOnce([{ healed: 1 }]);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'em_1' }) });

    await sendDailyUsageDigest(NOW);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toContain('17 cameras tempered');
    expect(body.html).toContain('Broome International Airport 0.59');
    expect(body.html).toContain('1 healed');
  });
});

describe('formatCalibrationLine', () => {
  it('renders total, newly tempered with names, and healed', () => {
    const html = formatCalibrationLine({
      tempered: 17,
      newlyTempered: [
        { webcamId: 4057187, title: 'Broome International Airport', multiplier: 0.59 },
        { webcamId: 29182812, title: 'Ceduna', multiplier: 0.72 },
      ],
      healed: 1,
    });
    expect(html).toContain('17 cameras tempered');
    expect(html).toContain('2 newly tempered');
    expect(html).toContain('Broome International Airport 0.59');
    expect(html).toContain('Ceduna 0.72');
    expect(html).toContain('1 healed');
  });

  it('omits the newly/healed clauses when nothing changed', () => {
    const html = formatCalibrationLine({ tempered: 17, newlyTempered: [], healed: 0 });
    expect(html).toContain('17 cameras tempered');
    expect(html).toContain('no changes');
    expect(html).not.toContain('newly tempered');
    expect(html).not.toContain('healed');
  });

  it('renders nothing at all when calibration data is unavailable', () => {
    expect(formatCalibrationLine(null)).toBe('');
  });

  it('falls back to the webcam id when a camera has no title', () => {
    const html = formatCalibrationLine({
      tempered: 1,
      newlyTempered: [{ webcamId: 4057187, title: null, multiplier: 0.59 }],
      healed: 0,
    });
    expect(html).toContain('#4057187 0.59');
  });

  it('singularises one newly tempered camera', () => {
    const html = formatCalibrationLine({
      tempered: 3,
      newlyTempered: [{ webcamId: 1, title: 'A', multiplier: 0.8 }],
      healed: 0,
    });
    expect(html).toContain('1 newly tempered');
  });
});

/** `ringStat(offsetDeg)`: a plausible ring, base by default at offset 0. */
function ringStat(offsetDeg: number): SweepRingStats {
  const isBase = offsetDeg === 0;
  return {
    offsetDeg,
    ringsSwept: 96,
    boxesAttempted: isBase ? 2976 : 2880,
    boxesEmpty: isBase ? 300 : 200,
    boxesFailed: 0,
    newWebcams: isBase ? 400 : 45,
    framesScored: isBase ? 380 : 40,
    framesGatePassed: isBase ? 130 : 4,
    elapsedMs: isBase ? 1_152_000 : 960_000,
  };
}

/** A day where only the base ring ran. */
function summaryBaseOnly(): SweepDigestSummary {
  return {
    ticks: 96,
    escalatedTicks: 0,
    budgetExhaustedTicks: 0,
    sunriseThinTicks: 0,
    sunsetThinTicks: 0,
    sunriseShortTicks: 0,
    sunsetShortTicks: 0,
    baseBoxes: 2976,
    escalationBoxes: 0,
    baseMs: 1_152_000,
    escalationMs: 0,
    rings: [ringStat(0)],
  };
}

/** A day where the base ring plus one day-side (+15.75°) ring both ran. */
function summaryWithDayRing(): SweepDigestSummary {
  return {
    ...summaryBaseOnly(),
    escalatedTicks: 12,
    sunsetThinTicks: 12,
    escalationBoxes: 2880,
    escalationMs: 960_000,
    // Desc by offset_deg, like getSweepDigestSummary's real ORDER BY — a
    // base-first fixture here would mask the i===0 ring-labeling bug (M4).
    rings: [ringStat(15.75), ringStat(0)],
  };
}

describe('sweptAltitudeSpan', () => {
  it('is the base ring alone when nothing escalated', () => {
    expect(sweptAltitudeSpan([ringStat(0)])).toEqual({ min: -24, max: -2 });
  });

  it('reaches golden hour once the day-side ring ran', () => {
    expect(sweptAltitudeSpan([ringStat(0), ringStat(15.75)])).toEqual({
      min: -24,
      max: 13.75,
    });
  });

  it('is null when no ring ran', () => {
    expect(sweptAltitudeSpan([])).toBeNull();
  });
});

describe('formatSweepLine', () => {
  const quiet = {
    ticks: 96,
    escalatedTicks: 0,
    budgetExhaustedTicks: 0,
    sunriseThinTicks: 0,
    sunsetThinTicks: 0,
    sunriseShortTicks: 0,
    sunsetShortTicks: 0,
    baseBoxes: 2976,
    escalationBoxes: 0,
    baseMs: 1_152_000,
    escalationMs: 0,
    rings: [
      {
        offsetDeg: 0,
        ringsSwept: 96,
        boxesAttempted: 2976,
        boxesEmpty: 300,
        boxesFailed: 0,
        newWebcams: 400,
        framesScored: 380,
        framesGatePassed: 130,
        elapsedMs: 1_152_000,
      },
    ],
  };

  it('renders nothing when no sweep was recorded', () => {
    expect(formatSweepLine(null)).toBe('');
  });

  it('prints only the summary and efficiency lines on a quiet day', () => {
    const html = formatSweepLine(quiet);
    expect(html).toContain('no feed fell under the floor');
    expect(html).toContain('2,976');
    // Nothing was widened, so there is no widening bill and no per-ring
    // comparison table. (The per-gate-passed cost line still prints — that
    // question doesn't require widening to have an answer.)
    expect(html).not.toContain('Widening cost');
    expect(html).not.toContain('Rings:');
  });

  it('prints the swept altitude span in degrees, not ring offsets', () => {
    expect(formatSweepLine(summaryWithDayRing())).toContain('-24° to +14°');
  });

  it('shows a partial-escalation ring share against the base ring\'s ticks, not just the full-day hull', () => {
    // Base ran all 96 ticks; the day-side ring ran only 12 of them. The span
    // alone would print the same "-24° to +14°" as a day where +15.75 ran
    // every tick, which over-claims how much of the day it actually covered.
    const html = formatSweepLine({
      ...quiet,
      escalatedTicks: 12,
      sunsetThinTicks: 12,
      escalationBoxes: 180,
      rings: [
        quiet.rings[0], // base, ringsSwept: 96
        {
          offsetDeg: 15.75,
          ringsSwept: 12,
          boxesAttempted: 180,
          boxesEmpty: 20,
          boxesFailed: 0,
          newWebcams: 45,
          framesScored: 40,
          framesGatePassed: 4,
          elapsedMs: 60_000,
        },
      ],
    });
    expect(html).toContain('12/96 ticks');
  });

  it('prints no ticks-share parenthetical on a base-only day', () => {
    expect(formatSweepLine(summaryBaseOnly())).not.toContain('ticks)');
  });

  it('prints the widening bill as seconds and frames, not just boxes', () => {
    const html = formatSweepLine(summaryWithDayRing());
    expect(html).toContain('Widening cost');
    expect(html).toContain('16.0 min/day sweeping');
  });

  it('prints what each ring cost per sunset it delivered', () => {
    // The lever question. A ring that costs twice as many boxes per
    // gate-passed frame as the base ring is the one to narrow or drop, and
    // that ratio is invisible in any total.
    const html = formatSweepLine(summaryWithDayRing());
    expect(html).toContain('Per gate-passed');
  });

  it('says nothing about widening cost when nothing escalated', () => {
    expect(formatSweepLine(summaryBaseOnly())).not.toContain('Widening cost');
  });

  it('reports failed boxes apart from empty ones, and only when there are any', () => {
    expect(formatSweepLine(summaryBaseOnly())).not.toContain('boxes failed');
    const withFailures = summaryBaseOnly();
    withFailures.rings[0].boxesFailed = 12;
    expect(formatSweepLine(withFailures)).toContain('12 boxes failed');
  });

  it('names the thin feed, the escalation cost, and its share of the baseline', () => {
    const html = formatSweepLine({
      ...quiet,
      escalatedTicks: 12,
      sunsetThinTicks: 12,
      sunsetShortTicks: 4,
      escalationBoxes: 180,
    });
    expect(html).toContain('sunset thin on 12 of 96 ticks');
    expect(html).toContain('4 still short');
    expect(html).toContain('+180 boxes');
    expect(html).toContain('2,976 base');
    expect(html).toContain('+6%');
    expect(html).not.toContain('sunrise thin');
  });

  it('compares gate-pass rates per ring, which is the golden-hour question', () => {
    const html = formatSweepLine({
      ...quiet,
      escalatedTicks: 12,
      sunsetThinTicks: 12,
      escalationBoxes: 180,
      rings: [
        ...quiet.rings,
        {
          offsetDeg: 15.75,
          ringsSwept: 12,
          boxesAttempted: 180,
          boxesEmpty: 20,
          boxesFailed: 0,
          newWebcams: 45,
          framesScored: 40,
          framesGatePassed: 4,
          elapsedMs: 60_000,
        },
      ],
    });
    expect(html).toContain('base 130/380 gate-passed (34%)');
    expect(html).toContain('+15.75');
    expect(html).toContain('4/40');
    expect(html).toContain('10%');
  });

  it('flags a budget-starved day and a rising empty-box share', () => {
    const html = formatSweepLine({
      ...quiet,
      budgetExhaustedTicks: 7,
      rings: [{ ...quiet.rings[0], boxesEmpty: 1500 }],
    });
    expect(html).toContain('7 ticks hit the sweep budget');
    expect(html).toContain('50% of boxes empty');
  });
});
