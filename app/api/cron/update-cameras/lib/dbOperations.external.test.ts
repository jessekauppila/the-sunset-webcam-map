import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  findExternalImagesNeedingScore,
  countExternalImagesNeedingScore,
  updateExternalImageModelScores,
  markExternalImageDeadUrl,
  findExternalImagesNeedingDisagreementRecompute,
  updateExternalImageDisagreementsBatch,
} from './dbOperations';

beforeEach(() => sqlMock.mockReset());

describe('findExternalImagesNeedingScore', () => {
  it('selects unscored, non-dead-url flickr rows and maps the row shape', async () => {
    sqlMock.mockResolvedValue([
      {
        external_image_id: 11,
        image_url: 'https://live.staticflickr.com/x/11.jpg',
        llm_quality: '0.910', // NUMERIC comes back as a string
        llm_is_sunset: true,
      },
    ]);
    const rows = await findExternalImagesNeedingScore(50);
    expect(rows).toEqual([
      {
        externalImageId: 11,
        imageUrl: 'https://live.staticflickr.com/x/11.jpg',
        llmQuality: 0.91,
        llmIsSunset: true,
      },
    ]);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/from\s+external_images/i);
    expect(q).toMatch(/ai_regression_score\s+is\s+null/i);
    expect(q).toMatch(/image_url\s+is\s+not\s+null/i);
    expect(q).toMatch(/scoring_state\s+is\s+distinct\s+from\s+'dead-url'/i);
    expect(q).toMatch(/source\s*=\s*'flickr'/i);
    expect(q).toMatch(/limit/i);
    expect(values).toContain(50);
  });

  it('coerces a null llm_quality to null, not NaN', async () => {
    sqlMock.mockResolvedValue([
      {
        external_image_id: 12,
        image_url: 'https://live.staticflickr.com/x/12.jpg',
        llm_quality: null,
        llm_is_sunset: null,
      },
    ]);
    const [row] = await findExternalImagesNeedingScore(10);
    expect(row.llmQuality).toBeNull();
    expect(row.llmIsSunset).toBeNull();
  });
});

describe('countExternalImagesNeedingScore', () => {
  it('returns the integer count', async () => {
    sqlMock.mockResolvedValue([{ n: 5872 }]);
    expect(await countExternalImagesNeedingScore()).toBe(5872);
  });

  it('returns 0 when the result is empty', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await countExternalImagesNeedingScore()).toBe(0);
  });
});

describe('updateExternalImageModelScores', () => {
  it('writes the judge columns + disagreement onto external_images, never ai_rating or webcams', async () => {
    sqlMock.mockResolvedValue([]);
    await updateExternalImageModelScores({
      externalImageId: 7,
      regressionScore: 0.812,
      regressionModelVersion: 'v4_reg',
      binaryScore: 0.91,
      binaryIsSunset: true,
      binaryModelVersion: 'v4_bin',
      scoringPath: 'onnx',
      disagreementKind: 'model_low_claude_sunset',
    });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+external_images/i);
    expect(q).toMatch(/ai_regression_score/);
    expect(q).toMatch(/ai_binary_score/);
    expect(q).toMatch(/ai_binary_is_sunset/);
    expect(q).toMatch(/scoring_path/);
    expect(q).toMatch(/model_disagreement_kind/);
    expect(q).toMatch(/disagreement_computed_at\s*=\s*now\(\)/i);
    expect(q).not.toMatch(/\bai_rating\s*=/);
    expect(q).not.toMatch(/webcams/i);
    expect(values).toContain(7);
    expect(values).toContain(0.812);
    expect(values).toContain('model_low_claude_sunset');
  });
});

describe('markExternalImageDeadUrl', () => {
  it("sets scoring_state='dead-url' on external_images so the finder excludes it", async () => {
    sqlMock.mockResolvedValue([]);
    await markExternalImageDeadUrl(99);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+external_images/i);
    expect(q).toMatch(/scoring_state\s*=\s*'dead-url'/i);
    expect(values).toContain(99);
  });
});

describe('findExternalImagesNeedingDisagreementRecompute', () => {
  it('selects rows where disagreement predates the Claude score (or is unset)', async () => {
    sqlMock.mockResolvedValue([
      {
        external_image_id: 5,
        ai_regression_score: '0.200',
        ai_binary_is_sunset: null,
        llm_quality: '0.850',
        llm_is_sunset: true,
      },
    ]);
    const rows = await findExternalImagesNeedingDisagreementRecompute(100);
    expect(rows[0]).toEqual({
      externalImageId: 5,
      aiRegressionScore: 0.2,
      binaryIsSunset: null,
      llmQuality: 0.85,
      llmIsSunset: true,
    });
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/from\s+external_images/i);
    expect(q).toMatch(/ai_regression_score\s+is\s+not\s+null/i);
    expect(q).toMatch(/llm_quality\s+is\s+not\s+null/i);
    expect(q).toMatch(/disagreement_computed_at\s+is\s+null/i);
    expect(q).toMatch(/disagreement_computed_at\s*<\s*.*llm_rated_at/i);
  });
});

describe('updateExternalImageDisagreementsBatch', () => {
  it('writes every row in a single unnest UPDATE on external_images', async () => {
    sqlMock.mockResolvedValue([]);
    await updateExternalImageDisagreementsBatch([
      { externalImageId: 5, kind: 'model_low_claude_sunset' },
      { externalImageId: 6, kind: null },
    ]);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+external_images/i);
    expect(q).toMatch(/unnest/i);
    expect(q).toMatch(/model_disagreement_kind/);
    expect(q).toMatch(/disagreement_computed_at\s*=\s*now\(\)/i);
    expect(values).toContainEqual([5, 6]);
    expect(values).toContainEqual(['model_low_claude_sunset', null]);
  });

  it('issues no query for an empty batch', async () => {
    sqlMock.mockResolvedValue([]);
    await updateExternalImageDisagreementsBatch([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
