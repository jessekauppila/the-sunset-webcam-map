import { describe, it, expect } from 'vitest';
import { captionBox, captionHeight, captionLines, displayTitle, drawFactor, formatTime, gray, lineGaps, pictureRect, splitTime } from './caption';

// 02:42 UTC on 2026-09-05 is 7:42 pm the evening before in Mazatlán (UTC−7).
const AT = Date.UTC(2026, 8, 5, 2, 42);
const TZ = 'America/Mazatlan';

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
      sub: 'Norrbotten County, Sweden · 7:42 pm there',
    });
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
  it('keeps the words the two readings share and hands back only what changed', () => {
    expect(splitTime('7:42 pm there', '7:52 pm there')).toEqual({ fromHead: '7:42', toHead: '7:52', tail: 'pm there' });
    // "pm" is shared until it isn't.
    expect(splitTime('11:52 am there', '12:02 pm there')).toEqual({ fromHead: '11:52 am', toHead: '12:02 pm', tail: 'there' });
    expect(splitTime('sun 1.2° above the horizon', 'sun 0.4° above the horizon'))
      .toEqual({ fromHead: 'sun 1.2°', toHead: 'sun 0.4°', tail: 'above the horizon' });
  });
  it('compares whole words, so a shared digit never splits a number', () => {
    expect(splitTime('7:42', '7:52')).toEqual({ fromHead: '7:42', toHead: '7:52', tail: '' });
  });
  it('leaves a word in the head even when every word matches, so there is always something to fade', () => {
    expect(splitTime('7:42 pm there', '7:42 pm there')).toEqual({ fromHead: '7:42', toHead: '7:42', tail: 'pm there' });
  });
});

describe('lineGaps', () => {
  it('the time carries the line gap plus its own, so it can sit apart from the two lines above it', () => {
    expect(lineGaps({ lineGap: 0, timeGap: 0 })).toEqual({ place: 0, time: 0 });
    expect(lineGaps({ lineGap: 4, timeGap: 0 })).toEqual({ place: 4, time: 4 });
    expect(lineGaps({ lineGap: 4, timeGap: 12 })).toEqual({ place: 4, time: 16 });
  });
});

describe('captionHeight', () => {
  const d = { titleSize: 21, placeSize: 17, timeSize: 12, lineGap: 0, timeGap: 0, timeLine: 'own' as const };
  const lines = { place: 'Norrbotten County, Sweden', time: '7:42 pm there' };
  it('adds the lines that will exist at the glass line heights, plus the gaps between them, at scale', () => {
    // title 21 × 1.15 + place 17 × 1.3 + time 12 × 1.3
    expect(captionHeight(d, lines, 1)).toBeCloseTo(61.85);
    expect(captionHeight(d, { place: '', time: '' }, 1)).toBeCloseTo(21 * 1.15);
    expect(captionHeight(d, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 12 * 1.3);
    expect(captionHeight({ ...d, lineGap: 4 }, lines, 1)).toBeCloseTo(61.85 + 8);
    expect(captionHeight(d, lines, 0.5)).toBeCloseTo(61.85 / 2);
  });
  it('the time gap pushes the time line down and the block grows by exactly that much', () => {
    expect(captionHeight({ ...d, timeGap: 10 }, lines, 1)).toBeCloseTo(61.85 + 10);
    expect(captionHeight({ ...d, lineGap: 4, timeGap: 10 }, lines, 1)).toBeCloseTo(61.85 + 8 + 10);
    // with no place line the time is still the line that carries the extra gap
    expect(captionHeight({ ...d, timeGap: 10 }, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 12 * 1.3 + 10);
    expect(captionHeight({ ...d, timeGap: 10 }, lines, 0.5)).toBeCloseTo((61.85 + 10) / 2);
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
