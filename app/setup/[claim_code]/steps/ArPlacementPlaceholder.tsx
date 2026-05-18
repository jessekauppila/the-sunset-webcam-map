'use client';

// Screen 4 placeholder. Real AR design pending — see the design stub at
// docs/superpowers/specs/2026-05-16-cloud-wizard-frontend-design.md
// for what this needs to become (three solstice/equinox arcs in a
// live camera feed with the phone's current bearing locked in).
//
// Lives here so the wizard flow is end-to-end navigable; replaced once
// the AR brainstorm pass completes.
export default function ArPlacementPlaceholder({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Sun-path preview</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Coming soon: live AR overlay showing where the sun rises and sets
        throughout the year at your location.
      </p>

      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-neutral-700 p-8 text-center text-xs text-neutral-500">
        AR overlay placeholder
        <br />
        (deferred — see design stub §4)
      </div>

      <div className="mt-6 flex justify-between">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
