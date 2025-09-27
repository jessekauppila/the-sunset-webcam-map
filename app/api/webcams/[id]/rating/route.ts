//adds a rating to a webcam in the database

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { rating } = await request.json();
    const webcamId = parseInt(params.id);

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      );
    }

    // Update the rating in the database
    await sql`
      UPDATE webcams 
      SET rating = ${rating}, updated_at = now()
      WHERE id = ${webcamId}
    `;

    return NextResponse.json({
      success: true,
      message: 'Rating updated successfully',
    });
  } catch (error) {
    console.error('Error updating webcam rating:', error);
    return NextResponse.json(
      { error: 'Failed to update rating' },
      { status: 500 }
    );
  }
}
