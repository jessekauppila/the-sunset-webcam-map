import { Source_Sans_3, Source_Serif_4 } from 'next/font/google';

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

export const soloFontClassName = `${sans.variable} ${serif.variable}`;
