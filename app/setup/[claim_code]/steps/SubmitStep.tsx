'use client';

import { useState } from 'react';
import type { WizardState } from '../types';

// Final step. Assembles the pre-register payload from wizard state and
// POSTs it. The shape matches app/api/cameras/pre-register/route.ts.
export default function SubmitStep({
  claimCode,
  state,
  onBack,
}: {
  claimCode: string;
  state: WizardState;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle');
  const [message, setMessage] = useState<string | null>(null);

  const missing = listMissing(state);

  const submit = async () => {
    if (missing.length > 0) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/cameras/pre-register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claim_code: claimCode,
          lat: state.lat,
          lng: state.lng,
          elevation_m: state.elevationM,
          timezone: state.timezone,
          placement: {
            azimuth_deg: state.placementAzimuth,
            tilt_deg: state.placementTilt,
            horizon_altitude_deg: 0,
            horizon_profile: state.horizonProfile,
          },
          operator_preferences: {
            phase_preference: state.phasePreference,
            delivery: state.delivery,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setStatus('success');
      setMessage('Setup complete. Your camera will start capturing at the next window.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (status === 'success') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-4 text-4xl">✓</div>
        <h1 className="mb-2 text-2xl font-light">You’re set up</h1>
        <p className="text-sm text-neutral-400">{message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Confirm and finish</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Review what we collected, then submit.
      </p>

      <dl className="mb-6 space-y-2 text-sm">
        <Row label="Phase" value={state.phasePreference ?? '—'} />
        <Row
          label="Location"
          value={
            state.lat != null && state.lng != null
              ? `${state.lat.toFixed(4)}, ${state.lng.toFixed(4)}`
              : '—'
          }
        />
        <Row label="Timezone" value={state.timezone ?? '—'} />
        <Row
          label="Bearing"
          value={
            state.placementAzimuth != null
              ? `${Math.round(state.placementAzimuth)}°`
              : '—'
          }
        />
        <Row
          label="Tilt"
          value={
            state.placementTilt != null
              ? `${Math.round(state.placementTilt)}°`
              : '—'
          }
        />
        <Row
          label="Delivery"
          value={
            state.delivery
              ? `${state.delivery.channel} · ${state.delivery.cadence}`
              : '—'
          }
        />
      </dl>

      {missing.length > 0 && (
        <p className="mb-4 text-sm text-amber-400">
          Missing: {missing.join(', ')}. Go back and fill them in.
        </p>
      )}
      {status === 'error' && message && (
        <p className="mb-4 text-sm text-red-400">{message}</p>
      )}

      <div className="mt-auto flex justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">
          Back
        </button>
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
  if (state.phasePreference == null) missing.push('phase');
  if (state.lat == null || state.lng == null) missing.push('location');
  if (state.timezone == null) missing.push('timezone');
  if (state.placementAzimuth == null) missing.push('bearing');
  if (state.placementTilt == null) missing.push('tilt');
  return missing;
}
