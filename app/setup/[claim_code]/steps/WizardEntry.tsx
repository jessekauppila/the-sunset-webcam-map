'use client';

import { useEffect, useState } from 'react';
import { Btn, Why } from '../components/InsideOutFrame';

// State-aware wizard entry (reconciliation spec §10 / integration contract SE-1).
// Reads the camera's commission state, then routes:
//   fresh (never placed / no active aim) → straight into the commission flow;
//   already-placed                        → Re-aim (primary) above Turn off (secondary),
//                                            so re-commissioning never hides behind a
//                                            "find decommission first" detour.
//
// "already-placed" = setup-status reports 'ready' (the camera has a realized aim).
// On a fetch error we default to the commission flow — better to let setup proceed
// than to block on a transient network hiccup; ConfirmCamera re-polls anyway.
type EntryPhase = 'loading' | 'placed' | 'error';

export default function WizardEntry({
  claimCode,
  onCommission,
  onReaim,
}: {
  claimCode: string;
  onCommission: () => void;
  onReaim: () => void;
}) {
  const [phase, setPhase] = useState<EntryPhase>('loading');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/cameras/setup-status/${claimCode}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status fetch failed'))))
      .then((d: { status?: string }) => {
        if (!active) return;
        if (d.status === 'ready') setPhase('placed');
        else onCommission();
      })
      .catch(() => {
        if (active) onCommission();
      });
    return () => {
      active = false;
    };
  }, [claimCode, onCommission]);

  async function handleDecommission() {
    setBusy(true);
    try {
      const res = await fetch(`/api/cameras/${claimCode}/decommission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claim_code: claimCode, relocate: false }),
      });
      setDone(res.ok ? 'Camera turned off.' : 'Could not turn off the camera — try again.');
    } catch {
      setDone('Could not reach the server — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') {
    return <p className="text-sm text-neutral-400">Checking this camera…</p>;
  }

  // phase === 'placed'
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="text-lg font-semibold">This camera is already set up</h1>
      <Why>
        It already has a saved aim. Re-aim it if you moved it or it is pointing the
        wrong way. Turning it off stops capture at this spot — you can set it up again
        any time with this same code.
      </Why>

      {/* Primary: Re-aim is FIRST so re-commissioning is the easy path. */}
      <Btn onClick={onReaim} disabled={busy}>
        Re-aim / move this camera
      </Btn>

      {/* Secondary: present, but visually subordinate (ghost) and below Re-aim. */}
      <Btn ghost onClick={handleDecommission} disabled={busy}>
        Turn off / decommission
      </Btn>

      {done && <p className="mt-3 text-sm text-neutral-300">{done}</p>}
    </div>
  );
}
