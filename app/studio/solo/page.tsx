'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { soloFontClassName } from '@/app/kiosk/soloFonts';
import { SoloStudioClient } from './SoloStudioClient';
import { SOLO_VERSIONS } from '@/app/lib/solo/versions';

export default function SoloStudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="Solo studio">
        <div className={soloFontClassName} style={{ display: 'contents' }}>
          <SoloStudioClient version={SOLO_VERSIONS.solo} />
        </div>
      </OwnerGate>
    </Suspense>
  );
}
