import { computeTemperingMultiplier } from '@/app/lib/cameraCalibration';
import {
  CALIBRATION_WINDOW_DAYS,
  CALIBRATION_HALF_LIFE_DAYS,
} from '@/app/lib/masterConfig';
import {
  findCalibrationEvidenceByCamera,
  updateCameraCalibrationBatch,
  insertCalibrationHistoryBatch,
} from './dbOperations';

export interface CalibrationResult {
  camerasEvaluated: number;
  tempered: number;
  changed: number;
}

/** Multipliers are stored NUMERIC(4,3); anything smaller is not a real change. */
const CHANGE_EPSILON = 0.001;

/**
 * Recompute every camera's tempering multiplier from accumulated evidence.
 *
 * Pure SQL + arithmetic: no image download, no ONNX. That is why this runs on
 * its own nightly cron without the ml/artifacts bundle.
 *
 * History is written for CHANGES ONLY — writing every camera every night would
 * add ~1,000 near-identical rows nightly, and webcams.calibration_computed_at
 * already answers "did the job run".
 */
export async function recomputeCameraCalibration(opts: {
  modelVersion: string;
}): Promise<CalibrationResult> {
  const rows = await findCalibrationEvidenceByCamera(
    opts.modelVersion,
    CALIBRATION_WINDOW_DAYS,
    CALIBRATION_HALF_LIFE_DAYS,
  );

  const updates = rows.map((r) => {
    const multiplier = computeTemperingMultiplier({
      falseShows: r.falseShows,
      negativeFrames: r.negativeFrames,
      falseShowDays: r.falseShowDays,
      rawFalseShows: r.rawFalseShows,
    });
    return { row: r, multiplier };
  });

  await updateCameraCalibrationBatch(
    updates.map(({ row, multiplier }) => ({
      webcamId: row.webcamId,
      multiplier,
      evidence: {
        falseShows: row.falseShows,
        negativeFrames: row.negativeFrames,
        falseShowDays: row.falseShowDays,
        rawFalseShows: row.rawFalseShows,
        modelVersion: opts.modelVersion,
      },
    })),
  );

  const changed = updates.filter(
    ({ row, multiplier }) =>
      row.previousMultiplier == null ||
      Math.abs(row.previousMultiplier - multiplier) > CHANGE_EPSILON,
  );

  await insertCalibrationHistoryBatch(
    changed.map(({ row, multiplier }) => ({
      webcamId: row.webcamId,
      multiplier,
      previousMultiplier: row.previousMultiplier,
      falseShows: row.falseShows,
      negativeFrames: row.negativeFrames,
      rawFalseShows: row.rawFalseShows,
      falseShowDays: row.falseShowDays,
      modelVersion: opts.modelVersion,
    })),
  );

  return {
    camerasEvaluated: rows.length,
    tempered: updates.filter((u) => u.multiplier < 1).length,
    changed: changed.length,
  };
}
