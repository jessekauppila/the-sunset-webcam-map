'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { SoloStudioClient } from './SoloStudioClient';
import { SOLO_VERSIONS } from '@/app/lib/solo/versions';

export default function SoloStudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="Solo studio">
        <SoloStudioClient version={SOLO_VERSIONS.solo} />
      </OwnerGate>
    </Suspense>
  );
}
