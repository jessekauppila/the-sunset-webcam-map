'use client';

import type { PhasePreference as Phase } from '../types';

const OPTIONS: { value: Phase; label: string; blurb: string }[] = [
  { value: 'sunrise', label: 'Sunrise', blurb: 'Wake up to the start of the day.' },
  { value: 'sunset', label: 'Sunset', blurb: 'Catch the end of every day.' },
  { value: 'both', label: 'Both', blurb: 'Two windows daily — sunrise and sunset.' },
];

// Screen 2. The phase_preference toggle.
export default function PhasePreference({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: Phase | null;
  onChange: (v: Phase) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">What do you want to capture?</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Your camera will only run during the windows you pick. You can change
        this later.
      </p>

      <div className="flex flex-col gap-3">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border p-4 text-left transition ${
              value === opt.value
                ? 'border-white bg-white/10'
                : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            <div className="text-lg">{opt.label}</div>
            <div className="text-xs text-neutral-400">{opt.blurb}</div>
          </button>
        ))}
      </div>

      <div className="mt-auto flex justify-between pt-8">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-neutral-400"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={value === null}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
