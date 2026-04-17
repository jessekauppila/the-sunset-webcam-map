#!/usr/bin/env python3
"""
Rate webcam snapshot and external images using a vision LLM.

Sends each image to Gemini Flash or GPT-4o-mini and receives a structured
JSON rating with a continuous 0.0-1.0 sunset quality score. Compatible
with both webcam_snapshots and external_images tables.

Requires one of:
  GEMINI_API_KEY   — for Gemini provider
  OPENAI_API_KEY   — for OpenAI provider

Usage:
  # Dry run (5 images, print results, no writes)
  python3 ml/llm_rater.py --provider gemini --dry-run

  # Rate all webcam snapshots
  python3 ml/llm_rater.py --provider gemini --source webcam

  # Rate Flickr-scraped external images
  python3 ml/llm_rater.py --provider gemini --source external

  # Rate both sources
  python3 ml/llm_rater.py --provider gemini --source all

  # Resume an interrupted run (skips already-rated images)
  python3 ml/llm_rater.py --provider gemini --source webcam --skip-rated

  # Write ratings back to the database
  python3 ml/llm_rater.py --provider gemini --source webcam --write-to-db
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg2
import psycopg2.extras
import requests
from tqdm.auto import tqdm

from common.io import ensure_dir, utc_timestamp

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
        "--provider", choices=["gemini", "openai"], default="gemini",
        help="LLM provider to use",
    )
    parser.add_argument(
        "--model", default="",
        help="Model name (default: gemini-2.0-flash or gpt-4o-mini)",
    )
    parser.add_argument(
        "--source", choices=["webcam", "external", "all"], default="webcam",
        help="Which image source to rate",
    )
    parser.add_argument(
        "--output-csv", default="",
        help="Output CSV path (default: ml/artifacts/llm_ratings/ratings_<timestamp>.csv)",
    )
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument(
        "--api-key", default="",
        help="LLM API key (default: from GEMINI_API_KEY or OPENAI_API_KEY env)",
    )
    parser.add_argument(
        "--rpm", type=int, default=14,
        help="Max requests per minute (default: 14, safe for Gemini free tier)",
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
        help="Process 5 images and print results without writing",
    )
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


def resolve_model(provider: str, model: str) -> str:
    if model:
        return model
    return "gemini-2.0-flash" if provider == "gemini" else "gpt-4o-mini"


def resolve_api_key(provider: str, cli_key: str) -> str:
    if cli_key:
        return cli_key
    env_name = "GEMINI_API_KEY" if provider == "gemini" else "OPENAI_API_KEY"
    key = os.getenv(env_name, "")
    if not key:
        raise RuntimeError(
            f"No API key found. Set {env_name} or pass --api-key"
        )
    return key


def download_image_bytes(url: str) -> bytes:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.content


def rate_with_gemini(image_bytes: bytes, model: str, api_key: str) -> dict:
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
    )
    return json.loads(response.text)


def rate_with_openai(image_bytes: bytes, model: str, api_key: str) -> dict:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
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


def rate_image(
    image_bytes: bytes,
    provider: str,
    model: str,
    api_key: str,
) -> dict:
    """Send image to LLM and return parsed rating dict. Retries on failure."""
    rate_fn = rate_with_gemini if provider == "gemini" else rate_with_openai

    for attempt in range(MAX_RETRIES):
        try:
            result = rate_fn(image_bytes, model, api_key)
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
            print(f"  Retry {attempt + 1}/{MAX_RETRIES} after {wait}s: {exc}")
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


def write_rating_to_db(
    conn: psycopg2.extensions.connection,
    source_table: str,
    record_id: int,
    rating: dict,
    model: str,
) -> None:
    """Write LLM rating back to the source table."""
    now = datetime.now(timezone.utc)

    if source_table == "webcam":
        query = """
        UPDATE webcam_snapshots
        SET llm_quality = %(quality)s, llm_model = %(model)s, llm_rated_at = %(rated_at)s
        WHERE id = %(id)s
        """
    else:
        query = """
        UPDATE external_images
        SET llm_quality = %(quality)s,
            llm_confidence = %(confidence)s,
            llm_model = %(model)s,
            llm_rated_at = %(rated_at)s
        WHERE id = %(id)s
        """

    with conn.cursor() as cur:
        cur.execute(query, {
            "quality": rating["quality"],
            "confidence": rating["confidence"],
            "model": model,
            "rated_at": now,
            "id": record_id,
        })
    conn.commit()


def main() -> None:
    args = parse_args()
    model = resolve_model(args.provider, args.model)
    api_key = resolve_api_key(args.provider, args.api_key)

    if not args.database_url:
        raise RuntimeError("DATABASE_URL is required via --database-url or env")

    output_csv = args.output_csv or str(
        Path("ml/artifacts/llm_ratings") / f"ratings_{utc_timestamp()}.csv"
    )
    ensure_dir(Path(output_csv).parent)
    failures_csv = output_csv.replace(".csv", "_failures.csv")

    print(f"LLM Rater")
    print(f"  Provider: {args.provider}")
    print(f"  Model: {model}")
    print(f"  Source: {args.source}")
    print(f"  RPM limit: {args.rpm}")
    print(f"  Skip rated: {args.skip_rated}")
    print(f"  Write to DB: {args.write_to_db}")
    print(f"  Dry run: {args.dry_run}")
    print(f"  Output: {output_csv}")

    conn = psycopg2.connect(args.database_url)

    rows: list[dict[str, Any]] = []
    if args.source in ("webcam", "all"):
        rows.extend(fetch_webcam_rows(conn, args.skip_rated, args.limit))
    if args.source in ("external", "all"):
        ext_limit = max(0, args.limit - len(rows)) if args.limit > 0 else 0
        rows.extend(fetch_external_rows(conn, args.skip_rated, ext_limit))

    if args.dry_run:
        rows = rows[:5]

    print(f"  Images to rate: {len(rows)}")

    if not rows:
        print("Nothing to rate.")
        conn.close()
        return

    delay = 60.0 / args.rpm if args.rpm > 0 else 0
    results: list[dict] = []
    failures: list[dict] = []

    for row in tqdm(rows, desc="Rating", unit="img", disable=args.no_progress):
        image_url = row["image_url"]

        try:
            image_bytes = download_image_bytes(image_url)
            rating = rate_image(image_bytes, args.provider, model, api_key)

            result = {
                "record_id": row["record_id"],
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

            if args.dry_run:
                print(json.dumps({
                    "record_id": result["record_id"],
                    "source": result["source_table"],
                    "quality": result["llm_quality"],
                    "is_sunset": result["llm_is_sunset"],
                    "confidence": result["llm_confidence"],
                    "human_rating": result["human_calculated_rating"],
                }, indent=2))
            elif args.write_to_db:
                write_rating_to_db(
                    conn, row["source_table"], row["record_id"],
                    rating, model,
                )

        except Exception as exc:
            failures.append({
                "record_id": row["record_id"],
                "source_table": row["source_table"],
                "image_url": image_url,
                "error": str(exc),
            })
            print(f"  FAILED record {row['record_id']}: {exc}")

        if delay > 0:
            time.sleep(delay)

    conn.close()

    if not args.dry_run and results:
        df = pd.DataFrame(results)
        df.to_csv(output_csv, index=False)
        print(f"\nRatings written to {output_csv}")

    if not args.dry_run and failures:
        df_fail = pd.DataFrame(failures)
        df_fail.to_csv(failures_csv, index=False)
        print(f"Failures written to {failures_csv}")

    summary = {
        "provider": args.provider,
        "model": model,
        "source": args.source,
        "total_processed": len(results),
        "total_failures": len(failures),
        "output_csv": output_csv if not args.dry_run else "(dry run)",
    }
    print(f"\n--- Summary ---")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
