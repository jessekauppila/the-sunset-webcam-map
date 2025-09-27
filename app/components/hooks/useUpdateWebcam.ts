//used to update the webcam orientation and rating

import { useState } from 'react';
import type { Orientation } from '@/app/lib/types';

interface UpdateWebcamParams {
  rating?: number;
  orientation?: Orientation;
}

interface UpdateWebcamResponse {
  success: boolean;
  message: string;
  updated?: UpdateWebcamParams;
}

export function useUpdateWebcam() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateWebcam = async (
    webcamId: number,
    updates: UpdateWebcamParams
  ): Promise<UpdateWebcamResponse | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/webcams/${webcamId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update webcam');
      }

      return data;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Error updating webcam:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const updateRating = async (webcamId: number, rating: number) => {
    return updateWebcam(webcamId, { rating });
  };

  const updateOrientation = async (
    webcamId: number,
    orientation: Orientation
  ) => {
    return updateWebcam(webcamId, { orientation });
  };

  return {
    updateWebcam,
    updateRating,
    updateOrientation,
    isLoading,
    error,
  };
}
