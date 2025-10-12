'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { WindyWebcam } from '@/app/lib/types';
import type {
  CanvasItem,
  CanvasProps,
  ImageData,
  RowData,
} from './types';
import { useScreenSize } from './useScreenSize';
import {
  getWebcamScale,
  calculateMaxViews,
  calculateWebcamDimensions,
} from './webcamScaling';
import {
  createLatitudeBands,
  calculateOptimalRows,
  calculateDynamicBaseHeight,
} from './rowLayout';
import { loadImage } from './utils';

export function MosaicCanvas({
  webcams,
  width = 1800,
  height = 1200,
  minRows,
  maxRows,
  maxImages,
  padding,
  onSelect,
  ratingSizeEffect = 0.75,
  viewSizeEffect = 0.1,
  baseHeight,
  fillScreenHeight = true,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Get responsive configuration based on screen size
  const responsiveConfig = useScreenSize(width, height);

  // Use responsive values or props (props take precedence if provided)
  const finalConfig = {
    baseHeight: baseHeight ?? responsiveConfig.baseHeight,
    minRows: minRows ?? responsiveConfig.minRows,
    maxRows: maxRows ?? responsiveConfig.maxRows,
    maxImages: maxImages ?? responsiveConfig.maxImages,
    padding: padding ?? responsiveConfig.padding,
  };

  // Prepare items: filter, map, sort, and limit
  const items: CanvasItem[] = useMemo(() => {
    return webcams
      .filter((w) => !!w.images?.current?.preview)
      .map((w) => ({
        webcam: w,
        lat: w.location.latitude,
        lng: w.location.longitude,
        src: w.images?.current?.preview,
      }))
      .sort((a, b) => b.lat - a.lat) // north → south
      .slice(0, finalConfig.maxImages);
  }, [webcams, finalConfig.maxImages]);

  // Calculate max views for normalization
  const maxViews = useMemo(() => {
    const max = calculateMaxViews(items.map((item) => item.webcam));
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
      return { bands: [], dynamicBaseHeight: finalConfig.baseHeight };

    const totalImages = items.length;

    // Calculate optimal number of rows
    const targetRows = calculateOptimalRows(
      totalImages,
      height,
      finalConfig.baseHeight,
      finalConfig.minRows,
      finalConfig.maxRows,
      finalConfig.padding,
      fillScreenHeight
    );

    // Calculate dynamic base height to fill screen
    const calculatedBaseHeight = calculateDynamicBaseHeight(
      targetRows,
      height,
      finalConfig.baseHeight,
      finalConfig.padding,
      fillScreenHeight
    );

    // Debug: core layout decision metrics
    console.log('MosaicCanvas layout', {
      canvasWidth: width,
      canvasHeight: height,
      totalImages,
      baseHeight: finalConfig.baseHeight,
      dynamicBaseHeight: calculatedBaseHeight,
      targetRows,
      minRows: finalConfig.minRows,
      maxRows: finalConfig.maxRows,
      padding: finalConfig.padding,
      fillScreenHeight,
    });

    // Create latitude-based bands
    const latitudeBands = createLatitudeBands(items, targetRows);

    return {
      bands: latitudeBands,
      dynamicBaseHeight: calculatedBaseHeight,
    };
  }, [
    items,
    height,
    width,
    finalConfig.baseHeight,
    finalConfig.minRows,
    finalConfig.maxRows,
    finalConfig.padding,
    fillScreenHeight,
  ]);

  // Hit map for click detection
  const hitRectsRef = useRef<
    Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      webcam: WindyWebcam;
    }>
  >([]);

  // Main canvas rendering effect
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
    ctx.fillStyle = '#000000';
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
      const rowData: RowData[] = [];

      // Pre-calculate all row data and total content height
      let totalContentHeight = 0;

      bands.forEach((row) => {
        // Calculate dimensions for each image in this row
        const imageData: ImageData[] = [];

        let totalImageWidth = 0;
        let maxImageHeight = 0;

        // Calculate dimensions for each image
        row.forEach((item) => {
          const img = imgMap.get(item.webcam.webcamId);
          if (!img) {
            imageData.push({ item, img: null, width: 0, height: 0 });
            return;
          }

          // Calculate dimensions with rating/view-based scaling using dynamic base height
          const { width: imgWidth, height: imgHeight } =
            calculateWebcamDimensions(
              img,
              item.webcam,
              dynamicBaseHeight,
              maxViews,
              ratingSizeEffect,
              viewSizeEffect,
              width * 0.8 // Max 80% of canvas width per image
            );

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
        totalImageWidth += finalConfig.padding * (row.length - 1);

        // Store row data
        rowData.push({
          height: maxImageHeight,
          y: 0, // Will be calculated below
          imageData,
          totalWidth: totalImageWidth,
        });

        totalContentHeight += maxImageHeight + finalConfig.padding;
      });

      // Calculate vertical offset to center content
      const verticalOffset = Math.max(
        0,
        (height - totalContentHeight) / 2
      );

      // Debug: how much vertical space we are filling
      console.log('MosaicCanvas render', {
        rows: rowData.length,
        totalContentHeight,
        canvasHeight: height,
        verticalOffset,
        dynamicBaseHeight,
      });
      let currentY = verticalOffset;

      // Update row positions with vertical centering
      rowData.forEach((rowInfo) => {
        rowInfo.y = currentY;
        currentY += rowInfo.height + finalConfig.padding;
      });

      // Render each row
      rowData.forEach((rowInfo) => {
        // Calculate starting x position to center the row
        const startX = Math.max(
          finalConfig.padding,
          (width - rowInfo.totalWidth) / 2
        );

        // Render images
        let currentX = startX;
        rowInfo.imageData.forEach(
          ({ item, img, width: imgWidth, height: imgHeight }) => {
            if (!img) {
              // Image failed to load - draw black rectangle
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
              currentX += failedWidth + finalConfig.padding;
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

            currentX += imgWidth + finalConfig.padding;
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
    finalConfig.padding,
    dynamicBaseHeight,
    maxViews,
    ratingSizeEffect,
    viewSizeEffect,
  ]);

  // Click handler effect
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
