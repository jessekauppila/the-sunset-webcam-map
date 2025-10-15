//suite of tools to manage firebase image database

import { getFirebaseBucket } from './firebase';
import type { WindyWebcam } from './types';

/**
 * Download an image from a URL and return as a Buffer
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download image: ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload an image buffer to Firebase Storage
 * Returns the public URL and storage path
 */
export async function uploadToFirebase(
  imageBuffer: Buffer,
  webcamId: number,
  timestamp: Date
): Promise<{ url: string; path: string }> {
  const bucket = getFirebaseBucket();
  const fileName = `${timestamp.getTime()}.jpg`;
  const path = `snapshots/${webcamId}/${fileName}`;

  const file = bucket.file(path);

  await file.save(imageBuffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: {
        webcamId: webcamId.toString(),
        capturedAt: timestamp.toISOString(),
      },
    },
  });

  // Make the file publicly accessible
  await file.makePublic();

  // Get the public URL
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${path}`;

  return {
    url: publicUrl,
    path,
  };
}

/**
 * Delete an image from Firebase Storage
 */
export async function deleteFromFirebase(
  path: string
): Promise<void> {
  const bucket = getFirebaseBucket();
  const file = bucket.file(path);

  try {
    await file.delete();
  } catch (error) {
    console.error(`Failed to delete file ${path}:`, error);
    // Don't throw - file might already be deleted
  }
}

/**
 * Capture a snapshot of a webcam and upload to Firebase
 */
export async function captureWebcamSnapshot(
  webcam: WindyWebcam
): Promise<{ url: string; path: string } | null> {
  try {
    // Get the preview image URL from the webcam
    const imageUrl = webcam.images?.current?.preview;

    if (!imageUrl) {
      console.warn(
        `No preview image available for webcam ${webcam.webcamId}`
      );
      return null;
    }

    console.log(`Downloading image from: ${imageUrl}`);

    // Download the image
    const imageBuffer = await downloadImage(imageUrl);

    console.log(
      `Downloaded ${imageBuffer.length} bytes for webcam ${webcam.webcamId}`
    );

    // Upload to Firebase
    const timestamp = new Date();
    const result = await uploadToFirebase(
      imageBuffer,
      webcam.webcamId,
      timestamp
    );

    console.log(`Uploaded to Firebase: ${result.url}`);

    return result;
  } catch (error) {
    console.error(
      `Failed to capture snapshot for webcam ${webcam.webcamId}:`,
      error instanceof Error ? error.message : error
    );
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    return null;
  }
}

// In-memory debounce tracker
// In production, you might want to use Redis or database for distributed systems
let lastCaptureTime = 0;
const DEBOUNCE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Check if enough time has passed since last capture
 */
export function shouldCapture(): boolean {
  const now = Date.now();
  const timeSinceLastCapture = now - lastCaptureTime;
  return timeSinceLastCapture >= DEBOUNCE_MS;
}

/**
 * Update the last capture timestamp
 */
export function updateLastCaptureTime(): void {
  lastCaptureTime = Date.now();
}

/**
 * Get time until next capture is allowed (in ms)
 */
export function getTimeUntilNextCapture(): number {
  const now = Date.now();
  const timeSinceLastCapture = now - lastCaptureTime;
  const remaining = DEBOUNCE_MS - timeSinceLastCapture;
  return Math.max(0, remaining);
}
