import type { WindyWebcam } from '@/app/lib/types';

export type CanvasItem = {
  webcam: WindyWebcam;
  lat: number;
  lng: number;
  src?: string;
};

export type ImageData = {
  item: CanvasItem;
  img: HTMLImageElement | null;
  width: number;
  height: number;
};

export type RowData = {
  height: number;
  y: number;
  imageData: ImageData[];
  totalWidth: number;
};

export type CanvasProps = {
  webcams: WindyWebcam[];
  width?: number;
  height?: number;
  minRows?: number;
  maxRows?: number;
  maxImages?: number;
  padding?: number;
  onSelect?: (webcam: WindyWebcam) => void;
  ratingSizeEffect?: number;
  viewSizeEffect?: number;
  baseHeight?: number;
  fillScreenHeight?: boolean;
};

export type ScreenSize = 'mobile' | 'tablet' | 'desktop' | 'large';

export type ResponsiveConfig = {
  screenSize: ScreenSize;
  baseHeight: number;
  minRows: number;
  maxRows: number;
  padding: number;
  maxImages: number;
};
