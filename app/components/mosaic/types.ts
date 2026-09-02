import type { WindyWebcam } from '@/app/lib/types';

/**
 * The contract every mosaic version implements. A version owns everything
 * from `webcams[]` to pixels — its own layout engine, its own tunables, its
 * own quality-signal interpretation, its own URL params (parsed out of
 * `search`). The surfaces (kiosk pages, main-page view modes) know only this
 * shape, so versions can evolve or be deleted without touching each other.
 */
export interface MosaicProps {
  webcams: WindyWebcam[];
  width: number;
  height: number;
  feed: 'sunrise' | 'sunset';
  /**
   * The OTHER feed's pool. Purely for cross-panel coordination: a version
   * may use it to size or scale this panel on the same ruler as its twin,
   * and must render nothing from it. Surfaces showing one panel alone omit
   * it, and every version must still compose correctly without it.
   */
  peerWebcams?: WindyWebcam[];
  setupMode?: boolean;
  onSelect?: (webcam: WindyWebcam) => void;
  /** Raw query string of the hosting page, for version-specific params. */
  search?: string;
  /**
   * The moment this composition represents, for solar-position math. Live
   * surfaces omit it (render time is correct); /studio passes the selected
   * scene's representsAt so a replayed scene computes the sun where it
   * actually was. Deliberately explicit: `lastUpdatedOn` cannot serve here —
   * it is `last_fetched_at` (Windy metadata) in the live payload but
   * `snapshot_captured_at` in reconstructed scenes.
   */
  at?: string | number;
  /** Merged-or-deviation knob values for THIS version's namespace (server profile). */
  settings?: Record<string, number | boolean | string>;
}

export type MosaicComponent = (props: MosaicProps) => React.ReactNode;
