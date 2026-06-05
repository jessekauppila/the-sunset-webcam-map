'use client';

import {
  formatModelLabel,
  SUNSET_DETECTION_THRESHOLD,
} from './aiRatingHelpers';

/**
 * React component for the AI-rating verdict display. Used inside
 * `RatingCard.tsx` to show the "Sunset detected / Not a sunset right
 * now" treatment.
 *
 * Display gate B semantics (mirrors the dark popup):
 *   - Binary says yes → verdict + rating + stars + dual-line footer
 *   - Binary says no  → verdict + dual-line footer ONLY (no rating shown)
 *   - Binary unavailable → falls back to regression-threshold proxy and
 *     collapses footer to a single line
 */

export type AiRatingDisplayProps = {
  /** 1-5 scale value from `webcams.ai_rating_regression`. */
  rating: number | null;
  /** Regression head model version. Rendered in the footer. */
  modelVersion: string | null;
  /**
   * Real "is this a sunset?" signal. When present, drives the verdict.
   * When null / undefined, the regression-threshold proxy decides.
   */
  binaryIsSunset?: boolean | null;
  /**
   * Binary head model version. When distinct from `modelVersion`, the
   * footer renders two lines.
   */
  binaryModelVersion?: string | null;
  /**
   * The webcam's phase ('sunrise' or 'sunset'). Drives the verdict copy
   * since the model treats both phases identically — calling a sunrise
   * cam's golden-hour detection a "sunset" reads wrong even when the
   * binary classifier is right. Unknown phase → fall back to the
   * compound "Sunrise or sunset" wording.
   */
  phase?: 'sunrise' | 'sunset' | null;
};

/**
 * Produce the verdict copy strings for a given phase. The model judges
 * both phases identically — the wording follows the webcam's known
 * context to avoid reading like a mistake.
 */
function verdictCopy(phase: 'sunrise' | 'sunset' | null | undefined): {
  detected: string;
  notDetected: string;
} {
  if (phase === 'sunrise') {
    return { detected: 'Sunrise detected', notDetected: 'Not a sunrise right now' };
  }
  if (phase === 'sunset') {
    return { detected: 'Sunset detected', notDetected: 'Not a sunset right now' };
  }
  return {
    detected: 'Sunrise or sunset detected',
    notDetected: 'Not a sunrise or sunset right now',
  };
}

export default function AiRatingDisplay({
  rating,
  modelVersion,
  binaryIsSunset = null,
  binaryModelVersion = null,
  phase = null,
}: AiRatingDisplayProps) {
  if (rating == null) return null;

  const hasBinarySignal = typeof binaryIsSunset === 'boolean';
  const isSunset = hasBinarySignal
    ? binaryIsSunset
    : rating >= SUNSET_DETECTION_THRESHOLD;

  const copy = verdictCopy(phase);

  return isSunset ? (
    <SunsetState
      rating={rating}
      modelVersion={modelVersion}
      binaryModelVersion={binaryModelVersion}
      verdictText={copy.detected}
    />
  ) : (
    <NotSunsetState
      rating={rating}
      modelVersion={modelVersion}
      binaryModelVersion={binaryModelVersion}
      verdictText={copy.notDetected}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Claude (LLM) verdict — the third judge (indigo)                            */
/* -------------------------------------------------------------------------- */

export type ClaudeVerdictDisplayProps = {
  /** Claude's raw [0,1] quality score. Rendered as a percentage, NOT stars. */
  quality: number | null;
  /** Claude's "is this a sunset?" verdict. null → quality shown without a claim. */
  isSunset?: boolean | null;
  /** Claude model id, e.g. "claude-sonnet-4-5". */
  model?: string | null;
  phase?: 'sunrise' | 'sunset' | null;
};

const CLAUDE_PALETTE = {
  detected: {
    background:
      'linear-gradient(180deg, rgba(129, 140, 248, 0.20), rgba(165, 180, 252, 0.05))',
    borderTopColor: 'rgba(79, 70, 229, 0.45)',
    borderBottomColor: 'rgba(67, 56, 202, 0.25)',
    verdict: '#4338ca',
    value: '#3730a3',
    footerText: 'rgba(55, 48, 163, 0.55)',
    footerDivider: 'rgba(79, 70, 229, 0.22)',
  },
  muted: {
    background: 'rgba(148, 163, 184, 0.10)',
    borderTopColor: 'rgba(100, 116, 139, 0.30)',
    borderBottomColor: 'rgba(100, 116, 139, 0.18)',
    verdict: '#475569',
    value: '#475569',
    footerText: 'rgba(71, 85, 105, 0.55)',
    footerDivider: 'rgba(100, 116, 139, 0.22)',
  },
} as const;

/**
 * The Claude judge block. Rendered alongside (not inside) the model
 * `AiRatingDisplay` so it shows even when the v4 model hasn't scored the
 * frame — the common case on the Claude-ranked leaderboard pre-backfill.
 * Quality is a normalized [0,1] value shown as a percentage; proxying it
 * through the 1-5 `Stars` widget is exactly the faking this surface removes.
 */
export function ClaudeVerdictDisplay({
  quality,
  isSunset = null,
  model = null,
  phase = null,
}: ClaudeVerdictDisplayProps) {
  if (quality == null) return null;

  const copy = verdictCopy(phase);
  const verdictText =
    isSunset === true
      ? copy.detected
      : isSunset === false
      ? copy.notDetected
      : 'Claude quality';
  const tone = isSunset === false ? CLAUDE_PALETTE.muted : CLAUDE_PALETTE.detected;
  const pct = `${Math.round(Math.max(0, Math.min(1, quality)) * 100)}%`;
  const modelLabel = formatModelLabel(model);

  return (
    <div
      className="rounded px-2.5 py-2 border-t border-b"
      style={{
        background: tone.background,
        borderTopColor: tone.borderTopColor,
        borderBottomColor: tone.borderBottomColor,
      }}
    >
      <div
        className="font-semibold uppercase"
        style={{
          color: tone.verdict,
          fontSize: '9.5px',
          letterSpacing: '0.18em',
          lineHeight: 1,
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
        }}
      >
        {verdictText}
      </div>

      <div className="flex items-center gap-2 mt-1.5">
        <span
          className="font-semibold uppercase"
          style={{
            color: tone.verdict,
            fontSize: '9px',
            letterSpacing: '0.12em',
            lineHeight: 1,
            fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
            opacity: 0.75,
          }}
        >
          Claude
        </span>
        <span
          className="font-medium"
          style={{
            color: tone.value,
            fontSize: '11px',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          }}
        >
          {pct}
          <span style={{ opacity: 0.5, fontWeight: 400 }}> quality</span>
        </span>
      </div>

      <div
        className="mt-2 pt-1.5 flex items-baseline justify-between"
        style={{
          color: tone.footerText,
          fontSize: '9px',
          letterSpacing: '0.05em',
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          borderTop: `1px dashed ${tone.footerDivider}`,
          lineHeight: 1,
        }}
      >
        <span>{modelLabel}</span>
        <span style={{ opacity: 0.7 }}>LLM</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sunset (warm amber)                                                        */
/* -------------------------------------------------------------------------- */

function SunsetState({
  rating,
  modelVersion,
  binaryModelVersion,
  verdictText,
}: {
  rating: number;
  modelVersion: string | null;
  binaryModelVersion: string | null;
  verdictText: string;
}) {
  return (
    <div
      className="rounded px-2.5 py-2 border-t border-b"
      style={{
        background:
          'linear-gradient(180deg, rgba(253, 186, 116, 0.22), rgba(254, 215, 170, 0.06))',
        borderTopColor: 'rgba(234, 88, 12, 0.45)',
        borderBottomColor: 'rgba(154, 52, 18, 0.25)',
      }}
    >
      <div
        className="font-semibold uppercase"
        style={{
          color: '#c2410c',
          fontSize: '9.5px',
          letterSpacing: '0.18em',
          lineHeight: 1,
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
        }}
      >
        {verdictText}
      </div>

      <div className="flex items-center gap-2 mt-1.5">
        <Stars rating={rating} palette="amber" />
        <span
          className="font-medium"
          style={{
            color: '#9a3412',
            fontSize: '11px',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          }}
        >
          {rating.toFixed(2)}
          <span style={{ opacity: 0.5, fontWeight: 400 }}>/5</span>
        </span>
      </div>

      <Footer
        regressionVersion={modelVersion}
        binaryVersion={binaryModelVersion}
        labelColor="rgba(154, 52, 18, 0.65)"
        textColor="rgba(154, 52, 18, 0.55)"
        dividerColor="rgba(234, 88, 12, 0.22)"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Not a sunset (cool slate)                                                  */
/* -------------------------------------------------------------------------- */

function NotSunsetState({
  rating,
  modelVersion,
  binaryModelVersion,
  verdictText,
}: {
  rating: number;
  modelVersion: string | null;
  binaryModelVersion: string | null;
  verdictText: string;
}) {
  // Always render the regression rating + stars even when binary says "no".
  // The disagreement between a "Not a sunset" verdict and a high regression
  // value is the most useful diagnostic signal — it surfaces silhouette
  // sunsets the binary classifier missed (Taltson River 2026-06-01) and
  // feeds the v5 training conversation. Cool slate palette so the data is
  // present but doesn't visually contradict the verdict.
  return (
    <div
      className="rounded px-2.5 py-2 border-t border-b"
      style={{
        background: 'rgba(148, 163, 184, 0.10)',
        borderTopColor: 'rgba(100, 116, 139, 0.30)',
        borderBottomColor: 'rgba(100, 116, 139, 0.18)',
      }}
    >
      <div
        className="font-medium uppercase"
        style={{
          color: '#475569',
          fontSize: '9.5px',
          letterSpacing: '0.18em',
          lineHeight: 1,
          fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
        }}
      >
        {verdictText}
      </div>

      <div className="flex items-center gap-2 mt-1.5">
        <Stars rating={rating} palette="slate" />
        <span
          className="font-medium"
          style={{
            color: '#475569',
            fontSize: '11px',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          }}
        >
          {rating.toFixed(2)}
          <span style={{ opacity: 0.5, fontWeight: 400 }}>/5</span>
        </span>
      </div>

      <Footer
        regressionVersion={modelVersion}
        binaryVersion={binaryModelVersion}
        labelColor="rgba(71, 85, 105, 0.7)"
        textColor="rgba(71, 85, 105, 0.55)"
        dividerColor="rgba(100, 116, 139, 0.22)"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stars                                                                       */
/* -------------------------------------------------------------------------- */

const STAR_PATH =
  'M5.5 0.6 L6.83 3.89 L10.4 4.21 L7.71 6.54 L8.51 10.03 L5.5 8.21 L2.49 10.03 L3.29 6.54 L0.6 4.21 L4.17 3.89 Z';
const STAR_OFFSETS = [0, 12.75, 25.5, 38.25, 51];
const STAR_TRACK_WIDTH = 62;

const STAR_PALETTES = {
  amber: {
    dim: 'rgba(251, 146, 60, 0.30)',
    fill: '#ea580c',
  },
  slate: {
    dim: 'rgba(148, 163, 184, 0.45)',
    fill: '#64748b',
  },
} as const;

function Stars({
  rating,
  palette,
}: {
  rating: number;
  palette: keyof typeof STAR_PALETTES;
}) {
  const clamped = Math.max(0, Math.min(5, rating));
  const fillWidth = (clamped / 5) * STAR_TRACK_WIDTH;
  const colors = STAR_PALETTES[palette];

  // Each instance gets a unique clipPath id so multiple cards on screen
  // don't shadow each other. React useId is overkill; a random suffix
  // is fine for SVG defs scoped to the component lifetime.
  const clipId = `ai-rating-star-clip-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width="62"
      height="11"
      viewBox="0 0 62 11"
      style={{ display: 'block', flex: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={fillWidth.toFixed(2)} height="11" />
        </clipPath>
      </defs>
      <g fill={colors.dim}>
        {STAR_OFFSETS.map((x) => (
          <path key={`d-${x}`} transform={`translate(${x}, 0)`} d={STAR_PATH} />
        ))}
      </g>
      <g fill={colors.fill} clipPath={`url(#${clipId})`}>
        {STAR_OFFSETS.map((x) => (
          <path key={`f-${x}`} transform={`translate(${x}, 0)`} d={STAR_PATH} />
        ))}
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                      */
/* -------------------------------------------------------------------------- */

function Footer({
  regressionVersion,
  binaryVersion,
  labelColor,
  textColor,
  dividerColor,
  marginTop = 'mt-2',
}: {
  regressionVersion: string | null;
  binaryVersion: string | null;
  labelColor: string;
  textColor: string;
  dividerColor: string;
  marginTop?: string;
}) {
  const regressionLabel = formatModelLabel(regressionVersion);
  const binaryLabel = formatModelLabel(binaryVersion);
  const hasDistinctBinary =
    binaryVersion != null && binaryVersion !== regressionVersion;

  const sharedStyle: React.CSSProperties = {
    color: textColor,
    fontSize: '9px',
    letterSpacing: '0.05em',
    fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
  };

  if (!hasDistinctBinary) {
    return (
      <div
        className={`${marginTop} pt-1.5 flex items-baseline justify-between`}
        style={{
          ...sharedStyle,
          borderTop: `1px dashed ${dividerColor}`,
          lineHeight: 1,
        }}
      >
        <span>{regressionLabel}</span>
        <span style={{ opacity: 0.7 }}>ONNX</span>
      </div>
    );
  }

  return (
    <div
      className={`${marginTop} pt-1.5`}
      style={{
        ...sharedStyle,
        borderTop: `1px dashed ${dividerColor}`,
        lineHeight: 1.4,
      }}
    >
      <div className="flex items-baseline justify-between">
        <span>
          <span style={{ color: labelColor, marginRight: 6 }}>binary</span>
          {binaryLabel}
        </span>
        <span style={{ opacity: 0.7 }}>ONNX</span>
      </div>
      <div className="flex items-baseline justify-between mt-0.5">
        <span>
          <span style={{ color: labelColor, marginRight: 6 }}>rating</span>
          {regressionLabel}
        </span>
        <span style={{ opacity: 0.7 }}>ONNX</span>
      </div>
    </div>
  );
}
