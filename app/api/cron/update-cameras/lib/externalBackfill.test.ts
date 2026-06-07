import { describe, it, expect, vi, beforeEach } from 'vitest';

const downloadImageMock = vi.fn();
const scoreImageMock = vi.fn();
const findRowsMock = vi.fn();
const writeScoresMock = vi.fn();
const markDeadUrlMock = vi.fn();

vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadImageMock(...a),
}));

// Keep the real computeDisagreementKind; mock only scoreImage.
vi.mock('./aiScoring', async (importActual) => {
  const actual = await importActual<typeof import('./aiScoring')>();
  return { ...actual, scoreImage: (...a: unknown[]) => scoreImageMock(...a) };
});

vi.mock('./dbOperations', () => ({
  findExternalImagesNeedingScore: (...a: unknown[]) => findRowsMock(...a),
  updateExternalImageModelScores: (...a: unknown[]) => writeScoresMock(...a),
  markExternalImageDeadUrl: (...a: unknown[]) => markDeadUrlMock(...a),
}));

import { backfillExternalImageScores } from './externalBackfill';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  externalImageId: 1,
  imageUrl: 'https://live.staticflickr.com/x/1.jpg',
  llmQuality: null,
  llmIsSunset: null,
  ...over,
});

const onnxResult = (over: Partial<Record<string, unknown>> = {}) => ({
  rawScore: 0.7,
  aiRating: 3.8,
  modelVersion: 'v4_reg',
  imageHash: 'h',
  source: 'flickr',
  pathTaken: 'onnx',
  binaryRawScore: 0.9,
  binaryIsSunset: true,
  binaryModelVersion: 'v4_bin',
  ...over,
});

beforeEach(() => {
  downloadImageMock.mockReset().mockResolvedValue(Buffer.from('jpg'));
  scoreImageMock.mockReset().mockResolvedValue(onnxResult());
  findRowsMock.mockReset();
  writeScoresMock.mockReset().mockResolvedValue(undefined);
  markDeadUrlMock.mockReset().mockResolvedValue(undefined);
});

describe('backfillExternalImageScores', () => {
  it('scores a flickr image and writes the model columns (source flickr, no webcam sync)', async () => {
    findRowsMock.mockResolvedValue([
      row({ externalImageId: 7, llmQuality: 0.9, llmIsSunset: true }),
    ]);
    const res = await backfillExternalImageScores({ limit: 50 });

    expect(downloadImageMock).toHaveBeenCalledWith(
      'https://live.staticflickr.com/x/1.jpg',
    );
    // scoreImage is told the source is flickr.
    expect(scoreImageMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'flickr' }),
    );
    expect(writeScoresMock).toHaveBeenCalledTimes(1);
    const writeArg = writeScoresMock.mock.calls[0][0];
    expect(writeArg.externalImageId).toBe(7);
    expect(writeArg.regressionScore).toBe(0.7);
    expect(writeArg.scoringPath).toBe('onnx');
    expect(res.scored).toBe(1);
    expect(markDeadUrlMock).not.toHaveBeenCalled();
  });

  it('SSRF: skips a non-staticflickr host without downloading or scoring', async () => {
    findRowsMock.mockResolvedValue([
      row({ externalImageId: 8, imageUrl: 'https://evil.example.com/x.jpg' }),
    ]);
    const res = await backfillExternalImageScores({ limit: 50 });

    expect(downloadImageMock).not.toHaveBeenCalled();
    expect(scoreImageMock).not.toHaveBeenCalled();
    expect(writeScoresMock).not.toHaveBeenCalled();
    expect(markDeadUrlMock).not.toHaveBeenCalled();
    expect(res.scored).toBe(0);
    expect(res.failed).toBe(1);
  });

  it('SSRF: rejects an http (non-https) staticflickr url', async () => {
    findRowsMock.mockResolvedValue([
      row({ imageUrl: 'http://live.staticflickr.com/x/1.jpg' }),
    ]);
    const res = await backfillExternalImageScores({ limit: 50 });
    expect(downloadImageMock).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it('aborts (no write) when scoreImage takes a non-ONNX path', async () => {
    findRowsMock.mockResolvedValue([row()]);
    scoreImageMock.mockResolvedValue(
      onnxResult({ pathTaken: 'unscored', rawScore: null, aiRating: null }),
    );
    const res = await backfillExternalImageScores({ limit: 50 });
    expect(writeScoresMock).not.toHaveBeenCalled();
    expect(res.scored).toBe(0);
    expect(res.abortedOnFallback).toBe(true);
  });

  it('marks a permanently-dead URL and continues', async () => {
    findRowsMock.mockResolvedValue([row({ externalImageId: 9 })]);
    downloadImageMock.mockRejectedValue(new Error('Failed to download image: Not Found'));
    const res = await backfillExternalImageScores({ limit: 50 });
    expect(markDeadUrlMock).toHaveBeenCalledWith(9);
    expect(res.deadUrls).toBe(1);
    expect(writeScoresMock).not.toHaveBeenCalled();
  });

  it('returns an empty result when nothing needs scoring', async () => {
    findRowsMock.mockResolvedValue([]);
    const res = await backfillExternalImageScores({ limit: 50 });
    expect(res).toMatchObject({ scored: 0, failed: 0, deadUrls: 0 });
    expect(downloadImageMock).not.toHaveBeenCalled();
  });
});
