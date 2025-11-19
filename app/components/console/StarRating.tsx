import { useMemo, useState } from 'react';

type StarRatingProps = {
  rating?: number;
  max?: number;
  size?: number;
  disabled?: boolean;
  onRate?: (rating: number) => void | Promise<void>;
  onHoverChange?: (rating: number | null) => void;
  className?: string;
  name?: string;
};

function StarRating({
  rating = 0,
  max = 5,
  size = 20,
  disabled = false,
  onRate,
  onHoverChange,
  className = '',
  name,
}: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [isFocusing, setIsFocusing] = useState(false);

  const stars = useMemo(() => {
    return Array.from({ length: max }, (_, index) => index + 1);
  }, [max]);

  const interactive = typeof onRate === 'function' && !disabled;
  const effectiveRating = hovered ?? rating ?? 0;

  const handleSelect = async (value: number) => {
    if (!interactive) return;
    await onRate?.(value);
  };

  const handleHover = (value: number | null) => {
    if (!interactive) return;
    setHovered(value);
    onHoverChange?.(value);
  };

  return (
    <div
      className={`star-wrapper flex gap-1 ${className}`}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={
        interactive
          ? `Rating selector${name ? ` for ${name}` : ''}`
          : `${rating} out of ${max} stars`
      }
      onMouseLeave={() => handleHover(null)}
    >
      {stars.map((value) => {
        const active = value <= effectiveRating;
        const isCurrent = value === effectiveRating;
        const baseImageStyle = { width: size, height: size };

        if (interactive) {
          return (
            <button
              type="button"
              key={value}
              className="star-button focus:outline-none"
              role="radio"
              aria-checked={value === rating}
              onMouseEnter={() => handleHover(value)}
              onFocus={() => {
                setIsFocusing(true);
                handleHover(value);
              }}
              onBlur={() => {
                setIsFocusing(false);
                handleHover(null);
              }}
              onClick={() => handleSelect(value)}
              disabled={disabled}
              data-active={active}
              data-current={isCurrent && !isFocusing}
            >
              <img
                style={{
                  ...baseImageStyle,
                  opacity: active ? 1 : 0.25,
                  transform:
                    hovered && value <= hovered
                      ? 'scale(1.05)'
                      : 'scale(1)',
                }}
                alt={active ? `${value} star` : 'empty star'}
                className="gold-star transition-opacity duration-150"
                src="/Five-pointed_star.svg-1.png"
              />
            </button>
          );
        }

        return (
          <span key={value} className="star-static" data-active={active}>
            <img
              style={{
                ...baseImageStyle,
                opacity: active ? 1 : 0.25,
              }}
              alt={active ? 'star' : 'empty star'}
              className="gold-star"
              src="/Five-pointed_star.svg-1.png"
            />
          </span>
        );
      })}
    </div>
  );
}

export default StarRating;
