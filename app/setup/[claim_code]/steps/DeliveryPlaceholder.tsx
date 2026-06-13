'use client';

// Step 8. Delivery is the lone non-aiming step (reconciliation spec): moved
// after mount & confirm, shipped as a placeholder. Skipping submits null
// delivery (gallery-only default downstream). Notification prefs also live in
// "My Cameras", so skipping here is safe.
export default function DeliveryPlaceholder({
  onSkip,
  onBack,
}: {
  onSkip: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Where should your photos go?</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Coming soon: pick email or text and a cadence. For now your photos land in your gallery —
        you can set notifications later in My Cameras.
      </p>
      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-neutral-700 p-8 text-center text-xs text-neutral-500">
        Delivery preferences placeholder
      </div>
      <div className="mt-6 flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button type="button" onClick={onSkip} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          Skip for now
        </button>
      </div>
    </div>
  );
}
