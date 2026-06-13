'use client';

import type { BracketSolution } from '@/app/lib/bracket';
import { WedgeCaseBracket } from '../components/diagrams';
import { C } from '../components/InsideOutFrame';

// Step 6. Fit the wedge to the case. Mostly instructions (ports prototype
// screen 5). Final parts/cut-files come from the bracket-design work.
export default function Assemble({
  solution,
  onNext,
  onBack,
}: {
  solution: BracketSolution;
  onNext: () => void;
  onBack: () => void;
}) {
  const tallSide = solution.angle !== 0 ? solution.offsetSide : null;
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-2 text-lg font-medium text-white">Assemble the bracket</h1>
      <WedgeCaseBracket wedge={solution.angle} />
      <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-neutral-300">
        <li>Confirm the Pi camera is on its 4× M2 standoffs in the <b>lid</b>, lens out the front hole.</li>
        <li>
          {solution.angle === 0
            ? <>Use the <b style={{ color: C.amber }}>0° flat bracket pair</b> — orientation doesn&apos;t matter.</>
            : <>Take the <b style={{ color: C.amber }}>{solution.angle}°</b> wedge pair, tall end toward <b>{tallSide}</b>.</>}
        </li>
        <li>Assemble: brackets into the lid, slide the lid kusabi in, face plate on, face kusabi to lock.</li>
        <li>Press the VHB tape flush to the glass from inside the room. Camera sits level — no tilt.</li>
      </ol>
      <div className="mt-auto flex items-center justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">Back</button>
        <button type="button" onClick={onNext} className="rounded bg-white px-6 py-2 text-sm font-medium text-black">
          It&apos;s mounted — power it on
        </button>
      </div>
    </div>
  );
}
