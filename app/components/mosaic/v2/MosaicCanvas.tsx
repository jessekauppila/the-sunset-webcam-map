'use client';

import { useEffect, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import type { Layout } from './engine/types';

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  webcam: WindyWebcam;
}

/**
 * Draws the composed layout. dpr-scaled, black backdrop, drawImage only —
 * frames come from a host with no CORS headers, so the canvas is tainted and
 * reading pixels back would throw. Click hit-testing uses rects captured at
 * draw time rather than the canvas itself.
 */
export function MosaicCanvas({
  layout,
  byId,
  width,
  height,
  onSelect,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  width: number;
  height: number;
  onSelect?: (webcam: WindyWebcam) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRectsRef = useRef<HitRect[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.resetTransform?.();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const hits: HitRect[] = [];
    for (const tile of layout.tiles) {
      const entry = byId.get(tile.id);
      if (!entry) continue;
      ctx.drawImage(entry.img, tile.x, tile.y, tile.width, tile.height);
      hits.push({
        x: tile.x, y: tile.y, w: tile.width, h: tile.height, webcam: entry.webcam,
      });
    }
    hitRectsRef.current = hits;
  }, [layout, byId, width, height]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    for (const hit of hitRectsRef.current) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
        onSelect(hit.webcam);
        return;
      }
    }
  };

  return <canvas ref={canvasRef} onClick={handleClick} />;
}
