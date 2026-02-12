import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class SplitConfig:
    seed: int = 20260212
    train_pct: int = 70
    val_pct: int = 15
    test_pct: int = 15

    def validate(self) -> None:
        total = self.train_pct + self.val_pct + self.test_pct
        if total != 100:
            raise ValueError(f"Split percentages must sum to 100, got {total}")


def stable_bucket(group_key: str, seed: int) -> int:
    digest = hashlib.sha256(f"{group_key}|{seed}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def assign_split(webcam_id: int, config: SplitConfig) -> str:
    config.validate()
    bucket = stable_bucket(str(webcam_id), config.seed)

    if bucket < config.train_pct:
        return "train"
    if bucket < config.train_pct + config.val_pct:
        return "val"
    return "test"
