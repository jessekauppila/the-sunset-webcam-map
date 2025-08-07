/**
 * Core types for the Sunset Webcam Map application
 */

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
