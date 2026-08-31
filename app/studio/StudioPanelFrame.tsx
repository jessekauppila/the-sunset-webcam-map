'use client';

import { useEffect, useRef, useState } from 'react';
import { fitScale, type PanelSize } from '@/app/kiosk/panelPreview';

/**
 * PanelFrame's container-measured sibling: PanelFrame fits a panel to the
 * *window*, this fits it to whatever box its parent lays out for it (the
 * studio's preview column, sized by the rest of the grid). Same stage
 * markup — true panel px, scaled down, `top left` origin — just measured
 * with a ResizeObserver on the wrapping element instead of `window.innerWidth`.
 */
export function StudioPanelFrame({
  panel,
  children,
}: {
  panel: PanelSize;
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
