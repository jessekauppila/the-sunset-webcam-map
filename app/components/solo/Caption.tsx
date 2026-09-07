'use client';

import type { CSSProperties } from 'react';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import {
  FONT_STACKS, LINE_HEIGHT, captionBox, captionLines, captionScale, formatTime, gray, splitTime,
  type CaptionEntry, type Rect,
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
   * the clock moves — and inside the clock, only the words that actually
   * change. Those crossfade over `fadeS`, out and in together, the way the
   * picture underneath dissolves; "pm there" and the rest of the shared tail
   * never animate. Absent on a dwell's first frame, where the whole caption
   * arrives with the picture instead.
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
  // What the two readings share, and the head that differs.
  const split = stepping && from ? splitTime(from, lines.time) : null;
  const fade = split && step ? step.fadeS : 0;

  const time = !lines.time ? null : split ? (
    // The head crossfades in place: the outgoing reading rides on top of the
    // incoming one, which holds the width so the tail beside it never moves.
    // Each head is keyed by its own text, so a step restarts the two
    // animations without remounting the line they sit in.
    <span style={{ ...timeFace, position: 'relative', display: 'inline-block' }}>
      <span data-testid="caption-time" style={{ display: 'inline-block' }}>
        <span data-testid="caption-time-head" key={split.toHead} style={{
          display: 'inline-block', animation: `solo-time-in ${fade}s ease both`,
        }}>
          {split.toHead}
        </span>
        {split.tail ? ` ${split.tail}` : null}
      </span>
      <span data-testid="caption-time-out" key={split.fromHead} aria-hidden style={{
        position: 'absolute', left: 0, top: 0, animation: `solo-time-out ${fade}s ease both`,
      }}>
        {split.fromHead}
      </span>
    </span>
  ) : (
    <span data-testid="caption-time" style={timeFace}>{lines.time}</span>
  );

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
