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

const phaseLabels: Record<string, string> = {
  sunrise: 'Sunrise',
  sunset: 'Sunset',
};

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

  const locationLabel = useMemo(() => inferLocation(webcam), [webcam]);
  const phaseLabel =
    (webcam.phase && phaseLabels[webcam.phase]) || 'Sunset Moment';

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
        err instanceof Error ? err.message : 'Failed to submit rating';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const feedbackToneClass =
    feedback?.tone === 'positive'
      ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30'
      : feedback?.tone === 'negative'
      ? 'bg-red-500/15 text-red-200 border-red-400/30'
      : 'bg-slate-700/40 text-slate-200 border-slate-600/40';

  return (
    <div
      className={`webcam-rating-card w-64 max-w-xs rounded-xl bg-slate-900/95 text-slate-100 shadow-xl border border-slate-700/60 overflow-hidden ${className}`}
    >
      <div className="relative">
        {webcam.images?.current?.preview ? (
          <img
            src={webcam.images.current.preview}
            alt={webcam.title}
            className="h-40 w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-40 w-full bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-4xl">
            🌅
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/75 to-transparent px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-amber-200/80">
            {phaseLabel}
          </p>
          <h3 className="text-sm font-semibold leading-tight text-white">
            {webcam.title}
          </h3>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {heading ? (
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {heading}
          </p>
        ) : null}

        {locationLabel ? (
          <p className="text-sm text-slate-300 leading-tight">
            {locationLabel}
          </p>
        ) : null}

        <div className="flex flex-col items-start gap-1">
          <p className="text-xs text-slate-400 uppercase tracking-wide">
            Rate this moment
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
            <p className="text-xs text-slate-400">Saving your rating…</p>
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
          <div className="rounded-lg border border-red-500/40 bg-red-600/15 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default RatingCard;

