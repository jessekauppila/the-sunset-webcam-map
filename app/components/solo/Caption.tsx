'use client';

import type { CSSProperties } from 'react';
import type { SoloDials } from '@/app/lib/solo/types';
import {
  FONT_STACKS, captionBox, captionLines, captionScale, gray, type CaptionEntry, type Rect,
} from '@/app/lib/solo/caption';

/**
 * The words under (or over) a solo frame, drawn from the caption dials. Shared
 * by every solo version so the glass captions the same whichever engine picks
 * the frame. Null when the place dial is off. Everything positional comes
 * from lib/solo/caption.ts, so this is layout only.
 */
export function Caption({ entry, dials, picture, width }: {
  entry: CaptionEntry;
  dials: SoloDials;
  /** Where the picture sits on the panel, from pictureRect. */
  picture: Rect;
  width: number;
}) {
  const lines = captionLines(entry, dials);
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
  const time = lines.time ? (
    <span data-testid="caption-time" style={{ fontSize: dials.timeSize * s, color: gray(dials.timeGray), fontVariantNumeric: 'tabular-nums' }}>
      {lines.time}
    </span>
  ) : null;

  return (
    <div data-testid="caption" style={block}>
      <div data-testid="caption-title" style={{
        ...line, fontSize: dials.titleSize * s, fontWeight: Number(dials.titleWeight), color: gray(dials.titleGray), lineHeight: 1.15,
      }}>
        {lines.title}
      </div>
      {(lines.place || (inline && time)) && (
        <div data-testid="caption-place" style={{ ...line, fontSize: dials.placeSize * s, color: gray(dials.placeGray), lineHeight: 1.3 }}>
          {lines.place}
          {inline && time && lines.place ? <span style={{ color: gray(dials.timeGray) }}> · </span> : null}
          {inline ? time : null}
        </div>
      )}
      {!inline && time && <div style={{ ...line, lineHeight: 1.3 }}>{time}</div>}
    </div>
  );
}
