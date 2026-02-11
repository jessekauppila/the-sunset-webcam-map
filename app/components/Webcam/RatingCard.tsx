import { useEffect, useMemo, useState } from 'react';
import StarRating from '@/app/components/console/StarRating';
import type { WindyWebcam } from '@/app/lib/types';

type FeedbackTone = 'positive' | 'negative' | 'neutral';

export type RateResult = {
  message?: string;
  tone?: FeedbackTone;
  rating?: number;
};

export type RatingCardProps = {
  webcam: WindyWebcam;
  initialRating?: number | null;
  onRate: (rating: number) => Promise<RateResult | void>;
  className?: string;
  heading?: string;
  disabled?: boolean;
};

function inferLocation(webcam: WindyWebcam) {
  const { location } = webcam;
  if (!location) return null;

  const parts = [location.city, location.region, location.country]
    .filter(Boolean)
    .map((part) => part?.toString().trim());

  return parts.length > 0 ? parts.join(', ') : null;
}

export function RatingCard({
  webcam,
  initialRating = null,
  onRate,
  className = '',
  heading,
  disabled = false,
}: RatingCardProps) {
  const [currentRating, setCurrentRating] = useState<number>(
    initialRating ?? 0
  );
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: FeedbackTone;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locationLabel = useMemo(
    () => inferLocation(webcam),
    [webcam]
  );
  const rateText =
    webcam.phase === 'sunrise'
      ? 'Rate this sunrise'
      : 'Rate this sunset';

  // Format location label with bold first part (webcam title)
  const formattedLocation = useMemo(() => {
    if (!locationLabel) return null;
    if (!webcam.title) return locationLabel;

    // Check if location starts with webcam title (handle with or without comma/space)
    const titleTrimmed = webcam.title.trim();
    if (locationLabel.startsWith(titleTrimmed)) {
      const rest = locationLabel.slice(titleTrimmed.length);
      return { bold: titleTrimmed, rest };
    }

    // Fallback: just return the location as-is
    return locationLabel;
  }, [locationLabel, webcam.title]);

  useEffect(() => {
    if (typeof initialRating === 'number') {
      setCurrentRating(initialRating);
    }
  }, [initialRating]);

  const handleRate = async (value: number) => {
    if (disabled || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await onRate(value);
      setCurrentRating(result?.rating ?? value);

      if (result?.message) {
        setFeedback({
          message: result.message,
          tone: result.tone ?? 'neutral',
        });
      } else {
        setFeedback({
          message: 'Thanks for rating!',
          tone: 'neutral',
        });
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to submit rating';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const feedbackToneClass =
    feedback?.tone === 'positive'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
      : feedback?.tone === 'negative'
      ? 'bg-red-100 text-red-700 border-red-300'
      : 'bg-gray-300 text-gray-700 border-gray-400';

  return (
    <div
      className={`webcam-rating-card w-64 max-w-xs rounded-md bg-gray-200 text-gray-800 shadow-xl border border-gray-300 overflow-hidden relative ${className}`}
    >
      <div className="px-3 pt-3">
        {webcam.images?.current?.preview ? (
          <img
            src={webcam.images.current.preview}
            alt={webcam.title}
            className="h-32 w-full object-cover rounded"
            loading="lazy"
          />
        ) : (
          <div className="h-32 w-full bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-4xl rounded">
            🌅
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 pt-5 pb-4">
        {heading ? (
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {heading}
          </p>
        ) : null}

        {formattedLocation ? (
          <p className="text-sm text-gray-600 leading-tight">
            {typeof formattedLocation === 'string' ? (
              formattedLocation
            ) : (
              <>
                <span className="font-semibold text-gray-700">
                  {formattedLocation.bold}
                </span>
                {formattedLocation.rest}
              </>
            )}
          </p>
        ) : null}

        {typeof webcam.aiRating === 'number' ? (
          <div className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1">
            <p className="text-[11px] uppercase tracking-wide text-indigo-500">
              AI rating
            </p>
            <p className="text-sm font-semibold text-indigo-700">
              {webcam.aiRating.toFixed(2)} / 5
            </p>
            {webcam.aiModelVersion ? (
              <p className="text-[11px] text-indigo-500">
                Model: {webcam.aiModelVersion}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col items-start gap-1">
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            {rateText}
          </p>
          <StarRating
            rating={currentRating}
            onRate={handleRate}
            disabled={disabled || submitting}
            size={28}
            name={webcam.title}
            className={submitting ? 'opacity-75' : ''}
          />
          {submitting ? (
            <p className="text-xs text-gray-500">
              Saving your rating…
            </p>
          ) : null}
        </div>

        {feedback ? (
          <div
            className={`rounded-lg border px-3 py-2 text-xs leading-snug ${feedbackToneClass}`}
          >
            {feedback.message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-400 bg-red-100 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default RatingCard;
