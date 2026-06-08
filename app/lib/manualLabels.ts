import { sql } from '@/app/lib/db';

export type LabelSource = 'webcam' | 'flickr';

export async function upsertManualLabel(opts: {
  source: LabelSource;
  imageId: number;
  isSunset: boolean;
  rating?: number | null;
}): Promise<void> {
  await sql`
    INSERT INTO manual_labels (source, image_id, is_sunset, rating)
    VALUES (${opts.source}, ${opts.imageId}, ${opts.isSunset}, ${opts.rating ?? null})
    ON CONFLICT (source, image_id) DO UPDATE
      SET is_sunset = EXCLUDED.is_sunset,
          rating = EXCLUDED.rating,
          labeled_at = now()
  `;
}

export async function deleteManualLabel(
  source: LabelSource,
  imageId: number,
): Promise<void> {
  await sql`
    DELETE FROM manual_labels WHERE source = ${source} AND image_id = ${imageId}
  `;
}
