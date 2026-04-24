import type { CustomLayerInterface, Map as MapboxMap } from 'mapbox-gl';

export interface SunShadowLayerOptions {
  id?: string;
  softness?: number;
  maxDarkness?: number;
  tint?: [number, number, number];
}

/**
 * Mapbox custom layer that renders a sun-synced day/night shadow on the globe.
 * No-op scaffold — shader is wired up in a later task.
 */
export class SunShadowLayer implements CustomLayerInterface {
  public readonly id: string;
  public readonly type = 'custom' as const;
  public readonly renderingMode = '3d' as const;

  private sunDir: [number, number, number] = [1, 0, 0];
  private softness: number;
  private maxDarkness: number;
  private tint: [number, number, number];

  private map: MapboxMap | null = null;

  constructor(options: SunShadowLayerOptions = {}) {
    this.id = options.id ?? 'sun-shadow';
    this.softness = options.softness ?? 0.15;
    this.maxDarkness = options.maxDarkness ?? 0.65;
    this.tint = options.tint ?? [0.05, 0.08, 0.18];
  }

  setSunDirection(dir: [number, number, number]): void {
    this.sunDir = dir;
    this.map?.triggerRepaint();
  }

  onAdd(map: MapboxMap, _gl: WebGL2RenderingContext): void {
    this.map = map;
    // Shader program setup happens in Task 7.
  }

  onRemove(_map: MapboxMap, _gl: WebGL2RenderingContext): void {
    this.map = null;
    // Program/buffer cleanup happens in Task 7.
  }

  render(_gl: WebGL2RenderingContext, _matrix: number[]): void {
    // No-op. Shader rendering wired up in Task 7.
    void this.sunDir;
    void this.softness;
    void this.maxDarkness;
    void this.tint;
  }
}
