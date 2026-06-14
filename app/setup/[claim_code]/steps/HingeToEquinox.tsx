'use client';

import type { Facing } from '@/app/lib/solar';
import { angDiff } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import { useTrueHeading } from '../lib/useTrueHeading';
import { HingeAnim, SkyView } from '../components/diagrams';
import { Why, Chip } from '../components/InsideOutFrame';

// Step 4. Swing the phone open like a door until the equinox event centers.
// The opening angle is real: angDiff(trueHeading, windowNormalTrue). The
// HingeAnim hands off demo->live the moment real movement appears.
export default function HingeToEquinox({
  facing,
  lat,
  lng,
  solution,
  onLock,
  onBack,
}: {
  facing: Facing;
  lat: number;
  lng: number;
  solution: BracketSolution;
  onLock: () => void;
  onBack: () => void;
}) {
  const { trueHeading } = useTrueHeading({ lat, lng });
  const eventLabel = `Equinox ${facing === 'west' ? 'sunset' : 'sunrise'}`;

  const liveOpenDeg = trueHeading != null ? angDiff(trueHeading, solution.normalTrue) : 0;
  const hingeDelta = trueHeading != null ? angDiff(solution.targetAz, trueHeading) : 999;
  const aligned = Math.abs(hingeDelta) <= 2;

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Hinge to the equinox</h1>
      <Why>
        Keep the edge of the phone nearest the sun on the glass and swing the other edge open into the
        room, like a door, until the <b>{eventLabel}</b> centers in view. That swing is the bracket angle.
      </Why>

      <HingeAnim wedgeDeg={solution.wedge} eventLabel={eventLabel} liveOpenDeg={liveOpenDeg} aligned={aligned} />

      <div className="mt-2">
        <SkyView
          centerAz={trueHeading ?? solution.normalTrue}
          fov={60}
          arc={solution.arc}
          showToday
          highlightLock={aligned}
          label="phone camera · AR"
        />
      </div>

      <Chip tone={aligned ? 'good' : 'dark'}>
        {aligned
          ? <>Equinox line centered — opened {Math.abs(solution.wedge).toFixed(0)}° from the glass.</>
          : <>Swing {hingeDelta > 0 ? 'right' : 'left'} {Math.abs(hingeDelta).toFixed(0)}° more.</>}
      </Chip>

      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button
          type="button"
          onClick={onLock}
          disabled={!aligned}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {aligned ? 'Lock the angle' : 'Line up the equinox line'}
        </button>
      </div>
    </div>
  );
}
