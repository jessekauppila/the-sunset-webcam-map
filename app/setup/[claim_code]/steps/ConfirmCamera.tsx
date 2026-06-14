'use client';

import { useEffect } from 'react';
import { usePolling } from '../lib/usePolling';
import type { DeviceStatus } from '../types';

type StatusResponse = { status: Exclude<DeviceStatus, 'unknown'> };

// Step 1 (Connect). Polls /api/cameras/setup-status/[claim_code] every 3s
// until the device leaves 'awaiting_wifi'. Auto-advances on any other status
// (registered | awaiting_aim | ready) — covering the resumable re-entry case
// where the device already registered before the recipient returned (Fix 6).
//
// E-gated: until sub-project E ships the captive-portal onboarding, no device
// flips setup-status, so this step only completes against a manually-seeded
// device row.
export default function ConfirmCamera({
  claimCode,
  onAdvance,
}: {
  claimCode: string;
  onAdvance: (status: Exclude<DeviceStatus, 'unknown'>) => void;
}) {
  const { latest, error, stopped } = usePolling<StatusResponse>(
    async () => {
      const res = await fetch(`/api/cameras/setup-status/${claimCode}`);
      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          throw new Error('Unknown or expired claim code.');
        }
        throw new Error(`Setup status check failed (${res.status})`);
      }
      return (await res.json()) as StatusResponse;
    },
    {
      intervalMs: 3000,
      stopWhen: (r) => r.status !== 'awaiting_wifi',
    }
  );

  useEffect(() => {
    if (stopped && latest) onAdvance(latest.status);
  }, [stopped, latest, onAdvance]);

  return (
    <div className="flex flex-1 flex-col justify-center text-center">
      <h1 className="mb-4 text-2xl font-light">Connect your camera</h1>
      <p className="mb-2 text-neutral-400">
        Waiting for your camera to connect…
      </p>
      <p className="mb-8 text-xs text-neutral-500">
        This step needs the camera&apos;s WiFi onboarding (sub-project E) to be live.
      </p>
      <div className="flex justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
      </div>
      {latest && (
        <p className="mt-6 text-xs text-neutral-500">
          Status: {latest.status}
        </p>
      )}
      {error && (
        <p className="mt-6 text-sm text-red-400">{error.message}</p>
      )}
    </div>
  );
}
