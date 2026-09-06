'use client';

import { SoloFrame } from '@/app/components/solo/SoloFrame';
import { StudioPanelFrame } from '../StudioPanelFrame';
import type { StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SIDE: Record<Feed, string> = { sunrise: 'left screen', sunset: 'right screen' };

/**
 * The two screens as the glass draws them right now, by the same component
 * the glass uses, with the studio dials instead of the live ones: what Deploy
 * will send. Each screen composes at the shared panel preset's true pixels
 * and StudioPanelFrame scales it to the box it is given, so the caption is
 * sized exactly as on glass and both screens fit above the fold. Always on
 * screen in the solo studio, whichever rail page is up, so a picture dial
 * shows its effect without a tab switch.
 */
export function GlassPreview({ screens, dials, panel }: {
  screens: { feed: Feed; server: StateView | null; error?: string | null }[];
  dials: SoloDials;
  /** The glass geometry: the frame composes at this size. */
  panel: { width: number; height: number };
}) {
  return (
    <>
      {screens.map(({ feed, server, error }) => {
        const current = server?.current?.entry ?? null;
        return (
          <section key={feed} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#8b95a7', padding: '0 0 6px', display: 'flex', gap: 10 }}>
              <span style={{ color: '#e5e7eb' }}>{feed} · {SIDE[feed]}</span>
              <span>{current ? `on glass now · frame ${current.snapshotId}` : error ?? 'nothing on glass'}</span>
              <span style={{ marginLeft: 'auto' }}>{panel.width} × {panel.height}</span>
            </div>
            <div data-testid={`preview-${feed}`} style={{ flex: 1, minHeight: 0, background: '#000', border: '1px solid #1d2432' }}>
              {current ? (
                <StudioPanelFrame panel={panel}>
                  <SoloFrame entry={current} previous={null} fadeS={0} dials={dials} width={panel.width} height={panel.height} />
                </StudioPanelFrame>
              ) : (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#4b5568', fontFamily: mono, fontSize: 12 }}>
                  no frame to preview
                </div>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
