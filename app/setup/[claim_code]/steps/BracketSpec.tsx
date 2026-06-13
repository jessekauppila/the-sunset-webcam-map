'use client';

import type { Facing } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';
import { HFOV } from '@/app/lib/bracket';
import { WedgeDiagram } from '../components/diagrams';
import { Label, Chip, C } from '../components/InsideOutFrame';

// Step 5. Read-only spec of the solved bracket: wedge angle, flip direction,
// lens. Coverage (sunsets/year) is intentionally TBD (v19 handoff correction).
export default function BracketSpec({
  facing,
  solution,
  onNext,
  onBack,
}: {
  facing: Facing;
  solution: BracketSolution;
  onNext: () => void;
  onBack: () => void;
}) {
  const tallSide = solution.angle !== 0 ? solution.offsetSide : null;
  const camFrac = 0.5 - Math.max(-0.32, Math.min(0.32, solution.signedWedge / 140));
  const span = Math.abs(solution.arc.jun - solution.arc.dec);
  const event = facing === 'west' ? 'sunset' : 'sunrise';

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Your bracket</h1>
      <div className="rounded-xl p-4" style={{ background: '#181818', border: '1px solid #3a5f40' }}>
        <Label>Wedge angle</Label>
        <div className="text-2xl text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <b style={{ color: C.amber }}>{solution.angle}°</b>{' '}
          <span className="text-base text-neutral-300">
            {solution.angle === 0 ? '— flat bracket, faces straight out' : 'wedge pair'}
          </span>
        </div>

        <Label>Flip direction</Label>
        <div className="text-xl text-white">
          {tallSide ? <>tall end toward <b style={{ color: C.amber }}>{tallSide}</b></>
                    : <><b style={{ color: C.amber }}>none</b> <span className="text-sm text-neutral-400">— flat, symmetric</span></>}
        </div>

        <Label>Lens</Label>
        <div className="text-xl text-white">
          <b style={{ color: C.amber }}>{solution.lens === 'wide' ? 'wide (120°)' : 'standard (66°)'}</b>
        </div>
        <div className="text-xs text-neutral-500">
          the year&apos;s {event} arc spans {span.toFixed(0)}° here —{' '}
          {span > HFOV.standard ? 'needs the wide lens' : 'the standard lens covers it'}
        </div>
      </div>

      <WedgeDiagram normalAz={solution.normalTrue} aimAz={solution.aimAz} hfov={solution.hfov} arc={solution.arc} camFrac={camFrac} />

      <Chip tone="dark">
        Bracket aim {Math.round(solution.aimAz)}° (equinox {Math.round(solution.targetAz)}°). Coverage: <b>TBD</b>.
      </Chip>

      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button type="button" onClick={onNext} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          This is my bracket — assemble it
        </button>
      </div>
    </div>
  );
}
