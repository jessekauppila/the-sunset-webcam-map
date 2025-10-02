'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';

type Props = {
  webcams: WindyWebcam[];
  width?: number;
  height?: number;
  rows?: number; // number of quantile rows
  maxImages?: number; // cap
  padding?: number; // px gap between tiles
  onSelect?: (webcam: WindyWebcam) => void; // click handler
};

type Item = {
  webcam: WindyWebcam;
  lat: number;
  lng: number;
  src?: string;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function MosaicCanvas({
  webcams,
  width = 1200,
  height = 800,
  rows = 6,
  maxImages = 180,
  padding = 2,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const items: Item[] = useMemo(() => {
    return webcams
      .filter((w) => !!w.images?.current?.preview)
      .map((w) => ({
        webcam: w,
        lat: w.location.latitude,
        lng: w.location.longitude,
        src: w.images?.current?.preview,
      }))
      .sort((a, b) => b.lat - a.lat) // north → south
      .slice(0, maxImages);
  }, [webcams, maxImages]);

  // Even quantile rows, west→east within each row
  const bands = useMemo(() => {
    if (!items.length) return [];
    const k = Math.min(Math.max(1, rows), items.length);
    const perRow = Math.ceil(items.length / k);
    const out: Item[][] = [];
    for (let i = 0; i < k; i++) {
      const start = i * perRow;
      const row = items.slice(start, start + perRow);
      row.sort((a, b) => a.lng - b.lng); // west → east
      if (row.length) out.push(row);
    }
    return out;
  }, [items, rows]);

  // Optional: hit map for clicks
  const hitRectsRef = useRef<
    Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      webcam: WindyWebcam;
    }>
  >([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
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
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, width, height);

    hitRectsRef.current = [];

    const allWithSrc = bands.flat().filter((x) => !!x.src);
    const loads = allWithSrc.map((x) =>
      loadImage(x.src as string)
        .then((img) => [x.webcam.webcamId, img] as const)
        .catch(() => null)
    );

    let cancelled = false;
    Promise.all(loads).then((pairs) => {
      if (cancelled) return;
      const imgMap = new Map<number, HTMLImageElement>();
      for (const p of pairs) if (p) imgMap.set(p[0], p[1]);

      const rowCount = bands.length || 1;
      const rowHeight = Math.floor(
        (height - padding * (rowCount + 1)) / rowCount
      );

      bands.forEach((row, rIdx) => {
        const cols = row.length || 1;
        const tileWidth = Math.floor(
          (width - padding * (cols + 1)) / cols
        );
        const y = padding + rIdx * (rowHeight + padding);

        row.forEach((item, cIdx) => {
          const x = padding + cIdx * (tileWidth + padding);
          const img = imgMap.get(item.webcam.webcamId);
          if (!img) return;

          // cover-fit crop
          const tileAR = tileWidth / rowHeight;
          const imgAR = img.naturalWidth / img.naturalHeight;
          let sx = 0,
            sy = 0,
            sw = img.naturalWidth,
            sh = img.naturalHeight;

          if (imgAR > tileAR) {
            const targetW = sh * tileAR;
            sx = Math.floor((sw - targetW) / 2);
            sw = Math.floor(targetW);
          } else {
            const targetH = sw / tileAR;
            sy = Math.floor((sh - targetH) / 2);
            sh = Math.floor(targetH);
          }

          ctx.drawImage(
            img,
            sx,
            sy,
            sw,
            sh,
            x,
            y,
            tileWidth,
            rowHeight
          );
          hitRectsRef.current.push({
            x,
            y,
            w: tileWidth,
            h: rowHeight,
            webcam: item.webcam,
          });
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [bands, width, height, padding]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onSelect) return;

    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const r of hitRectsRef.current) {
        if (
          x >= r.x &&
          x <= r.x + r.w &&
          y >= r.y &&
          y <= r.y + r.h
        ) {
          onSelect?.(r.webcam);
          break;
        }
      }
    };

    canvas.addEventListener('click', handleClick);
    return () => canvas.removeEventListener('click', handleClick);
  }, [onSelect]);

  return <canvas ref={canvasRef} />;
}
