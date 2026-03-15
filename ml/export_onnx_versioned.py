#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export ONNX to a versioned artifact path from an experiment run."
    )
    parser.add_argument(
        "--run-dir",
        required=True,
        help="Experiment run directory containing train/best.pt.",
    )
    parser.add_argument(
        "--target-type",
        choices=["binary", "regression"],
        required=True,
    )
    parser.add_argument(
        "--model-name",
        choices=["resnet18", "mobilenet_v3_small"],
        default="resnet18",
    )
    parser.add_argument(
        "--artifact-root",
        default="ml/artifacts/models",
        help="Root folder for ONNX artifacts.",
    )
    parser.add_argument(
        "--version-tag",
        default="",
        help=(
            "Optional explicit version tag. Defaults to run-dir basename "
            "(e.g. 20260315_033455_v2_mild_crop_balanced)."
        ),
    )
    parser.add_argument("--opset", type=int, default=17)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_dir = Path(args.run_dir)
    version_tag = args.version_tag.strip() or run_dir.name
    checkpoint = run_dir / "train" / "best.pt"
    if not checkpoint.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint}")

    target_folder = f"{args.target_type}_{args.model_name}"
    output = Path(args.artifact_root) / target_folder / version_tag / "model.onnx"
    output.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "ml/export_onnx.py",
        "--checkpoint",
        checkpoint.as_posix(),
        "--target-type",
        args.target_type,
        "--model-name",
        args.model_name,
        "--output",
        output.as_posix(),
        "--opset",
        str(args.opset),
    ]
    print(json.dumps({"cmd": cmd}))
    subprocess.run(cmd, check=True)

    env_key_path = (
        "AI_ONNX_BINARY_MODEL_PATH"
        if args.target_type == "binary"
        else "AI_ONNX_REGRESSION_MODEL_PATH"
    )
    env_key_version = (
        "AI_BINARY_MODEL_VERSION"
        if args.target_type == "binary"
        else "AI_REGRESSION_MODEL_VERSION"
    )
    print(
        json.dumps(
            {
                "ok": True,
                "version_tag": version_tag,
                "run_dir": run_dir.as_posix(),
                "checkpoint": checkpoint.as_posix(),
                "onnx_output": output.as_posix(),
                "env_hint": {
                    env_key_path: output.as_posix(),
                    env_key_version: version_tag,
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
