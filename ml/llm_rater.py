#!/usr/bin/env python3
"""
Rate webcam snapshot and external images using a vision LLM.

Sends each image to a vision LLM (Anthropic Claude, Google Gemini, or
OpenAI) and receives a structured JSON rating with a continuous 0.0-1.0
sunset quality score. Compatible with both webcam_snapshots and
external_images tables.

Requires one of (read from shell env or `.env.local` automatically):
  ANTHROPIC_API_KEY  — for Anthropic Claude provider
  GEMINI_API_KEY     — for Gemini provider
  OPENAI_API_KEY     — for OpenAI provider

DATABASE_URL is also auto-loaded from `.env.local` if not set in the shell.

Usage:
  # Dry run with HTML report (default 20 images, opens in browser)
  python3 ml/llm_rater.py --provider anthropic --dry-run

  # Larger dry-run sample for visual sanity-checking
  python3 ml/llm_rater.py --provider anthropic --dry-run --dry-run-count 50

  # Rate all webcam snapshots
  python3 ml/llm_rater.py --provider anthropic --source webcam

  # Rate Flickr-scraped external images
  python3 ml/llm_rater.py --provider anthropic --source external

  # Rate both sources
  python3 ml/llm_rater.py --provider anthropic --source all

  # Resume an interrupted run (skips already-rated images)
  python3 ml/llm_rater.py --provider anthropic --source webcam --skip-rated

  # Write ratings back to the database
  python3 ml/llm_rater.py --provider anthropic --source webcam --write-to-db
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import time
from datetime import datetime, timezone
from html import escape as html_escape
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg2
import psycopg2.extras
import requests
from tqdm.auto import tqdm

from common.io import ensure_dir, get_env_or_file, utc_timestamp

RATING_PROMPT = """Analyze this webcam image and return a JSON object with these fields:

{
  "is_sunset": <boolean — is a sunset or sunrise visible in this image?>,
  "quality": <float 0.0-1.0 — sunset/sunrise quality rating>,
  "confidence": <float 0.0-1.0 — your confidence in this rating>,
  "has_clouds": <boolean — are dramatic clouds adding to the scene?>,
  "color_palette": <string — brief description of dominant sky colors>,
  "obstruction": <string or null — "rain on lens", "fog", "building", or null if clear view>
}

Quality scale:
  0.00 = no sunset/sunrise visible at all (dark, gray, daytime, indoor)
  0.10 = barely any color, mostly gray or overcast
  0.30 = weak sunset, minimal color
  0.50 = decent sunset, some color in the sky
  0.70 = good sunset, vivid colors
  0.85 = great sunset, dramatic sky with rich colors
  0.95 = spectacular, once-in-a-lifetime sunset

Return ONLY the JSON object, no markdown fences, no extra text."""

MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rate images with a vision LLM for sunset quality"
    )
    parser.add_argument(
        "--provider", choices=["anthropic", "gemini", "openai"], default="gemini",
        help="LLM provider to use",
    )
    parser.add_argument(
        "--model", default="",
        help="Model name (defaults: claude-haiku-4-5, gemini-2.0-flash, gpt-4o-mini)",
    )
    parser.add_argument(
        "--source", choices=["webcam", "external", "all"], default="webcam",
        help="Which image source to rate",
    )
    parser.add_argument(
        "--output-csv", default="",
        help="Output CSV path (default: ml/artifacts/llm_ratings/ratings_<timestamp>.csv)",
    )
    parser.add_argument(
        "--database-url", default="",
        help="Postgres connection string (default: DATABASE_URL from env or .env.local)",
    )
    parser.add_argument(
        "--api-key", default="",
        help="LLM API key (default: from ANTHROPIC_API_KEY, GEMINI_API_KEY, "
             "or OPENAI_API_KEY in env or .env.local)",
    )
    parser.add_argument(
        "--env-file", default=".env.local",
        help="Dotenv file to load API keys + DATABASE_URL from when not set "
             "in the shell environment (default: .env.local)",
    )
    parser.add_argument(
        "--rpm", type=int, default=14,
        help="Max requests per minute (default: 14, safe for Gemini free tier)",
    )
    parser.add_argument(
        "--download-timeout", type=float, default=30.0,
        help="Per-image HTTP download timeout in seconds (default: 30)",
    )
    parser.add_argument(
        "--api-timeout", type=float, default=60.0,
        help="Per-image LLM API call timeout in seconds (default: 60)",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Print per-step progress (download / API call / parse) for each image",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Max images to process (0 = all)",
    )
    parser.add_argument(
        "--skip-rated", action="store_true",
        help="Skip images that already have an LLM rating in the database",
    )
    parser.add_argument(
        "--write-to-db", action="store_true",
        help="Write LLM ratings back to the source database table",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Sample N images and generate an HTML report without writing to DB",
    )
    parser.add_argument(
        "--dry-run-count", type=int, default=20,
        help="How many images to rate during --dry-run (default: 20)",
    )
    parser.add_argument(
        "--dry-run-html", default="",
        help="Path for the dry-run HTML report (default: alongside output CSV)",
    )
    parser.add_argument(
        "--dry-run-sample-mode", choices=["sequential", "random", "spread"],
        default="spread",
        help="How to pick dry-run samples: sequential (first N), random, or spread "
             "(evenly spaced across the dataset to see variety)",
    )
    parser.add_argument(
        "--estimate-only", action="store_true",
        help="Count rows and print an estimated $ cost + wall-clock time, "
             "then exit. No LLM API calls are made.",
    )
    parser.add_argument(
        "--sample-tokens", type=int, default=0,
        help="When combined with --estimate-only, download N sample images "
             "(spread across the dataset) and measure their actual dimensions "
             "to compute a much more accurate per-image token count. "
             "Recommended for tiny webcam thumbnails where the default "
             "constants over-estimate cost. (default: 0 = skip)",
    )
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


DEFAULT_MODELS = {
    "anthropic": "claude-haiku-4-5",
    "gemini": "gemini-2.0-flash",
    "openai": "gpt-4o-mini",
}

API_KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openai": "OPENAI_API_KEY",
}

# Approximate USD pricing per million tokens, as of 2026. These are
# only used for the --estimate-only preflight check; actual billing is
# whatever the provider charges. Keys are model-name prefixes; longest
# matching prefix wins. Update freely if pricing changes.
MODEL_PRICING_USD_PER_MTOK: dict[str, dict[str, float]] = {
    # Anthropic
    "claude-haiku-4-5":    {"input": 1.00, "output": 5.00},
    "claude-sonnet-4-5":   {"input": 3.00, "output": 15.00},
    "claude-opus-4":       {"input": 15.00, "output": 75.00},
    "claude-3-5-haiku":    {"input": 0.80, "output": 4.00},
    "claude-3-5-sonnet":   {"input": 3.00, "output": 15.00},
    # Google
    "gemini-2.0-flash":    {"input": 0.075, "output": 0.30},
    "gemini-1.5-flash":    {"input": 0.075, "output": 0.30},
    "gemini-1.5-pro":      {"input": 1.25, "output": 5.00},
    # OpenAI
    "gpt-4o-mini":         {"input": 0.15, "output": 0.60},
    "gpt-4o":              {"input": 2.50, "output": 10.00},
}

# Rough per-image token estimates. Webcam JPEGs are anywhere from
# ~320×240 thumbnails (Windy webcam API) to full ~1024×768 frames, and
# our rating prompt is ~250 tokens. The structured JSON response is
# ~200 output tokens. These constants give a worst-case ballpark; pass
# `--sample-tokens N` to measure real dimensions instead.
TOKENS_PER_IMAGE_INPUT_DEFAULT  = 1500   # 1085 image + ~250 prompt + slack
TOKENS_PER_IMAGE_OUTPUT_DEFAULT = 200
TOKENS_PROMPT_OVERHEAD          = 250    # the RATING_PROMPT, roughly
ANTHROPIC_TOKENS_PER_PIXEL      = 1 / 750.0  # published heuristic


def measure_image_tokens(image_bytes: bytes) -> tuple[int, int, int]:
    """Return (width, height, anthropic_image_tokens) for a JPEG/PNG blob."""
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    img_tokens = max(1, int(w * h * ANTHROPIC_TOKENS_PER_PIXEL))
    return w, h, img_tokens


def estimate_cost_usd(
    model: str,
    n_images: int,
    tokens_in_per_image: int = TOKENS_PER_IMAGE_INPUT_DEFAULT,
    tokens_out_per_image: int = TOKENS_PER_IMAGE_OUTPUT_DEFAULT,
) -> tuple[float, dict | None]:
    """Return (estimated_total_usd, pricing_dict_or_None) for n images.

    Falls back to (0.0, None) when we don't have pricing data for the model.
    """
    pricing = None
    best_prefix_len = 0
    for prefix, rates in MODEL_PRICING_USD_PER_MTOK.items():
        if model.startswith(prefix) and len(prefix) > best_prefix_len:
            pricing = rates
            best_prefix_len = len(prefix)
    if pricing is None:
        return 0.0, None
    in_cost  = n_images * tokens_in_per_image  / 1_000_000 * pricing["input"]
    out_cost = n_images * tokens_out_per_image / 1_000_000 * pricing["output"]
    return in_cost + out_cost, pricing


def resolve_model(provider: str, model: str) -> str:
    if model:
        return model
    return DEFAULT_MODELS[provider]


def resolve_api_key(provider: str, cli_key: str, env_file: str) -> str:
    if cli_key:
        return cli_key
    env_name = API_KEY_ENV[provider]
    key = get_env_or_file(env_name, env_file)
    if not key:
        raise RuntimeError(
            f"No API key found. Set {env_name} in your shell, place "
            f"{env_name}=... in {env_file}, or pass --api-key."
        )
    return key


def resolve_database_url(cli_value: str, env_file: str) -> str:
    if cli_value:
        return cli_value
    return get_env_or_file("DATABASE_URL", env_file)


def download_image_bytes(url: str, timeout: float = 30.0) -> bytes:
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def rate_with_gemini(
    image_bytes: bytes, model: str, api_key: str, timeout: float = 60.0,
) -> dict:
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    gen_model = genai.GenerativeModel(model)

    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    response = gen_model.generate_content(
        [RATING_PROMPT, img],
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.1,
        ),
        request_options={"timeout": timeout},
    )
    return json.loads(response.text)


def rate_with_openai(
    image_bytes: bytes, model: str, api_key: str, timeout: float = 60.0,
) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=api_key, timeout=timeout)
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    response = client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": RATING_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}",
                            "detail": "low",
                        },
                    },
                ],
            }
        ],
        temperature=0.1,
        max_tokens=300,
    )
    return json.loads(response.choices[0].message.content)


def rate_with_anthropic(
    image_bytes: bytes, model: str, api_key: str, timeout: float = 60.0,
) -> dict:
    """Rate via Anthropic Claude API.

    Claude does not have a native JSON response mode, so we strip any
    accidental markdown fences from the response before parsing.
    """
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key, timeout=timeout)
    b64 = base64.b64encode(image_bytes).decode("utf-8")

    response = client.messages.create(
        model=model,
        max_tokens=400,
        temperature=0.1,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": RATING_PROMPT},
                ],
            }
        ],
    )

    text = response.content[0].text.strip()
    # Strip accidental markdown code fences (```json ... ```).
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)


PROVIDER_RATE_FNS = {
    "anthropic": rate_with_anthropic,
    "gemini": rate_with_gemini,
    "openai": rate_with_openai,
}


def rate_image(
    image_bytes: bytes,
    provider: str,
    model: str,
    api_key: str,
    timeout: float = 60.0,
) -> dict:
    """Send image to LLM and return parsed rating dict. Retries on failure."""
    rate_fn = PROVIDER_RATE_FNS[provider]

    for attempt in range(MAX_RETRIES):
        try:
            result = rate_fn(image_bytes, model, api_key, timeout)
            # Validate required fields
            result.setdefault("is_sunset", False)
            result.setdefault("quality", 0.0)
            result.setdefault("confidence", 0.5)
            result.setdefault("has_clouds", False)
            result.setdefault("color_palette", "")
            result.setdefault("obstruction", None)
            result["quality"] = max(0.0, min(1.0, float(result["quality"])))
            result["confidence"] = max(0.0, min(1.0, float(result["confidence"])))
            return result
        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = RETRY_BACKOFF_BASE ** (attempt + 1)
            tqdm.write(
                f"  Retry {attempt + 1}/{MAX_RETRIES} after {wait}s: {exc}"
            )
            time.sleep(wait)

    raise RuntimeError("unreachable")


def fetch_webcam_rows(
    conn: psycopg2.extensions.connection,
    skip_rated: bool,
    limit: int,
) -> list[dict[str, Any]]:
    """Fetch webcam snapshots to rate."""
    where_extra = "AND s.llm_quality IS NULL" if skip_rated else ""
    limit_clause = f"LIMIT {limit}" if limit > 0 else ""

    query = f"""
    SELECT
      s.id AS record_id,
      'webcam' AS source_table,
      s.webcam_id,
      s.firebase_url AS image_url,
      s.calculated_rating AS human_calculated_rating,
      COUNT(r.id)::int AS human_rating_count
    FROM webcam_snapshots s
    LEFT JOIN webcam_snapshot_ratings r ON r.snapshot_id = s.id
    WHERE s.firebase_url IS NOT NULL
      {where_extra}
    GROUP BY s.id, s.webcam_id, s.firebase_url, s.calculated_rating
    ORDER BY s.id
    {limit_clause}
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query)
        return [dict(r) for r in cur.fetchall()]


def fetch_external_rows(
    conn: psycopg2.extensions.connection,
    skip_rated: bool,
    limit: int,
) -> list[dict[str, Any]]:
    """Fetch external (Flickr etc.) images to rate."""
    where_extra = "AND llm_quality IS NULL" if skip_rated else ""
    limit_clause = f"LIMIT {limit}" if limit > 0 else ""

    query = f"""
    SELECT
      id AS record_id,
      'external' AS source_table,
      NULL AS webcam_id,
      COALESCE(image_url, original_url) AS image_url,
      NULL AS human_calculated_rating,
      0 AS human_rating_count
    FROM external_images
    WHERE (image_url IS NOT NULL OR original_url IS NOT NULL)
      {where_extra}
    ORDER BY id
    {limit_clause}
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query)
        return [dict(r) for r in cur.fetchall()]


def sample_rows(
    rows: list[dict[str, Any]],
    count: int,
    mode: str,
    seed: int = 42,
) -> list[dict[str, Any]]:
    """Pick a sample of rows for dry-run rating.

    sequential: first N rows (fastest, but biased)
    random: N rows picked uniformly at random
    spread: N rows evenly spaced across the dataset (best for variety)
    """
    if count >= len(rows):
        return rows

    if mode == "sequential":
        return rows[:count]

    if mode == "random":
        import random
        rng = random.Random(seed)
        return rng.sample(rows, count)

    # spread: evenly spaced indices
    n = len(rows)
    indices = [int(i * n / count) for i in range(count)]
    return [rows[i] for i in indices]


def _agreement_level(quality: float, human_norm: float) -> tuple[str, str, float]:
    """Return (level, color, diff) for a single image's human↔LLM agreement."""
    diff = abs(quality - human_norm)
    if diff < 0.15:
        return "GOOD", "#2e7d32", diff
    if diff < 0.30:
        return "OK", "#ed6c02", diff
    return "DISAGREE", "#c62828", diff


def render_dry_run_html(
    results: list[dict],
    output_path: str,
    provider: str,
    model: str,
) -> None:
    """Generate a self-contained HTML report of dry-run ratings.

    The page sorts by quality (desc) by default and embeds a client-side
    toolbar so a human reviewer can search palette / obstruction text
    and filter by sunset, clouds, obstruction, confidence, and quality
    without re-running the rater. Each card carries `data-*` attributes
    that the JS reads to filter and re-sort in place.
    """
    sorted_results = sorted(
        results,
        key=lambda r: float(r.get("llm_quality") or 0),
        reverse=True,
    )

    cards: list[str] = []
    for r in sorted_results:
        quality = float(r.get("llm_quality") or 0)
        is_sunset = bool(r.get("llm_is_sunset"))
        confidence = float(r.get("llm_confidence") or 0)
        has_clouds = bool(r.get("llm_has_clouds"))
        palette_raw = str(r.get("llm_color_palette") or "")
        obstruction_raw = str(r.get("llm_obstruction") or "")
        human = r.get("human_calculated_rating")
        human_count = int(r.get("human_rating_count") or 0)
        record_id = r.get("record_id", "")
        source = str(r.get("source_table") or "")
        image_url = str(r.get("image_url") or "")

        palette = html_escape(palette_raw)
        obstruction = html_escape(obstruction_raw)

        agreement_html = ""
        agreement_level = "none"
        agreement_diff = -1.0
        human_norm: float | None = None
        if human is not None:
            human_norm = float(human) / 5.0
            level, color, diff = _agreement_level(quality, human_norm)
            agreement_level = level
            agreement_diff = diff
            agreement_html = (
                f'<div class="agreement" style="color:{color};">'
                f'Agreement: {level} (diff {diff:.2f})</div>'
            )

        human_html = (
            f'<div class="human">Human: {float(human):.2f}/5 '
            f'({human_count} rater{"s" if human_count != 1 else ""})</div>'
            if human is not None else
            '<div class="human muted">No human rating</div>'
        )

        bar_pct = int(quality * 100)
        bar_color = (
            "#c62828" if quality < 0.3 else
            "#ed6c02" if quality < 0.6 else
            "#2e7d32"
        )

        # Searchable text blob for the JS search box.
        search_blob = " ".join(
            filter(None, [
                str(record_id),
                source,
                palette_raw,
                obstruction_raw,
                "sunset" if is_sunset else "not-sunset",
                "clouds" if has_clouds else "no-clouds",
                f"agreement-{agreement_level.lower()}",
            ])
        ).lower()
        search_blob = html_escape(search_blob, quote=True)

        cards.append(f"""
        <div class="card"
             data-quality="{quality:.4f}"
             data-confidence="{confidence:.4f}"
             data-is-sunset="{int(is_sunset)}"
             data-has-clouds="{int(has_clouds)}"
             data-obstructed="{int(bool(obstruction_raw))}"
             data-has-human="{int(human is not None)}"
             data-human-norm="{(human_norm if human_norm is not None else -1):.4f}"
             data-agreement="{agreement_level.lower()}"
             data-agreement-diff="{agreement_diff:.4f}"
             data-record-id="{html_escape(str(record_id))}"
             data-source="{html_escape(source)}"
             data-search="{search_blob}">
          <img src="{html_escape(image_url, quote=True)}"
               alt="image {html_escape(str(record_id))}" loading="lazy"/>
          <div class="meta">
            <div class="header">
              <span class="id">#{html_escape(str(record_id))}</span>
              <span class="source">{html_escape(source)}</span>
            </div>
            <div class="quality-row">
              <div class="quality-num" style="color:{bar_color};">{quality:.2f}</div>
              <div class="quality-bar">
                <div class="quality-fill" style="width:{bar_pct}%; background:{bar_color};"></div>
              </div>
            </div>
            <div class="badges">
              <span class="badge {'on' if is_sunset else 'off'}">
                {'sunset' if is_sunset else 'not sunset'}
              </span>
              <span class="badge {'on' if has_clouds else 'off'}">
                {'has clouds' if has_clouds else 'no clouds'}
              </span>
              <span class="badge muted">conf {confidence:.2f}</span>
              {f'<span class="badge obstructed">obstructed</span>' if obstruction_raw else ''}
            </div>
            <div class="palette">{palette}</div>
            {f'<div class="obstruction">obstruction: {obstruction}</div>' if obstruction_raw else ''}
            {human_html}
            {agreement_html}
          </div>
        </div>
        """)

    quality_values = [float(r.get("llm_quality") or 0) for r in sorted_results]
    avg_q = sum(quality_values) / len(quality_values) if quality_values else 0
    sunsets = sum(1 for r in sorted_results if r.get("llm_is_sunset"))
    obstructed_count = sum(1 for r in sorted_results if r.get("llm_obstruction"))
    cloudy_count = sum(1 for r in sorted_results if r.get("llm_has_clouds"))

    # Toolbar JS: pure vanilla, no deps. Reads data-* attrs and toggles
    # display + reorders cards in place. Doubled curly braces escape the
    # f-string interpolation.
    toolbar_js = """
<script>
(function() {
  const grid = document.getElementById('grid');
  const cards = Array.from(grid.querySelectorAll('.card'));
  const counter = document.getElementById('count');
  const total = cards.length;

  const ctrls = {
    search:        document.getElementById('f-search'),
    sunset:        document.getElementById('f-sunset'),
    clouds:        document.getElementById('f-clouds'),
    obstruction:   document.getElementById('f-obstruction'),
    human:         document.getElementById('f-human'),
    minConfidence: document.getElementById('f-min-conf'),
    minQuality:    document.getElementById('f-min-q'),
    sort:          document.getElementById('f-sort'),
  };
  const minConfLabel = document.getElementById('f-min-conf-val');
  const minQLabel    = document.getElementById('f-min-q-val');

  function bool3(value, attr, card) {
    if (value === 'all') return true;
    const want = value === 'yes' ? '1' : '0';
    return card.dataset[attr] === want;
  }

  function apply() {
    const q = (ctrls.search.value || '').trim().toLowerCase();
    const minConf = parseFloat(ctrls.minConfidence.value);
    const minQ = parseFloat(ctrls.minQuality.value);
    minConfLabel.textContent = minConf.toFixed(2);
    minQLabel.textContent = minQ.toFixed(2);

    let visible = 0;
    for (const card of cards) {
      const text = card.dataset.search || '';
      const conf = parseFloat(card.dataset.confidence);
      const qual = parseFloat(card.dataset.quality);

      let show = true;
      if (q && !text.includes(q)) show = false;
      if (show && !bool3(ctrls.sunset.value, 'isSunset', card)) show = false;
      if (show && !bool3(ctrls.clouds.value, 'hasClouds', card)) show = false;
      if (show && !bool3(ctrls.obstruction.value, 'obstructed', card)) show = false;
      if (show && !bool3(ctrls.human.value, 'hasHuman', card)) show = false;
      if (show && conf < minConf) show = false;
      if (show && qual < minQ) show = false;

      card.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    counter.textContent = `${visible} of ${total}`;
  }

  function sortCards() {
    const mode = ctrls.sort.value;
    const cmp = {
      'quality-desc':    (a,b) => b.q - a.q,
      'quality-asc':     (a,b) => a.q - b.q,
      'confidence-desc': (a,b) => b.c - a.c,
      'confidence-asc':  (a,b) => a.c - b.c,
      'agreement-worst': (a,b) => b.d - a.d,
      'record-id':       (a,b) => String(a.r).localeCompare(String(b.r)),
    }[mode] || ((a,b) => b.q - a.q);

    const sorted = cards
      .map(card => ({
        card,
        q: parseFloat(card.dataset.quality),
        c: parseFloat(card.dataset.confidence),
        d: parseFloat(card.dataset.agreementDiff),
        r: card.dataset.recordId,
      }))
      .sort(cmp);
    for (const item of sorted) grid.appendChild(item.card);
  }

  for (const ctrl of Object.values(ctrls)) {
    if (!ctrl) continue;
    const evt = ctrl.tagName === 'INPUT' && (ctrl.type === 'text' || ctrl.type === 'range')
      ? 'input' : 'change';
    ctrl.addEventListener(evt, () => {
      if (ctrl === ctrls.sort) sortCards();
      apply();
    });
  }

  document.getElementById('f-reset').addEventListener('click', () => {
    ctrls.search.value = '';
    ctrls.sunset.value = 'all';
    ctrls.clouds.value = 'all';
    ctrls.obstruction.value = 'all';
    ctrls.human.value = 'all';
    ctrls.minConfidence.value = '0';
    ctrls.minQuality.value = '0';
    ctrls.sort.value = 'quality-desc';
    sortCards();
    apply();
  });

  apply();
})();
</script>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>LLM Rater Dry Run — {html_escape(provider)} / {html_escape(model)}</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; background: #fafafa; margin: 0; padding: 24px; color: #222; }}
  h1 {{ font-size: 22px; margin: 0 0 4px 0; }}
  .summary {{ color: #555; margin-bottom: 16px; font-size: 14px; }}
  .toolbar {{
    background: white; border-radius: 12px; padding: 12px 16px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px 16px; margin-bottom: 16px; align-items: end;
  }}
  .toolbar label {{ display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #555; }}
  .toolbar input[type=text],
  .toolbar select {{
    padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px;
    font-size: 13px; background: white; color: #222;
  }}
  .toolbar input[type=range] {{ width: 100%; }}
  .toolbar .range-label {{ display: flex; justify-content: space-between; font-size: 11px; color: #888; }}
  .toolbar button {{
    padding: 7px 12px; border: 1px solid #ddd; background: #fafafa;
    border-radius: 6px; cursor: pointer; font-size: 13px;
  }}
  .toolbar button:hover {{ background: #eee; }}
  .toolbar .count-row {{ font-size: 13px; color: #333; }}
  .toolbar .count-row strong {{ font-size: 16px; }}

  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }}
  .card {{ background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }}
  .card img {{ width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #eee; display: block; }}
  .meta {{ padding: 12px 14px; }}
  .header {{ display: flex; justify-content: space-between; font-size: 12px; color: #888; margin-bottom: 6px; }}
  .id {{ font-family: monospace; }}
  .source {{ text-transform: uppercase; letter-spacing: 0.5px; }}
  .quality-row {{ display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }}
  .quality-num {{ font-size: 24px; font-weight: 600; min-width: 56px; }}
  .quality-bar {{ flex: 1; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; }}
  .quality-fill {{ height: 100%; }}
  .badges {{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }}
  .badge {{ font-size: 11px; padding: 3px 8px; border-radius: 10px; background: #eee; color: #555; }}
  .badge.on {{ background: #e8f5e9; color: #2e7d32; }}
  .badge.off {{ background: #fafafa; color: #999; }}
  .badge.muted {{ background: #f0f0f0; color: #666; }}
  .badge.obstructed {{ background: #fdecea; color: #c62828; }}
  .palette {{ font-size: 13px; color: #444; margin-bottom: 4px; line-height: 1.4; }}
  .obstruction {{ font-size: 12px; color: #c62828; margin-bottom: 4px; }}
  .human {{ font-size: 12px; color: #555; }}
  .human.muted {{ color: #aaa; }}
  .agreement {{ font-size: 12px; font-weight: 600; margin-top: 2px; }}
</style>
</head>
<body>
  <h1>LLM Rater dry run</h1>
  <div class="summary">
    Provider: <strong>{html_escape(provider)}</strong> &nbsp;
    Model: <strong>{html_escape(model)}</strong> &nbsp;
    Images: <strong>{len(sorted_results)}</strong> &nbsp;
    Sunsets: <strong>{sunsets}</strong> &nbsp;
    Cloudy: <strong>{cloudy_count}</strong> &nbsp;
    Obstructed: <strong>{obstructed_count}</strong> &nbsp;
    Avg quality: <strong>{avg_q:.2f}</strong>
  </div>

  <div class="toolbar">
    <label>Search
      <input type="text" id="f-search" placeholder="palette, obstruction, id…"/>
    </label>
    <label>Is sunset
      <select id="f-sunset">
        <option value="all">all</option>
        <option value="yes">sunset only</option>
        <option value="no">not sunset</option>
      </select>
    </label>
    <label>Has clouds
      <select id="f-clouds">
        <option value="all">all</option>
        <option value="yes">cloudy only</option>
        <option value="no">no clouds</option>
      </select>
    </label>
    <label>Obstruction
      <select id="f-obstruction">
        <option value="all">all</option>
        <option value="yes">obstructed only</option>
        <option value="no">clear only</option>
      </select>
    </label>
    <label>Has human rating
      <select id="f-human">
        <option value="all">all</option>
        <option value="yes">rated by humans</option>
        <option value="no">no human rating</option>
      </select>
    </label>
    <label>Min confidence <span id="f-min-conf-val">0.00</span>
      <input type="range" id="f-min-conf" min="0" max="1" step="0.05" value="0"/>
    </label>
    <label>Min quality <span id="f-min-q-val">0.00</span>
      <input type="range" id="f-min-q" min="0" max="1" step="0.05" value="0"/>
    </label>
    <label>Sort by
      <select id="f-sort">
        <option value="quality-desc">quality (high → low)</option>
        <option value="quality-asc">quality (low → high)</option>
        <option value="confidence-desc">confidence (high → low)</option>
        <option value="confidence-asc">confidence (low → high)</option>
        <option value="agreement-worst">human ↔ LLM disagreement</option>
        <option value="record-id">record id</option>
      </select>
    </label>
    <div class="count-row">
      Showing <strong id="count">{len(sorted_results)} of {len(sorted_results)}</strong>
      <button id="f-reset" type="button" style="margin-left: 8px;">Reset</button>
    </div>
  </div>

  <div class="grid" id="grid">
    {''.join(cards)}
  </div>
  {toolbar_js}
</body>
</html>
"""
    Path(output_path).write_text(html, encoding="utf-8")


DB_UPDATE_COLUMNS = (
    "llm_quality",
    "llm_is_sunset",
    "llm_confidence",
    "llm_has_clouds",
    "llm_color_palette",
    "llm_obstruction",
    "llm_model",
    "llm_provider",
    "llm_rated_at",
)


def _build_db_update_query(table: str) -> str:
    """SQL UPDATE writing every column in DB_UPDATE_COLUMNS by name."""
    set_clauses = ",\n            ".join(
        f"{col} = %({col})s" for col in DB_UPDATE_COLUMNS
    )
    return f"""
    UPDATE {table}
    SET {set_clauses}
    WHERE id = %(id)s
    """


def write_rating_to_db(
    conn: psycopg2.extensions.connection,
    source_table: str,
    record_id: int,
    rating: dict,
    model: str,
    provider: str,
) -> None:
    """Persist the full LLM rating payload back to the source table.

    Requires the schema additions in
    `database/migrations/20260504_add_llm_metadata_columns.sql`. All
    fields are written every time so a re-rate cleanly overwrites the
    prior model's metadata.
    """
    table = "webcam_snapshots" if source_table == "webcam" else "external_images"
    query = _build_db_update_query(table)

    params = {
        "id": record_id,
        "llm_quality": rating["quality"],
        "llm_is_sunset": bool(rating.get("is_sunset", False)),
        "llm_confidence": rating["confidence"],
        "llm_has_clouds": bool(rating.get("has_clouds", False)),
        "llm_color_palette": rating.get("color_palette") or None,
        "llm_obstruction": rating.get("obstruction") or None,
        "llm_model": model,
        "llm_provider": provider,
        "llm_rated_at": datetime.now(timezone.utc),
    }

    with conn.cursor() as cur:
        cur.execute(query, params)
    conn.commit()


def main() -> None:
    args = parse_args()
    model = resolve_model(args.provider, args.model)
    # Estimate-only doesn't make API calls, so skip the API key check.
    api_key = "" if args.estimate_only else resolve_api_key(
        args.provider, args.api_key, args.env_file,
    )
    database_url = resolve_database_url(args.database_url, args.env_file)

    if not database_url:
        raise RuntimeError(
            "DATABASE_URL not found. Pass --database-url, export it, "
            f"or set DATABASE_URL=... in {args.env_file}."
        )

    output_csv = args.output_csv or str(
        Path("ml/artifacts/llm_ratings") / f"ratings_{utc_timestamp()}.csv"
    )
    ensure_dir(Path(output_csv).parent)
    failures_csv = output_csv.replace(".csv", "_failures.csv")

    print(f"LLM Rater", flush=True)
    print(f"  Provider: {args.provider}", flush=True)
    print(f"  Model: {model}", flush=True)
    print(f"  Source: {args.source}", flush=True)
    print(f"  RPM limit: {args.rpm}", flush=True)
    print(f"  Download timeout: {args.download_timeout:.0f}s", flush=True)
    print(f"  API timeout:      {args.api_timeout:.0f}s", flush=True)
    print(f"  Skip rated: {args.skip_rated}", flush=True)
    print(f"  Write to DB: {args.write_to_db}", flush=True)
    print(f"  Dry run: {args.dry_run}", flush=True)
    print(f"  Verbose: {args.verbose}", flush=True)
    print(f"  Output: {output_csv}", flush=True)

    print("Connecting to Postgres…", flush=True)
    conn = psycopg2.connect(database_url)
    print("  connected.", flush=True)

    rows: list[dict[str, Any]] = []
    if args.source in ("webcam", "all"):
        rows.extend(fetch_webcam_rows(conn, args.skip_rated, args.limit))
    if args.source in ("external", "all"):
        ext_limit = max(0, args.limit - len(rows)) if args.limit > 0 else 0
        rows.extend(fetch_external_rows(conn, args.skip_rated, ext_limit))

    if args.dry_run:
        rows = sample_rows(rows, args.dry_run_count, args.dry_run_sample_mode)

    print(f"  Images to rate: {len(rows)}")

    # --- Estimate-only preflight: print cost + time and exit ---
    if args.estimate_only:
        tokens_in_per_image  = TOKENS_PER_IMAGE_INPUT_DEFAULT
        tokens_out_per_image = TOKENS_PER_IMAGE_OUTPUT_DEFAULT
        measured_note = ""

        if args.sample_tokens > 0 and len(rows) > 0:
            sample = sample_rows(rows, args.sample_tokens, "spread")
            print(
                f"\nMeasuring real image dimensions on {len(sample)} sampled "
                f"image{'s' if len(sample) != 1 else ''}…",
                flush=True,
            )
            widths: list[int] = []
            heights: list[int] = []
            img_tokens_list: list[int] = []
            for s_idx, srow in enumerate(sample, start=1):
                try:
                    img_bytes = download_image_bytes(
                        srow["image_url"], timeout=args.download_timeout,
                    )
                    w, h, img_tokens = measure_image_tokens(img_bytes)
                    widths.append(w)
                    heights.append(h)
                    img_tokens_list.append(img_tokens)
                    print(
                        f"  [{s_idx}/{len(sample)}] {w}x{h}px → "
                        f"~{img_tokens} image tokens",
                        flush=True,
                    )
                except Exception as exc:
                    print(
                        f"  [{s_idx}/{len(sample)}] FAILED: {exc} (skipping)",
                        flush=True,
                    )

            if img_tokens_list:
                avg_img_tokens = sum(img_tokens_list) / len(img_tokens_list)
                avg_w = sum(widths) / len(widths)
                avg_h = sum(heights) / len(heights)
                tokens_in_per_image = int(avg_img_tokens + TOKENS_PROMPT_OVERHEAD)
                measured_note = (
                    f"  Measured avg dimensions: {avg_w:.0f}x{avg_h:.0f}px"
                    f" → ~{avg_img_tokens:.0f} image + {TOKENS_PROMPT_OVERHEAD}"
                    f" prompt = {tokens_in_per_image} input tokens/image\n"
                )
            else:
                print(
                    "  No samples succeeded; falling back to default token "
                    "constants.",
                    flush=True,
                )

        total_cost, pricing = estimate_cost_usd(
            model, len(rows),
            tokens_in_per_image=tokens_in_per_image,
            tokens_out_per_image=tokens_out_per_image,
        )
        per_image = (total_cost / len(rows)) if len(rows) else 0
        rpm = args.rpm if args.rpm > 0 else 60
        # Use 5s/image as a conservative wall-clock floor (download + API).
        seconds = max(60.0 / rpm, 5.0) * len(rows)
        hours = seconds / 3600

        print("\n--- Cost estimate (no LLM API calls made) ---", flush=True)
        if pricing is None:
            print(f"  Model: {model} (no pricing data on file)", flush=True)
            print(f"  Rows that would be rated: {len(rows)}", flush=True)
        else:
            print(f"  Model: {model}", flush=True)
            print(
                f"  Pricing: ${pricing['input']:.2f} / MTok input,"
                f" ${pricing['output']:.2f} / MTok output", flush=True,
            )
            if measured_note:
                print(measured_note, end="", flush=True)
            else:
                print(
                    f"  Token assumptions (default): ~{tokens_in_per_image} in,"
                    f" ~{tokens_out_per_image} out per image",
                    flush=True,
                )
                print(
                    "  Tip: pass --sample-tokens 10 to measure real image"
                    " dimensions for a much more accurate cost estimate.",
                    flush=True,
                )
            print(f"  Rows that would be rated: {len(rows)}", flush=True)
            print(f"  Per-image: ~${per_image:.4f}", flush=True)
            print(f"  TOTAL:     ~${total_cost:,.2f}", flush=True)
        print(
            f"  Wall-clock estimate at {rpm} rpm: "
            f"~{hours:.1f}h ({seconds / 60:.0f} min)", flush=True,
        )
        print(
            "  (Costs are approximate. Actual billing depends on the exact "
            "image content and response length.)",
            flush=True,
        )
        conn.close()
        return

    if not rows:
        print("Nothing to rate.")
        conn.close()
        return

    delay = 60.0 / args.rpm if args.rpm > 0 else 0
    results: list[dict] = []
    failures: list[dict] = []

    progress = tqdm(
        rows, desc="Rating", unit="img", disable=args.no_progress,
    )
    for idx, row in enumerate(progress, start=1):
        image_url = row["image_url"]
        record_id = row["record_id"]
        t_start = time.monotonic()

        if args.verbose:
            tqdm.write(
                f"[{idx}/{len(rows)}] record {record_id} downloading {image_url[:80]}…"
            )

        try:
            t0 = time.monotonic()
            image_bytes = download_image_bytes(
                image_url, timeout=args.download_timeout,
            )
            t_download = time.monotonic() - t0

            if args.verbose:
                tqdm.write(
                    f"[{idx}/{len(rows)}] record {record_id} downloaded "
                    f"{len(image_bytes) / 1024:.0f} KB in {t_download:.1f}s, "
                    f"calling {args.provider}…"
                )

            t1 = time.monotonic()
            rating = rate_image(
                image_bytes, args.provider, model, api_key,
                timeout=args.api_timeout,
            )
            t_api = time.monotonic() - t1
            t_total = time.monotonic() - t_start

            tqdm.write(
                f"[{idx}/{len(rows)}] record {record_id}: "
                f"q={rating['quality']:.2f} sunset={rating['is_sunset']} "
                f"conf={rating['confidence']:.2f}  "
                f"(dl {t_download:.1f}s, api {t_api:.1f}s, total {t_total:.1f}s)"
            )

            result = {
                "record_id": record_id,
                "source_table": row["source_table"],
                "webcam_id": row.get("webcam_id"),
                "image_url": image_url,
                "llm_quality": rating["quality"],
                "llm_is_sunset": rating["is_sunset"],
                "llm_confidence": rating["confidence"],
                "llm_has_clouds": rating["has_clouds"],
                "llm_color_palette": rating.get("color_palette", ""),
                "llm_obstruction": rating.get("obstruction"),
                "llm_model": model,
                "llm_provider": args.provider,
                "rated_at": datetime.now(timezone.utc).isoformat(),
                "human_calculated_rating": row.get("human_calculated_rating"),
                "human_rating_count": row.get("human_rating_count", 0),
            }
            results.append(result)

            if not args.dry_run and args.write_to_db:
                write_rating_to_db(
                    conn, row["source_table"], record_id,
                    rating, model, args.provider,
                )

        except Exception as exc:
            failures.append({
                "record_id": record_id,
                "source_table": row["source_table"],
                "image_url": image_url,
                "error": str(exc),
            })
            tqdm.write(
                f"[{idx}/{len(rows)}] FAILED record {record_id} "
                f"after {time.monotonic() - t_start:.1f}s: {exc}"
            )

        if delay > 0:
            time.sleep(delay)

    conn.close()

    html_path: str | None = None
    if args.dry_run and results:
        html_path = args.dry_run_html or str(
            Path(output_csv).with_name(
                f"dry_run_{args.provider}_{utc_timestamp()}.html"
            )
        )
        ensure_dir(Path(html_path).parent)
        render_dry_run_html(results, html_path, args.provider, model)
        print(f"\nDry-run HTML report: {html_path}")
        print(f"Open it with: open '{html_path}'")

    if not args.dry_run and results:
        df = pd.DataFrame(results)
        df.to_csv(output_csv, index=False)
        print(f"\nRatings written to {output_csv}")

    if results and (failures or not args.dry_run):
        # Write failures CSV both in real runs and dry-runs (if any).
        df_fail = pd.DataFrame(failures) if failures else None
        if df_fail is not None:
            df_fail.to_csv(failures_csv, index=False)
            print(f"Failures written to {failures_csv}")

    summary = {
        "provider": args.provider,
        "model": model,
        "source": args.source,
        "total_processed": len(results),
        "total_failures": len(failures),
        "output_csv": output_csv if not args.dry_run else "(dry run)",
        "dry_run_html": html_path,
    }
    print(f"\n--- Summary ---")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
