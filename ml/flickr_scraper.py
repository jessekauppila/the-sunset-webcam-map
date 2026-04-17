#!/usr/bin/env python3
"""
Scrape sunset/sunrise images from Flickr for ML training data.

Downloads Creative-Commons-licensed images, uploads them to Firebase Storage,
and records metadata in the external_images Postgres table.

Requires:
  FLICKR_API_KEY      — free key from https://www.flickr.com/services/apps/create/
  DATABASE_URL        — Postgres connection string
  FIREBASE_STORAGE_BUCKET — GCS bucket name (e.g. sunrisesunset-32a25.firebasestorage.app)

Usage:
  # Preview what would be scraped (no downloads)
  python3 ml/flickr_scraper.py --query sunset --max-images 100 --dry-run

  # Scrape sunsets
  python3 ml/flickr_scraper.py --query sunset --max-images 2000

  # Scrape negative examples
  python3 ml/flickr_scraper.py --query "cloudy sky" --max-images 500 --category negative

  # Scrape multiple queries
  python3 ml/flickr_scraper.py \
    --query sunset sunrise "golden hour" "sky colors" \
    --max-images 1000

  # Resume interrupted scrape (skips already-downloaded images)
  python3 ml/flickr_scraper.py --query sunset --max-images 2000
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests
from tqdm.auto import tqdm

# Flickr license IDs that are Creative Commons or public domain.
# See https://www.flickr.com/services/api/flickr.photos.licenses.getInfo.html
CC_LICENSE_IDS = {
    1: "cc-by-nc-sa-2.0",
    2: "cc-by-nc-2.0",
    3: "cc-by-nc-nd-2.0",
    4: "cc-by-2.0",
    5: "cc-by-sa-2.0",
    6: "cc-by-nd-2.0",
    7: "no-known-restrictions",
    8: "us-govt",
    9: "cc0-1.0",
    10: "public-domain-mark",
}

# Default: only fully open licenses (no NC/ND restrictions).
DEFAULT_LICENSE_IDS = "4,5,9,10"

FLICKR_REST_URL = "https://www.flickr.com/services/rest/"

# Minimum delay between Flickr API calls (seconds).
API_DELAY = 1.0


def flickr_api_call(api_key: str, method: str, **params: str | int) -> dict:
    """Make a Flickr REST API call and return the parsed JSON response."""
    params.update({
        "method": method,
        "api_key": api_key,
        "format": "json",
        "nojsoncallback": 1,
    })
    resp = requests.get(FLICKR_REST_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if data.get("stat") != "ok":
        raise RuntimeError(f"Flickr API error: {data}")
    return data


def search_photos(
    api_key: str,
    query: str,
    license_ids: str,
    sort: str,
    per_page: int,
    page: int,
) -> dict:
    """Search Flickr for photos matching the query."""
    return flickr_api_call(
        api_key,
        "flickr.photos.search",
        text=query,
        license=license_ids,
        sort=sort,
        per_page=per_page,
        page=page,
        content_type=1,  # photos only (no screenshots/illustrations)
        media="photos",
        extras="url_l,url_c,url_z,tags,description,owner_name,license,"
               "o_dims,date_taken",
    )


def get_best_image_url(photo: dict) -> tuple[str, int, int] | None:
    """Pick the best available size URL from a photo record.

    Preference: url_l (1024px) > url_c (800px) > url_z (640px).
    Returns (url, width, height) or None if no suitable URL.
    """
    for suffix in ("l", "c", "z"):
        url_key = f"url_{suffix}"
        w_key = f"width_{suffix}"
        h_key = f"height_{suffix}"
        if photo.get(url_key):
            return (
                photo[url_key],
                int(photo.get(w_key, 0)),
                int(photo.get(h_key, 0)),
            )
    return None


def download_image(url: str, max_retries: int = 3) -> bytes:
    """Download image bytes with retry."""
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, timeout=60)
            resp.raise_for_status()
            return resp.content
        except (requests.RequestException, IOError) as exc:
            if attempt == max_retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  Download retry {attempt + 1}/{max_retries} after {wait}s: {exc}")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def upload_to_firebase(
    image_bytes: bytes,
    firebase_path: str,
    bucket_name: str,
) -> str:
    """Upload image bytes to Firebase Storage and return the public URL.

    Uses firebase-admin SDK if available, otherwise falls back to saving
    locally under ml/artifacts/external_images/.
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, storage

        if not firebase_admin._apps:
            cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            if cred_path:
                cred = credentials.Certificate(cred_path)
            else:
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {"storageBucket": bucket_name})

        bucket = storage.bucket()
        blob = bucket.blob(firebase_path)
        blob.upload_from_string(image_bytes, content_type="image/jpeg")
        blob.make_public()
        return blob.public_url

    except (ImportError, Exception) as exc:
        # Fallback: save locally when Firebase SDK is unavailable.
        local_root = Path("ml/artifacts/external_images")
        local_path = local_root / firebase_path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(image_bytes)
        print(f"  [fallback] Saved locally (no Firebase): {local_path}  ({exc})")
        return str(local_path)


def image_already_exists(
    cur: psycopg2.extensions.cursor,
    source: str,
    source_id: str,
) -> bool:
    """Check if we already scraped this image."""
    cur.execute(
        "SELECT 1 FROM external_images WHERE source = %s AND source_id = %s",
        (source, source_id),
    )
    return cur.fetchone() is not None


def insert_image_record(
    cur: psycopg2.extensions.cursor,
    *,
    source: str,
    source_id: str,
    image_url: str,
    firebase_path: str,
    original_url: str,
    license_str: str,
    title: str | None,
    description: str | None,
    tags: list[str],
    owner: str | None,
    width: int,
    height: int,
    category: str,
) -> None:
    """Insert a row into external_images."""
    cur.execute(
        """
        INSERT INTO external_images (
          source, source_id, image_url, firebase_path, original_url,
          license, title, description, tags, owner,
          width, height, category
        ) VALUES (
          %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s,
          %s, %s, %s
        )
        ON CONFLICT (source, source_id) DO NOTHING
        """,
        (
            source, source_id, image_url, firebase_path, original_url,
            license_str, title, description, tags, owner,
            width, height, category,
        ),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape sunset images from Flickr for ML training"
    )
    parser.add_argument(
        "--query", nargs="+", required=True,
        help="Search terms (e.g. sunset sunrise 'golden hour')",
    )
    parser.add_argument(
        "--max-images", type=int, default=500,
        help="Maximum total images to download across all queries",
    )
    parser.add_argument(
        "--category", default="sunset",
        choices=["sunset", "negative"],
        help="Category label for these images",
    )
    parser.add_argument(
        "--license-ids", default=DEFAULT_LICENSE_IDS,
        help=f"Comma-separated Flickr license IDs (default: {DEFAULT_LICENSE_IDS})",
    )
    parser.add_argument(
        "--sort", default="interestingness-desc",
        choices=[
            "interestingness-desc", "relevance",
            "date-posted-desc", "date-taken-desc",
        ],
        help="Flickr search sort order",
    )
    parser.add_argument(
        "--per-page", type=int, default=100,
        help="Results per Flickr API page (max 500)",
    )
    parser.add_argument(
        "--database-url", default=os.getenv("DATABASE_URL"),
        help="Postgres connection string",
    )
    parser.add_argument(
        "--firebase-bucket",
        default=os.getenv("FIREBASE_STORAGE_BUCKET", ""),
        help="Firebase Storage bucket name",
    )
    parser.add_argument(
        "--flickr-api-key",
        default=os.getenv("FLICKR_API_KEY", ""),
        help="Flickr API key",
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview results without downloading or inserting")
    parser.add_argument("--local-only", action="store_true",
                        help="Save images locally instead of uploading to Firebase")
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


def run_scrape(args: argparse.Namespace) -> dict:
    """Execute the scraping pipeline. Returns a summary dict."""
    api_key = args.flickr_api_key
    if not api_key:
        print("ERROR: FLICKR_API_KEY is required. Get one at "
              "https://www.flickr.com/services/apps/create/apply")
        sys.exit(1)

    if not args.dry_run:
        if not args.database_url:
            print("ERROR: DATABASE_URL is required (or pass --database-url)")
            sys.exit(1)

    stats = {
        "queries": args.query,
        "max_images": args.max_images,
        "category": args.category,
        "downloaded": 0,
        "skipped_existing": 0,
        "skipped_no_url": 0,
        "errors": 0,
        "dry_run": args.dry_run,
    }

    conn = None
    if not args.dry_run:
        conn = psycopg2.connect(args.database_url)
        conn.autocommit = False

    total_downloaded = 0
    images_per_query = max(1, args.max_images // len(args.query))

    try:
        for query in args.query:
            if total_downloaded >= args.max_images:
                break

            remaining = min(images_per_query, args.max_images - total_downloaded)
            print(f"\n--- Searching Flickr for '{query}' "
                  f"(target: {remaining} images) ---")

            query_downloaded = 0
            page = 1
            max_pages = (remaining // args.per_page) + 2

            while query_downloaded < remaining and page <= max_pages:
                time.sleep(API_DELAY)

                try:
                    result = search_photos(
                        api_key, query, args.license_ids,
                        args.sort, args.per_page, page,
                    )
                except Exception as exc:
                    print(f"  Search error on page {page}: {exc}")
                    stats["errors"] += 1
                    break

                photos = result.get("photos", {}).get("photo", [])
                total_pages = int(result.get("photos", {}).get("pages", 0))

                if not photos:
                    print(f"  No more results (page {page})")
                    break

                if page == 1:
                    total_available = int(
                        result.get("photos", {}).get("total", 0)
                    )
                    print(f"  Found {total_available} total results, "
                          f"processing up to {remaining}")

                pbar = tqdm(
                    photos,
                    desc=f"  Page {page}/{total_pages}",
                    disable=args.no_progress,
                    leave=False,
                )

                for photo in pbar:
                    if query_downloaded >= remaining:
                        break

                    photo_id = str(photo["id"])

                    url_info = get_best_image_url(photo)
                    if not url_info:
                        stats["skipped_no_url"] += 1
                        continue
                    img_url, width, height = url_info

                    if args.dry_run:
                        title = photo.get("title", "")[:60]
                        print(f"    [dry-run] {photo_id}: {title} "
                              f"({width}x{height})")
                        query_downloaded += 1
                        total_downloaded += 1
                        stats["downloaded"] += 1
                        continue

                    cur = conn.cursor()
                    if image_already_exists(cur, "flickr", photo_id):
                        stats["skipped_existing"] += 1
                        cur.close()
                        continue

                    try:
                        image_bytes = download_image(img_url)

                        firebase_path = (
                            f"external_images/flickr/{photo_id}.jpg"
                        )

                        if args.local_only:
                            local_dir = Path("ml/artifacts/external_images")
                            local_path = local_dir / f"flickr/{photo_id}.jpg"
                            local_path.parent.mkdir(parents=True, exist_ok=True)
                            local_path.write_bytes(image_bytes)
                            stored_url = str(local_path)
                        else:
                            stored_url = upload_to_firebase(
                                image_bytes, firebase_path,
                                args.firebase_bucket,
                            )

                        license_id = int(photo.get("license", 0))
                        license_str = CC_LICENSE_IDS.get(
                            license_id, f"unknown-{license_id}"
                        )

                        raw_tags = photo.get("tags", "")
                        tag_list = (
                            [t.strip() for t in raw_tags.split() if t.strip()]
                            if isinstance(raw_tags, str)
                            else []
                        )

                        desc_content = photo.get("description", {})
                        if isinstance(desc_content, dict):
                            desc_content = desc_content.get("_content", "")

                        insert_image_record(
                            cur,
                            source="flickr",
                            source_id=photo_id,
                            image_url=stored_url,
                            firebase_path=firebase_path,
                            original_url=img_url,
                            license_str=license_str,
                            title=photo.get("title"),
                            description=desc_content[:1000] if desc_content else None,
                            tags=tag_list,
                            owner=photo.get("ownername"),
                            width=width,
                            height=height,
                            category=args.category,
                        )

                        conn.commit()
                        query_downloaded += 1
                        total_downloaded += 1
                        stats["downloaded"] += 1

                    except Exception as exc:
                        conn.rollback()
                        stats["errors"] += 1
                        print(f"    Error on {photo_id}: {exc}")
                    finally:
                        cur.close()

                page += 1

            print(f"  '{query}': downloaded {query_downloaded} images")

    finally:
        if conn:
            conn.close()

    return stats


def main() -> None:
    args = parse_args()
    print("Flickr Scraper")
    print(f"  Queries: {args.query}")
    print(f"  Max images: {args.max_images}")
    print(f"  Category: {args.category}")
    print(f"  Sort: {args.sort}")
    print(f"  Licenses: {args.license_ids}")
    print(f"  Dry run: {args.dry_run}")
    print(f"  Local only: {args.local_only}")

    stats = run_scrape(args)

    print("\n--- Summary ---")
    print(json.dumps(stats, indent=2))

    summary_path = Path("ml/artifacts/scraper_runs")
    summary_path.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    summary_file = summary_path / f"flickr_{ts}.json"
    summary_file.write_text(json.dumps(stats, indent=2))
    print(f"\nRun summary saved to {summary_file}")


if __name__ == "__main__":
    main()
