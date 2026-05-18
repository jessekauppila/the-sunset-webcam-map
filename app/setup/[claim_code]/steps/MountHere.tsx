'use client';

import { useDeviceOrientation } from '../lib/useDeviceOrientation';
import { useGeolocation } from '../lib/useGeolocation';

// Screen 6. The "snap a single orientation + location reading" step.
// Requires DeviceOrientation permission (explicit on iOS) and Geolocation
// permission. Both fire on entering this screen so the operator sees the
// permission prompts in context.
//
// Captures everything the pre-register endpoint REQUIRES that the wizard
// hasn't already collected: lat, lng, timezone, placement.azimuth_deg,
// placement.tilt_deg. Hands the bundle to the parent.
export default function MountHere({
  onCapture,
  onBack,
}: {
  onCapture: (data: {
    azimuthDeg: number;
    tiltDeg: number;
    geo: { lat: number; lng: number; elevationM: number | null };
    timezone: string;
  }) => void;
  onBack: () => void;
}) {
  const { orientation, permissionState, requestPermission, error: orientErr } =
    useDeviceOrientation();
  const { result: geo, error: geoErr, pending: geoPending } = useGeolocation(true);

  const ready =
    permissionState === 'granted' && orientation !== null && geo !== null;

  const capture = () => {
    if (!orientation || !geo) return;
    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    onCapture({
      azimuthDeg: orientation.azimuthDeg,
      tiltDeg: orientation.tiltDeg,
      geo,
      timezone,
    });
  };

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Mount here</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Point your phone exactly the way the camera will be pointed, then tap
        below.
      </p>

      {permissionState === 'unknown' && (
        <button
          type="button"
          onClick={requestPermission}
          className="mb-6 rounded border border-white px-4 py-2 text-sm"
        >
          Enable compass + tilt
        </button>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 text-sm">
        <Tile
          label="Bearing"
          value={orientation ? `${Math.round(orientation.azimuthDeg)}°` : '—'}
        />
        <Tile
          label="Tilt"
          value={orientation ? `${Math.round(orientation.tiltDeg)}°` : '—'}
        />
        <Tile
          label="Latitude"
          value={geo ? geo.lat.toFixed(4) : geoPending ? '…' : '—'}
        />
        <Tile
          label="Longitude"
          value={geo ? geo.lng.toFixed(4) : geoPending ? '…' : '—'}
        />
      </div>

      {(orientErr || geoErr) && (
        <p className="mb-4 text-sm text-red-400">
          {orientErr ?? geoErr}
        </p>
      )}

      <div className="mt-auto flex justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">
          Back
        </button>
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Mount here
        </button>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-700 p-3">
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-lg">{value}</div>
    </div>
  );
}
