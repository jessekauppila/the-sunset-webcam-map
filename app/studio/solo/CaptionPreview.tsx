'use client';

import { useEffect, useRef, useState } from 'react';
import { SoloFrame } from '@/app/components/solo/SoloFrame';
import type { StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The caption tab's main area: each screen's frame on glass right now, drawn
 * by the same component the glass uses, with the studio dials instead of the
 * live ones. What you see is what Deploy will send. Panels keep the shared
 * panel preset's aspect and fill the width they are given.
 */
export function CaptionPreview({ screens, dials, panel }: {
  screens: { feed: Feed; server: StateView | null; error?: string | null }[];
  dials: SoloDials;
  /** The glass geometry, for the aspect ratio. */
  panel: { width: number; height: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = width || 800;
  const h = Math.round(w * panel.height / panel.width);

  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {screens.map(({ feed, server, error }) => {
        const current = server?.current?.entry ?? null;
        return (
          <section key={feed}>
            <div style={{ fontFamily: mono, fontSize: 11, color: '#8b95a7', padding: '0 0 6px', display: 'flex', gap: 10 }}>
              <span style={{ color: '#e5e7eb' }}>{feed}</span>
              <span>{current ? `on glass now · frame ${current.snapshotId}` : error ?? 'nothing on glass'}</span>
              <span style={{ marginLeft: 'auto' }}>{panel.width} × {panel.height}</span>
            </div>
            <div ref={feed === screens[0].feed ? ref : undefined} data-testid={`preview-${feed}`}
              style={{ width: '100%', background: '#000', border: '1px solid #1d2432' }}>
              {current ? (
                <SoloFrame entry={current} previous={null} fadeS={0} dials={dials} width={w} height={h} />
              ) : (
                <div style={{ height: h, display: 'grid', placeItems: 'center', color: '#4b5568', fontFamily: mono, fontSize: 12 }}>
                  no frame to preview
                </div>
              )}
            </div>
          </section>
        );
      })}
      <p style={{ margin: 0, fontSize: 12, color: '#8b95a7', maxWidth: '64ch' }}>
        Drawn with the studio dials by the same code as the glass. Move a caption dial on the left and it changes here;
        Deploy sends it to the screens.
      </p>
    </div>
  );
}
