// Shape of what the wizard accumulates as the operator walks through the
// bracket flow. Submitted to /api/cameras/pre-register at the end via
// buildPreRegisterPayload (app/lib/bracket.ts).
import type { Facing } from '@/app/lib/solar';
import type { BracketSolution } from '@/app/lib/bracket';

// Single-aimed bracket cameras: no 'both' in the UI (integration contract D-8).
export type WizardPhase = 'sunrise' | 'sunset';

export type DeliveryChoice = {
  channel: 'email' | 'sms' | 'gallery-only';
  email?: string;
  phone?: string;
  cadence: 'daily' | 'per-event' | 'quality-gated';
} | null;

// setup-status reports FOUR states over the wire (integration contract §2.2 / D-6):
// awaiting_wifi | registered | awaiting_aim | ready. 'unknown' is a CLIENT-ONLY
// sentinel for the pre-first-poll initial state — setup-status NEVER returns it
// (contract §2.2 note). Keep it in the union; no endpoint produces it.
export type DeviceStatus = 'awaiting_wifi' | 'registered' | 'awaiting_aim' | 'ready' | 'unknown';

export type WizardState = {
  // Step 1 (Connect) — setup-status poll result.
  deviceStatus: DeviceStatus;

  // Step 2 (Facing/phase). facing drives both the solar arcs and phase_preference.
  facing: Facing | null;

  // Step 3 (Measure window) — phone-flat magnetic reading + declination.
  windowMagAz: number | null;
  declinationDeg: number | null;

  // Step 4 onward — the solved bracket bundle (recomputed when inputs change).
  solution: BracketSolution | null;

  // Geolocation (captured on Measure window).
  lat: number | null;
  lng: number | null;
  elevationM: number | null;
  timezone: string | null;

  // Step 8 (Delivery) — null when skipped.
  delivery: DeliveryChoice;
};

export const initialWizardState: WizardState = {
  deviceStatus: 'unknown',
  facing: null,
  windowMagAz: null,
  declinationDeg: null,
  solution: null,
  lat: null,
  lng: null,
  elevationM: null,
  timezone: null,
  delivery: null,
};

// The reconciliation spec's 9-step flow (step 1 gated on sub-project E).
export const STEPS = [
  'connect',          // 1 — real, E-gated
  'facing-phase',     // 2 — real
  'measure-window',   // 3 — real
  'hinge-equinox',    // 4 — real (solar.ts + declination endpoint)
  'bracket-spec',     // 5 — real
  'assemble',         // 6 — real
  'mount-confirm',    // 7 — real
  'delivery',         // 8 — PLACEHOLDER (Skip for now)
  'submit',           // 9 — real (pre-register)
] as const;
export type Step = typeof STEPS[number];
