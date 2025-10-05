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
  // Scaling configuration
  ratingSizeEffect?: number; // How much rating affects size (0-1, default 0.75)
  viewSizeEffect?: number; // How much views affect size (0-1, default 0.1)
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

// Calculate scale factor based on rating and views
function getWebcamScale(
  webcam: WindyWebcam,
  maxViews: number,
  ratingSizeEffect: number,
  viewSizeEffect: number
): number {
  // Calculate base size (minimum size)
  const baseSize = 1 - (ratingSizeEffect + viewSizeEffect);

  // Calculate rating contribution (0-1 scale)
  let ratingScale = 0;
  if (webcam.rating !== undefined && webcam.rating !== null) {
    const clampedRating = Math.max(0, Math.min(5, webcam.rating));
    ratingScale = clampedRating / 5; // 0 to 1
  }

  // Calculate view contribution (0-1 scale)
  let viewScale = 0;
  if (maxViews > 0) {
    viewScale = Math.min(1, webcam.viewCount / maxViews); // 0 to 1
  }

  // Debug logging for first few webcams
  if (webcam.webcamId <= 3) {
    console.log(
      `Webcam ${webcam.webcamId}: viewCount=${webcam.viewCount}, maxViews=${maxViews}, viewScale=${viewScale}, ratingScale=${ratingScale}, baseSize=${baseSize}`
    );
  }

  // Final scale: base + rating effect + view effect
  return (
    baseSize +
    ratingScale * ratingSizeEffect +
    viewScale * viewSizeEffect
  );
}

export function MosaicCanvas({
  webcams,
  width = 1800,
  height = 1200,
  rows = 6,
  maxImages = 180,
  padding = 2,
  onSelect,
  ratingSizeEffect = 0.75,
  viewSizeEffect = 0.1,
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

  // Calculate max views for normalization
  const maxViews = useMemo(() => {
    if (items.length === 0) return 1;
    const max = Math.max(
      ...items.map((item) => item.webcam.viewCount)
    );
    console.log(
      'Debug: maxViews =',
      max,
      'viewCounts =',
      items.map((item) => item.webcam.viewCount).slice(0, 10)
    );
    return max;
  }, [items]);

  // Flexible rows based on natural grouping, maintaining original aspect ratios
  const bands = useMemo(() => {
    if (!items.length) return [];

    // Calculate optimal row distribution
    const totalImages = items.length;
    const targetRows = Math.min(Math.max(1, rows), totalImages);

    // Distribute images more naturally across rows
    const imagesPerRow = Math.floor(totalImages / targetRows);
    const extraImages = totalImages % targetRows;

    const out: Item[][] = [];
    let imageIndex = 0;

    for (let i = 0; i < targetRows; i++) {
      // Some rows get one extra image to distribute remainder
      const rowSize = imagesPerRow + (i < extraImages ? 1 : 0);
      const row = items.slice(imageIndex, imageIndex + rowSize);

      // Sort by longitude (west → east) within each row
      row.sort((a, b) => a.lng - b.lng);

      if (row.length > 0) {
        out.push(row);
      }

      imageIndex += rowSize;
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
        const y = padding + rIdx * (rowHeight + padding);

        // Calculate total width needed for this row's images
        let totalImageWidth = 0;
        const imageData: Array<{
          item: Item;
          img: HTMLImageElement | null;
          width: number;
          height: number;
        }> = [];

        // First pass: calculate dimensions for each image maintaining original aspect ratio
        row.forEach((item) => {
          const img = imgMap.get(item.webcam.webcamId);
          if (!img) {
            imageData.push({ item, img: null, width: 0, height: 0 });
            return;
          }

          // Get combined rating and view-based scale factor
          const webcamScale = getWebcamScale(
            item.webcam,
            maxViews,
            ratingSizeEffect,
            viewSizeEffect
          );

          // Calculate dimensions maintaining original aspect ratio
          const imgAR = img.naturalWidth / img.naturalHeight;
          let imgWidth = rowHeight * imgAR; // Scale to fit row height
          let imgHeight = rowHeight;

          // Apply combined rating and view-based scaling
          imgWidth *= webcamScale;
          imgHeight *= webcamScale;

          // If image is too wide, scale down to fit (but maintain rating scale proportion)
          if (imgWidth > width * 0.8) {
            // Max 80% of canvas width per image
            const maxWidth = width * 0.8;
            const scaleDownFactor = maxWidth / imgWidth;
            imgWidth = maxWidth;
            imgHeight *= scaleDownFactor;
          }

          imageData.push({
            item,
            img,
            width: imgWidth,
            height: imgHeight,
          });
          totalImageWidth += imgWidth;
        });

        // Add padding between images
        totalImageWidth += padding * (row.length - 1);

        // Calculate starting x position to center the row
        const startX = Math.max(
          padding,
          (width - totalImageWidth) / 2
        );

        // Second pass: render images
        let currentX = startX;
        imageData.forEach(
          ({ item, img, width: imgWidth, height: imgHeight }) => {
            if (!img) {
              // Image failed to load - draw black rectangle
              // Use combined rating and view scale for failed images too
              const webcamScale = getWebcamScale(
                item.webcam,
                maxViews,
                ratingSizeEffect,
                viewSizeEffect
              );
              const failedWidth =
                (imgWidth || rowHeight) * webcamScale;
              const failedHeight = rowHeight * webcamScale;

              ctx.fillStyle = '#000000';
              ctx.fillRect(
                currentX,
                y + (rowHeight - failedHeight) / 2,
                failedWidth,
                failedHeight
              );
              currentX += failedWidth + padding;
              return;
            }

            // Center image vertically within row
            const drawY = y + (rowHeight - imgHeight) / 2;

            // Draw the image maintaining its original aspect ratio
            ctx.drawImage(img, currentX, drawY, imgWidth, imgHeight);

            hitRectsRef.current.push({
              x: currentX,
              y: drawY,
              w: imgWidth,
              h: imgHeight,
              webcam: item.webcam,
            });

            currentX += imgWidth + padding;
          }
        );
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    bands,
    width,
    height,
    padding,
    maxViews,
    ratingSizeEffect,
    viewSizeEffect,
  ]);

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
