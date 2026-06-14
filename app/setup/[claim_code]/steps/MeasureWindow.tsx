'use client';

import { useEffect } from 'react';
import type { Facing } from '@/app/lib/solar';
import { solveBracket, compassName } from '@/app/lib/bracket';
import { useGeolocation } from '../lib/useGeolocation';
import { useTrueHeading } from '../lib/useTrueHeading';
import { PlacePhoneAnim } from '../components/diagrams';
import { Why, Label, Chip, Btn, C } from '../components/InsideOutFrame';

// Step 3. Phone flat on glass -> window-normal azimuth. Real sensors:
// useGeolocation (lat/lng) + useTrueHeading (magnetic compass + WMM
// declination). Hands the raw inputs up; the parent solves the bracket.
export default function MeasureWindow({
  facing,
  onCapture,
  onBack,
}: {
  facing: Facing;
  onCapture: (data: {
    windowMagAz: number;
    declinationDeg: number;
    geo: { lat: number; lng: number; elevationM: number | null };
    timezone: string;
  }) => void;
  onBack: () => void;
}) {
  const { result: geo } = useGeolocation(true);
  const { orientation, permissionState, requestPermission, declinationDeg, trueHeading } =
    useTrueHeading({ lat: geo?.lat ?? null, lng: geo?.lng ?? null });

  useEffect(() => {
    if (permissionState === 'unknown') void requestPermission();
  }, [permissionState, requestPermission]);

  const ready = orientation != null && geo != null && declinationDeg != null && trueHeading != null;
  const year = new Date().getUTCFullYear();
  const preview =
    ready && declinationDeg != null
      ? solveBracket({ lat: geo!.lat, year, facing, windowMagAz: orientation!.azimuthDeg, declinationDeg })
      : null;

  const capture = () => {
    if (!orientation || !geo || declinationDeg == null) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    onCapture({ windowMagAz: orientation.azimuthDeg, declinationDeg, geo, timezone });
  };

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Measure the window</h1>
      <Why>
        Hold your phone flat against the glass, screen toward you. Its back camera now looks out the
        window — so the compass reads the direction this window faces.
      </Why>
      <PlacePhoneAnim />

      {permissionState === 'unknown' && (
        <Btn onClick={() => void requestPermission()}>Enable compass</Btn>
      )}

      <Label>This window</Label>
      <div className="rounded-xl p-3" style={{ background: '#181818', border: '1px solid #2a2a2a' }}>
        <div className="text-xl text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {preview ? (
            <>faces <b style={{ color: C.amber2 }}>{compassName(preview.normalTrue)} ({Math.round(preview.normalTrue)}°)</b></>
          ) : (
            <span className="text-neutral-500">waiting for compass + location…</span>
          )}
        </div>
      </div>

      {preview && (
        preview.poorFit ? (
          <Chip tone="warn">
            This window faces {Math.abs(preview.offset).toFixed(0)}° off the {facing === 'west' ? 'sunset' : 'sunrise'},
            past the wedge ladder — it&apos;ll still work, aimed as close as the largest part allows.
          </Chip>
        ) : (
          <Chip tone="good">✓ Suits a {preview.angle}° wedge — the arc lands in view.</Chip>
        )
      )}

      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Capture — phone is flat on the glass
        </button>
      </div>
    </div>
  );
}
