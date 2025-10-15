import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import type { WindyWebcam } from '@/app/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow up to 5 minutes for capture

export async function GET(request: Request) {
  return captureSnapshots(request);
}

export async function POST(request: Request) {
  return captureSnapshots(request);
}

async function captureSnapshots(request: Request) {
  try {
    // Check for authorization header for cron jobs
    const authHeader = request.headers.get('authorization');
    const isAuthorized =
      authHeader === `Bearer ${process.env.CRON_SECRET}` ||
      process.env.NODE_ENV === 'development';

    if (!isAuthorized && process.env.NODE_ENV !== 'development') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Starting scheduled snapshot capture...');

    // Get terminator webcams with rating >= 4 from database
    const rows = await sql`
      SELECT s.webcam_id, s.phase, s.rank,
             w.id, w.source, w.external_id, w.title, w.status, w.view_count,
             w.lat, w.lng, w.city, w.region, w.country, w.continent,
             w.images, w.urls, w.player, w.categories,
             w.last_fetched_at, w.created_at, w.updated_at,
             w.rating, w.orientation
      FROM terminator_webcam_state s
      JOIN webcams w ON w.id = s.webcam_id
      WHERE s.active = true 
        AND w.status = 'active' 
        AND w.rating >= 4
      ORDER BY s.rank
      LIMIT 100
    `;

    // Transform to WindyWebcam format
    const webcamsToCapture: WindyWebcam[] = rows
      .map((row: Record<string, unknown>) => {
        try {
          return {
            webcamId: row.webcam_id,
            title: row.title || 'Unknown',
            viewCount: row.view_count || 0,
            status: row.status || 'unknown',
            images: row.images
              ? typeof row.images === 'string'
                ? JSON.parse(row.images)
                : row.images
              : null,
            location: {
              city: row.city || '',
              region: row.region || '',
              longitude: row.lng,
              latitude: row.lat,
              country: row.country || '',
              continent: row.continent || '',
            },
            categories: row.categories
              ? typeof row.categories === 'string'
                ? JSON.parse(row.categories)
                : row.categories
              : [],
            lastUpdatedOn: row.last_fetched_at,
            player: row.player
              ? typeof row.player === 'string'
                ? JSON.parse(row.player)
                : row.player
              : null,
            urls: row.urls
              ? typeof row.urls === 'string'
                ? JSON.parse(row.urls)
                : row.urls
              : null,
            phase: row.phase,
            rank: row.rank,
            source: row.source,
            externalId: row.external_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            rating: row.rating,
            orientation: row.orientation,
          };
        } catch (error) {
          console.error(
            `Error parsing webcam ${row.webcam_id}:`,
            error
          );
          return null;
        }
      })
      .filter(Boolean) as WindyWebcam[];

    if (webcamsToCapture.length === 0) {
      console.log('No webcams with rating >= 4 found for capture');
      return NextResponse.json({
        success: true,
        message: 'No webcams to capture',
        captured: 0,
      });
    }

    console.log(
      `Found ${webcamsToCapture.length} webcams to capture`
    );

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each webcam
    for (const webcam of webcamsToCapture) {
      try {
        console.log(`Capturing webcam ${webcam.webcamId}...`);

        // Capture and upload the image
        const snapshot = await captureWebcamSnapshot(webcam);

        if (!snapshot) {
          results.failed++;
          results.errors.push(
            `Webcam ${webcam.webcamId}: Failed to capture image`
          );
          continue;
        }

        // Save metadata to database
        const dbRows = await sql`
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
          RETURNING id
        `;

        console.log(
          `Successfully captured webcam ${webcam.webcamId}`
        );
        results.success++;
      } catch (error) {
        console.error(
          `Error capturing webcam ${webcam.webcamId}:`,
          error
        );
        results.failed++;
        results.errors.push(
          `Webcam ${webcam.webcamId}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    console.log(
      `Scheduled capture complete. Success: ${results.success}, Failed: ${results.failed}`
    );

    return NextResponse.json({
      success: true,
      message: `Captured ${results.success} snapshots`,
      captured: results.success,
      failed: results.failed,
      errors: results.errors,
    });
  } catch (error) {
    console.error('Error in scheduled capture:', error);
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
