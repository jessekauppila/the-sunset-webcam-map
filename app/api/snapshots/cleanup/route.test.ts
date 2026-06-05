// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const deleteFromFirebaseMock = vi.fn();
const cleanupEnabledMock = { value: false };

vi.mock('@/app/lib/db', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  deleteFromFirebase: (...a: unknown[]) => deleteFromFirebaseMock(...a),
}));
vi.mock('@/app/lib/masterConfig', () => ({
  get CLEANUP_ENABLED() {
    return cleanupEnabledMock.value;
  },
  AI_SNAPSHOT_MIN_RATING_THRESHOLD: 4.0,
}));

import { GET } from './route';

beforeEach(() => {
  sqlMock.mockReset();
  deleteFromFirebaseMock.mockReset().mockResolvedValue(undefined);
  cleanupEnabledMock.value = false;
  process.env.NODE_ENV = 'development'; // bypass the auth gate
});

function makeReq(): Request {
  return new Request('http://test/api/snapshots/cleanup', { method: 'GET' });
}

describe('GET /api/snapshots/cleanup', () => {
  it('refuses to delete anything when CLEANUP_ENABLED is false', async () => {
    cleanupEnabledMock.value = false;
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.deleted).toBe(0);
    expect(body.skipped_reason).toContain('CLEANUP_ENABLED');
    expect(sqlMock).not.toHaveBeenCalled();
    expect(deleteFromFirebaseMock).not.toHaveBeenCalled();
  });

  it('queries the snapshot table when CLEANUP_ENABLED is true', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]); // SELECT returns nothing
    await GET(makeReq());
    expect(sqlMock).toHaveBeenCalled();
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/captured_at < NOW\(\) - INTERVAL '7 days'/i);
  });

  it('excludes snapshots flagged as model disagreements', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]);
    await GET(makeReq());
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/model_disagreement_kind\s+is\s+null/i);
  });

  it('excludes snapshots with any rating row (rating OR verdict)', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]);
    await GET(makeReq());
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/webcam_snapshot_ratings/i);
    expect(q).toMatch(/rating\s+is\s+not\s+null\s+or\s+is_sunset_verdict\s+is\s+not\s+null/i);
  });

  it('excludes high-score snapshots by the REAL ai_regression_score, not junk ai_rating', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]);
    await GET(makeReq());
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(
      /ai_regression_score\s+is\s+null\s+or\s+ai_regression_score\s*</i,
    );
    // Must NOT retain on the junk legacy column anymore.
    expect(q).not.toMatch(/ai_rating\s+is\s+null\s+or\s+ai_rating\s*</i);
  });

  it('excludes Claude-scored frames (llm_quality set) — they may be on the leaderboard', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]); // SELECT returns nothing
    await GET(makeReq());
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?').toLowerCase();
    expect(q).toMatch(/llm_quality\s+is\s+null/i);
  });
});
