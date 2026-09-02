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
} from './dailyDigest';

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
    rings: [
      {
        offsetDeg: 0,
        ringsSwept: 96,
        boxesAttempted: 2976,
        boxesEmpty: 300,
        newWebcams: 400,
        framesScored: 380,
        framesGatePassed: 130,
      },
    ],
  };

  it('renders nothing when no sweep was recorded', () => {
    expect(formatSweepLine(null)).toBe('');
  });

  it('collapses a quiet day to one clause', () => {
    const html = formatSweepLine(quiet);
    expect(html).toContain('no feed fell under the floor');
    expect(html).toContain('2,976');
    // Nothing was widened, so there is no cost and no per-ring comparison.
    expect(html).not.toContain('gate-passed');
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
          newWebcams: 45,
          framesScored: 40,
          framesGatePassed: 4,
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
