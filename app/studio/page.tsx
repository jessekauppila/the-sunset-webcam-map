'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { soloFontClassName } from '@/app/kiosk/soloFonts';
import { StudioClient } from './StudioClient';

/**
 * The one studio. The font wrapper used to live on /studio/solo; the solo
 * preview draws with the kiosk's own face, so it moved up here with the
 * surface. `display: contents` keeps the grid below it intact.
 */
export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="Studio">
        <div className={soloFontClassName} style={{ display: 'contents' }}>
          <StudioClient />
        </div>
      </OwnerGate>
    </Suspense>
  );
}
