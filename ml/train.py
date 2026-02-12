#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable

import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms


class ManifestDataset(Dataset):
    def __init__(self, csv_path: str, transform: Callable, target_type: str) -> None:
        self.df = pd.read_csv(csv_path)
        self.transform = transform
        self.target_type = target_type

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        image = Image.open(row["image_path_or_url"]).convert("RGB")
        x = self.transform(image)
        y = float(row["target_label"])
        if self.target_type == "binary":
            y = int(y)
        return x, y


def build_model(model_name: str, target_type: str) -> nn.Module:
    if model_name == "mobilenet_v3_small":
        model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        in_features = model.classifier[-1].in_features
        out_features = 1 if target_type == "regression" else 2
        model.classifier[-1] = nn.Linear(in_features, out_features)
        return model

    model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
    in_features = model.fc.in_features
    out_features = 1 if target_type == "regression" else 2
    model.fc = nn.Linear(in_features, out_features)
    return model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train V2 sunset model")
    parser.add_argument("--train-manifest", required=True)
    parser.add_argument("--val-manifest", required=True)
    parser.add_argument("--target-type", choices=["binary", "regression"], default="binary")
    parser.add_argument("--model-name", choices=["resnet18", "mobilenet_v3_small"], default="resnet18")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--output-dir", default="ml/artifacts/models")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_tf = transforms.Compose(
        [
            transforms.Resize((256, 256)),
            transforms.RandomResizedCrop((224, 224), scale=(0.8, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1),
            transforms.ToTensor(),
        ]
    )
    val_tf = transforms.Compose(
        [transforms.Resize((224, 224)), transforms.ToTensor()]
    )

    train_ds = ManifestDataset(args.train_manifest, train_tf, args.target_type)
    val_ds = ManifestDataset(args.val_manifest, val_tf, args.target_type)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    model = build_model(args.model_name, args.target_type).to(device)
    criterion = (
        nn.MSELoss() if args.target_type == "regression" else nn.CrossEntropyLoss()
    )
    optimizer = optim.Adam(model.parameters(), lr=args.learning_rate)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    best_path = out_dir / "best.pt"

    best_metric = -1.0 if args.target_type == "binary" else float("inf")
    history: list[dict] = []

    for epoch in range(args.epochs):
        model.train()
        train_loss = 0.0
        for x, y in train_loader:
            x = x.to(device)
            if args.target_type == "regression":
                y_tensor = torch.tensor(y, dtype=torch.float32, device=device).unsqueeze(1)
            else:
                y_tensor = torch.tensor(y, dtype=torch.long, device=device)
            optimizer.zero_grad()
            pred = model(x)
            loss = criterion(pred, y_tensor)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()

        model.eval()
        val_loss = 0.0
        all_y = []
        all_pred = []
        with torch.no_grad():
            for x, y in val_loader:
                x = x.to(device)
                if args.target_type == "regression":
                    y_tensor = torch.tensor(y, dtype=torch.float32, device=device).unsqueeze(1)
                    pred = model(x)
                    val_loss += criterion(pred, y_tensor).item()
                    all_pred.extend(pred.squeeze(1).cpu().tolist())
                    all_y.extend(list(y))
                else:
                    y_tensor = torch.tensor(y, dtype=torch.long, device=device)
                    logits = model(x)
                    val_loss += criterion(logits, y_tensor).item()
                    all_pred.extend(torch.argmax(logits, dim=1).cpu().tolist())
                    all_y.extend(list(y))

        if args.target_type == "binary":
            val_metric = f1_score(all_y, all_pred, zero_division=0)
            is_better = val_metric > best_metric
            if is_better:
                best_metric = val_metric
                torch.save(model.state_dict(), best_path)
        else:
            val_metric = val_loss / max(1, len(val_loader))
            is_better = val_metric < best_metric
            if is_better:
                best_metric = val_metric
                torch.save(model.state_dict(), best_path)

        history.append(
            {
                "epoch": epoch + 1,
                "train_loss": train_loss / max(1, len(train_loader)),
                "val_loss": val_loss / max(1, len(val_loader)),
                "val_metric": val_metric,
            }
        )

    summary = {
        "target_type": args.target_type,
        "model_name": args.model_name,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "best_metric": best_metric,
        "best_checkpoint": str(best_path),
        "history": history,
    }
    (out_dir / "train_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
