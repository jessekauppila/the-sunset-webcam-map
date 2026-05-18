'use client';

import { useState } from 'react';
import { initialWizardState, STEPS, type WizardState, type Step } from './types';
import ConfirmCamera from './steps/ConfirmCamera';
import PhasePreference from './steps/PhasePreference';
import DeliveryPreferences from './steps/DeliveryPreferences';
import ArPlacementPlaceholder from './steps/ArPlacementPlaceholder';
import HorizonSweepPlaceholder from './steps/HorizonSweepPlaceholder';
import MountHere from './steps/MountHere';
import SubmitStep from './steps/SubmitStep';

export default function WizardClient({ claimCode }: { claimCode: string }) {
  const [step, setStep] = useState<Step>('confirm-camera');
  const [state, setState] = useState<WizardState>(initialWizardState);

  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }));

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
        <span>
          Step {STEPS.indexOf(step) + 1} of {STEPS.length}
        </span>
      </header>

      <section className="flex flex-1 flex-col">
        {step === 'confirm-camera' && (
          <ConfirmCamera
            claimCode={claimCode}
            onAdvance={(deviceStatus) => {
              update({ deviceStatus });
              goNext();
            }}
          />
        )}
        {step === 'phase-preference' && (
          <PhasePreference
            value={state.phasePreference}
            onChange={(phasePreference) => update({ phasePreference })}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === 'delivery-preferences' && (
          <DeliveryPreferences
            value={state.delivery}
            onChange={(delivery) => update({ delivery })}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === 'ar-placement' && (
          <ArPlacementPlaceholder onNext={goNext} onBack={goBack} />
        )}
        {step === 'horizon-sweep' && (
          <HorizonSweepPlaceholder onNext={goNext} onBack={goBack} />
        )}
        {step === 'mount-here' && (
          <MountHere
            onCapture={({ azimuthDeg, tiltDeg, geo, timezone }) => {
              update({
                placementAzimuth: azimuthDeg,
                placementTilt: tiltDeg,
                lat: geo.lat,
                lng: geo.lng,
                elevationM: geo.elevationM,
                timezone,
              });
              goNext();
            }}
            onBack={goBack}
          />
        )}
        {step === 'submit' && (
          <SubmitStep claimCode={claimCode} state={state} onBack={goBack} />
        )}
      </section>
    </main>
  );
}
