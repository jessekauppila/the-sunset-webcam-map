// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { sendDailyUsageDigest } from './dailyDigest';

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
