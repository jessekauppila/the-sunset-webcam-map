#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


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


def strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def read_database_url_from_env_file(path: Path) -> str | None:
    if not path.exists():
        return None

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "DATABASE_URL":
            return strip_quotes(value)
    return None


def main() -> None:
    args = parse_args()
    db_url = args.database_url or os.getenv("DATABASE_URL")
    if not db_url:
        db_url = read_database_url_from_env_file(Path(args.env_file))

    if not db_url:
        raise RuntimeError(
            "DATABASE_URL not found. Set --database-url, export DATABASE_URL, "
            "or place DATABASE_URL=... in the env file."
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
