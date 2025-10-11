//original before refactoring....

'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';

type Props = {
  webcams: WindyWebcam[];
  width?: number;
  height?: number;
  minRows?: number; // minimum number of rows (default 3)
  maxRows?: number; // maximum number of rows (default 20)
  maxImages?: number; // cap
  padding?: number; // px gap between tiles
  onSelect?: (webcam: WindyWebcam) => void; // click handler
  // Scaling configuration
  ratingSizeEffect?: number; // How much low ratings reduce size (0-1, default 0.75)
  viewSizeEffect?: number; // How much low views reduce size (0-1, default 0.1)
  baseHeight?: number; // Maximum height for highest-rated webcams (default 60px)
  fillScreenHeight?: boolean; // Whether to dynamically scale to fill screen height (default true)
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
  // Start with maximum size (1.0) and scale DOWN based on lower ratings/views
  const maxSize = 1.0;

  // Calculate rating penalty (0-1 scale, where 0 = worst rating, 1 = best rating)
  let ratingPenalty = 0;
  if (webcam.rating !== undefined && webcam.rating !== null) {
    const clampedRating = Math.max(0, Math.min(5, webcam.rating));
    ratingPenalty = 1 - clampedRating / 5; // Invert: 0 = best rating, 1 = worst rating
  }

  // Calculate view penalty (0-1 scale, where 0 = most views, 1 = least views)
  let viewPenalty = 0;
  if (maxViews > 0) {
    viewPenalty = 1 - Math.min(1, webcam.viewCount / maxViews); // Invert: 0 = most views, 1 = least views
  }

  // Debug logging for first few webcams
  if (webcam.webcamId <= 3) {
    console.log(
      `Webcam ${webcam.webcamId}: viewCount=${webcam.viewCount}, maxViews=${maxViews}, viewPenalty=${viewPenalty}, ratingPenalty=${ratingPenalty}`
    );
  }

  // Final scale: max size - penalties
  // Higher ratingSizeEffect/viewSizeEffect means more penalty for low ratings/views
  const finalScale =
    maxSize -
    ratingPenalty * ratingSizeEffect -
    viewPenalty * viewSizeEffect;

  // Ensure minimum scale to prevent images from becoming too small
  return Math.max(0.2, finalScale); // Minimum 20% of max size
}

export function MosaicCanvas({
  webcams,
  width = 1800,
  height = 1200,
  minRows = 3,
  maxRows = 20,
  maxImages = 180,
  padding = 2,
  onSelect,
  ratingSizeEffect = 0.75,
  viewSizeEffect = 0.1,
  baseHeight = 60,
  fillScreenHeight = true,
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

  // Calculate optimal number of rows and dynamic image heights
  const { bands, dynamicBaseHeight } = useMemo(() => {
    if (!items.length)
      return { bands: [], dynamicBaseHeight: baseHeight };

    const totalImages = items.length;

    // Calculate optimal number of rows based on image count and screen height
    let targetRows: number;
    if (fillScreenHeight) {
      // Calculate rows based on available height and minimum row height
      const availableHeight = height - padding * 2; // Account for top/bottom padding
      const minRowHeight = baseHeight * 0.2; // Minimum 20% of base height
      const maxRowsFromHeight = Math.floor(
        availableHeight / (minRowHeight + padding)
      );

      // Use the smaller of: maxRowsFromHeight, maxRows, or totalImages
      targetRows = Math.min(maxRowsFromHeight, maxRows, totalImages);
      targetRows = Math.max(minRows, targetRows); // Ensure minimum rows
    } else {
      // Use fixed calculation based on image count
      targetRows = Math.min(
        Math.max(minRows, Math.ceil(Math.sqrt(totalImages))),
        maxRows
      );
    }

    // Calculate dynamic base height to fill screen
    let calculatedBaseHeight = baseHeight;
    if (fillScreenHeight && targetRows > 0) {
      const availableHeight = height - padding * 2;
      const totalPaddingHeight = padding * (targetRows - 1);
      const availableForImages = availableHeight - totalPaddingHeight;
      calculatedBaseHeight = Math.max(
        baseHeight * 0.2,
        availableForImages / targetRows
      );
    }

    // Create latitude-based bands with blank spaces
    const out: Item[][] = [];

    // Calculate latitude ranges for each row
    const minLat = Math.min(...items.map((item) => item.lat));
    const maxLat = Math.max(...items.map((item) => item.lat));
    const latRange = maxLat - minLat;
    const latStep = latRange / targetRows;

    for (let i = 0; i < targetRows; i++) {
      const rowMinLat = minLat + i * latStep;
      const rowMaxLat = minLat + (i + 1) * latStep;

      // Find items in this latitude range
      const rowItems = items.filter(
        (item) => item.lat >= rowMinLat && item.lat < rowMaxLat
      );

      // Sort by longitude (west → east) within each row
      rowItems.sort((a, b) => a.lng - b.lng);

      // Always add the row, even if empty (for geographic positioning)
      out.push(rowItems);
    }

    return { bands: out, dynamicBaseHeight: calculatedBaseHeight };
  }, [
    items,
    height,
    minRows,
    maxRows,
    baseHeight,
    fillScreenHeight,
    padding,
  ]);

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

      // Calculate row heights and positions dynamically
      const rowData: Array<{
        height: number;
        y: number;
        imageData: Array<{
          item: Item;
          img: HTMLImageElement | null;
          width: number;
          height: number;
        }>;
        totalWidth: number;
      }> = [];

      // Pre-calculate all row data and total content height
      let totalContentHeight = 0;

      bands.forEach((row) => {
        // Calculate dimensions for each image in this row
        const imageData: Array<{
          item: Item;
          img: HTMLImageElement | null;
          width: number;
          height: number;
        }> = [];

        let totalImageWidth = 0;
        let maxImageHeight = 0;

        // Calculate dimensions for each image
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

          // Calculate base dimensions using dynamic base height (calculated to fill screen)
          const imgAR = img.naturalWidth / img.naturalHeight;
          let imgWidth = dynamicBaseHeight * imgAR;
          let imgHeight = dynamicBaseHeight;

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
          maxImageHeight = Math.max(maxImageHeight, imgHeight);
        });

        // Add padding between images
        totalImageWidth += padding * (row.length - 1);

        // Store row data
        rowData.push({
          height: maxImageHeight,
          y: 0, // Will be calculated below
          imageData,
          totalWidth: totalImageWidth,
        });

        totalContentHeight += maxImageHeight + padding;
      });

      // Calculate vertical offset to center content
      const verticalOffset = Math.max(
        0,
        (height - totalContentHeight) / 2
      );
      let currentY = verticalOffset;

      // Update row positions with vertical centering
      rowData.forEach((rowInfo) => {
        rowInfo.y = currentY;
        currentY += rowInfo.height + padding;
      });

      // Render each row
      rowData.forEach((rowInfo) => {
        // Calculate starting x position to center the row
        const startX = Math.max(
          padding,
          (width - rowInfo.totalWidth) / 2
        );

        // Second pass: render images
        let currentX = startX;
        rowInfo.imageData.forEach(
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
              const failedWidth = dynamicBaseHeight * webcamScale;
              const failedHeight = dynamicBaseHeight * webcamScale;

              ctx.fillStyle = '#000000';
              ctx.fillRect(
                currentX,
                rowInfo.y + (rowInfo.height - failedHeight) / 2,
                failedWidth,
                failedHeight
              );
              currentX += failedWidth + padding;
              return;
            }

            // Center image vertically within row
            const drawY =
              rowInfo.y + (rowInfo.height - imgHeight) / 2;

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
    dynamicBaseHeight,
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
