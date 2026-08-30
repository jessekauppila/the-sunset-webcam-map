import { sql } from '@/app/lib/db';

export type LabelSource = 'webcam' | 'flickr';

/** The row the database actually stored — the client's proof of the write. */
export type SavedLabel = { id: number; labeledAt: string };

export async function upsertManualLabel(opts: {
  source: LabelSource;
  imageId: number;
  isSunset: boolean;
  rating?: number | null;
  /** Which queue produced this label. Lets the two populations be told apart in
   *  raw SQL without joining label_samples — and they must be: labels from the
   *  disagreement queue are drawn from the hardest ~15% of the corpus, so
   *  pooling them with a random sample destroys what the random sample is for. */
  origin?: string | null;
}): Promise<SavedLabel | null> {
  // RETURNING costs nothing extra and turns "the request didn't error" into
  // "the row exists, here it is" — the queue reports saves from this, not from
  // the HTTP status.
  const rows = (await sql`
    INSERT INTO manual_labels (source, image_id, is_sunset, rating, origin)
    VALUES (${opts.source}, ${opts.imageId}, ${opts.isSunset}, ${opts.rating ?? null},
            ${opts.origin ?? 'hard_example'})
    ON CONFLICT (source, image_id) DO UPDATE
      SET is_sunset = EXCLUDED.is_sunset,
          rating = EXCLUDED.rating,
          origin = EXCLUDED.origin,
          labeled_at = now()
    RETURNING id, labeled_at
  `) as { id: number | string; labeled_at: string | Date }[];
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), labeledAt: new Date(row.labeled_at).toISOString() };
}

export async function deleteManualLabel(
  source: LabelSource,
  imageId: number,
): Promise<number> {
  const rows = (await sql`
    DELETE FROM manual_labels WHERE source = ${source} AND image_id = ${imageId}
    RETURNING id
  `) as unknown[];
  return rows.length;
}

/** Total gold labels on record. Small, indexed table — cheap per call. */
export async function countManualLabels(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM manual_labels
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}
