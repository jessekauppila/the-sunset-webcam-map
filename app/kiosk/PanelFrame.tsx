'use client';

import { useEffect, useState } from 'react';
import { fitScale, type PanelSize } from './panelPreview';

/**
 * Renders its children at a panel's true dimensions, then scales the result to
 * fit the current window. The mosaic composes as if it were on the glass while
 * displaying at desk size, so composition judged here holds on the panel.
 *
 * The stage keeps a black backdrop and is centered in the viewport; the outer
 * box reserves only the *scaled* footprint so the page never scrolls.
 */
export function PanelFrame({
  panel,
  children,
}: {
  panel: PanelSize;
  children: React.ReactNode;
}) {
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scale = fitScale(
    panel.width,
    panel.height,
    viewport.width,
    viewport.height
  );

  return (
    <div
      data-testid="panel-box"
      style={{
        width: panel.width * scale,
        height: panel.height * scale,
        margin: '0 auto',
        overflow: 'hidden',
        // The kiosk layout hides the pointer for the gallery; a preview is
        // being driven from a desk, so give it back.
        cursor: 'auto',
      }}
    >
      <div
        data-testid="panel-stage"
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
  );
}
