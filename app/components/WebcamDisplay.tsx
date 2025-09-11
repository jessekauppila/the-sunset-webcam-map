'use client';

import { useEffect, useRef } from 'react';
import type { WindyWebcam } from '../lib/types';

interface WebcamDisplayProps {
  webcam: WindyWebcam;
}

export function WebcamDisplay({ webcam }: WebcamDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webcam.images?.current?.preview) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous'; // Handle CORS if needed

    img.onload = () => {
      // Set canvas size to match the image
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw the image onto the canvas
      ctx.drawImage(img, 0, 0);
    };

    img.onerror = () => {
      // Fallback: draw a placeholder if image fails to load
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#666';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Image failed to load',
        canvas.width / 2,
        canvas.height / 2
      );
    };

    img.src = webcam.images.current.preview;
  }, [webcam.images?.current?.preview]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-contain rounded"
      style={{ maxWidth: '100%', maxHeight: '100%' }}
    />
  );
}
