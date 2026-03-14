#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare multiple experiment run folders.")
    parser.add_argument(
        "--run-dirs",
        nargs="+",
        required=True,
        help="Experiment directories containing run_manifest.json",
    )
    parser.add_argument("--output-json", default="ml/artifacts/reports/experiment_compare.json")
    parser.add_argument("--output-csv", default="ml/artifacts/reports/experiment_compare.csv")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def flatten_run(run_dir: Path) -> dict[str, Any]:
    manifest = read_json(run_dir / "run_manifest.json")
    resolved = read_json(Path(manifest["config_resolved"]))
    eval_report = read_json(Path(manifest["eval_report"]))
    train_summary = read_json(Path(manifest["train_summary"]))

    row: dict[str, Any] = {
        "run_dir": str(run_dir),
        "run_name": resolved.get("run", {}).get("name"),
        "seed": resolved.get("run", {}).get("seed"),
        "target_type": eval_report.get("target_type"),
        "model_name": train_summary.get("model_name"),
        "epochs": train_summary.get("epochs"),
        "batch_size": train_summary.get("batch_size"),
        "learning_rate": train_summary.get("learning_rate"),
        "crop_strategy": train_summary.get("crop_strategy"),
        "augmentation_profile": train_summary.get("augmentation_profile"),
        "class_weighting": train_summary.get("class_weighting"),
        "sampler": train_summary.get("sampler"),
        "best_metric": train_summary.get("best_metric"),
    }

    if eval_report.get("target_type") == "binary":
        row.update(
            {
                "decision_threshold": eval_report.get("decision_threshold"),
                "precision": eval_report.get("precision"),
                "recall": eval_report.get("recall"),
                "f1": eval_report.get("f1"),
                "auc": eval_report.get("auc"),
                "balanced_accuracy": eval_report.get("balanced_accuracy"),
                "tp": eval_report.get("confusion", {}).get("tp"),
                "tn": eval_report.get("confusion", {}).get("tn"),
                "fp": eval_report.get("confusion", {}).get("fp"),
                "fn": eval_report.get("confusion", {}).get("fn"),
            }
        )
    else:
        row.update({"mae": eval_report.get("mae"), "rmse": eval_report.get("rmse")})
    return row


def main() -> None:
    args = parse_args()
    rows = [flatten_run(Path(d)) for d in args.run_dirs]

    json_path = Path(args.output_json)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps({"runs": rows}, indent=2), encoding="utf-8")

    csv_path = Path(args.output_csv)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    keys = sorted({k for row in rows for k in row.keys()})
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)

    print(json.dumps({"ok": True, "output_json": str(json_path), "output_csv": str(csv_path)}, indent=2))


if __name__ == "__main__":
    main()
