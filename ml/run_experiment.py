#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

from common.io import ensure_dir, utc_timestamp


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run unified ML experiment from one YAML config.")
    parser.add_argument("--config", required=True, help="Path to experiment YAML config.")
    parser.add_argument("--output-root", default="ml/artifacts/experiments")
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


def read_config(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Config must parse to a mapping/object.")
    return data


def cfg_get(cfg: dict[str, Any], key: str, default: Any) -> Any:
    value = cfg.get(key, default)
    return default if value is None else value


def slugify(value: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip())
    return safe.strip("_").lower() or "run"


def run_cmd(cmd: list[str]) -> None:
    print(json.dumps({"cmd": cmd}))
    subprocess.run(cmd, check=True)


def main() -> None:
    args = parse_args()
    config_path = Path(args.config)
    config = read_config(config_path)

    run_cfg = cfg_get(config, "run", {})
    if not isinstance(run_cfg, dict):
        raise ValueError("run section must be an object.")
    run_name = str(cfg_get(run_cfg, "name", config_path.stem))
    run_seed = int(cfg_get(run_cfg, "seed", 20260212))

    root = ensure_dir(args.output_root)
    run_dir = ensure_dir(root / f"{utc_timestamp()}_{slugify(run_name)}")
    dataset_dir = ensure_dir(run_dir / "dataset")
    train_dir = ensure_dir(run_dir / "train")
    eval_dir = ensure_dir(run_dir / "eval")

    shutil.copy2(config_path, run_dir / "config.input.yaml")

    data_cfg = cfg_get(config, "data", {})
    split_cfg = cfg_get(data_cfg, "splits", {})
    model_cfg = cfg_get(config, "model", {})
    imbalance_cfg = cfg_get(config, "imbalance", {})
    aug_cfg = cfg_get(config, "augmentation", {})
    crop_cfg = cfg_get(config, "cropping", {})
    perf_cfg = cfg_get(config, "performance", {})
    subset_cfg = cfg_get(config, "subset", {})
    cache_cfg = cfg_get(config, "image_cache", {})
    eval_cfg = cfg_get(config, "metrics", {})

    export_cmd = [
        sys.executable,
        "ml/export_dataset.py",
        "--label-source",
        str(cfg_get(data_cfg, "label_source", "manual_only")),
        "--target-type",
        str(cfg_get(data_cfg, "target_type", "binary")),
        "--binary-threshold",
        str(cfg_get(data_cfg, "binary_threshold", 4.0)),
        "--min-rating-count",
        str(cfg_get(data_cfg, "min_rating_count", 2)),
        "--seed",
        str(cfg_get(split_cfg, "seed", run_seed)),
        "--train-pct",
        str(cfg_get(split_cfg, "train_pct", 70)),
        "--val-pct",
        str(cfg_get(split_cfg, "val_pct", 15)),
        "--test-pct",
        str(cfg_get(split_cfg, "test_pct", 15)),
        "--output-dir",
        str(dataset_dir),
    ]
    if args.no_progress:
        export_cmd.append("--no-progress")
    run_cmd(export_cmd)

    export_runs = sorted(dataset_dir.glob("*"), key=lambda p: p.name)
    if not export_runs:
        raise RuntimeError("Dataset export did not produce a timestamped output folder.")
    exported_dir = export_runs[-1]
    train_manifest = exported_dir / "manifest_train.csv"
    val_manifest = exported_dir / "manifest_val.csv"
    test_manifest = exported_dir / "manifest_test.csv"

    train_cmd = [
        sys.executable,
        "ml/train.py",
        "--train-manifest",
        str(train_manifest),
        "--val-manifest",
        str(val_manifest),
        "--target-type",
        str(cfg_get(data_cfg, "target_type", "binary")),
        "--model-name",
        str(cfg_get(model_cfg, "name", "resnet18")),
        "--epochs",
        str(cfg_get(model_cfg, "epochs", 10)),
        "--batch-size",
        str(cfg_get(model_cfg, "batch_size", 32)),
        "--learning-rate",
        str(cfg_get(model_cfg, "learning_rate", 1e-4)),
        "--seed",
        str(run_seed),
        "--class-weighting",
        str(cfg_get(imbalance_cfg, "class_weighting", "none")),
        "--sampler",
        str(cfg_get(imbalance_cfg, "sampler", "none")),
        "--augmentation-profile",
        str(cfg_get(aug_cfg, "profile", "light")),
        "--crop-strategy",
        str(cfg_get(crop_cfg, "strategy", "random_resized")),
        "--crop-scale-min",
        str(cfg_get(crop_cfg, "scale_min", 0.8)),
        "--crop-scale-max",
        str(cfg_get(crop_cfg, "scale_max", 1.0)),
        "--output-dir",
        str(train_dir),
    ]
    num_workers = int(cfg_get(perf_cfg, "num_workers", 0))
    train_cmd.extend(["--num-workers", str(num_workers)])
    train_cmd.extend(["--prefetch-factor", str(int(cfg_get(perf_cfg, "prefetch_factor", 2)))])
    if bool(cfg_get(perf_cfg, "pin_memory", False)):
        train_cmd.append("--pin-memory")
    if bool(cfg_get(perf_cfg, "persistent_workers", False)):
        train_cmd.append("--persistent-workers")

    train_cmd.extend(["--max-train-samples", str(int(cfg_get(subset_cfg, "max_train_samples", 0)))])
    train_cmd.extend(["--max-val-samples", str(int(cfg_get(subset_cfg, "max_val_samples", 0)))])

    if bool(cfg_get(cache_cfg, "enabled", False)):
        train_cmd.append("--cache-urls")
        cache_dir = str(cfg_get(cache_cfg, "cache_dir", "ml/artifacts/image_cache"))
        train_cmd.extend(["--cache-dir", cache_dir])
    if bool(cfg_get(cache_cfg, "precache", False)):
        train_cmd.append("--precache-urls")

    class_weighting = str(cfg_get(imbalance_cfg, "class_weighting", "none"))
    manual_weights = cfg_get(imbalance_cfg, "manual_weights", {})
    if class_weighting == "manual":
        if not isinstance(manual_weights, dict):
            raise ValueError("imbalance.manual_weights must be an object for class_weighting=manual.")
        neg = manual_weights.get("neg")
        pos = manual_weights.get("pos")
        if neg is None or pos is None:
            raise ValueError(
                "imbalance.manual_weights.neg and imbalance.manual_weights.pos are required for class_weighting=manual."
            )
        train_cmd.extend(["--manual-class-weight-neg", str(neg)])
        train_cmd.extend(["--manual-class-weight-pos", str(pos)])
    if args.no_progress:
        train_cmd.append("--no-progress")
    run_cmd(train_cmd)

    eval_cmd = [
        sys.executable,
        "ml/evaluate.py",
        "--test-manifest",
        str(test_manifest),
        "--checkpoint",
        str(train_dir / "best.pt"),
        "--target-type",
        str(cfg_get(data_cfg, "target_type", "binary")),
        "--model-name",
        str(cfg_get(model_cfg, "name", "resnet18")),
        "--decision-threshold",
        str(cfg_get(eval_cfg, "decision_threshold", 0.5)),
        "--output",
        str(eval_dir / "eval_report.json"),
    ]
    if bool(cfg_get(eval_cfg, "threshold_sweep", False)):
        eval_cmd.append("--threshold-sweep")
        eval_cmd.extend(["--threshold-sweep-start", str(cfg_get(eval_cfg, "threshold_sweep_start", 0.1))])
        eval_cmd.extend(["--threshold-sweep-end", str(cfg_get(eval_cfg, "threshold_sweep_end", 0.9))])
        eval_cmd.extend(["--threshold-sweep-step", str(cfg_get(eval_cfg, "threshold_sweep_step", 0.1))])
    if args.no_progress:
        eval_cmd.append("--no-progress")
    run_cmd(eval_cmd)

    resolved = {
        "run": {"name": run_name, "seed": run_seed},
        "data": data_cfg,
        "model": model_cfg,
        "imbalance": imbalance_cfg,
        "augmentation": aug_cfg,
        "cropping": crop_cfg,
        "performance": perf_cfg,
        "subset": subset_cfg,
        "image_cache": cache_cfg,
        "metrics": eval_cfg,
        "paths": {
            "run_dir": str(run_dir),
            "dataset_dir": str(exported_dir),
            "train_dir": str(train_dir),
            "eval_dir": str(eval_dir),
            "train_manifest": str(train_manifest),
            "val_manifest": str(val_manifest),
            "test_manifest": str(test_manifest),
            "checkpoint": str(train_dir / "best.pt"),
            "eval_report": str(eval_dir / "eval_report.json"),
        },
    }
    (run_dir / "config.resolved.json").write_text(json.dumps(resolved, indent=2), encoding="utf-8")

    run_manifest = {
        "config_input": str(run_dir / "config.input.yaml"),
        "config_resolved": str(run_dir / "config.resolved.json"),
        "dataset_meta": str(exported_dir / "export_meta.json"),
        "train_summary": str(train_dir / "train_summary.json"),
        "eval_report": str(eval_dir / "eval_report.json"),
    }
    (run_dir / "run_manifest.json").write_text(json.dumps(run_manifest, indent=2), encoding="utf-8")

    print(json.dumps({"ok": True, "run_dir": str(run_dir), "run_manifest": run_manifest}, indent=2))


if __name__ == "__main__":
    main()
