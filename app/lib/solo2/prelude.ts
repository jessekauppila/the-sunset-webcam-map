/**
 * The prelude of a frame: the same camera's earlier captures, oldest first,
 * the last `max` of them (spec §4.4). Pure over whatever the state endpoint
 * already returned: no query. Frames below a floor are fine here; they are
 * earlier pictures of the same scene.
 */
export function preludeFor<T extends { webcamId: number; snapshotId: number; capturedAt: number }>(
  entry: T, entries: T[], max: number,
): T[] {
  if (max <= 0) return [];
  return entries
    .filter((e) => e.webcamId === entry.webcamId && e.snapshotId !== entry.snapshotId && e.capturedAt < entry.capturedAt)
    .sort((a, b) => a.capturedAt - b.capturedAt || a.snapshotId - b.snapshotId)
    .slice(-Math.floor(max));
}
