'use client';

import { useState } from 'react';
import { initialWizardState, STEPS, type WizardState, type Step } from './types';
import { solveBracket } from '@/app/lib/bracket';
import ConfirmCamera from './steps/ConfirmCamera';
import FacingPhase from './steps/FacingPhase';
import MeasureWindow from './steps/MeasureWindow';
import HingeToEquinox from './steps/HingeToEquinox';
import BracketSpec from './steps/BracketSpec';
import Assemble from './steps/Assemble';
import MountConfirm from './steps/MountConfirm';
import DeliveryPlaceholder from './steps/DeliveryPlaceholder';
import SubmitStep from './steps/SubmitStep';

export default function WizardClient({ claimCode }: { claimCode: string }) {
  const [step, setStep] = useState<Step>('connect');
  const [state, setState] = useState<WizardState>(initialWizardState);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));
  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx >= 0 && idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };
  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-black px-4 py-6 text-white">
      <header className="mb-4 flex items-center justify-between text-xs uppercase tracking-wider text-neutral-400">
        <span>Camera setup</span>
        <span>Step {STEPS.indexOf(step) + 1} of {STEPS.length}</span>
      </header>

      <section className="flex flex-1 flex-col">
        {step === 'connect' && (
          <ConfirmCamera
            claimCode={claimCode}
            onAdvance={(deviceStatus) => { update({ deviceStatus }); goNext(); }}
          />
        )}
        {step === 'facing-phase' && (
          <FacingPhase onChoose={(facing) => { update({ facing }); goNext(); }} />
        )}
        {step === 'measure-window' && state.facing && (
          <MeasureWindow
            facing={state.facing}
            onCapture={({ windowMagAz, declinationDeg, geo, timezone }) => {
              const solution = solveBracket({
                lat: geo.lat,
                year: new Date().getUTCFullYear(),
                facing: state.facing!,
                windowMagAz,
                declinationDeg,
              });
              update({
                windowMagAz, declinationDeg,
                lat: geo.lat, lng: geo.lng, elevationM: geo.elevationM,
                timezone, solution,
              });
              goNext();
            }}
            onBack={goBack}
          />
        )}
        {step === 'hinge-equinox' && state.facing && state.solution && state.lat != null && state.lng != null && (
          <HingeToEquinox
            facing={state.facing}
            lat={state.lat}
            lng={state.lng}
            solution={state.solution}
            onLock={goNext}
            onBack={goBack}
          />
        )}
        {step === 'bracket-spec' && state.facing && state.solution && (
          <BracketSpec facing={state.facing} solution={state.solution} onNext={goNext} onBack={goBack} />
        )}
        {step === 'assemble' && state.solution && (
          <Assemble solution={state.solution} onNext={goNext} onBack={goBack} />
        )}
        {step === 'mount-confirm' && state.facing && state.solution && (
          <MountConfirm facing={state.facing} solution={state.solution} onConfirm={goNext} onBack={goBack} />
        )}
        {step === 'delivery' && (
          <DeliveryPlaceholder onSkip={() => { update({ delivery: null }); goNext(); }} onBack={goBack} />
        )}
        {step === 'submit' && (
          <SubmitStep claimCode={claimCode} state={state} onBack={goBack} />
        )}
      </section>
    </main>
  );
}
