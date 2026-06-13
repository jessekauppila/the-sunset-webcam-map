'use client';

import type { Facing } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import { MountDiagram, SkyView } from '../components/diagrams';
import { Why, Chip } from '../components/InsideOutFrame';

// Step 7. Mount on the glass; confirm the live view shows the event markers
// over open sky. The aim is correct by construction. Ports prototype screen 6
// (pre-confirm half; success + payload lives in SubmitStep).
export default function MountConfirm({
  facing,
  solution,
  onConfirm,
  onBack,
}: {
  facing: Facing;
  solution: BracketSolution;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const event = facing === 'west' ? 'sunset' : 'sunrise';
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Confirm the view</h1>
      <Why>
        The aim is correct by construction — baked into the bracket. The live view should already show
        the {event} markers over open sky.
      </Why>
      <MountDiagram wedge={solution.angle} />
      <div className="mt-2">
        <SkyView centerAz={solution.aimAz} fov={solution.hfov} arc={solution.arc} showToday label="camera live view" />
      </div>
      <Chip tone="info">Do the {event} lines sit over open sky, clear of the frame?</Chip>
      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Something&apos;s off — back</button>
        <button type="button" onClick={onConfirm} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          ✓ Looks right
        </button>
      </div>
    </div>
  );
}
