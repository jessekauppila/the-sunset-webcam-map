#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys

from common.io import get_env_or_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run ML experiment while loading DATABASE_URL from .env.local."
    )
    parser.add_argument("--config", required=True, help="Experiment config path.")
    parser.add_argument(
        "--env-file",
        default=".env.local",
        help="Path to env file containing DATABASE_URL (default: .env.local).",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Optional explicit DATABASE_URL override (takes precedence over env file).",
    )
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db_url = args.database_url or get_env_or_file("DATABASE_URL", args.env_file)

    if not db_url:
        raise RuntimeError(
            "DATABASE_URL not found. Set --database-url, export DATABASE_URL, "
            f"or place DATABASE_URL=... in {args.env_file}."
        )

    env = os.environ.copy()
    env["DATABASE_URL"] = db_url

    cmd = [sys.executable, "ml/run_experiment.py", "--config", args.config]
    if args.no_progress:
        cmd.append("--no-progress")
    print({"cmd": cmd, "env_file": args.env_file, "database_url_loaded": True})
    subprocess.run(cmd, check=True, env=env)


if __name__ == "__main__":
    main()
