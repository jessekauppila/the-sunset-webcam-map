import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import type { WindyWebcam } from '@/app/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for image capture

interface CaptureRequest {
  webcams: WindyWebcam[];
}

interface CaptureResult {
  success: number;
  failed: number;
  snapshots: Array<{
    webcamId: number;
    snapshotId: number;
    url: string;
  }>;
  errors: Array<{
    webcamId: number;
    error: string;
  }>;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptureRequest;
    const { webcams } = body;

    if (!webcams || !Array.isArray(webcams) || webcams.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: webcams array required' },
        { status: 400 }
      );
    }

    const result: CaptureResult = {
      success: 0,
      failed: 0,
      snapshots: [],
      errors: [],
    };

    // Process each webcam
    for (const webcam of webcams) {
      try {
        // Capture and upload the image
        console.log(
          `Attempting to capture webcam ${webcam.webcamId}...`
        );
        const snapshot = await captureWebcamSnapshot(webcam);

        if (!snapshot) {
          console.error(
            `Failed to capture webcam ${webcam.webcamId}`
          );
          result.failed++;
          result.errors.push({
            webcamId: webcam.webcamId,
            error: 'Failed to capture or upload image',
          });
          continue;
        }

        console.log(
          `Successfully captured webcam ${webcam.webcamId}`
        );

        // Save metadata to database
        const rows = await sql`
          INSERT INTO webcam_snapshots (
            webcam_id, phase, rank, initial_rating, firebase_url, firebase_path, captured_at
          )
          VALUES (
            ${webcam.webcamId},
            ${webcam.phase || 'unknown'},
            ${webcam.rank || null},
            ${webcam.rating || null},
            ${snapshot.url},
            ${snapshot.path},
            NOW()
          )
          RETURNING id, firebase_url
        `;

        const savedSnapshot = rows[0] as {
          id: number;
          firebase_url: string;
        };

        result.success++;
        result.snapshots.push({
          webcamId: webcam.webcamId,
          snapshotId: savedSnapshot.id,
          url: savedSnapshot.firebase_url,
        });
      } catch (error) {
        console.error(
          `Error capturing webcam ${webcam.webcamId}:`,
          error
        );
        result.failed++;
        result.errors.push({
          webcamId: webcam.webcamId,
          error:
            error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in capture route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
