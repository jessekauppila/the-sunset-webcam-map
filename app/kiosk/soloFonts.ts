import { Atkinson_Hyperlegible_Next, Source_Sans_3, Source_Serif_4 } from 'next/font/google';

/**
 * The two faces the caption's font dial can pick beyond the system face and
 * the site's Geist pair (which the root layout already provides as
 * --font-geist-sans / --font-geist-mono). Bundled at build time by next/font,
 * so the Pi needs nothing installed and no Google request at runtime. Apply
 * `soloFontClassName` on the kiosk root and on the solo studio pages; the
 * stacks in lib/solo/caption.ts read the variables it sets.
 *
 * Not imported by anything vitest runs: next/font needs the Next compiler.
 */
const sans = Source_Sans_3({ subsets: ['latin'], variable: '--solo-font-sans', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin'], variable: '--solo-font-serif', display: 'swap' });
// Drawn for low vision: no two letters confusable and the counters stay
// open, which is what holds a dim caption together at a distance.
const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin'], variable: '--solo-font-atkinson', display: 'swap' });

export const soloFontClassName = `${sans.variable} ${serif.variable} ${atkinson.variable}`;
