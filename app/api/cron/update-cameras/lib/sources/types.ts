/**
 * The source port (issue #204).
 *
 * Every place frames could come from besides Windy — the ranked list in
 * docs/image-source-register.md — plugs into the cron through this one
 * interface. The core declares the port; each vendor gets an adapter into it
 * (ports and adapters, with the adapter acting as the anti-corruption layer
 * that keeps a vendor's model from leaking into ours). Nothing in this file
 * knows what Windy or the FAA is.
 *
 * The canonical unit downstream is the Snapshot (CONCEPTS.md): a webcams row
 * keyed by (source, external_id), and webcam_snapshots rows that inherit their
 * origin from it. So a SourceCamera is exactly what a webcams row needs plus
 * the URL of its current frame, and no more.
 *
 * Windy itself is NOT behind this port yet. Moving it first would mean
 * designing the port from one example; it moves once a second adapter has
 * proved the shape.
 */

export interface SourceCamera {
  /** Registry name, e.g. 'faa'. Becomes webcams.source. */
  source: string;
  /** The source's own id, as text. Becomes webcams.external_id. */
  externalId: string;
  title: string;
  lat: number;
  lng: number;
  /** The current frame. Compared tick to tick: an unchanged URL is not re-fetched. */
  imageUrl: string;
  /**
   * The source's own marker for "this is a new frame" when the URL does not
   * carry one: an ETag or Last-Modified from a HEAD. Compared tick to tick in
   * place of the URL when present. Leave undefined for a source whose URL
   * changes with every frame (FAA stamps the capture time into the filename).
   */
  imageVersion?: string;
  /** When the source says the frame was taken, ISO 8601, or null if it does not say. */
  imageAt: string | null;
  /** Published camera direction, degrees clockwise from true north. */
  azimuthDeg: number | null;
  /** Published horizontal field of view, degrees. */
  hfovDeg: number | null;
  country: string | null;
  region: string | null;
  city: string | null;
  /** Credit the source requires beside the picture, text or HTML. */
  attribution: string | null;
  operator: string | null;
}

export interface SourceListOptions {
  now: Date;
  /** The swept band, as the same box test the Windy sweep applies. */
  within: (lat: number, lng: number) => boolean;
  /**
   * Cameras this source may contribute to this tick. The band test alone does
   * not bound a source packed inside one query box -- see capPerTick.ts -- so
   * an adapter applies this BEFORE any per-camera network work, and reports
   * what it set aside as `skipped.over_cap`.
   */
  maxCameras?: number;
}

export interface SourceListResult {
  cameras: SourceCamera[];
  /** Requests sent. */
  attempted: number;
  /** Requests that came back non-OK, or could not be made at all. */
  failed: number;
  /** `failed` split by HTTP status or reason: `{ "401": 1 }`, `{ unconfigured: 1 }`. */
  failedByStatus: Record<string, number>;
  /** Cameras the source listed but the adapter set aside, by reason. */
  skipped: Record<string, number>;
  elapsedMs: number;
}

export interface Source {
  /** Registry name. Lowercase, stable, doubles as webcams.source. */
  readonly name: string;
  /** Runtime flag key that turns the source on. Seeded OFF. */
  readonly flag: string;
  /**
   * Every camera of this source inside the swept band whose current frame is
   * worth scoring. Never throws for a network or shape problem: those are
   * counted in `failed` / `failedByStatus` so the tick can say what happened.
   */
  listCameras(opts: SourceListOptions): Promise<SourceListResult>;
}

/**
 * The in-tick identity of a camera from any source, Windy included. Windy's
 * external id is its numeric webcamId as text, so a Windy camera is
 * `windy:1234567890`. The database identity is webcams.id, which the tick
 * only learns after the upsert; this key is how it gets there.
 */
export function sourceKey(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export function emptyListResult(elapsedMs = 0): SourceListResult {
  return { cameras: [], attempted: 0, failed: 0, failedByStatus: {}, skipped: {}, elapsedMs };
}
