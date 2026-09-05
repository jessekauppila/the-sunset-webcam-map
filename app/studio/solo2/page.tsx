'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { SoloStudioClient } from '../solo/SoloStudioClient';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';

/** /studio/solo2: the solo studio driving the solo2 namespace and engine (solo2 spec §5.4). */
export default function Solo2StudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="solo2 studio">
        <SoloStudioClient version={SOLO_VERSIONS.solo2 as SoloVersionSpec} />
      </OwnerGate>
    </Suspense>
  );
}
