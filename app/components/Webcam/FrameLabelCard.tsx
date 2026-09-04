'use client';

import { useState } from 'react';
import RatingCard, { type RateResult } from '@/app/components/Webcam/RatingCard';
import { labelFeedback, labelFrame, type FrameLabelResult } from '@/app/lib/frameLabels';
import type { WindyWebcam } from '@/app/lib/types';

/**
 * The detail card every display surface shows when a camera is clicked: the
 * map popup and the /studio preview mount THIS, not two hand-wired copies of
 * it. One card means one meaning for a rating — a gold label in
 * `manual_labels` — on whichever surface the operator happens to be using.
 */
export function FrameLabelCard({
  webcam,
  heading,
  allowCapture = true,
  onLabeled,
}: {
  webcam: WindyWebcam;
  heading?: string;
  /**
   * What the SURFACE does after a label lands — the map advances its tour and
   * raises a snackbar, /studio leaves the panel open. The write itself is
   * identical either way, which is the point of sharing this card.
   */
  onLabeled?: (
    result: FrameLabelResult,
    feedback: { message: string; tone: 'positive' | 'negative' | 'neutral' }
  ) => void;
  /**
   * Whether the frame may be captured when it is not already archived.
   *
   * True on live surfaces, where the tile shows what the camera is looking at
   * right now. FALSE when replaying a saved scene: capturing there would go
   * fetch the CURRENT image and attach the operator's judgment of a June
   * evening to tonight's frame. A scene tile with no archived frame behind it
   * therefore cannot be labeled at all, and says so.
   */
  allowCapture?: boolean;
}) {
  // The frame identity is taken from the record the card was handed, not read
  // back out of state at submit time, so it cannot drift between the click
  // and the write.
  const frameId = webcam.frameId;
  const canLabel = frameId != null || allowCapture;

  const [total, setTotal] = useState<number | null>(null);

  const phase: 'sunrise' | 'sunset' =
    webcam.phase === 'sunrise' ? 'sunrise' : 'sunset';

  const submit = async (isSunset: boolean, rating: number | null): Promise<RateResult> => {
    const webcamId = Number(webcam.webcamId);
    if (!Number.isInteger(webcamId) || webcamId <= 0) {
      throw new Error('This camera has no id to label against.');
    }
    const result = await labelFrame({ webcamId, phase, frameId, isSunset, rating });
    setTotal(result.labeledTotal);
    const feedback = labelFeedback(result, isSunset, rating);
    onLabeled?.(result, feedback);
    return { ...feedback, rating: rating ?? 0 };
  };

  return (
    <div>
      <RatingCard
        webcam={webcam}
        heading={heading}
        initialRating={null}
        onRate={(rating) => submit(true, rating)}
        onReject={canLabel ? () => submit(false, null) : undefined}
        readOnly={!canLabel}
        readOnlyNote={
          canLabel
            ? undefined
            : 'This scene replays a frozen pool with no archived frame behind this tile, so there is nothing to label.'
        }
      />
      {total !== null ? (
        <p className="mt-1 px-4 text-xs text-gray-500">{total} gold labels on record</p>
      ) : null}
    </div>
  );
}

export default FrameLabelCard;
