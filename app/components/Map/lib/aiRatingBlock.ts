/**
 * Renders the "AI rating" section that lives inside the Mapbox webcam popup.
 *
 * Returns an inline HTML string because Mapbox popups don't accept React.
 * Two visual states: "sunset detected" (warm amber) vs "not a sunset right
 * now" (cool slate). The verdict is currently derived from the regression
 * rating crossing a threshold — a stand-in for the binary classifier that
 * exists but isn't yet plumbed through the cron. When binary lands, the
 * verdict gate flips from `rating >= SUNSET_DETECTION_THRESHOLD` to
 * `binaryScore >= ...` with no change to the visual structure.
 *
 * See `memory/project_two_tier_sunset_classification.md` for the followup.
 */

// Below this 1-5 rating we say the camera isn't currently looking at a
// sunset. Picked by eye on 2026-05-31; tunable. Corresponds to raw model
// output 0.4 ((rating - 1) / 4).
export const SUNSET_DETECTION_THRESHOLD = 2.6;

export interface AiRatingBlockInput {
  /** 1-5 scale. The value already in `webcams.ai_rating_regression`. */
  rating: number | null;
  /**
   * Model version string from `webcams.ai_model_version_regression`.
   * Rendered as small footer metadata.
   */
  modelVersion: string | null;
  /**
   * Used to namespace the SVG clipPath ID so multiple popups on screen
   * don't collide. The webcam id is the natural choice.
   */
  uniqueKey: string | number;
}

/**
 * Top-level entry. Returns an empty string when there's no signal to show
 * (matches the previous behavior of hiding the whole block on null ratings).
 */
export function renderAiRatingBlock(input: AiRatingBlockInput): string {
  if (input.rating == null) return '';
  const isSunset = input.rating >= SUNSET_DETECTION_THRESHOLD;
  return isSunset
    ? renderSunsetBlock(input.rating, input.modelVersion, input.uniqueKey)
    : renderNoSunsetBlock(input.rating, input.modelVersion);
}

/* -------------------------------------------------------------------------- */
/* "Sunset detected" — warm amber state                                       */
/* -------------------------------------------------------------------------- */

function renderSunsetBlock(
  rating: number,
  modelVersion: string | null,
  uniqueKey: string | number,
): string {
  const clipId = `ai-rating-fill-${String(uniqueKey).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const STAR_TRACK_WIDTH = 62; // px — must match the SVG width
  const fillWidth = ((Math.max(0, Math.min(5, rating)) / 5) * STAR_TRACK_WIDTH).toFixed(2);

  return `
    <div style="
        margin: 10px 0 4px;
        padding: 9px 10px 8px;
        border-radius: 2px;
        background: linear-gradient(180deg, rgba(180, 83, 9, 0.16), rgba(120, 53, 15, 0.04));
        border-top: 1px solid rgba(251, 146, 60, 0.42);
        border-bottom: 1px solid rgba(120, 53, 15, 0.55);
      ">
      <div style="
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          font-size: 8.5px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #fdba74;
          line-height: 1;
        ">Sunset detected</div>

      <div style="display: flex; align-items: center; gap: 7px; margin-top: 6px;">
        ${renderStars({ clipId, fillWidth, color: '#fb923c', dimColor: 'rgba(251, 146, 60, 0.18)' })}

        <span style="
            font-family: var(--font-geist-mono), ui-monospace, monospace;
            font-size: 10px;
            font-weight: 500;
            color: #fed7aa;
            letter-spacing: -0.02em;
            line-height: 1;
          ">${rating.toFixed(2)}<span style="opacity: 0.45; font-weight: 400;">/5</span></span>
      </div>

      ${renderModelFooter(modelVersion, {
        color: 'rgba(253, 186, 116, 0.42)',
        dividerColor: 'rgba(251, 146, 60, 0.18)',
      })}
    </div>
  `;
}

/* -------------------------------------------------------------------------- */
/* "Not a sunset right now" — cool slate state                                */
/* -------------------------------------------------------------------------- */

function renderNoSunsetBlock(rating: number, modelVersion: string | null): string {
  return `
    <div style="
        margin: 10px 0 4px;
        padding: 9px 10px 8px;
        border-radius: 2px;
        background: rgba(15, 23, 42, 0.42);
        border-top: 1px solid rgba(148, 163, 184, 0.18);
        border-bottom: 1px solid rgba(15, 23, 42, 0.6);
      ">
      <div style="
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          font-size: 8.5px;
          font-weight: 500;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #94a3b8;
          line-height: 1;
        ">Not a sunset right now</div>

      <div style="display: flex; align-items: center; gap: 7px; margin-top: 6px;">
        ${renderEmptyStars('rgba(148, 163, 184, 0.22)')}

        <span style="
            font-family: var(--font-geist-mono), ui-monospace, monospace;
            font-size: 10px;
            font-weight: 500;
            color: #94a3b8;
            letter-spacing: -0.02em;
            line-height: 1;
          ">${rating.toFixed(2)}<span style="opacity: 0.4; font-weight: 400;">/5</span></span>
      </div>

      ${renderModelFooter(modelVersion, {
        color: 'rgba(148, 163, 184, 0.4)',
        dividerColor: 'rgba(148, 163, 184, 0.14)',
      })}
    </div>
  `;
}

/* -------------------------------------------------------------------------- */
/* Star primitives                                                            */
/* -------------------------------------------------------------------------- */

// Single 5-point star path, inscribed in an 11x11 viewBox.
const STAR_PATH =
  'M5.5 0.6 L6.83 3.89 L10.4 4.21 L7.71 6.54 L8.51 10.03 L5.5 8.21 L2.49 10.03 L3.29 6.54 L0.6 4.21 L4.17 3.89 Z';

function renderStarRow(fill: string): string {
  // Five copies, each 11x11, spaced 12.75px center-to-center.
  return `
    <g fill="${fill}">
      <path transform="translate(0, 0)" d="${STAR_PATH}"/>
      <path transform="translate(12.75, 0)" d="${STAR_PATH}"/>
      <path transform="translate(25.5, 0)" d="${STAR_PATH}"/>
      <path transform="translate(38.25, 0)" d="${STAR_PATH}"/>
      <path transform="translate(51, 0)" d="${STAR_PATH}"/>
    </g>
  `;
}

function renderStars(opts: {
  clipId: string;
  fillWidth: string;
  color: string;
  dimColor: string;
}): string {
  return `
    <svg width="62" height="11" viewBox="0 0 62 11" style="display: block; flex: none;" aria-hidden="true">
      <defs>
        <clipPath id="${opts.clipId}">
          <rect x="0" y="0" width="${opts.fillWidth}" height="11"/>
        </clipPath>
      </defs>
      ${renderStarRow(opts.dimColor)}
      <g clip-path="url(#${opts.clipId})">
        ${renderStarRow(opts.color)}
      </g>
    </svg>
  `;
}

function renderEmptyStars(color: string): string {
  return `
    <svg width="62" height="11" viewBox="0 0 62 11" style="display: block; flex: none;" aria-hidden="true">
      ${renderStarRow(color)}
    </svg>
  `;
}

/* -------------------------------------------------------------------------- */
/* Footer (model version + ONNX badge)                                        */
/* -------------------------------------------------------------------------- */

function renderModelFooter(
  modelVersion: string | null,
  opts: { color: string; dividerColor: string },
): string {
  // Trim "regression" / "binary" type prefixes if present, then strip leading
  // version tag and date to leave the readable suffix. Examples:
  //   "v4_regression_llm_with_flickr" -> "v4 · llm_with_flickr"
  //   "20260513_113243_v4_regression_llm_with_flickr" -> "v4 · llm_with_flickr"
  //   null -> "—"
  const label = formatModelLabel(modelVersion);

  return `
    <div style="
        margin-top: 7px;
        padding-top: 6px;
        border-top: 1px dashed ${opts.dividerColor};
        font-family: var(--font-geist-mono), ui-monospace, monospace;
        font-size: 7.5px;
        letter-spacing: 0.06em;
        color: ${opts.color};
        line-height: 1;
        display: flex;
        justify-content: space-between;
      ">
      <span>${escapeHtml(label)}</span>
      <span style="opacity: 0.7;">ONNX</span>
    </div>
  `;
}

export function formatModelLabel(modelVersion: string | null): string {
  if (!modelVersion) return '—';
  // Strip optional timestamp prefix like "20260513_113243_".
  const label = modelVersion.replace(/^\d{8}_\d{6}_/, '');
  // Extract the version tag (v\d+) and the descriptive tail after the
  // "_regression_" or "_binary_" infix. Falls back to the cleaned string.
  const match = label.match(/^(v\d+)_(?:regression|binary)_(.+)$/);
  if (match) {
    return `${match[1]} · ${match[2]}`;
  }
  return label;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
