'use client';

import { useState } from 'react';

/**
 * Yes / No buttons that capture the operator's "is this a sunrise/sunset?"
 * verdict. Sits above the star rating in the labeling card. Phase-aware copy.
 *
 * Behavior contract:
 *   - No verdict yet → both buttons un-selected; onChange not called
 *   - "Yes" clicked → highlights, onChange(true) fires (parent enables stars)
 *   - "No" clicked  → highlights, onChange(false) fires (parent hides stars +
 *                     submits immediately since there's nothing else to enter)
 *   - Clicking the already-selected button un-selects (onChange(null))
 */

export type Verdict = boolean | null;

export type VerdictButtonsProps = {
  value: Verdict;
  onChange: (next: Verdict) => void;
  /** Webcam phase. Drives the question copy ("Is this a sunrise?" vs sunset). */
  phase?: 'sunrise' | 'sunset' | null;
  /** Disable interaction (e.g. when a submit is in-flight). */
  disabled?: boolean;
};

export default function VerdictButtons({
  value,
  onChange,
  phase = null,
  disabled = false,
}: VerdictButtonsProps) {
  const phaseWord =
    phase === 'sunrise'
      ? 'sunrise'
      : phase === 'sunset'
      ? 'sunset'
      : 'sunrise or sunset';
  const question = `Is this a ${phaseWord}?`;

  const handleClick = (next: boolean) => {
    if (disabled) return;
    // Click the already-selected button → un-select.
    onChange(value === next ? null : next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-wide text-gray-500">
        {question}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleClick(true)}
          disabled={disabled}
          aria-pressed={value === true}
          className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium transition ${
            value === true
              ? 'border-amber-500 bg-amber-100 text-amber-900'
              : 'border-gray-300 text-gray-700 hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => handleClick(false)}
          disabled={disabled}
          aria-pressed={value === false}
          className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium transition ${
            value === false
              ? 'border-slate-500 bg-slate-100 text-slate-900'
              : 'border-gray-300 text-gray-700 hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          No
        </button>
      </div>
    </div>
  );
}

/**
 * Convenience hook for the parent: tracks verdict locally and exposes the
 * "is stars enabled?" derived state. Callers should still POST to the rate
 * endpoint when they want to persist the verdict.
 */
export function useVerdictState(initial: Verdict = null) {
  const [verdict, setVerdict] = useState<Verdict>(initial);
  return {
    verdict,
    setVerdict,
    starsEnabled: verdict === true,
  };
}
