// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const sqlMock = vi.fn();
const requireOwnerMock = vi.fn();

vi.mock('@/app/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values);
  // archive/curated branches reference sql.unsafe; hard-examples doesn't.
  (sql as unknown as { unsafe: (s: string) => string }).unsafe = (s: string) => s;
  return { sql };
});

// Guard pulls in real Auth.js/Google at import otherwise.
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

import { GET } from './route';

const req = (qs: string) => new Request(`http://test/api/snapshots${qs}`);

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  requireOwnerMock.mockReset().mockResolvedValue(null); // default: authorized owner
});

describe('GET /api/snapshots?mode=hard-examples', () => {
  it('returns 401 (gated) before running any query when not the owner', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    );
    const res = await GET(req('?mode=hard-examples'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('ranks model-vs-Claude first, then gap magnitude, then recency', async () => {
    await GET(req('?mode=hard-examples'));
    const mainCall = sqlMock.mock.calls.find(([strings]) =>
      strings.join('?').match(/model_disagreement_kind IS NOT NULL/i),
    );
    expect(mainCall).toBeDefined();
    const q = (mainCall![0] as TemplateStringsArray).join('?');
    // Priority CASE: model-vs-Claude kinds at 100, binary split at 50.
    expect(q).toMatch(/WHEN 'model_low_claude_sunset' THEN 100/);
    expect(q).toMatch(/WHEN 'binary_negative_regression_high' THEN 50/);
    // Magnitude tiebreak on the [0,1] score gap, then recency.
    expect(q).toMatch(/ABS\(COALESCE\(s\.ai_regression_score, 0\) - COALESCE\(s\.llm_quality, 0\)\) DESC/i);
    expect(q).toMatch(/s\.captured_at DESC/i);
  });

  it('excludes verdicted frames UNCONDITIONALLY (not scoped to a user_session_id)', async () => {
    await GET(req('?mode=hard-examples&user_session_id=abc123'));
    const exclusionCall = sqlMock.mock.calls.find(([strings]) =>
      strings.join('?').match(/is_sunset_verdict IS NOT NULL/i),
    );
    expect(exclusionCall).toBeDefined();
    const q = (exclusionCall![0] as TemplateStringsArray).join('?');
    // The membership invariant must NOT key on user_session_id anymore.
    expect(q).not.toMatch(/user_session_id/i);
  });
});
