#!/usr/bin/env python3
from __future__ import annotations

"""
Baseline PyTorch training script for sunset quality model.

Flow:
1) Load train/val manifests
2) Build transfer-learning model
3) Train epoch loop with validation
4) Save best checkpoint + summary artifact
"""

import argparse
import hashlib
import io
import json
import random
import time
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import requests
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from tqdm.auto import tqdm
from torchvision import models, transforms


class ManifestDataset(Dataset):
    """Dataset wrapper around CSV manifest rows."""

    def __init__(
        self,
        csv_path: str,
        transform: Callable,
        target_type: str,
        max_samples: int = 0,
        seed: int = 20260212,
        cache_urls: bool = False,
        cache_dir: str = "",
    ) -> None:
        self.df = pd.read_csv(csv_path)
        if max_samples > 0 and len(self.df) > max_samples:
            # Deterministic sub-sampling for fast pilot runs.
            self.df = self.df.sample(n=max_samples, random_state=seed).reset_index(drop=True)
        self.transform = transform
        self.target_type = target_type
        self.cache_urls = cache_urls
        self.cache_root = Path(cache_dir) if cache_dir else None
        if self.cache_urls and self.cache_root is not None:
            self.cache_root.mkdir(parents=True, exist_ok=True)

    def __len__(self) -> int:
        return len(self.df)

    def _cache_path_for_url(self, image_ref: str) -> Path:
        parsed = urlparse(image_ref)
        ext = Path(parsed.path).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
            ext = ".jpg"
        digest = hashlib.sha256(image_ref.encode("utf-8")).hexdigest()
        return (self.cache_root or Path(".")) / f"{digest}{ext}"

    def url_cache_state(self) -> dict:
        url_series = self.df["image_path_or_url"].astype(str)
        urls = [u for u in url_series.tolist() if u.startswith("http://") or u.startswith("https://")]
        unique_urls = sorted(set(urls))
        if not self.cache_urls or self.cache_root is None:
            return {
                "enabled": False,
                "unique_url_count": len(unique_urls),
                "cached_count": 0,
                "missing_count": len(unique_urls),
            }

        cached_count = 0
        for url in unique_urls:
            if self._cache_path_for_url(url).exists():
                cached_count += 1
        return {
            "enabled": True,
            "cache_dir": str(self.cache_root),
            "unique_url_count": len(unique_urls),
            "cached_count": cached_count,
            "missing_count": len(unique_urls) - cached_count,
        }

    def warm_url_cache(self, show_progress: bool = True) -> dict:
        if not self.cache_urls or self.cache_root is None:
            return {"enabled": False, "downloaded": 0, "failed": 0}
        before = self.url_cache_state()
        url_series = self.df["image_path_or_url"].astype(str)
        urls = [u for u in url_series.tolist() if u.startswith("http://") or u.startswith("https://")]
        unique_urls = sorted(set(urls))
        downloaded = 0
        failed = 0
        for url in tqdm(
            unique_urls,
            desc="Precache URLs",
            unit="url",
            disable=not show_progress,
        ):
            cache_path = self._cache_path_for_url(url)
            if cache_path.exists():
                continue
            try:
                resp = requests.get(url, timeout=20)
                resp.raise_for_status()
                cache_path.write_bytes(resp.content)
                downloaded += 1
            except Exception:
                failed += 1
        after = self.url_cache_state()
        return {
            "enabled": True,
            "downloaded": downloaded,
            "failed": failed,
            "before": before,
            "after": after,
        }

    def load_image(self, image_ref: str) -> Image.Image:
        if image_ref.startswith("http://") or image_ref.startswith("https://"):
            if self.cache_urls and self.cache_root is not None:
                cache_path = self._cache_path_for_url(image_ref)
                if cache_path.exists():
                    return Image.open(cache_path).convert("RGB")
                resp = requests.get(image_ref, timeout=20)
                resp.raise_for_status()
                cache_path.write_bytes(resp.content)
                return Image.open(cache_path).convert("RGB")
            resp = requests.get(image_ref, timeout=20)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
        return Image.open(image_ref).convert("RGB")

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        image = self.load_image(str(row["image_path_or_url"]))
        x = self.transform(image)
        y = float(row["target_label"])
        if self.target_type == "binary":
            y = int(y)
        return x, y


def build_model(model_name: str, target_type: str) -> nn.Module:
    """Build pretrained backbone and replace final layer for target mode."""
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
    parser.add_argument("--seed", type=int, default=20260212)
    parser.add_argument("--class-weighting", choices=["none", "balanced", "manual"], default="none")
    parser.add_argument("--manual-class-weight-neg", type=float)
    parser.add_argument("--manual-class-weight-pos", type=float)
    parser.add_argument("--sampler", choices=["none", "weighted"], default="none")
    parser.add_argument("--augmentation-profile", choices=["off", "light", "medium"], default="light")
    parser.add_argument("--crop-strategy", choices=["random_resized", "center", "resize_only"], default="random_resized")
    parser.add_argument("--crop-scale-min", type=float, default=0.8)
    parser.add_argument("--crop-scale-max", type=float, default=1.0)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--pin-memory", action="store_true")
    parser.add_argument("--prefetch-factor", type=int, default=2)
    parser.add_argument("--persistent-workers", action="store_true")
    parser.add_argument("--max-train-samples", type=int, default=0)
    parser.add_argument("--max-val-samples", type=int, default=0)
    parser.add_argument("--cache-urls", action="store_true")
    parser.add_argument("--cache-dir", default="")
    parser.add_argument("--precache-urls", action="store_true")
    parser.add_argument("--output-dir", default="ml/artifacts/models")
    parser.add_argument("--no-progress", action="store_true")
    args = parser.parse_args()

    if args.target_type != "binary":
        if args.class_weighting != "none":
            parser.error("--class-weighting is only supported for binary target type.")
        if args.sampler != "none":
            parser.error("--sampler weighted is only supported for binary target type.")

    if args.class_weighting == "manual":
        if args.manual_class_weight_neg is None or args.manual_class_weight_pos is None:
            parser.error(
                "--manual-class-weight-neg and --manual-class-weight-pos are required when --class-weighting manual."
            )
        if args.manual_class_weight_neg <= 0 or args.manual_class_weight_pos <= 0:
            parser.error("Manual class weights must be > 0.")

    if args.crop_strategy == "random_resized":
        if not (0 < args.crop_scale_min <= 1 and 0 < args.crop_scale_max <= 1):
            parser.error("crop scales must be in (0, 1].")
        if args.crop_scale_min > args.crop_scale_max:
            parser.error("--crop-scale-min must be <= --crop-scale-max.")

    if args.num_workers < 0:
        parser.error("--num-workers must be >= 0.")
    if args.prefetch_factor <= 0:
        parser.error("--prefetch-factor must be > 0.")
    if args.max_train_samples < 0 or args.max_val_samples < 0:
        parser.error("--max-train-samples/--max-val-samples must be >= 0.")
    if args.precache_urls and not args.cache_urls:
        parser.error("--precache-urls requires --cache-urls.")

    return args


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def build_train_transform(args: argparse.Namespace) -> transforms.Compose:
    ops: list[transforms.Transform] = []
    if args.crop_strategy == "random_resized":
        ops.extend(
            [
                transforms.Resize((256, 256)),
                transforms.RandomResizedCrop(
                    (224, 224),
                    scale=(args.crop_scale_min, args.crop_scale_max),
                ),
            ]
        )
    elif args.crop_strategy == "center":
        ops.extend([transforms.Resize((256, 256)), transforms.CenterCrop((224, 224))])
    else:
        ops.append(transforms.Resize((224, 224)))

    if args.augmentation_profile == "light":
        ops.extend(
            [
                transforms.RandomHorizontalFlip(),
                transforms.ColorJitter(brightness=0.1, contrast=0.1, saturation=0.1),
            ]
        )
    elif args.augmentation_profile == "medium":
        ops.extend(
            [
                transforms.RandomHorizontalFlip(),
                transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
            ]
        )

    ops.append(transforms.ToTensor())
    return transforms.Compose(ops)


def binary_class_counts(df: pd.DataFrame) -> dict[int, int]:
    raw_counts = df["target_label"].astype(int).value_counts().to_dict()
    return {0: int(raw_counts.get(0, 0)), 1: int(raw_counts.get(1, 0))}


def loss_class_weights(args: argparse.Namespace, counts: dict[int, int]) -> list[float] | None:
    if args.class_weighting == "none":
        return None
    if args.class_weighting == "manual":
        return [float(args.manual_class_weight_neg), float(args.manual_class_weight_pos)]

    total = counts[0] + counts[1]
    if counts[0] == 0 or counts[1] == 0:
        return None
    # Balanced weighting: each class contributes similarly to total loss.
    return [total / (2.0 * counts[0]), total / (2.0 * counts[1])]


def build_sampler_if_needed(args: argparse.Namespace, train_df: pd.DataFrame) -> WeightedRandomSampler | None:
    if args.sampler != "weighted":
        return None
    counts = binary_class_counts(train_df)
    if counts[0] == 0 or counts[1] == 0:
        return None
    inv = {0: 1.0 / counts[0], 1: 1.0 / counts[1]}
    sample_weights = train_df["target_label"].astype(int).map(inv).astype(float).tolist()
    return WeightedRandomSampler(
        weights=torch.DoubleTensor(sample_weights),
        num_samples=len(sample_weights),
        replacement=True,
    )


def build_loader(
    dataset: Dataset,
    batch_size: int,
    shuffle: bool,
    sampler: WeightedRandomSampler | None,
    args: argparse.Namespace,
) -> DataLoader:
    kwargs: dict = {
        "batch_size": batch_size,
        "shuffle": shuffle,
        "sampler": sampler,
        "num_workers": args.num_workers,
        "pin_memory": args.pin_memory,
    }
    if args.num_workers > 0:
        kwargs["persistent_workers"] = args.persistent_workers
        kwargs["prefetch_factor"] = args.prefetch_factor
    return DataLoader(dataset, **kwargs)


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    run_start = time.perf_counter()

    train_tf = build_train_transform(args)
    val_tf = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor()])

    train_ds = ManifestDataset(
        args.train_manifest,
        train_tf,
        args.target_type,
        max_samples=args.max_train_samples,
        seed=args.seed,
        cache_urls=args.cache_urls,
        cache_dir=args.cache_dir,
    )
    val_ds = ManifestDataset(
        args.val_manifest,
        val_tf,
        args.target_type,
        max_samples=args.max_val_samples,
        seed=args.seed + 1,
        cache_urls=args.cache_urls,
        cache_dir=args.cache_dir,
    )
    cache_state_before_train = train_ds.url_cache_state()
    cache_state_before_val = val_ds.url_cache_state()
    cache_warmup_train = {"enabled": False}
    cache_warmup_val = {"enabled": False}
    if args.precache_urls:
        cache_warmup_train = train_ds.warm_url_cache(show_progress=not args.no_progress)
        cache_warmup_val = val_ds.warm_url_cache(show_progress=not args.no_progress)

    sampler = build_sampler_if_needed(args, train_ds.df)
    train_loader = build_loader(
        train_ds,
        args.batch_size,
        shuffle=(sampler is None),
        sampler=sampler,
        args=args,
    )
    val_loader = build_loader(
        val_ds,
        args.batch_size,
        shuffle=False,
        sampler=None,
        args=args,
    )

    model = build_model(args.model_name, args.target_type).to(device)
    class_counts = binary_class_counts(train_ds.df) if args.target_type == "binary" else {}
    class_weights = loss_class_weights(args, class_counts) if args.target_type == "binary" else None
    if args.target_type == "binary":
        if class_weights is None:
            criterion = nn.CrossEntropyLoss()
        else:
            criterion = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, dtype=torch.float32, device=device))
    else:
        criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=args.learning_rate)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    best_path = out_dir / "best.pt"

    best_metric = -1.0 if args.target_type == "binary" else float("inf")
    history: list[dict] = []

    epoch_times_sec: list[float] = []
    for epoch in tqdm(
        range(args.epochs),
        desc="Epochs",
        unit="epoch",
        disable=args.no_progress,
    ):
        epoch_start = time.perf_counter()
        # --- training phase ---
        model.train()
        train_loss = 0.0
        for x, y in tqdm(
            train_loader,
            desc=f"Train {epoch + 1}/{args.epochs}",
            unit="batch",
            leave=False,
            disable=args.no_progress,
        ):
            x = x.to(device)
            if args.target_type == "regression":
                y_tensor = y.to(device=device, dtype=torch.float32).unsqueeze(1)
            else:
                y_tensor = y.to(device=device, dtype=torch.long)
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
            for x, y in tqdm(
                val_loader,
                desc=f"Val {epoch + 1}/{args.epochs}",
                unit="batch",
                leave=False,
                disable=args.no_progress,
            ):
                x = x.to(device)
                if args.target_type == "regression":
                    y_tensor = y.to(device=device, dtype=torch.float32).unsqueeze(1)
                    pred = model(x)
                    val_loss += criterion(pred, y_tensor).item()
                    all_pred.extend(pred.squeeze(1).cpu().tolist())
                    all_y.extend(y.cpu().tolist())
                else:
                    y_tensor = y.to(device=device, dtype=torch.long)
                    logits = model(x)
                    val_loss += criterion(logits, y_tensor).item()
                    all_pred.extend(torch.argmax(logits, dim=1).cpu().tolist())
                    all_y.extend(y.cpu().tolist())

        if args.target_type == "binary":
            # For binary v1, use validation F1 as model-selection metric.
            val_metric = f1_score(all_y, all_pred, zero_division=0)
            is_better = val_metric > best_metric
            if is_better:
                best_metric = val_metric
                torch.save(model.state_dict(), best_path)
        else:
            # For regression, lower validation loss is better.
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
        print(
            json.dumps(
                {
                    "epoch": epoch + 1,
                    "train_loss": history[-1]["train_loss"],
                    "val_loss": history[-1]["val_loss"],
                    "val_metric": val_metric,
                }
            )
        )
        epoch_times_sec.append(time.perf_counter() - epoch_start)

    total_runtime_sec = time.perf_counter() - run_start

    summary = {
        "target_type": args.target_type,
        "model_name": args.model_name,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "seed": args.seed,
        "train_manifest": args.train_manifest,
        "val_manifest": args.val_manifest,
        "class_weighting": args.class_weighting,
        "manual_class_weight_neg": args.manual_class_weight_neg,
        "manual_class_weight_pos": args.manual_class_weight_pos,
        "effective_class_weights": class_weights,
        "sampler": args.sampler,
        "augmentation_profile": args.augmentation_profile,
        "crop_strategy": args.crop_strategy,
        "crop_scale_min": args.crop_scale_min,
        "crop_scale_max": args.crop_scale_max,
        "num_workers": args.num_workers,
        "pin_memory": args.pin_memory,
        "prefetch_factor": args.prefetch_factor,
        "persistent_workers": args.persistent_workers,
        "max_train_samples": args.max_train_samples,
        "max_val_samples": args.max_val_samples,
        "cache_urls": args.cache_urls,
        "cache_dir": args.cache_dir if args.cache_urls else None,
        "precache_urls": args.precache_urls,
        "cache_state_before_train": cache_state_before_train,
        "cache_state_before_val": cache_state_before_val,
        "cache_warmup_train": cache_warmup_train,
        "cache_warmup_val": cache_warmup_val,
        "cache_state_after_train": train_ds.url_cache_state(),
        "cache_state_after_val": val_ds.url_cache_state(),
        "train_class_counts": class_counts,
        "train_num_samples": len(train_ds),
        "val_num_samples": len(val_ds),
        "total_runtime_sec": total_runtime_sec,
        "epoch_times_sec": epoch_times_sec,
        "best_metric": best_metric,
        "best_checkpoint": str(best_path),
        "history": history,
    }
    (out_dir / "train_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
