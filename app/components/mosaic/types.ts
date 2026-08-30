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
  setupMode?: boolean;
  onSelect?: (webcam: WindyWebcam) => void;
  /** Raw query string of the hosting page, for version-specific params. */
  search?: string;
}

export type MosaicComponent = (props: MosaicProps) => React.ReactNode;
