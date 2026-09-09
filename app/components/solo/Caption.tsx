'use client';

import { Fragment, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import {
  FONT_STACKS, LINE_HEIGHT, captionBox, captionLines, captionScale, captionSequence, gray,
  pairTimeSegments, splitTime, sunEventOf, tailTravel, timeSegments,
  type CaptionEntry, type LineKey, type Rect,
} from '@/app/lib/solo/caption';

const TIME_KEYFRAMES = `
@keyframes solo-time-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes solo-time-in { from { opacity: 0 } to { opacity: 1 } }
`;

/** The three elements of one crossfading stretch, kept so the glide can measure it. */
interface StretchNodes {
  /** The slot the stretch swaps inside; its width is the arriving reading's. */
  slot: HTMLElement | null;
  /** The reading on its way out, absolutely placed, so its width is the leaving one's. */
  out: HTMLElement | null;
  /** Everything after the stretch, which travels when the two widths differ. */
  tail: HTMLElement | null;
}

/**
 * The words under (or over) a solo frame, drawn from the caption dials. Shared
 * by every solo version so the glass captions the same whichever engine picks
 * the frame. Null when the place dial is off. Everything positional comes
 * from lib/solo/caption.ts, so this is layout only.
 */
export function Caption({ entry, dials, picture, width, feed, step, now = Date.now() }: {
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
   * the time moves — and inside it, only the characters that actually change.
   * Those crossfade over `fadeS`, out and in together, the way the picture
   * underneath dissolves; the characters the two readings share at either end
   * never animate, so a run counts down "38 minutes ago" to "28 minutes ago"
   * by moving one digit.
   *
   * When the two readings are not the same width — "10 minutes ago" losing a
   * digit to "9 minutes ago" — the words after the digit glide to their new
   * place across the same fade instead of arriving there at once, which is
   * what used to read as the line sliding sideways.
   *
   * `ease` is the timing function of the dissolve this step belongs to. It is
   * one value for every layer of a change, the picture's included: an eased
   * arrival against a departure on another curve lands in a third of the time
   * it left in (PR #160). Absent on a dwell's first frame, where the whole
   * caption arrives with the picture instead.
   */
  step?: { from: CaptionEntry; fadeS: number; ease?: string } | null;
  /**
   * The wall clock the 'ago' style measures against. One value for the frame
   * arriving and the frame it replaces, so the only thing between the two
   * readings is how much older one picture is than the other — never a tick
   * of the clock that would make the difference look larger than it is.
   */
  now?: number;
}) {
  const stretches = useRef(new Map<number, StretchNodes>());
  const lines = captionLines(entry, dials, feed, now);
  const s = captionScale(width);
  const box = captionBox(dials, picture, width);
  const overlay = dials.captionLayout === 'overlay';
  // Folding the time onto the place line only makes sense while the name
  // leads; when the time is the headline it always has a line of its own.
  const inline = dials.timeLine === 'inline' && dials.lineOrder === 'name-first';
  // Margins, not a flex gap: every line owns the space above it, so the
  // region can sit tight under the name while the time stands clear of
  // both. captionHeight walks the same sequence and adds the same numbers.
  const sequence = captionSequence(dials);

  // The reading the step is leaving, built with this caption's own dials so
  // the two ends of the fade are always the same format, then matched piece
  // for piece against the reading arriving.
  const leaving = step && step.fadeS > 0 && lines
    ? timeSegments(dials.timeStyle, step.from.capturedAt, step.from.timezone, step.from.sunAltitudeDeg,
      now, sunEventOf(step.from))
    : null;
  const pairs = pairTimeSegments(leaving, lines?.timeParts ?? []);
  // Two frames of the same minute say the same thing; nothing to fade.
  const stepping = pairs.some((p) => p.fade && p.from !== p.to);
  const fade = stepping && step ? step.fadeS : 0;
  const ease = step?.ease ?? 'ease';

  // Measured once the step is laid out, so the words that have to move start
  // where they were and travel to where they now are. One width read and one
  // transform written per changed stretch, and the transform is composited:
  // animating the slot's width instead lays the whole line out again on every
  // frame, which lands the words on whole pixels and steps rather than glides.
  const stepKey = `${fade}|${ease}|${pairs.map((p) => `${p.from}›${p.to}`).join('|')}`;
  useLayoutEffect(() => {
    if (fade <= 0) return;
    for (const { slot, out, tail } of stretches.current.values()) {
      if (!slot || !out || !tail || typeof tail.animate !== 'function') continue;
      const travel = tailTravel(out.getBoundingClientRect().width, slot.getBoundingClientRect().width);
      if (!travel) continue;
      // The glass steps every few seconds for days at a time, so each step
      // clears the one before it rather than stacking finished animations on
      // an element that never unmounts.
      tail.getAnimations?.().forEach((a) => a.cancel());
      tail.animate(
        [{ transform: `translateX(${travel}px)` }, { transform: 'translateX(0px)' }],
        { duration: fade * 1000, easing: ease, fill: 'backwards' },
      );
    }
  }, [stepKey, fade, ease]);

  if (!lines) return null;

  const block: CSSProperties = {
    position: 'absolute', left: box.left, top: box.top, bottom: box.bottom, width: box.width, maxWidth: box.maxWidth,
    textAlign: box.textAlign, display: 'flex', flexDirection: 'column',
    fontFamily: FONT_STACKS[dials.font], whiteSpace: 'nowrap',
    letterSpacing: `${dials.captionTrack / 1000}em`,
    textShadow: overlay ? '0 1px 4px #000' : undefined,
  };
  const line: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis' };
  // `caption-time` wraps the whole line, the readings on their way out
  // included: a ghost rides on top of the reading that replaced it until the
  // crossfade ends, so read the heads and tails, not the line's text.
  const timeFace: CSSProperties = {
    fontSize: dials.timeSize * s, color: gray(dials.timeGray), fontVariantNumeric: 'tabular-nums',
  };

  const keep = (i: number, part: keyof StretchNodes) => (node: HTMLElement | null) => {
    const held = stretches.current.get(i) ?? { slot: null, out: null, tail: null };
    held[part] = node;
    if (held.slot || held.out || held.tail) stretches.current.set(i, held);
    else stretches.current.delete(i);
  };

  /**
   * The time line from piece `i` on. Each changed stretch nests everything
   * after it inside its own tail, so a second stretch that also changes width
   * travels its own distance on top of the first one's rather than having to
   * know about it.
   */
  const piece = (i: number): ReactNode => {
    if (i >= pairs.length) return null;
    const p = pairs[i];
    const rest = piece(i + 1);
    // A piece that did not change, and every piece of punctuation, is written
    // as it is: only what actually moved animates.
    if (!p.fade || p.from === p.to) return <Fragment key={i}>{p.to}{rest}</Fragment>;
    const split = splitTime(p.from, p.to);
    return (
      <Fragment key={i}>
        {split.lead}
        {/* The stretch crossfades in place: the outgoing reading rides on top
            of the incoming one, which holds the slot's width. Each half is
            keyed by its own text, so a step restarts the two animations
            without remounting the line they sit in. */}
        <span ref={keep(i, 'slot')} style={{ position: 'relative', display: 'inline-block' }}>
          <span data-testid="caption-time-head" key={split.toMid} style={{
            display: 'inline-block', animation: `solo-time-in ${fade}s ${ease} both`,
          }}>
            {split.toMid}
          </span>
          <span data-testid="caption-time-out" key={split.fromMid} aria-hidden ref={keep(i, 'out')} style={{
            position: 'absolute', left: 0, top: 0, animation: `solo-time-out ${fade}s ${ease} both`,
          }}>
            {split.fromMid}
          </span>
        </span>
        {split.tail || rest ? (
          <span data-testid="caption-time-tail" ref={keep(i, 'tail')} style={{ display: 'inline-block' }}>
            {split.tail}{rest}
          </span>
        ) : null}
      </Fragment>
    );
  };

  const time = !lines.time ? null : (
    <span data-testid="caption-time" style={{ ...timeFace, whiteSpace: 'pre' }}>
      {piece(0)}
    </span>
  );

  /* Drawn in the order the dials ask for, so flipping the order moves each
     line's own space with it rather than leaving a hole at the top. */
  const draw = (key: LineKey, gap: number) => {
    const margin = gap * s;
    if (key === 'title') {
      return (
        <div key={key} data-testid="caption-title" style={{
          ...line, marginTop: margin, fontSize: dials.titleSize * s,
          fontWeight: Number(dials.titleWeight), color: gray(dials.titleGray),
          lineHeight: LINE_HEIGHT.title,
        }}>
          {lines.title}
        </div>
      );
    }
    if (key === 'place') {
      if (!lines.place && !(inline && time)) return null;
      return (
        <div key={key} data-testid="caption-place" style={{
          ...line, marginTop: margin, fontSize: dials.placeSize * s,
          fontWeight: Number(dials.titleWeight), color: gray(dials.placeGray),
          lineHeight: LINE_HEIGHT.place,
        }}>
          {lines.place}
          {inline && time && lines.place ? <span style={{ color: gray(dials.timeGray) }}> · </span> : null}
          {inline ? time : null}
        </div>
      );
    }
    if (inline || !time) return null;
    return (
      <div key={key} data-testid="caption-time-line" style={{
        ...line, marginTop: margin, fontWeight: Number(dials.titleWeight),
        lineHeight: LINE_HEIGHT.time,
      }}>
        {time}
      </div>
    );
  };

  return (
    <>
      {stepping && <style>{TIME_KEYFRAMES}</style>}
      <div data-testid="caption" style={block}>
        {sequence.map(({ key, gap }) => draw(key, gap))}
      </div>
    </>
  );
}
