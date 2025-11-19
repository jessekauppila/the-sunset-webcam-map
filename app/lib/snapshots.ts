import { getUserSessionId } from './userSession';

export type CaptureAndRateRequest = {
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  rating: number;
  userSessionId?: string;
};

export type CaptureAndRateResponse = {
  success: boolean;
  snapshotId: number;
  rating: number;
  calculatedRating: number | null;
  ratingCount: number;
  capturedAt: string;
  firebaseUrl: string;
  alreadyExisted: boolean;
};

const API_ENDPOINT = '/api/snapshots/capture-and-rate';

export async function captureAndRateWebcam({
  webcamId,
  phase,
  rating,
  userSessionId,
}: CaptureAndRateRequest): Promise<CaptureAndRateResponse> {
  const sessionId = userSessionId || getUserSessionId();

  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webcamId,
      phase,
      rating,
      userSessionId: sessionId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      errorText || 'Failed to capture and rate webcam snapshot'
    );
  }

  const data = (await response.json()) as CaptureAndRateResponse;
  return data;
}


