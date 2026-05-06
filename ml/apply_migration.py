#!/usr/bin/env python3
"""
Apply one or more SQL migration files to the project's Postgres database.

Reads DATABASE_URL from `.env.local` (or the shell environment) using the
same loader as `llm_rater.py` and `run_training.py`, so you don't need to
configure psql separately. Each migration is run in its own transaction:
if the SQL fails, that file is rolled back and the script aborts before
touching the next file.

Usage:
  # Apply a single file
  python3 ml/apply_migration.py database/migrations/20260504_add_llm_metadata_columns.sql

  # Apply several in order
  python3 ml/apply_migration.py \\
    database/migrations/20260417_add_llm_quality_to_snapshots.sql \\
    database/migrations/20260504_add_llm_metadata_columns.sql

  # Just check connection + show what would be applied
  python3 ml/apply_migration.py --dry-run database/migrations/*.sql
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common.io import get_env_or_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply one or more SQL migration files to Postgres."
    )
    parser.add_argument("files", nargs="+", help="SQL migration files to apply, in order.")
    parser.add_argument(
        "--database-url", default="",
        help="Postgres connection string (default: DATABASE_URL from env or .env.local)",
    )
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be applied without actually executing the SQL.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db_url = args.database_url or get_env_or_file("DATABASE_URL", args.env_file)
    if not db_url:
        raise SystemExit(
            f"DATABASE_URL not found. Pass --database-url or set it in {args.env_file}."
        )

    paths: list[Path] = []
    for f in args.files:
        p = Path(f)
        if not p.exists():
            raise SystemExit(f"Migration file not found: {p}")
        paths.append(p)

    if args.dry_run:
        print("[dry run] Would apply migrations in this order:")
        for p in paths:
            size = p.stat().st_size
            print(f"  - {p}  ({size} bytes)")
        print("\nNo SQL was executed. Re-run without --dry-run to apply.")
        return

    print(f"Connecting to Postgres…")
    conn = psycopg2.connect(db_url)
    print("  connected.")

    try:
        for p in paths:
            sql = p.read_text(encoding="utf-8")
            print(f"\nApplying {p} ({len(sql)} chars)…")
            with conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
            print(f"  OK: {p.name}")
    finally:
        conn.close()

    print(f"\nDone. {len(paths)} migration(s) applied successfully.")


if __name__ == "__main__":
    main()
