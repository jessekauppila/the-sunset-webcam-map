//allows you to enter the orientation of the webcam in the database..

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
    const { orientation } = await request.json();
    const webcamId = parseInt(params.id);

    // Validate orientation
    if (!orientation || !validOrientations.includes(orientation)) {
      return NextResponse.json(
        {
          error: `Orientation must be one of: ${validOrientations.join(
            ', '
          )}`,
        },
        { status: 400 }
      );
    }

    // Update the orientation in the database
    await sql`
      UPDATE webcams 
      SET orientation = ${orientation}, updated_at = now()
      WHERE id = ${webcamId}
    `;

    return NextResponse.json({
      success: true,
      message: 'Orientation updated successfully',
    });
  } catch (error) {
    console.error('Error updating webcam orientation:', error);
    return NextResponse.json(
      { error: 'Failed to update orientation' },
      { status: 500 }
    );
  }
}
