#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torchvision import models


def build_model(model_name: str, target_type: str):
    if model_name == "mobilenet_v3_small":
        model = models.mobilenet_v3_small(weights=None)
        in_features = model.classifier[-1].in_features
        model.classifier[-1] = torch.nn.Linear(in_features, 1 if target_type == "regression" else 2)
        return model
    model = models.resnet18(weights=None)
    in_features = model.fc.in_features
    model.fc = torch.nn.Linear(in_features, 1 if target_type == "regression" else 2)
    return model


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export PyTorch checkpoint to ONNX")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--model-name", choices=["resnet18", "mobilenet_v3_small"], default="resnet18")
    parser.add_argument("--target-type", choices=["binary", "regression"], default="binary")
    parser.add_argument("--output", default="ml/artifacts/models/model.onnx")
    parser.add_argument("--opset", type=int, default=17)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    model = build_model(args.model_name, args.target_type)
    state = torch.load(args.checkpoint, map_location="cpu")
    model.load_state_dict(state)
    model.eval()

    dummy = torch.randn(1, 3, 224, 224)
    torch.onnx.export(
        model,
        dummy,
        out.as_posix(),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=args.opset,
    )

    # Smoke test with onnxruntime
    sess = ort.InferenceSession(out.as_posix(), providers=["CPUExecutionProvider"])
    ort_out = sess.run(None, {"input": dummy.numpy().astype(np.float32)})

    metadata = {
        "checkpoint": args.checkpoint,
        "model_name": args.model_name,
        "target_type": args.target_type,
        "output": out.as_posix(),
        "sha256": file_sha256(out),
        "opset": args.opset,
        "input_shape": [1, 3, 224, 224],
        "smoke_output_shapes": [list(np.array(x).shape) for x in ort_out],
    }
    meta_path = out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "metadata": metadata}, indent=2))


if __name__ == "__main__":
    main()
