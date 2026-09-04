// app/ring/page.tsx
'use client';

import { useRingStation } from './useRingStation';
import { clockLabel } from '@/app/lib/ring/stationHelpers';

export default function RingStationPage() {
  const { status, imageUrl, title, slot } = useRingStation();

  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black text-white">
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={title ?? 'Live sunset'}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
        {status === 'live' && slot && (
          <p className="text-sm opacity-80">
            {title ?? 'Live sunset'} — stand at {clockLabel(slot.angleDeg)} ({slot.index + 1}/{slot.total})
          </p>
        )}
        {status === 'connecting' && <p className="text-sm opacity-80">Finding the best light…</p>}
        {status === 'waiting' && <p className="text-sm opacity-80">Ring is full — waiting for an opening…</p>}
        {status === 'error' && <p className="text-sm opacity-80">Reconnecting…</p>}
      </div>
    </main>
  );
}
