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

describe('central owner-auth (review #10)', () => {
  it('gates the verification mode (private by default) before any query', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    );
    const res = await GET(req('?mode=verification'));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('does NOT gate public modes (archive) even if the caller is not the owner', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    );
    const res = await GET(req('?mode=archive'));
    expect(res.status).not.toBe(401);
    expect(sqlMock).toHaveBeenCalled();
  });

  it('does NOT gate the default (no mode) public archive read', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await GET(req(''));
    expect(res.status).not.toBe(403);
  });
});

describe('GET /api/snapshots?mode=verification', () => {
  const allText = () =>
    sqlMock.mock.calls.map(([s]) => (s as TemplateStringsArray).join('?'));

  it('reads BOTH the webcam archive and the Flickr set (external_images)', async () => {
    await GET(req('?mode=verification'));
    const text = allText();
    expect(text.some((q) => /from\s+webcam_snapshots\s+s/i.test(q))).toBe(true);
    expect(text.some((q) => /from\s+external_images\s+e/i.test(q))).toBe(true);
  });

  it('disagreements_only=true filters to flagged frames (both legs)', async () => {
    await GET(req('?mode=verification&disagreements_only=true'));
    const text = allText();
    // The flagged filter fragment runs for both legs.
    const flagged = text.filter((q) =>
      /model_disagreement_kind\s+is\s+not\s+null/i.test(q),
    );
    expect(flagged.length).toBeGreaterThanOrEqual(2);
  });

  it('browse (no toggle) does NOT filter on disagreement kind', async () => {
    await GET(req('?mode=verification'));
    const text = allText();
    expect(
      text.some((q) => /model_disagreement_kind\s+is\s+not\s+null/i.test(q)),
    ).toBe(false);
  });

  it('excludes frames already in manual_labels (per leg)', async () => {
    await GET(req('?mode=verification&disagreements_only=true'));
    const text = allText();
    expect(text.some((q) => /not in\s*\(\s*select image_id from manual_labels where source\s*=\s*'webcam'/i.test(q))).toBe(true);
    expect(text.some((q) => /not in\s*\(\s*select image_id from manual_labels where source\s*=\s*'flickr'/i.test(q))).toBe(true);
  });
  it('source=flickr filter queries only the external leg', async () => {
    await GET(req('?mode=verification&source=flickr'));
    const text = allText();
    expect(text.some((q) => /from\s+external_images\s+e/i.test(q))).toBe(true);
    expect(text.some((q) => /from\s+webcam_snapshots\s+s\b/i.test(q))).toBe(false);
  });
  it('attaches a provenance field to each returned snapshot', async () => {
    sqlMock.mockResolvedValue([
      { snapshot_id: 1, source: 'flickr', firebase_url: 'x', captured_at: '2026-04-01', snapshot: {} },
    ]);
    const res = await GET(req('?mode=verification'));
    const body = await res.json();
    expect(body.snapshots[0]).toHaveProperty('provenance');
  });
});
