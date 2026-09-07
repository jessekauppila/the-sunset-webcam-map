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
 * eye is using. It is an outline, not a border: outlines take no layout
 * space, so the box the line marks is exactly the box that was measured.
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
          outline: edge ? `1px solid ${edge}` : undefined,
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
      </div>
    </div>
  );
}
