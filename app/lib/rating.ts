import { getUserSessionId } from './userSession';

/**
 * Rate a webcam (updates webcam table)
 */
export async function rateWebcam(webcamId: number, rating: number) {
  const response = await fetch(`/api/webcams/${webcamId}/rating`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating }),
  });

  if (!response.ok) {
    throw new Error('Failed to rate webcam');
  }

  return response.json();
}

/**
 * Rate a snapshot (adds user rating to webcam_snapshot_ratings table)
 */
export async function rateSnapshot(
  snapshotId: number,
  rating: number
) {
  const userSessionId = getUserSessionId();

  const response = await fetch(`/api/snapshots/${snapshotId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userSessionId, rating }),
  });

  if (!response.ok) {
    throw new Error('Failed to rate snapshot');
  }

  return response.json();
}
