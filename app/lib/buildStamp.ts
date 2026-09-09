/**
 * Which build a page is running, so a tab can tell it has fallen behind the
 * one production is serving.
 *
 * The problem this solves: a browser tab runs the JavaScript it loaded until
 * something reloads it. Nothing in the app ever did. A studio left open across
 * a deploy goes on drawing the old caption, the old dials and the old
 * defaults, and disagrees with the glass about a composition they share every
 * line of code for — which reads as a bug in the code and is not one. The Pi's
 * kiosk tabs have the same problem from the other end: they held a build 12
 * hours older than main until someone ran the doctor script by hand.
 *
 * The stamp is the commit the bundle was BUILT from, inlined by next.config's
 * `env` at build time. Both halves read this same constant: the client from
 * the chunk it loaded, the server from the deployment answering the poll. They
 * differ exactly when the tab is behind, and no runtime environment variable
 * has to be present for that comparison to be right — a missing one would make
 * every tab look stale forever, which on the glass would be a reload loop.
 */

/** What both ends stamp when there is no commit to name: `next dev`, and tests. */
export const DEV_BUILD = 'dev';

/**
 * The build this bundle was compiled from. Inlined at build time, so the value
 * a tab holds is the value its own chunks were built with, however old.
 */
export const BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID || DEV_BUILD;

/** How long a mismatch must hold before the glass reloads itself. */
export const CONFIRM_MS = 90_000;

/** The shortest gap between two self-reloads, so a mismatch cannot loop. */
export const RELOAD_COOLDOWN_MS = 15 * 60_000;

/**
 * Whether a page loaded from `client` is behind the server answering it.
 *
 * Deliberately false unless both stamps are real and different: an absent
 * server stamp (an older deployment, a poll that has not landed) means "no
 * information", never "you are stale", and a dev build is never compared
 * because every `next dev` bundle carries the same one.
 */
export function isStaleBuild(client: string, server: string | null | undefined): boolean {
  if (!client || !server) return false;
  if (client === DEV_BUILD || server === DEV_BUILD) return false;
  return client !== server;
}

/**
 * Whether the glass should reload itself now: the mismatch has held long
 * enough to be a deploy rather than a rollout's half-second, and this tab has
 * not already reloaded for one recently.
 */
export function shouldReload({ staleSinceMs, nowMs, lastReloadAtMs }: {
  /** When this tab first saw the mismatch, or null while it agrees with the server. */
  staleSinceMs: number | null;
  nowMs: number;
  /** When this tab last reloaded itself, across reloads; null when it never has. */
  lastReloadAtMs: number | null;
}): boolean {
  if (staleSinceMs == null) return false;
  if (nowMs - staleSinceMs < CONFIRM_MS) return false;
  if (lastReloadAtMs != null && nowMs - lastReloadAtMs < RELOAD_COOLDOWN_MS) return false;
  return true;
}
