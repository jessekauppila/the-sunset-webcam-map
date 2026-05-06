"""
Small I/O utilities shared by ML scripts.

These helpers keep export/train/eval scripts consistent and concise.
"""

import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


def utc_timestamp() -> str:
    """Timestamp used for deterministic artifact folder naming."""
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def ensure_dir(path: str | Path) -> Path:
    """Create directory tree if missing and return Path object."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_csv(path: str | Path, rows: Iterable[dict]) -> None:
    """
    Write list-like dict rows to CSV.

    Note: when `rows` is empty we still create the file so downstream
    pipelines can fail with explicit "no data" checks.
    """
    rows = list(rows)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)

    if not rows:
        p.write_text("", encoding="utf-8")
        return

    keys = list(rows[0].keys())
    with p.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: str | Path, payload: dict) -> None:
    """Write pretty JSON file for metadata/report artifacts."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def env_required(name: str) -> str:
    """Read required env var or raise with a clear message."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def read_env_file(path: str | Path = ".env.local") -> dict[str, str]:
    """Parse a dotenv-style file into a dict, ignoring comments/blank lines.

    Used to share secrets between Next.js dev server and Python scripts.
    Does NOT mutate os.environ on its own; callers decide what to do with
    the returned mapping. Lines without `=` are skipped silently.
    """
    p = Path(path)
    if not p.exists():
        return {}

    result: dict[str, str] = {}
    for raw_line in p.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        result[key] = _strip_quotes(value)
    return result


def get_env_or_file(
    name: str,
    env_file: str | Path = ".env.local",
) -> str:
    """Read a variable from os.environ first, falling back to .env.local.

    Returns "" if not found in either place. Caller decides whether
    that is fatal.
    """
    value = os.getenv(name, "")
    if value:
        return value
    return read_env_file(env_file).get(name, "")
