import type { DroppedKey } from '@/app/lib/settings/schema';

/**
 * What a scene restore did. Kept apart from the action in
 * `restoreSceneDials.ts` on purpose: the preview only needs to DISPLAY a
 * report, and pulling the action in would drag the mosaic registry along
 * through sharedSchema for the sake of one constant.
 */
export interface RestoreReport {
  activeVersion: string;
  /** Saved dial keys the current schemas accepted. */
  restored: number;
  /** Saved dial keys no current schema has. Named, never hidden. */
  dropped: DroppedKey[];
}

/** One line for the operator, honest about a partial restore. */
export function describeRestore(r: RestoreReport): string {
  if (r.dropped.length === 0) return `restored ${r.activeVersion} · ${r.restored} dials`;
  const total = r.restored + r.dropped.length;
  const names = r.dropped.map((d) => d.key).join(', ');
  return `restored ${r.activeVersion} · ${r.restored} of ${total} dials · not in this schema: ${names}`;
}
