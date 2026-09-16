'use client';

import { useEffect, useState } from 'react';
import { Solo2Screen } from '@/app/components/solo2/Solo2Screen';
import { useGlassFollower, type GlassFollower } from '@/app/components/solo2/useGlassFollower';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { Feed } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { MirrorDark, panelFor } from './MirrorPage';
import { fitPiece } from './pieceLayout';

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
 */
function PiecePanel({ feed, glass, dials, panel, scale }: {
  feed: Feed;
  glass: GlassFollower;
  dials: Solo2Dials;
  panel: PanelSize;
  scale: number;
}) {
  return (
    <div
      data-testid={`piece-panel-${feed}`}
      style={{ width: panel.width * scale, height: panel.height * scale, overflow: 'hidden', flex: 'none' }}
    >
      <div
        data-testid={`piece-stage-${feed}`}
        style={{
          width: panel.width,
          height: panel.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: '#000',
        }}
      >
        <Solo2Screen glass={glass} dials={dials} width={panel.width} height={panel.height} feed={feed} debug={false} />
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

  // Both, not either: a lone panel appearing first would show the piece
  // lopsided and then jump, and the dials arrive with the projection whether
  // or not that feed has anything drawable, so waiting costs nothing beyond
  // the slower of two requests.
  if (!sunrise.dials || !sunset.dials) return <MirrorDark />;
  // One preset for both, because one live profile sets it for both panels.
  const panel = panelFor(sunrise.panelPreset ?? sunset.panelPreset);
  const layout = fitPiece(panel, viewport.width, viewport.height);
  if (layout.scale <= 0) return <MirrorDark />;

  return (
    <div
      data-testid="piece"
      style={{ display: 'flex', gap: layout.gap, width: layout.width, height: layout.height }}
    >
      <PiecePanel feed="sunrise" glass={sunrise} dials={sunrise.dials} panel={panel} scale={layout.scale} />
      <PiecePanel feed="sunset" glass={sunset} dials={sunset.dials} panel={panel} scale={layout.scale} />
    </div>
  );
}
