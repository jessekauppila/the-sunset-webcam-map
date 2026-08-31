// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyCronAuth } from './auth';

const SECRET = 'super-secret-value';

function req(init: { auth?: string; urlSecret?: string } = {}) {
  const url = init.urlSecret
    ? `http://t/api/cron/update-cameras?secret=${encodeURIComponent(init.urlSecret)}`
    : 'http://t/api/cron/update-cameras';
  return new Request(url, {
    headers: init.auth ? { authorization: init.auth } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyCronAuth', () => {
  it('accepts the Vercel cron bearer header', () => {
    expect(verifyCronAuth(req({ auth: `Bearer ${SECRET}` }))).toBe(true);
  });

  it('accepts the ?secret= URL fallback', () => {
    expect(verifyCronAuth(req({ urlSecret: SECRET }))).toBe(true);
  });

  it('rejects a wrong bearer and a wrong URL secret', () => {
    expect(verifyCronAuth(req({ auth: 'Bearer nope' }))).toBe(false);
    expect(verifyCronAuth(req({ urlSecret: 'nope' }))).toBe(false);
    expect(verifyCronAuth(req())).toBe(false);
  });

  // Regression: the check used to be `authHeader === \`Bearer ${process.env.CRON_SECRET}\``,
  // which collapses to the literal "Bearer undefined" when the env var is missing —
  // letting anyone who sends that exact header run the cron.
  it('rejects "Bearer undefined" when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronAuth(req({ auth: 'Bearer undefined' }))).toBe(false);
    expect(verifyCronAuth(req({ urlSecret: 'undefined' }))).toBe(false);
  });

  it('rejects an empty-string CRON_SECRET rather than authorizing on it', () => {
    process.env.CRON_SECRET = '';
    expect(verifyCronAuth(req({ auth: 'Bearer ' }))).toBe(false);
    expect(verifyCronAuth(req({ urlSecret: '' }))).toBe(false);
  });

  // Regression: the secret was being written to stdout on every invocation
  // (both the raw env var and the `Bearer <secret>` header), which put it in
  // Vercel's runtime logs ~once a minute via the kiosk tick path.
  it('never writes the secret to the console', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    verifyCronAuth(req({ auth: `Bearer ${SECRET}` }));
    verifyCronAuth(req({ urlSecret: SECRET }));

    const emitted = [...log.mock.calls, ...error.mock.calls, ...warn.mock.calls]
      .flat()
      .map((a) => String(a))
      .join('\n');

    expect(emitted).not.toContain(SECRET);
  });
});
