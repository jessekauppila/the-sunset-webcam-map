import { describe, it, expect } from 'vitest';
import { captionBox, captionHeight, captionLines, displayTitle, formatTime, gray, pictureRect } from './caption';

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
    expect(pictureRect({ captionLayout: 'overlay', pictureHeight: 87, pictureTop: 4 }, 1920, 1080)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });
  it('inset keeps the panel aspect at the dialled height, centred, the dialled way down', () => {
    // 87 % of 1080 = 940 tall; 16:9 → 1671 wide; (1920 − 1671) / 2 = 124 (rounded); 4 % of 1080 = 43.
    expect(pictureRect({ captionLayout: 'inset', pictureHeight: 87, pictureTop: 4 }, 1920, 1080)).toEqual({ left: 125, top: 43, width: 1671, height: 940 });
  });
  it('scales with the panel it is drawn on', () => {
    const r = pictureRect({ captionLayout: 'inset', pictureHeight: 50, pictureTop: 0 }, 960, 540);
    expect(r).toEqual({ left: 240, top: 0, width: 480, height: 270 });
  });
});

describe('captionHeight', () => {
  const d = { titleSize: 21, placeSize: 17, timeSize: 12, lineGap: 0, timeLine: 'own' as const };
  const lines = { place: 'Norrbotten County, Sweden', time: '7:42 pm there' };
  it('adds the lines that will exist at the glass line heights, plus the gaps between them, at scale', () => {
    // title 21 × 1.15 + place 17 × 1.3 + time 12 × 1.3
    expect(captionHeight(d, lines, 1)).toBeCloseTo(61.85);
    expect(captionHeight(d, { place: '', time: '' }, 1)).toBeCloseTo(21 * 1.15);
    expect(captionHeight(d, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 12 * 1.3);
    expect(captionHeight({ ...d, lineGap: 4 }, lines, 1)).toBeCloseTo(61.85 + 8);
    expect(captionHeight(d, lines, 0.5)).toBeCloseTo(61.85 / 2);
  });
  it('an inline time shares the place line, and makes one when there is no place', () => {
    expect(captionHeight({ ...d, timeLine: 'inline' }, lines, 1)).toBeCloseTo(21 * 1.15 + 17 * 1.3);
    expect(captionHeight({ ...d, timeLine: 'inline' }, { place: '', time: '7:42 pm' }, 1)).toBeCloseTo(21 * 1.15 + 17 * 1.3);
  });
});

describe('captionBox', () => {
  const pic = { left: 125, top: 43, width: 1671, height: 940 }; // pictureRect at 87 % on 1920 × 1080
  const d = {
    captionLayout: 'inset' as const, captionAnchor: 'panel-bottom' as const, captionAlign: 'picture' as const, captionGap: 18,
    titleSize: 21, placeSize: 17, timeSize: 12, lineGap: 0, timeLine: 'own' as const,
  };
  const lines = { place: 'Norrbotten County, Sweden', time: '7:42 pm there' };
  const capH = 61.85; // captionHeight(d, lines, 1)
  it('panel-bottom + picture: the gap above the panel edge, flush with the picture, when the picture leaves room', () => {
    const short = pictureRect({ captionLayout: 'inset', pictureHeight: 80, pictureTop: 4 }, 1920, 1080);
    const box = captionBox(d, short, 1920, 1080, lines);
    expect(box).toMatchObject({ left: short.left, maxWidth: short.width, textAlign: 'left' });
    expect(box.top).toBeCloseTo(1080 - 18 - capH);
    expect(box.bottom).toBeUndefined();
  });
  it('a panel-bottom caption never rises into the picture: it sits no higher than the gap below the picture', () => {
    // At 87 % the panel edge would put the caption's top at 1000.15; the picture ends at 983, so the gap wins by less than a pixel.
    expect(captionBox(d, pic, 1920, 1080, lines)).toEqual({ left: 125, maxWidth: 1671, top: 1001, textAlign: 'left' });
    // At 92 % (the glass on 2026-09-05) the panel edge would put it 37 px into the picture; it hangs under the picture instead.
    const tall = pictureRect({ captionLayout: 'inset', pictureHeight: 92, pictureTop: 4 }, 1920, 1080);
    expect(tall.top + tall.height).toBe(1037);
    expect(captionBox(d, tall, 1920, 1080, lines)).toMatchObject({ top: 1037 + 18 });
  });
  it('under-picture hangs the gap below the picture', () => {
    expect(captionBox({ ...d, captionAnchor: 'under-picture' }, pic, 1920, 1080, lines)).toMatchObject({ top: 43 + 940 + 18 });
  });
  it('center spans the panel; panel sits at the glass margin', () => {
    expect(captionBox({ ...d, captionAlign: 'center' }, pic, 1920, 1080, lines)).toEqual({ left: 0, width: 1920, textAlign: 'center', top: 1001 });
    expect(captionBox({ ...d, captionAlign: 'panel' }, pic, 1920, 1080, lines)).toMatchObject({ left: 24, textAlign: 'left' });
  });
  it('the gap and the caption are in glass pixels: everything halves on a half-size panel', () => {
    const half = pictureRect({ captionLayout: 'inset', pictureHeight: 80, pictureTop: 4 }, 960, 540);
    expect(captionBox(d, half, 960, 540, lines).top).toBeCloseTo((1080 - 18 - capH) / 2);
  });
  it('overlay tucks into the picture corner whatever the dials say', () => {
    expect(captionBox({ ...d, captionLayout: 'overlay', captionAlign: 'center' }, pic, 1920, 1080, lines)).toEqual({ left: 24, bottom: 20, textAlign: 'left', maxWidth: 1872 });
  });
});

it('gray is a percent of white', () => {
  expect(gray(100)).toBe('rgb(255, 255, 255)');
  expect(gray(46)).toBe('rgb(117, 117, 117)');
  expect(gray(0)).toBe('rgb(0, 0, 0)');
});
