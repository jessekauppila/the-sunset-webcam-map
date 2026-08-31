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
  it('sample=<name> restricts both legs to the pre-drawn set', async () => {
    await GET(req('?mode=verification&sample=random_ordinary_v1'));
    const text = allText();
    expect(text.some((q) => /s\.id in\s*\(\s*select image_id from label_samples/i.test(q))).toBe(true);
    expect(text.some((q) => /e\.id in\s*\(\s*select image_id from label_samples/i.test(q))).toBe(true);
  });

  it('sample mode overrides disagreements_only rather than stacking with it', async () => {
    // The sample is drawn from the frames the disagreement filter excludes, so
    // ANDing the two would return an empty queue.
    await GET(req('?mode=verification&disagreements_only=true&sample=random_ordinary_v1'));
    const text = allText();
    expect(
      text.some((q) => /model_disagreement_kind\s+is\s+not\s+null/i.test(q)),
    ).toBe(false);
  });

  it('serves the sample in its frozen position order, not by rank or recency', async () => {
    await GET(req('?mode=verification&sample=random_ordinary_v1'));
    // The sort key is a nested sql`` fragment, so it is its own template call
    // rather than inline text in the main query.
    const text = allText();
    expect(text.some((q) => /-\(SELECT ls\.position/i.test(q))).toBe(true);
    expect(text.some((q) => /ls\.sample_name = \?/i.test(q))).toBe(true);
  });

  it('still excludes already-labeled frames so a sample resumes across sittings', async () => {
    await GET(req('?mode=verification&sample=random_ordinary_v1'));
    const text = allText();
    expect(text.some((q) => /not in\s*\(\s*select image_id from manual_labels where source\s*=\s*'webcam'/i.test(q))).toBe(true);
  });

  it('reports sample progress against the draw, not against what is unrated', async () => {
    sqlMock.mockResolvedValue([{ size: 200, labeled: 47 }]);
    const res = await GET(req('?mode=verification&sample=random_ordinary_v1'));
    const body = await res.json();
    expect(body.sample).toEqual({ name: 'random_ordinary_v1', size: 200, labeled: 47 });
  });

  it('omits sample progress entirely when no sample was asked for', async () => {
    const res = await GET(req('?mode=verification&disagreements_only=true'));
    expect((await res.json()).sample).toBeNull();
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

describe('GET /api/snapshots?mode=verification — retest samples', () => {
  const allText = () =>
    sqlMock.mock.calls.map(([s]) => (s as TemplateStringsArray).join('?'));

  // A retest sample (label_samples.kind = 'retest') re-serves frames that BY
  // CONSTRUCTION already have manual_labels rows; drop-out and progress must
  // therefore read manual_label_retests instead.
  const mockRetestKind = () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?');
      if (/select\s+kind\s+from\s+label_samples/i.test(q)) {
        return Promise.resolve([{ kind: 'retest' }]);
      }
      if (/count\(\*\)::int as size/i.test(q)) {
        return Promise.resolve([{ size: 150, labeled: 12 }]);
      }
      return Promise.resolve([]);
    });
  };

  it('serves retest frames despite their manual_labels rows (no gold exclusion)', async () => {
    mockRetestKind();
    await GET(req('?mode=verification&sample=retest_v1'));
    const text = allText();
    // Membership filter still applies…
    expect(text.some((q) => /s\.id in\s*\(\s*select image_id from label_samples/i.test(q))).toBe(true);
    // …but nothing excludes on manual_labels — every retest frame has a row there.
    expect(text.some((q) => /not in\s*\(\s*select image_id from manual_labels/i.test(q))).toBe(false);
  });

  it('drops a frame from the queue once manual_label_retests has its re-rating', async () => {
    mockRetestKind();
    await GET(req('?mode=verification&sample=retest_v1'));
    const text = allText();
    expect(
      text.some((q) =>
        /not in\s*\(\s*select image_id from manual_label_retests\s+where source\s*=\s*'webcam'\s+and origin\s*=\s*\?/i.test(q),
      ),
    ).toBe(true);
  });

  it('reports retest progress from manual_label_retests, not manual_labels', async () => {
    mockRetestKind();
    const res = await GET(req('?mode=verification&sample=retest_v1'));
    const body = await res.json();
    expect(body.sample).toEqual({ name: 'retest_v1', size: 150, labeled: 12 });
    const progressCall = allText().find((q) => /count\(\*\)::int as size/i.test(q));
    expect(progressCall).toMatch(/manual_label_retests/i);
    expect(progressCall).not.toMatch(/join manual_labels\b/i);
  });

  it('stays blind: no query joins manual_labels, so the first-pass label is never fetched', async () => {
    mockRetestKind();
    await GET(req('?mode=verification&sample=retest_v1'));
    const text = allText();
    expect(text.some((q) => /join\s+manual_labels\b/i.test(q))).toBe(false);
  });

  it('draw samples keep the manual_labels drop-out exactly as before', async () => {
    // Kind lookup returns 'draw' — behavior must be indistinguishable from
    // the pre-retest code path.
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = strings.join('?');
      if (/select\s+kind\s+from\s+label_samples/i.test(q)) {
        return Promise.resolve([{ kind: 'draw' }]);
      }
      return Promise.resolve([]);
    });
    await GET(req('?mode=verification&sample=random_ordinary_v1'));
    const text = allText();
    expect(text.some((q) => /not in\s*\(\s*select image_id from manual_labels where source\s*=\s*'webcam'/i.test(q))).toBe(true);
    expect(text.some((q) => /manual_label_retests/i.test(q) && /not in/i.test(q))).toBe(false);
  });
});
