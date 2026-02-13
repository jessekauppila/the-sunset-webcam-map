#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import torch
from PIL import Image
from sklearn.metrics import (
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
)
from torch.utils.data import DataLoader, Dataset
from tqdm.auto import tqdm
from torchvision import models, transforms


class EvalDataset(Dataset):
    def __init__(self, csv_path: str, target_type: str) -> None:
        self.df = pd.read_csv(csv_path)
        self.tf = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor()])
        self.target_type = target_type

    def __len__(self) -> int:
        return len(self.df)

    @staticmethod
    def load_image(image_ref: str) -> Image.Image:
        if image_ref.startswith("http://") or image_ref.startswith("https://"):
            resp = requests.get(image_ref, timeout=20)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
        return Image.open(image_ref).convert("RGB")

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        image = self.load_image(str(row["image_path_or_url"]))
        x = self.tf(image)
        y = float(row["target_label"])
        if self.target_type == "binary":
            y = int(y)
        return x, y


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate trained sunset model")
    parser.add_argument("--test-manifest", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--target-type", choices=["binary", "regression"], default="binary")
    parser.add_argument("--model-name", choices=["resnet18", "mobilenet_v3_small"], default="resnet18")
    parser.add_argument(
        "--decision-threshold",
        type=float,
        default=0.5,
        help="Binary positive-class threshold in [0, 1] for converting probabilities to labels.",
    )
    parser.add_argument("--output", default="ml/artifacts/reports/eval_report.json")
    parser.add_argument("--no-progress", action="store_true")
    args = parser.parse_args()
    if args.target_type == "binary" and not (0.0 <= args.decision_threshold <= 1.0):
        parser.error("--decision-threshold must be between 0 and 1 for binary targets.")
    return args


def main() -> None:
    args = parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ds = EvalDataset(args.test_manifest, args.target_type)
    loader = DataLoader(ds, batch_size=32, shuffle=False)

    model = build_model(args.model_name, args.target_type).to(device)
    state = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(state)
    model.eval()

    y_true = []
    y_pred = []
    y_scores = []
    with torch.no_grad():
        for x, y in tqdm(
            loader,
            desc="Evaluating",
            unit="batch",
            disable=args.no_progress,
        ):
            x = x.to(device)
            out = model(x)
            if args.target_type == "regression":
                pred = out.squeeze(1).cpu().numpy()
                y_pred.extend(pred.tolist())
                y_true.extend(y.cpu().tolist())
            else:
                probs = torch.softmax(out, dim=1)[:, 1].cpu().numpy()
                pred = (probs >= args.decision_threshold).astype(int)
                y_scores.extend(probs.tolist())
                y_pred.extend(pred.tolist())
                y_true.extend(y.cpu().tolist())

    report = {"target_type": args.target_type, "num_samples": len(y_true)}
    if args.target_type == "binary":
        report["decision_threshold"] = args.decision_threshold
        report["precision"] = precision_score(y_true, y_pred, zero_division=0)
        report["recall"] = recall_score(y_true, y_pred, zero_division=0)
        report["f1"] = f1_score(y_true, y_pred, zero_division=0)
        report["auc"] = roc_auc_score(y_true, y_scores) if len(set(y_true)) > 1 else None
    else:
        report["mae"] = mean_absolute_error(y_true, y_pred)
        report["rmse"] = float(np.sqrt(mean_squared_error(y_true, y_pred)))

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "report": report, "output": str(out)}, indent=2))


if __name__ == "__main__":
    main()
