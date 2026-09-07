'use client';

import { useEffect, useRef, useState } from 'react';
import { fitScale, type PanelSize } from '@/app/kiosk/panelPreview';

/**
 * PanelFrame's container-measured sibling: PanelFrame fits a panel to the
 * *window*, this fits it to whatever box its parent lays out for it (the
 * studio's preview column, sized by the rest of the grid). Same stage
 * markup — true panel px, scaled down, `top left` origin — just measured
 * with a ResizeObserver on the wrapping element instead of `window.innerWidth`.
 *
 * `edge` draws a hairline on the scaled panel box — the line the glass's own
 * bezel makes. Without it the only rectangle in the preview column is the
 * column's own border, and the panel inside it is black on black, so a
 * caption falling off the panel still looks comfortably inside the frame the
 * eye is using.
 *
 * It is an inset shadow on a layer over the stage, not an outline on the box.
 * An outline is painted *outside* the border box, and `fitScale` sizes the
 * box to meet the measuring wrapper on its limiting axis — so the wrapper's
 * `overflow: hidden` clipped the line away on that axis, and clipped all four
 * sides whenever the panel and the column were the same shape, which in the
 * solo studio they nearly are. Measured headless: nothing drawn at all.
 * An inset shadow is painted inside, so it cannot be clipped; the layer puts
 * it over the stage, whose own black background would otherwise cover it.
 */
export function StudioPanelFrame({
  panel,
  edge,
  children,
}: {
  panel: PanelSize;
  /** Colour of the panel-edge hairline. No line without one. */
  edge?: string;
  children: React.ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = fitScale(panel.width, panel.height, box.width, box.height);

  return (
    <div
      ref={measureRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="studio-panel-box"
        style={{
          width: panel.width * scale,
          height: panel.height * scale,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          data-testid="studio-panel-stage"
          style={{
            width: panel.width,
            height: panel.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: '#000',
          }}
        >
          {children}
        </div>
        {edge && (
          <div
            data-testid="studio-panel-edge"
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              boxShadow: `inset 0 0 0 1px ${edge}`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
