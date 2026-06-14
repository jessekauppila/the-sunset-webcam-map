'use client';

import { useState } from 'react';
import type { WizardState } from '../types';
import { buildPreRegisterPayload } from '@/app/lib/bracket';

// Step 9. Builds the §4.2 pre-register payload from the solved bracket and
// POSTs it. The shape comes from buildPreRegisterPayload (app/lib/bracket.ts).
// isOwner: when true, renders the "Publish now" checkbox and includes publish
// in the POST body so the server can set deployment state = 'deployed'.
export default function SubmitStep({
  claimCode,
  state,
  onBack,
  isOwner,
  onPublishChange,
}: {
  claimCode: string;
  state: WizardState;
  onBack: () => void;
  isOwner: boolean;
  onPublishChange?: (publish: boolean) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const missing = listMissing(state);

  const submit = async () => {
    if (missing.length > 0 || !state.solution || state.facing == null ||
        state.lat == null || state.lng == null || state.timezone == null ||
        state.declinationDeg == null) {
      return;
    }
    setStatus('submitting');
    try {
      const payload = buildPreRegisterPayload({
        claimCode,
        lat: state.lat,
        lng: state.lng,
        elevationM: state.elevationM,
        timezone: state.timezone,
        facing: state.facing,
        solution: state.solution,
        declinationDeg: state.declinationDeg,
        delivery: state.delivery,
      });
      const body: Record<string, unknown> = {
        ...payload,
        mode: state.mode,
        ...(isOwner ? { publish: state.publish } : {}),
      };
      const res = await fetch('/api/cameras/pre-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Fix 6 / contract LC-5: a near-TTL code can expire mid-flow; surface
        // 404/410 legibly at Submit, not just on Connect.
        if (res.status === 410 || res.status === 404) {
          throw new Error("Unknown or expired claim code — this camera's setup link has expired.");
        }
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setStatus('success');
      setMessage('Setup complete. Your camera fine-tunes its aim on the next clear window.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (status === 'success') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-4 text-4xl">✓</div>
        <h1 className="mb-2 text-2xl font-light">You&apos;re set up</h1>
        <p className="text-sm text-neutral-400">{message}</p>
      </div>
    );
  }

  const sol = state.solution;
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Confirm and finish</h1>
      <p className="mb-6 text-sm text-neutral-400">Review what we collected, then submit.</p>

      <dl className="mb-6 space-y-2 text-sm">
        <Row label="Phase" value={state.facing === 'east' ? 'sunrise' : state.facing === 'west' ? 'sunset' : '—'} />
        <Row label="Location" value={state.lat != null && state.lng != null ? `${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}` : '—'} />
        <Row label="Timezone" value={state.timezone ?? '—'} />
        <Row label="Aim" value={sol ? `${Math.round(sol.aimAz)}°` : '—'} />
        <Row label="Wedge" value={sol ? `${sol.angle}°${sol.offsetSide ? ` (tall ${sol.offsetSide})` : ''}` : '—'} />
        <Row label="Lens" value={sol ? (sol.lens === 'wide' ? 'wide 102°' : 'standard 66°') : '—'} />
        <Row label="Delivery" value={state.delivery ? `${state.delivery.channel}` : 'gallery only'} />
      </dl>

      {isOwner && (
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.publish}
            onChange={(e) => onPublishChange?.(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          Publish now (go live)
        </label>
      )}

      {missing.length > 0 && (
        <p className="mb-4 text-sm text-amber-400">Missing: {missing.join(', ')}. Go back and fill them in.</p>
      )}
      {status === 'error' && message && <p className="mb-4 text-sm text-red-400">{message}</p>}

      <div className="mt-auto flex justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={missing.length > 0 || status === 'submitting'}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {status === 'submitting' ? 'Submitting…' : 'Finish setup'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-neutral-800 py-1">
      <dt className="text-neutral-400">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function listMissing(state: WizardState): string[] {
  const missing: string[] = [];
  if (state.facing == null) missing.push('phase');
  if (state.lat == null || state.lng == null) missing.push('location');
  if (state.timezone == null) missing.push('timezone');
  if (state.solution == null) missing.push('bracket');
  if (state.declinationDeg == null) missing.push('declination');
  return missing;
}
