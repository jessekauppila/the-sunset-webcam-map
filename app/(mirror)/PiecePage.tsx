'use client';

import { useEffect, useState } from 'react';
import { Solo2Screen } from '@/app/components/solo2/Solo2Screen';
import { useGlassFollower, type GlassFollower } from '@/app/components/solo2/useGlassFollower';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { Feed } from '@/app/lib/solo/types';
import { MirrorDark, panelFor } from './MirrorPage';
import { fitPiece, panelCrop, type PanelCrop } from './pieceLayout';

/** The window, measured. `PanelFrame`'s own measurement, for a page that fits two panels rather than one. */
function useViewport(): { width: number; height: number } {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

/**
 * One panel of the pair: the composition at its true pixels, scaled by the
 * factor the PAIR was fitted with rather than by one it computed for itself.
 * That shared factor is what keeps the two pictures the same size as each
 * other, which is the whole claim the page is making.
 *
 * The panel is drawn WHOLE and shown through a window `crop` wide. Cropping
 * by moving the window, rather than by handing the renderer a narrower
 * panel, is what keeps this a mirror: `Solo2Screen` is composing for the
 * same 1920x1080 it composes for on the wall, and every size inside it — the
 * picture, the caption's type, the gap under it — is the size the gallery
 * is showing at this moment. Pass it a cropped width instead and it would
 * lay the whole composition out again to fit, and the page would stop being
 * a picture of the glass.
 */
function PiecePanel({ feed, glass, panel, crop, scale }: {
  feed: Feed;
  glass: GlassFollower;
  panel: PanelSize;
  crop: PanelCrop;
  scale: number;
}) {
  return (
    <div
      data-testid={`piece-panel-${feed}`}
      style={{ width: crop.width * scale, height: panel.height * scale, overflow: 'hidden', flex: 'none' }}
    >
      <div
        data-testid={`piece-stage-${feed}`}
        style={{
          width: panel.width,
          height: panel.height,
          // Right to left: slide the panel so the content's left edge sits at
          // the window's, THEN scale. The translate is in panel pixels, which
          // is what `crop.left` is measured in.
          transform: `scale(${scale}) translateX(${-crop.left}px)`,
          transformOrigin: 'top left',
          background: '#000',
        }}
      >
        {/*
          Black until this feed's own projection lands, and black again if it
          stops answering. The panel keeps its place in the pair either way,
          which is what the glass does: a screen whose feed is down is a dark
          screen beside a live one, not a dark room.
        */}
        {glass.dials ? (
          <Solo2Screen glass={glass} dials={glass.dials} width={panel.width} height={panel.height} feed={feed} debug={false} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The piece: both screens at once, sunrise left and sunset right, as they
 * hang in the gallery.
 *
 * This is the page to send someone who has never stood in the room. A single
 * mirror is half the work — the two screens are composed against each other,
 * and the rendezvous times their peaks to land together, which is invisible
 * unless both are in front of you.
 *
 * The pair scales as ONE object (`fitPiece`), so the two pictures stay the
 * same size as each other and keep a seam between them at every window size.
 * The seam is not the wall's real gap; see `pieceLayout.ts` for why
 * reproducing that measurement makes the piece read as two screenshots.
 *
 * Both halves are followers, exactly as the single mirrors are: two
 * projections, no advance, nothing that decides what comes next.
 */
export function PiecePage() {
  const sunrise = useGlassFollower('sunrise');
  const sunset = useGlassFollower('sunset');
  const viewport = useViewport();

  // Either, not both. Waiting for both would hold the whole page black
  // whenever ONE feed's projection is failing, which is a worse lie than a
  // dark half: the gallery in that state has one screen lit and one dark.
  // Both requests go out together, so in the ordinary case the second lands
  // within milliseconds of the first and nothing is seen to arrive late.
  if (!sunrise.dials && !sunset.dials) return <MirrorDark />;
  // One preset for both, because one live profile sets it for both panels;
  // whichever feed has answered can therefore speak for the pair's geometry.
  const panel = panelFor(sunrise.panelPreset ?? sunset.panelPreset);
  // Same argument for the dials: one live profile composes both screens, so
  // whichever feed answered describes the pair. Both panels get ONE crop for
  // the same reason they get one scale — a pair cropped by different amounts
  // would show two different-sized pictures and lose the comparison.
  const dials = sunrise.dials ?? sunset.dials;
  const crop = dials ? panelCrop(dials, panel) : { left: 0, width: panel.width };
  const layout = fitPiece({ width: crop.width, height: panel.height }, viewport.width, viewport.height);
  if (layout.scale <= 0) return <MirrorDark />;

  return (
    <div
      data-testid="piece"
      style={{ display: 'flex', gap: layout.gap, width: layout.width, height: layout.height }}
    >
      <PiecePanel feed="sunrise" glass={sunrise} panel={panel} crop={crop} scale={layout.scale} />
      <PiecePanel feed="sunset" glass={sunset} panel={panel} crop={crop} scale={layout.scale} />
    </div>
  );
}
