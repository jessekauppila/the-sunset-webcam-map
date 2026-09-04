/**
 * Writing a gold label for the frame a display surface is showing.
 *
 * One entry point for both the map popup and the /studio preview, so the two
 * surfaces cannot drift into disagreeing about what a rating means. There is
 * exactly one destination — `manual_labels`, the table the two-scale model
 * program trains on. No public star path runs from here.
 */

export type FrameLabelInput = {
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  /**
   * The archived frame on screen, when there is one. Omit for a live Windy
   * tile: the server captures the frame and labels what it captured. Passing
   * an id the server cannot match to this webcam is refused rather than
   * quietly labeled.
   */
  frameId?: number;
  isSunset: boolean;
  /** 1-5 quality. Null, and only null, when isSunset is false. */
  rating: number | null;
};

export type FrameLabelResult = {
  saved: { id: number; labeledAt: string };
  /** The frame the label actually landed on. */
  frameId: number;
  frameUrl: string;
  capturedAt: string;
  /** True when the server had to capture the frame to have something to name. */
  captured: boolean;
  origin: string;
  labeledTotal: number;
};

export const FRAME_LABEL_ENDPOINT = '/api/manual-labels/frame';

/**
 * The population a label came from, decided by the SERVER from what it
 * actually resolved, never from what the client claims. The two are not
 * interchangeable in an ML export: an archive frame survived the model gate
 * (or the 2% random trickle), while a captured one is an ungated draw from
 * whatever was on the wall.
 *
 * They live here rather than in the route because a Next.js route module may
 * export only its handlers and a fixed set of config fields.
 */
export const ARCHIVE_ORIGIN = 'operator_archive';
export const LIVE_ORIGIN = 'operator_live';

export async function labelFrame(input: FrameLabelInput): Promise<FrameLabelResult> {
  const response = await fetch(FRAME_LABEL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  // The body carries the reason; an HTTP code alone would make every failure
  // read as the same failure.
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok) {
    const detail = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  // "The request didn't error" is not "the row exists". The queue surfaces
  // learned this the hard way; hold the same line here.
  const saved = body.saved as FrameLabelResult['saved'] | undefined;
  if (!saved?.id) throw new Error('no label row returned');

  return {
    saved,
    frameId: Number(body.frameId),
    frameUrl: String(body.frameUrl ?? ''),
    capturedAt: String(body.capturedAt ?? ''),
    captured: body.captured === true,
    origin: String(body.origin ?? ''),
    labeledTotal: Number(body.labeledTotal ?? 0),
  };
}

/** What the operator is told after a label lands. */
export function labelFeedback(
  result: FrameLabelResult,
  isSunset: boolean,
  rating: number | null
): { message: string; tone: 'positive' | 'negative' | 'neutral' } {
  if (!isSunset) {
    return { message: 'Recorded: not a sunset.', tone: 'neutral' };
  }
  // Say when a frame was captured. The operator judged what was on their
  // screen; the label is bound to the frame the server took, and they should
  // know that is what went on record.
  const captured = result.captured ? ' Captured this frame to label it.' : '';
  return {
    message: `Saved ${rating}★ as a gold label.${captured}`,
    tone: rating != null && rating >= 3 ? 'positive' : 'negative',
  };
}
