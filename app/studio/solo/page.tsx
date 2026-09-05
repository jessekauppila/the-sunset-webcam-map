'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { SoloStudioClient } from './SoloStudioClient';

export default function SoloStudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="Solo studio">
        <SoloStudioClient />
      </OwnerGate>
    </Suspense>
  );
}
