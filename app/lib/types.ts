/**
 * Core types for the Sunset Webcam Map application
 */

export type Orientation =
  | 'N'
  | 'NE'
  | 'E'
  | 'SE'
  | 'S'
  | 'SW'
  | 'W'
  | 'NW';

export interface WindyWebcam {
  webcamId: number;
  title: string;
  viewCount: number;
  status: string;
  images?: {
    sizes: {
      icon: { width: number; height: number };
      preview: { width: number; height: number };
      thumbnail: { width: number; height: number };
    };
    current: {
      icon: string;
      preview: string;
      thumbnail: string;
    };
    daylight: {
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

  // Latest AI scoring fields (updated by cron ingestion)
  aiRating?: number; // 0-5 normalized score
  aiModelVersion?: string; // Model version for aiRating
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
  initialRating: number; // Rating when captured
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
