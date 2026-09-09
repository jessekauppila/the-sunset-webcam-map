'use client';

import { useEffect, useRef } from 'react';
import { BUILD_ID, isStaleBuild, shouldReload } from '@/app/lib/buildStamp';

/** Where a tab remembers its last self-reload, so a stubborn mismatch cannot loop. */
export const LAST_RELOAD_KEY = 'kiosk:lastBuildReloadAt';

/** How often a confirmed mismatch is re-checked while it lasts. */
const CHECK_MS = 15_000;

function readLastReload(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_RELOAD_KEY);
    if (!raw) return null;
    const ms = Number(raw);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    // Incognito with site data blocked, and the thumbnail contexts. Without
    // the memory the cooldown cannot be enforced across the reload, which is
    // survivable: the reloaded tab holds the new build and stops being stale.
    return null;
  }
}

function writeLastReload(ms: number): void {
  try {
    window.localStorage.setItem(LAST_RELOAD_KEY, String(ms));
  } catch {
    // See above; nothing here is worth failing a reload over.
  }
}

/**
 * Reloads the page once the deployment answering its polls has moved on from
 * the build this page is running.
 *
 * The kiosk tabs run the JavaScript they loaded at boot and nothing has ever
 * moved them off it: after a kiosk-affecting merge, someone had to run
 * `scripts/pi/kiosk-doctor.sh --sync --reload` by hand, and when nobody did,
 * the glass drew an old composition beside a studio drawing the new one — a
 * disagreement with no bug behind it (2026-09-06, again 2026-09-08).
 *
 * Deliberately slow to act. The mismatch has to hold for CONFIRM_MS before
 * anything happens, because a rollout swaps the serving bundle over a few
 * seconds and a stamp read mid-swap can disagree once and agree again; and a
 * tab will not reload twice inside RELOAD_COOLDOWN_MS, because the one way
 * this could hurt the glass is a loop against an edge cache still handing out
 * the old HTML. Settings still reach the Pi on their own within a minute;
 * this is only about code.
 *
 * Pass the `build` the poll returned. Null or undefined — an older deployment,
 * a poll that has not landed — means no information, and nothing happens.
 */
export function useBuildReload(serverBuild: string | null | undefined): void {
  // Kept across renders, not in state: seeing the mismatch must not itself
  // cause the render that re-reads it.
  const staleSinceMs = useRef<number | null>(null);

  useEffect(() => {
    if (!isStaleBuild(BUILD_ID, serverBuild)) {
      staleSinceMs.current = null;
      return;
    }
    if (staleSinceMs.current == null) staleSinceMs.current = Date.now();

    const check = () => {
      if (!shouldReload({
        staleSinceMs: staleSinceMs.current,
        nowMs: Date.now(),
        lastReloadAtMs: readLastReload(),
      })) return;
      writeLastReload(Date.now());
      window.location.reload();
    };

    check();
    const t = setInterval(check, CHECK_MS);
    return () => clearInterval(t);
  }, [serverBuild]);
}
