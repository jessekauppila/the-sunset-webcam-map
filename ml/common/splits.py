"""
Deterministic split helpers.

Why this exists:
- We want reproducible train/val/test assignment across runs.
- We also want leakage protection by assigning at webcam-group level.
"""

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class SplitConfig:
    """Single source of truth for split seed and percentages."""

    seed: int = 20260212
    train_pct: int = 70
    val_pct: int = 15
    test_pct: int = 15

    def validate(self) -> None:
        """Fail fast if split percentages are misconfigured."""
        total = self.train_pct + self.val_pct + self.test_pct
        if total != 100:
            raise ValueError(f"Split percentages must sum to 100, got {total}")


def stable_bucket(group_key: str, seed: int) -> int:
    """
    Convert stable ID + seed into bucket [0..99].

    Using a stable hash guarantees the same webcam is assigned to
    the same split every export run.
    """
    digest = hashlib.sha256(f"{group_key}|{seed}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def assign_split(webcam_id: int, config: SplitConfig) -> str:
    """Map webcam group to train/val/test according to configured ratios."""
    config.validate()
    bucket = stable_bucket(str(webcam_id), config.seed)

    if bucket < config.train_pct:
        return "train"
    if bucket < config.train_pct + config.val_pct:
        return "val"
    return "test"
