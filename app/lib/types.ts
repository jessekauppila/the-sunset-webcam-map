/**
 * Core types for the Sunset Webcam Map application
 */

import type { CameraHealth } from './cameraHealth';

export type Orientation =
  | 'N'
  | 'NE'
  | 'E'
  | 'SE'
  | 'S'
  | 'SW'
  | 'W'
  | 'NW';

/**
 * Format discriminator for what kind of live asset a webcam row carries.
 * Use this to decide HOW to render (img vs video), not WHAT hardware produced
 * the asset — hardware traceability lives in dedicated fields on the row.
 */
export type LiveAssetKind =
  | 'windy_bundle'
  | 'custom_snapshot'
  | 'custom_stream';

export interface WindyWebcam {
  webcamId: number;
  title: string;
  viewCount: number;
  status: string;
  images?: {
    sizes?: {
      icon: { width: number; height: number };
      preview: { width: number; height: number };
      thumbnail: { width: number; height: number };
    };
    current: {
      preview: string;
      icon?: string;
      thumbnail?: string;
    };
    daylight?: {
      icon: string;
      preview: string;
      thumbnail: string;
    };
  };
  location: {
    city?: string;
    region?: string;
    longitude: number;
    latitude: number;
    country?: string;
    continent?: string;
  };
  categories: Array<{
    id: string;
    name: string;
  }>;
  lastUpdatedOn?: string;
  player?: {
    live?: string;
    day?: string;
    month?: string;
    year?: string;
    lifetime?: string;
  };
  urls?: {
    detail?: string;
    edit?: string;
    provider?: string;
  };

  // Additional fields for terminator webcams
  phase?: 'sunrise' | 'sunset';
  rank?: number;
  source?: string;
  externalId?: string;
  createdAt?: string;
  updatedAt?: string;

  // User rating and orientation fields
  rating?: number; // 1-5 star rating
  orientation?: Orientation; // Direction the webcam is facing

  // Latest AI scoring fields (updated by cron ingestion).
  // All three ratings are on a 1-5 scale, matching human stars
  // (aiScoring.ts maps the model's [0,1] output via 1 + rawScore * 4).
  aiRating?: number; // 1-5 normalized score
  aiModelVersion?: string; // Model version for aiRating
  aiRatingBinary?: number; // 1-5 normalized binary score
  aiModelVersionBinary?: string; // Model version for binary score
  aiRatingRegression?: number; // 1-5 normalized regression score
  aiModelVersionRegression?: string; // Model version for regression score

  // Claude (LLM) judge — the third opinion, distinct from the two model
  // heads above. Do NOT proxy these into the aiRating* slots: that hides
  // which judge actually spoke (the leaderboard used to fake llm_quality
  // into aiRatingRegression). llmQuality is the model's raw [0,1] quality
  // and is rendered as a percentage, never as 1-5 stars.
  llmQuality?: number | null; // [0,1] Claude quality score
  llmIsSunset?: boolean | null; // Claude's "is this a sunset?" verdict
  llmModel?: string | null; // e.g. "claude-sonnet-4-5"

  // Source label for external_images (Flickr) rows in the verification view —
  // these have no webcam title/location, so the card shows source + title + owner.
  owner?: string | null; // e.g. Flickr photo owner

  // Live-asset format discriminator. Tells the popup/renderer what KIND of
  // asset is on screen. Omitted when no asset is available (no snapshot, no
  // Windy images).
  liveAssetKind?: LiveAssetKind;

  // Per-camera traceability — populated only for source='custom' rows.
  // The cameras row joined via webcams.custom_camera_id.
  deviceClass?: string;            // e.g. 'rpi-zero-2w'
  firmwareVersion?: string;        // e.g. '0.1.0'
  hardwareId?: string;             // e.g. 'pi-zero-2w-tier0-jesse-house'

  // ISO8601 UTC timestamp of the snapshot whose firebase_url is in
  // images.current.preview. Only set when liveAssetKind === 'custom_snapshot'.
  latestSnapshotCapturedAt?: string;

  // "My Cameras" view only — present for the owner's own custom cameras.
  // Absent on Windy/terminator webcams, so existing markers are unchanged.
  cameraHealth?: CameraHealth;
  isInWindowNow?: boolean;
  lastSnapshotAt?: string | null;
  lastHeartbeatAt?: string | null;
  cameraId?: number;
}

export function windyWebcamToLocation(
  webcam: WindyWebcam | undefined
): Location | undefined {
  if (!webcam) return undefined;

  return {
    lat: webcam.location.latitude,
    lng: webcam.location.longitude,
  };
}

export interface Location {
  lat: number;
  lng: number;
}

export interface Webcam {
  id: string;
  name: string;
  lat: number;
  lng: number;
  url: string;
  thumbnailUrl?: string;
  isActive: boolean;
  source: 'windy' | 'custom' | 'openweather';
  lastUpdated?: Date;
}

export interface SunsetData {
  terminator: Location[];
  sunPosition: {
    azimuth: number;
    altitude: number;
  };
  timestamp: Date;
}

export interface MapViewport {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface WebcamTooltipData {
  webcam: Webcam;
  position: {
    x: number;
    y: number;
  };
  isVisible: boolean;
}

export interface SunsetMapProps {
  className?: string;
  userLocation?: Location;
  onWebcamHover?: (webcam: Webcam | null) => void;
  onWebcamClick?: (webcam: Webcam) => void;
}

export type WebcamSource = 'windy' | 'custom' | 'openweather';

export interface WebcamAPIResponse {
  webcams: Webcam[];
  total: number;
  source: WebcamSource;
}

// Snapshot types for archived webcam images
export interface SnapshotMetadata {
  id: number;
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  rank: number | null;
  initialRating: number | null; // Manual rating at capture time (if available)
  calculatedRating: number | null; // Average of user ratings
  aiRating: number | null; // Future AI rating
  firebaseUrl: string;
  firebasePath: string;
  capturedAt: string;
  createdAt: string;
  ratingCount: number; // Number of user ratings
  userRating?: number; // Current user's rating (if rated)
}

// Snapshot = WindyWebcam data + snapshot metadata
export interface Snapshot extends WindyWebcam {
  snapshot: SnapshotMetadata;
}
