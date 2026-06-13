'use client';

import type { Facing } from '@/app/lib/solar';

// Step 2. Facing choice = phase preference (reconciliation spec merge).
// 'east' -> sunrise, 'west' -> sunset. Drops 'both' (integration contract D-8).
export default function FacingPhase({ onChoose }: { onChoose: (f: Facing) => void }) {
  const options: { facing: Facing; title: string; sub: string }[] = [
    { facing: 'east', title: 'Sunrise', sub: 'faces east · 365 sunrises a year' },
    { facing: 'west', title: 'Sunset', sub: 'faces west · 365 sunsets a year' },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-3 text-lg font-medium text-white">Is this a sunrise or sunset camera?</h1>
      {options.map((o) => (
        <button
          key={o.facing}
          type="button"
          onClick={() => onChoose(o.facing)}
          className="mb-2 block w-full rounded-xl border border-neutral-700 p-3 text-left hover:border-neutral-500"
          style={{ background: '#181818' }}
        >
          <span className="block font-medium text-white">{o.title}</span>
          <span className="block text-sm text-neutral-500">{o.sub}</span>
        </button>
      ))}
    </div>
  );
}
