// Shape of what the wizard accumulates as the operator walks through
// the screens. Submitted to /api/cameras/pre-register at the end.
// See pre-register/route.ts:11-27 for the matching server-side type.

export type PhasePreference = 'sunrise' | 'sunset' | 'both';

export type DeliveryPreferences = {
  channel: 'email' | 'sms' | 'gallery-only';
  email?: string;
  phone?: string;
  cadence: 'daily' | 'per-event' | 'quality-gated';
};

export type HorizonPoint = { azimuth_deg: number; altitude_deg: number };

export type WizardState = {
  // Screen 1: confirm-camera polling result.
  deviceStatus: 'awaiting_wifi' | 'registered' | 'ready' | 'unknown';

  // Screen 2.
  phasePreference: PhasePreference | null;

  // Screen 3.
  delivery: DeliveryPreferences | null;

  // Screens 4-5 (deferred to brainstorming session).
  horizonProfile: HorizonPoint[] | null;

  // Screen 6: captured on "Mount Here" tap.
  placementAzimuth: number | null;
  placementTilt: number | null;

  // Geolocation API output. Captured automatically when permission is
  // granted; not bound to any particular screen.
  lat: number | null;
  lng: number | null;
  elevationM: number | null;

  // Browser-derived.
  timezone: string | null;
};

export const initialWizardState: WizardState = {
  deviceStatus: 'unknown',
  phasePreference: null,
  delivery: null,
  horizonProfile: null,
  placementAzimuth: null,
  placementTilt: null,
  lat: null,
  lng: null,
  elevationM: null,
  timezone: null,
};

// Six screens per the design spec. Names match the spec's headings.
export const STEPS = [
  'confirm-camera',
  'phase-preference',
  'delivery-preferences',
  'ar-placement',     // Screen 4 — placeholder until brainstorm
  'horizon-sweep',    // Screen 5 — placeholder until brainstorm
  'mount-here',
  'submit',
] as const;
export type Step = typeof STEPS[number];
