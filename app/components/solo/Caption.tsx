'use client';

import type { CSSProperties } from 'react';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import {
  FONT_STACKS, LINE_HEIGHT, captionBox, captionLines, captionScale, gray, lineGaps, localTimezone,
  pairTimeSegments, splitTime, timeSegments,
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
export function Caption({ entry, dials, picture, width, feed, step, hereTimezone }: {
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
  /**
   * The zone the "my time" dial reads as here. Defaults to the zone this
   * glass is set to, which is why a Pi on the wrong timezone writes the wrong
   * here-clock; tests and the studio pass it explicitly.
   */
  hereTimezone?: string | null;
}) {
  const here = { style: dials.hereTime, timezone: hereTimezone === undefined ? localTimezone() : hereTimezone };
  const lines = captionLines(entry, dials, feed, here.timezone);
  if (!lines) return null;
  const s = captionScale(width);
  const box = captionBox(dials, picture, width);
  const overlay = dials.captionLayout === 'overlay';
  const inline = dials.timeLine === 'inline';
  // Margins, not a flex gap: the time line can be pushed further down than
  // the place line is, and captionHeight adds up the same two numbers.
  const gaps = lineGaps(dials);

  const block: CSSProperties = {
    position: 'absolute', left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxWidth: box.maxWidth,
    textAlign: box.textAlign, display: 'flex', flexDirection: 'column',
    fontFamily: FONT_STACKS[dials.font], whiteSpace: 'nowrap',
    textShadow: overlay ? '0 1px 4px #000' : undefined,
  };
  const line: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis' };
  // `caption-time` wraps the whole line, the readings on their way out
  // included: a ghost rides on top of the reading that replaced it until the
  // crossfade ends, so read the heads and tails, not the line's text.
  const timeFace: CSSProperties = {
    fontSize: dials.timeSize * s, color: gray(dials.timeGray), fontVariantNumeric: 'tabular-nums',
  };

  // The reading the step is leaving, built with this caption's own dials so
  // the two ends of the fade are always the same format, then matched piece
  // for piece against the reading arriving.
  const leaving = step && step.fadeS > 0
    ? timeSegments(dials.timeStyle, step.from.capturedAt, step.from.timezone, step.from.sunAltitudeDeg, here)
    : null;
  const pairs = pairTimeSegments(leaving, lines.timeParts);
  // Two frames of the same minute say the same thing; nothing to fade.
  const stepping = pairs.some((p) => p.fade && p.from !== p.to);
  const fade = stepping && step ? step.fadeS : 0;

  const time = !lines.time ? null : (
    <span data-testid="caption-time" style={{ ...timeFace, whiteSpace: 'pre' }}>
      {pairs.map((p, i) => {
        // A piece that did not change, and every piece of punctuation, is
        // written as it is: only what actually moved animates.
        if (!p.fade || p.from === p.to) return <span key={i}>{p.to}</span>;
        // The head crossfades in place: the outgoing reading rides on top of
        // the incoming one, which holds the width so the tail beside it never
        // moves. Each head is keyed by its own text, so a step restarts the
        // two animations without remounting the line they sit in.
        const split = splitTime(p.from, p.to);
        return (
          <span key={i}>
            {split.lead}
            <span style={{ position: 'relative', display: 'inline-block' }}>
              <span data-testid="caption-time-head" key={split.toMid} style={{
                display: 'inline-block', animation: `solo-time-in ${fade}s ease both`,
              }}>
                {split.toMid}
              </span>
              <span data-testid="caption-time-out" key={split.fromMid} aria-hidden style={{
                position: 'absolute', left: 0, top: 0, animation: `solo-time-out ${fade}s ease both`,
              }}>
                {split.fromMid}
              </span>
            </span>
            {split.tail}
          </span>
        );
      })}
    </span>
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
          <div data-testid="caption-place" style={{ ...line, marginTop: gaps.place * s, fontSize: dials.placeSize * s, color: gray(dials.placeGray), lineHeight: LINE_HEIGHT.place }}>
            {lines.place}
            {inline && time && lines.place ? <span style={{ color: gray(dials.timeGray) }}> · </span> : null}
            {inline ? time : null}
          </div>
        )}
        {!inline && time && (
          <div data-testid="caption-time-line" style={{ ...line, marginTop: gaps.time * s, lineHeight: LINE_HEIGHT.time }}>
            {time}
          </div>
        )}
      </div>
    </>
  );
}
