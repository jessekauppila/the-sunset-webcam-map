'use client';

// Screen 5 placeholder. Real horizon-sweep design pending — see the
// design stub at docs/superpowers/specs/2026-05-16-cloud-wizard-
// frontend-design.md for what this needs to become (record {azimuth,
// altitude} pairs as the operator turns in a circle aimed at the
// visible horizon).
//
// The pre-register endpoint accepts horizon_profile as optional;
// skipping here is safe — the server will derive a default geometric
// horizon (altitude 0 everywhere) until this is built.
export default function HorizonSweepPlaceholder({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Map your horizon</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Coming soon: walk in a slow circle while keeping the phone aimed at
        where the sky meets the ground, so we know when the sun is actually
        visible from this spot.
      </p>

      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-neutral-700 p-8 text-center text-xs text-neutral-500">
        Horizon sweep placeholder
        <br />
        (deferred — see design stub §5)
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
