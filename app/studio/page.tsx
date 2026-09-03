'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { StudioClient } from './StudioClient';

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="Studio">
        <StudioClient />
      </OwnerGate>
    </Suspense>
  );
}
