'use client';

import type { CSSProperties } from 'react';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import {
  FONT_STACKS, LINE_HEIGHT, captionBox, captionLines, captionScale, formatTime, gray, type CaptionEntry, type Rect,
} from '@/app/lib/solo/caption';

const TIME_KEYFRAMES = `
@keyframes solo-time-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes solo-time-in { from { opacity: 0 } to { opacity: 1 } }
`;

/**
 * The words under (or over) a solo frame, drawn from the caption dials. Shared
 * by every solo version so the glass captions the same whichever engine picks
 * the frame. Null when the place dial is off. Everything positional comes
 * from lib/solo/caption.ts, so this is layout only.
 */
export function Caption({ entry, dials, picture, width, feed, step }: {
  entry: CaptionEntry;
  dials: SoloDials;
  /** Where the picture sits on the panel, from pictureRect. */
  picture: Rect;
  width: number;
  /** The panel's height; unused since the caption hangs from the picture, kept so callers need not change. */
  height?: number;
  /** The screen this caption is for, so the prefix dial can name it. */
  feed?: Feed;
  /**
   * The frame the time is stepping from, inside a camera run. Every frame of
   * a run is the same camera, so the title and the place hold still and only
   * the clock moves: the old time fades out over the first half of `fadeS`,
   * the new one in over the second, never overlapping. Absent on a dwell's
   * first frame, where the whole caption arrives with the picture instead.
   */
  step?: { from: CaptionEntry; fadeS: number } | null;
}) {
  const lines = captionLines(entry, dials, feed);
  if (!lines) return null;
  const s = captionScale(width);
  const box = captionBox(dials, picture, width);
  const overlay = dials.captionLayout === 'overlay';
  const inline = dials.timeLine === 'inline';

  const block: CSSProperties = {
    position: 'absolute', left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxWidth: box.maxWidth,
    textAlign: box.textAlign, display: 'flex', flexDirection: 'column', gap: dials.lineGap * s,
    fontFamily: FONT_STACKS[dials.font], whiteSpace: 'nowrap',
    textShadow: overlay ? '0 1px 4px #000' : undefined,
  };
  const line: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis' };
  const timeFace: CSSProperties = {
    fontSize: dials.timeSize * s, color: gray(dials.timeGray), fontVariantNumeric: 'tabular-nums',
  };

  // The clock the step is leaving, read with this caption's own dials so the
  // two ends of the fade are always the same format.
  const from = step && step.fadeS > 0
    ? formatTime(dials.timeStyle, step.from.capturedAt, step.from.timezone, step.from.sunAltitudeDeg)
    : null;
  // Two frames of the same minute say the same thing; nothing to fade.
  const stepping = !!from && !!lines.time && from !== lines.time;
  const half = stepping && step ? step.fadeS / 2 : 0;

  const timeText = (
    <span data-testid="caption-time" key={lines.time} style={
      stepping ? { ...timeFace, display: 'inline-block', animation: `solo-time-in ${half}s ease ${half}s both` } : timeFace
    }>
      {lines.time}
    </span>
  );
  const time = !lines.time ? null : stepping ? (
    // The outgoing clock rides on top of the incoming one, which holds the
    // line's width so nothing around it moves while the two swap.
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {timeText}
      <span data-testid="caption-time-out" key={from} aria-hidden style={{
        ...timeFace, position: 'absolute', left: 0, top: 0, animation: `solo-time-out ${half}s ease both`,
      }}>
        {from}
      </span>
    </span>
  ) : timeText;

  return (
    <>
      {stepping && <style>{TIME_KEYFRAMES}</style>}
      <div data-testid="caption" style={block}>
        <div data-testid="caption-title" style={{
          ...line, fontSize: dials.titleSize * s, fontWeight: Number(dials.titleWeight), color: gray(dials.titleGray), lineHeight: LINE_HEIGHT.title,
        }}>
          {lines.title}
        </div>
        {(lines.place || (inline && time)) && (
          <div data-testid="caption-place" style={{ ...line, fontSize: dials.placeSize * s, color: gray(dials.placeGray), lineHeight: LINE_HEIGHT.place }}>
            {lines.place}
            {inline && time && lines.place ? <span style={{ color: gray(dials.timeGray) }}> · </span> : null}
            {inline ? time : null}
          </div>
        )}
        {!inline && time && <div style={{ ...line, lineHeight: LINE_HEIGHT.time }}>{time}</div>}
      </div>
    </>
  );
}
