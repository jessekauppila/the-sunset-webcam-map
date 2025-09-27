//this enters rating and orientation into the database...

//this might not be necessary...

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import type { Orientation } from '@/app/lib/types';

const validOrientations: Orientation[] = [
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const webcamId = parseInt(params.id);
    const { rating, orientation } = body;

    // Validate inputs
    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      );
    }

    if (
      orientation !== undefined &&
      !validOrientations.includes(orientation)
    ) {
      return NextResponse.json(
        {
          error: `Orientation must be one of: ${validOrientations.join(
            ', '
          )}`,
        },
        { status: 400 }
      );
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (rating !== undefined) {
      updates.push(`rating = $${paramIndex}`);
      values.push(rating);
      paramIndex++;
    }

    if (orientation !== undefined) {
      updates.push(`orientation = $${paramIndex}`);
      values.push(orientation);
      paramIndex++;
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Add webcamId and updated_at to the values
    updates.push(`updated_at = now()`);
    values.push(webcamId);

    const query = `
      UPDATE webcams 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `;

    await sql.unsafe(query, values);

    return NextResponse.json({
      success: true,
      message: 'Webcam updated successfully',
      updated: { rating, orientation },
    });
  } catch (error) {
    console.error('Error updating webcam:', error);
    return NextResponse.json(
      { error: 'Failed to update webcam' },
      { status: 500 }
    );
  }
}
