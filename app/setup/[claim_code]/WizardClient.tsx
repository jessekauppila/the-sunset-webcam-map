'use client';

import { useCallback, useState } from 'react';
import { initialWizardState, STEPS, type WizardState, type Step } from './types';
import { solveBracket } from '@/app/lib/bracket';
import WizardEntry from './steps/WizardEntry';
import ConfirmCamera from './steps/ConfirmCamera';
import FacingPhase from './steps/FacingPhase';
import MeasureWindow from './steps/MeasureWindow';
import HingeToEquinox from './steps/HingeToEquinox';
import BracketSpec from './steps/BracketSpec';
import Assemble from './steps/Assemble';
import MountConfirm from './steps/MountConfirm';
import DeliveryPlaceholder from './steps/DeliveryPlaceholder';
import SubmitStep from './steps/SubmitStep';

export default function WizardClient({ claimCode, isOwner }: { claimCode: string; isOwner: boolean }) {
  // State-aware entry (Task 22): gate the flow until we know whether this is a
  // fresh commission or an already-placed camera. `entered` flips once the entry
  // routes us in (fresh → 'connect'; re-aim → skip the E-gate, start at facing).
  const [entered, setEntered] = useState(false);
  const [step, setStep] = useState<Step>('connect');
  const [state, setState] = useState<WizardState>(initialWizardState);

  const update = (patch: Partial<WizardState>) => setState((s) => ({ ...s, ...patch }));

  const onCommission = useCallback(() => {
    // Fresh camera: keep mode at default 'reaim' (first deployment; mode is
    // ignored server-side when there's no active deployment).
    setStep('connect');
    setEntered(true);
  }, []);
  const onReaim = useCallback((mode: 'reaim' | 'new') => {
    // Already connected + placed: record which kind of re-aim the operator chose,
    // then skip Connect (the E-gate) and jump straight into the bracket flow.
    setState((s) => ({ ...s, mode }));
    setStep('facing-phase');
    setEntered(true);
  }, []);
  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx >= 0 && idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };
  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  if (!entered) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col bg-black px-4 py-6 text-white">
        <header className="mb-4 text-xs uppercase tracking-wider text-neutral-400">
          Camera setup
        </header>
        <section className="flex flex-1 flex-col">
          <WizardEntry claimCode={claimCode} onCommission={onCommission} onReaim={onReaim} />
        </section>
      </main>
    );
  }

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
          <SubmitStep
            claimCode={claimCode}
            state={state}
            onBack={goBack}
            isOwner={isOwner}
            onPublishChange={(publish) => update({ publish })}
          />
        )}
      </section>
    </main>
  );
}
