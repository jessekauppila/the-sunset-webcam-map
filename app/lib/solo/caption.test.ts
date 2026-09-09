import { describe, it, expect } from 'vitest';
import { captionBox, captionHeight, captionLines, displayTitle, drawFactor, formatAgo, formatTime, gray, captionSequence, pairTimeSegments, pictureRect, splitTime, tailTravel, timeSegments, timeText } from './caption';

// 02:42 UTC on 2026-09-05 is 7:42 pm the evening before in Mazatlán (UTC−7).
const AT = Date.UTC(2026, 8, 5, 2, 42);
const TZ = 'America/Mazatlan';
const MIN = 60_000;

describe('formatTime', () => {
  it('renders each style', () => {
    expect(formatTime('off', AT, TZ, 1.23)).toBeNull();
    expect(formatTime('12h', AT, TZ, 1.23)).toBe('7:42 pm');
    expect(formatTime('12h-there', AT, TZ, 1.23)).toBe('7:42 pm there');
    expect(formatTime('24h', AT, TZ, 1.23)).toBe('19:42');
    expect(formatTime('sun', AT, TZ, 1.23)).toBe('sun 1.2° above the horizon');
    expect(formatTime('12h-sun', AT, TZ, -2.15)).toBe('7:42 pm · sun 2.1° below the horizon');
  });
  it('a morning time reads am', () => {
    expect(formatTime('12h', Date.UTC(2026, 8, 5, 13, 5), TZ, 0)).toBe('6:05 am');
  });
  it('without a timezone the clock styles say nothing and the sun still can', () => {
    expect(formatTime('12h', AT, null, 1)).toBeNull();
    expect(formatTime('24h', AT, null, 1)).toBeNull();
    expect(formatTime('12h-sun', AT, null, 1)).toBe('sun 1.0° above the horizon');
    expect(formatTime('sun', AT, TZ, null)).toBeNull();
  });
  it('an unknown zone name is treated as no zone', () => {
    expect(formatTime('12h', AT, 'Mars/Olympus', 1)).toBeNull();
  });
});

describe('formatAgo', () => {
  it('counts minutes up to an hour', () => {
    expect(formatAgo(13 * MIN)).toBe('13 minutes ago');
    expect(formatAgo(1 * MIN)).toBe('1 minute ago');
    expect(formatAgo(59 * MIN)).toBe('59 minutes ago');
  });
  it('then hours and minutes, dropping a round remainder', () => {
    expect(formatAgo(65 * MIN)).toBe('1 hour 5 minutes ago');
    expect(formatAgo(60 * MIN)).toBe('1 hour ago');
    expect(formatAgo(120 * MIN)).toBe('2 hours ago');
    expect(formatAgo(181 * MIN)).toBe('3 hours 1 minute ago');
  });
  it('then days and hours, for a camera that has gone quiet', () => {
    expect(formatAgo(25 * 60 * MIN)).toBe('1 day 1 hour ago');
    expect(formatAgo(48 * 60 * MIN)).toBe('2 days ago');
  });
  it('under a minute, and a capture that reads as being in the future, are both just now', () => {
    expect(formatAgo(59_000)).toBe('just now');
    expect(formatAgo(0)).toBe('just now');
    expect(formatAgo(-5 * MIN)).toBe('just now');
  });
});

describe('the ago style', () => {
  it('measures the picture against the wall clock it is given', () => {
    expect(formatTime('ago', AT, TZ, 1.23, AT + 13 * MIN)).toBe('13 minutes ago');
    expect(formatTime('ago', AT, null, null, AT + 65 * MIN)).toBe('1 hour 5 minutes ago');
  });
  it('needs neither a zone nor a sun angle, so it always says something', () => {
    expect(timeSegments('ago', AT, null, null, AT + MIN)).toEqual([{ text: '1 minute ago', fade: true }]);
  });
  it('a run counts down, and only the digit that moved is asked to fade', () => {
    const now = AT + 38 * MIN;
    const from = timeSegments('ago', AT, TZ, null, now);
    const to = timeSegments('ago', AT + 10 * MIN, TZ, null, now);
    expect(timeText(from)).toBe('38 minutes ago');
    expect(timeText(to)).toBe('28 minutes ago');
    const [pair] = pairTimeSegments(from, to);
    expect(splitTime(pair.from, pair.to)).toEqual({ lead: '', fromMid: '3', toMid: '2', tail: '8 minutes ago' });
  });
  it('an hour reading holds the hour still and moves the minute', () => {
    expect(splitTime('1 hour 5 minutes ago', '1 hour 4 minutes ago'))
      .toEqual({ lead: '1 hour ', fromMid: '5', toMid: '4', tail: ' minutes ago' });
  });
});

describe('pairTimeSegments', () => {
  const seg = (text: string, fade = true) => ({ text, fade });

  it('nothing to fade from means nothing animates', () => {
    expect(pairTimeSegments(null, [seg('7:42 pm')])).toEqual([{ from: '7:42 pm', to: '7:42 pm', fade: false }]);
  });

  it('matches piece for piece, so the reading that held still is not asked to fade', () => {
    const from = [seg('7:42 pm there'), seg(' (', false), seg('10:42 pm here'), seg(')', false)];
    const to = [seg('7:51 pm there'), seg(' (', false), seg('10:51 pm here'), seg(')', false)];
    expect(pairTimeSegments(from, to)).toEqual([
      { from: '7:42 pm there', to: '7:51 pm there', fade: true },
      { from: ' (', to: ' (', fade: false },
      { from: '10:42 pm here', to: '10:51 pm here', fade: true },
      { from: ')', to: ')', fade: false },
    ]);
  });

  it('two readings of different shapes crossfade as one line, the way they did before there were pieces', () => {
    const from = [seg('7:42 pm'), seg(' \u00b7 ', false), seg('sun 1.2\u00b0 above the horizon')];
    const to = [seg('7:51 pm')];
    expect(pairTimeSegments(from, to)).toEqual([
      { from: '7:42 pm \u00b7 sun 1.2\u00b0 above the horizon', to: '7:51 pm', fade: true },
    ]);
  });
});

describe('displayTitle', () => {
  // Real Windy titles from the sunset bin on 2026-09-05.
  const split = 'Split › West';
  const porjus = 'Porjus › North-west: Northern Lights webcam';
  const toussus = 'Toussus-le-Noble: Toussus Le Noble';
  const plain = 'Pier';

  it('raw leaves every title alone', () => {
    for (const t of [split, porjus, toussus, plain]) expect(displayTitle(t, 'raw')).toEqual({ title: t, city: null });
  });
  it('compass drops the "› Compass" part and keeps "City: Spot"', () => {
    expect(displayTitle(split, 'compass').title).toBe('Split');
    expect(displayTitle(porjus, 'compass').title).toBe('Porjus: Northern Lights webcam');
    expect(displayTitle(plain, 'compass').title).toBe('Pier');
  });
  it('comma and dot keep the compass with a quieter separator', () => {
    expect(displayTitle(split, 'comma').title).toBe('Split, West');
    expect(displayTitle(porjus, 'comma').title).toBe('Porjus, North-west: Northern Lights webcam');
    expect(displayTitle(split, 'dot').title).toBe('Split · West');
  });
  it('spot shows the spot name and hands the city to the place line; a title with no spot keeps the city', () => {
    expect(displayTitle(porjus, 'spot')).toEqual({ title: 'Northern Lights webcam', city: 'Porjus' });
    expect(displayTitle(split, 'spot')).toEqual({ title: 'Split', city: null });
  });
  it('a spot that repeats the city (modulo hyphens and case) is said once', () => {
    expect(displayTitle(toussus, 'compass').title).toBe('Toussus-le-Noble');
    expect(displayTitle(toussus, 'spot')).toEqual({ title: 'Toussus-le-Noble', city: null });
  });
});

describe('captionLines', () => {
  const e = { title: 'Porjus › North-west: Northern Lights webcam', region: 'Norrbotten County', country: 'Sweden', capturedAt: AT, timezone: TZ, sunAltitudeDeg: 1.2 };
  const d = { showPlace: true, timeStyle: '12h-there' as const, titleClean: 'compass' as const };
  it('gives the cleaned title, the place, the time, and the two joined', () => {
    expect(captionLines(e, d)).toEqual({
      title: 'Porjus: Northern Lights webcam', place: 'Norrbotten County, Sweden', time: '7:42 pm there',
      timeParts: [{ text: '7:42 pm there', fade: true }],
      sub: 'Norrbotten County, Sweden · 7:42 pm there',
    });
  });
  it('the ago style reads against the wall clock the caller passes', () => {
    const lines = captionLines(e, { ...d, timeStyle: 'ago' }, undefined, AT + 13 * MIN)!;
    expect(lines.time).toBe('13 minutes ago');
    expect(lines.sub).toBe('Norrbotten County, Sweden · 13 minutes ago');
  });
  it('names the screen before the title when the prefix dial is on and a feed is given', () => {
    expect(captionLines(e, { ...d, feedPrefix: true }, 'sunset')!.title).toBe('Sunset: Porjus: Northern Lights webcam');
    expect(captionLines(e, { ...d, feedPrefix: true }, 'sunrise')!.title).toBe('Sunrise: Porjus: Northern Lights webcam');
    expect(captionLines(e, { ...d, feedPrefix: true })!.title).toBe('Porjus: Northern Lights webcam');
    expect(captionLines(e, { ...d, feedPrefix: false }, 'sunset')!.title).toBe('Porjus: Northern Lights webcam');
  });
  it('spot mode puts the city on the place line', () => {
    expect(captionLines(e, { ...d, titleClean: 'spot' })).toMatchObject({ title: 'Northern Lights webcam', place: 'Porjus, Norrbotten County, Sweden' });
  });
  it('an empty time leaves sub as the place alone; place off gives nothing', () => {
    expect(captionLines(e, { ...d, timeStyle: 'off' })).toMatchObject({ time: '', sub: 'Norrbotten County, Sweden' });
    expect(captionLines({ ...e, region: '', country: '' }, d)!.sub).toBe('7:42 pm there');
    expect(captionLines(e, { ...d, showPlace: false })).toBeNull();
  });
});

describe('pictureRect', () => {
  it('overlay fills the panel', () => {
    expect(pictureRect({ captionLayout: 'overlay', pictureHeight: 87, pictureShift: 0 }, 1920, 1080)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });
  it('inset keeps the panel aspect at the dialled height, locked on the centre both ways', () => {
    // 87 % of 1080 = 940 tall; 16:9 → 1671 wide; (1920 − 1671) / 2 = 125 (rounded); (1080 − 940) / 2 = 70.
    expect(pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 0 }, 1920, 1080)).toEqual({ left: 125, top: 70, width: 1671, height: 940 });
    // Growing the picture moves its top up and its foot down by the same amount.
    const small = pictureRect({ captionLayout: 'inset', pictureHeight: 50, pictureShift: 0 }, 1920, 1080);
    const big = pictureRect({ captionLayout: 'inset', pictureHeight: 70, pictureShift: 0 }, 1920, 1080);
    expect(small.top + small.height / 2).toBe(540);
    expect(big.top + big.height / 2).toBe(540);
  });
  it('scales with the panel it is drawn on', () => {
    expect(pictureRect({ captionLayout: 'inset', pictureHeight: 50, pictureShift: 0 }, 960, 540)).toEqual({ left: 240, top: 135, width: 480, height: 270 });
  });
  it('the nudge slides the picture off centre by a percent of the panel, negative up, and changes nothing else', () => {
    const centred = pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 0 }, 1920, 1080);
    const up = pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: -5 }, 1920, 1080);
    const down = pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 5 }, 1920, 1080);
    expect(up.top).toBe(centred.top - 54); // 5 % of 1080
    expect(down.top).toBe(centred.top + 54);
    expect({ ...up, top: 0 }).toEqual({ ...centred, top: 0 });
    // Half the panel, half the nudge: it is a percent, not a pixel count.
    expect(pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 5 }, 960, 540).top)
      .toBe(pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 0 }, 960, 540).top + 27);
  });
  it('the caption goes with it: the pair keeps its gap and moves as one block', () => {
    const d = { captionLayout: 'inset' as const, captionAlign: 'picture' as const, captionGap: 18 };
    const centred = pictureRect({ captionLayout: 'inset', pictureHeight: 80, pictureShift: 0 }, 1920, 1080);
    const up = pictureRect({ captionLayout: 'inset', pictureHeight: 80, pictureShift: -5 }, 1920, 1080);
    expect(captionBox(d, up, 1920).top).toBe(captionBox(d, centred, 1920).top! - 54);
  });
  it('overlay has no centre to nudge: the picture is the panel', () => {
    expect(pictureRect({ captionLayout: 'overlay', pictureHeight: 87, pictureShift: -10 }, 1920, 1080))
      .toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });
});

describe('splitTime', () => {
  it('holds every character the two readings share at both ends and fades only the stretch between', () => {
    // The hour and the colon did not move, so they do not animate.
    expect(splitTime('7:22 pm there', '7:32 pm there'))
      .toEqual({ lead: '7:', fromMid: '2', toMid: '3', tail: '2 pm there' });
    expect(splitTime('7:42 pm there', '7:52 pm there'))
      .toEqual({ lead: '7:', fromMid: '4', toMid: '5', tail: '2 pm there' });
    // One digit of the sun's angle, with "sun 1." and the words after it still.
    expect(splitTime('sun 1.2° above the horizon', 'sun 1.4° above the horizon'))
      .toEqual({ lead: 'sun 1.', fromMid: '2', toMid: '4', tail: '° above the horizon' });
  });
  it('an hour rolling over past noon moves the middle and keeps both ends', () => {
    expect(splitTime('11:52 am there', '12:02 pm there'))
      .toEqual({ lead: '1', fromMid: '1:52 a', toMid: '2:02 p', tail: 'm there' });
  });
  it('a reading with no shared ends fades whole', () => {
    expect(splitTime('7:59', '8:00')).toEqual({ lead: '', fromMid: '7:59', toMid: '8:00', tail: '' });
  });
  it('leaves a character in the middle even when the two readings match, so there is always something to fade', () => {
    expect(splitTime('7:42 pm there', '7:42 pm there'))
      .toEqual({ lead: '7:42 pm ther', fromMid: 'e', toMid: 'e', tail: '' });
  });
});

describe('captionSequence', () => {
  const d = { lineOrder: 'name-first' as const, titleGap: 4, placeGap: 6, timeGap: 12 };
  it('draws name, region, time and gives the first line no space above it', () => {
    expect(captionSequence(d)).toEqual([
      { key: 'title', gap: 0 }, { key: 'place', gap: 6 }, { key: 'time', gap: 12 },
    ]);
  });
  it('flipping the order carries each gap with its own line', () => {
    expect(captionSequence({ ...d, lineOrder: 'time-first' })).toEqual([
      { key: 'time', gap: 0 }, { key: 'title', gap: 4 }, { key: 'place', gap: 6 },
    ]);
  });
});

describe('captionHeight', () => {
  const d = {
    titleSize: 21, placeSize: 17, timeSize: 12,
    lineOrder: 'name-first' as const, titleGap: 0, placeGap: 0, timeGap: 0, timeLine: 'own' as const,
  };
  const lines = { place: 'Norrbotten County, Sweden', time: '7:42 pm there' };
  it('adds the lines that will exist at the glass line heights, plus the gaps between them, at scale', () => {
    // title 21 × 1.15 + place 17 × 1.3 + time 12 × 1.3
    expect(captionHeight(d, lines, 1)).toBeCloseTo(61.85);
    expect(captionHeight(d, { place: '', time: '' }, 1)).toBeCloseTo(21 * 1.15);
    expect(captionHeight(d, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 12 * 1.3);
    expect(captionHeight({ ...d, placeGap: 4, timeGap: 4 }, lines, 1)).toBeCloseTo(61.85 + 8);
    expect(captionHeight(d, lines, 0.5)).toBeCloseTo(61.85 / 2);
  });
  it('each line carries its own gap, so the region can sit tight while the time stands clear', () => {
    expect(captionHeight({ ...d, timeGap: 10 }, lines, 1)).toBeCloseTo(61.85 + 10);
    expect(captionHeight({ ...d, placeGap: 4, timeGap: 14 }, lines, 1)).toBeCloseTo(61.85 + 4 + 14);
    // with no place line the time is still the line that carries its gap
    expect(captionHeight({ ...d, timeGap: 10 }, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 12 * 1.3 + 10);
    expect(captionHeight({ ...d, timeGap: 10 }, lines, 0.5)).toBeCloseTo((61.85 + 10) / 2);
  });
  it('the first line has no space above it, whichever line leads', () => {
    const flipped = { ...d, lineOrder: 'time-first' as const, titleGap: 30, placeGap: 0, timeGap: 99 };
    // time leads so its 99 is dropped; only the name's 30 is added
    expect(captionHeight(flipped, lines, 1)).toBeCloseTo(61.85 + 30);
  });
  it('an inline time shares the place line, and makes one when there is no place', () => {
    expect(captionHeight({ ...d, timeLine: 'inline' }, lines, 1)).toBeCloseTo(21 * 1.15 + 17 * 1.3);
    expect(captionHeight({ ...d, timeLine: 'inline' }, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 17 * 1.3);
  });
  it('an inline time ignores the time gap: there is no time line to push down', () => {
    expect(captionHeight({ ...d, timeLine: 'inline', timeGap: 30 }, lines, 1)).toBeCloseTo(21 * 1.15 + 17 * 1.3);
  });
});


describe('captionBox', () => {
  const pic = pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 0 }, 1920, 1080); // 125, 70, 1671 × 940
  const d = { captionLayout: 'inset' as const, captionAlign: 'picture' as const, captionGap: 18 };
  it('hangs the gap below the picture\'s foot, flush with the picture', () => {
    expect(captionBox(d, pic, 1920)).toEqual({ left: 125, maxWidth: 1671, top: 70 + 940 + 18, textAlign: 'left' });
  });
  it('the gap is from the picture whatever its height: the caption follows the foot, never the panel edge', () => {
    for (const h of [40, 60, 80, 92]) {
      const p = pictureRect({ captionLayout: 'inset', pictureHeight: h, pictureShift: 0 }, 1920, 1080);
      expect(captionBox(d, p, 1920).top).toBe(p.top + p.height + 18);
    }
    // At 92 % the picture ends at 1034 and the caption starts at 1052: it leaves the panel, and that is what the preview shows.
    const tall = pictureRect({ captionLayout: 'inset', pictureHeight: 92, pictureShift: 0 }, 1920, 1080);
    expect(captionBox(d, tall, 1920).top).toBeGreaterThan(1080 - 30);
  });
  it('center spans the panel; panel sits at the glass margin', () => {
    expect(captionBox({ ...d, captionAlign: 'center' }, pic, 1920)).toEqual({ left: 0, width: 1920, textAlign: 'center', top: 1028 });
    expect(captionBox({ ...d, captionAlign: 'panel' }, pic, 1920)).toMatchObject({ left: 24, textAlign: 'left', top: 1028 });
  });
  it('the gap is in glass pixels: everything halves on a half-size panel', () => {
    const half = pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureShift: 0 }, 960, 540);
    expect(captionBox(d, half, 960).top).toBe(half.top + half.height + 9);
  });
  it('overlay tucks into the picture corner whatever the dials say', () => {
    expect(captionBox({ ...d, captionLayout: 'overlay', captionAlign: 'center' }, pic, 1920)).toEqual({ left: 24, bottom: 20, textAlign: 'left', maxWidth: 1872 });
  });
});

it('gray is a percent of white', () => {
  expect(gray(100)).toBe('rgb(255, 255, 255)');
  expect(gray(46)).toBe('rgb(117, 117, 117)');
  expect(gray(0)).toBe('rgb(0, 0, 0)');
});

describe('drawFactor', () => {
  it('is the picture width over the source width: 1 at native size, ~4.2 at the default inset on a 1080 panel', () => {
    expect(drawFactor({ width: 400 })).toBe(1);
    const d = { captionLayout: 'inset' as const, pictureHeight: 87, pictureShift: 0 };
    expect(drawFactor(pictureRect(d, 1920, 1080))).toBeCloseTo(4.18, 2);
    expect(drawFactor(pictureRect({ ...d, captionLayout: 'overlay' }, 2560, 1440))).toBeCloseTo(6.4, 2);
    expect(drawFactor({ width: 1000 }, { width: 500 })).toBe(2);
  });
});

describe('tailTravel', () => {
  it('moves the words left by what the number lost', () => {
    // "10 minutes ago" → "9 minutes ago": the digits are 20px, then 11px, so
    // the twelve characters after them end up 9px further left.
    expect(tailTravel(20, 11)).toBe(9);
  });

  it('moves them right when the reading grows', () => {
    expect(tailTravel(11, 20)).toBe(-9);
  });

  it('is nothing when the number keeps its width', () => {
    // 38 → 28 in tabular figures: one digit swapped, same advance, so there is
    // nothing for the words beside it to do.
    expect(tailTravel(20, 20)).toBe(0);
  });

  it('ignores a sub-pixel difference rather than promoting a layer for it', () => {
    expect(tailTravel(20.2, 20)).toBe(0);
  });
});
