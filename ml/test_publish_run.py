import json
import tempfile
import unittest
from pathlib import Path

from ml.publish_run import (
    classify_status,
    slugify,
    update_manifest,
    build_index_json,
)


class TestSlugify(unittest.TestCase):
    def test_already_clean(self):
        self.assertEqual(slugify("v3_regression_llm_labels"),
                         "v3_regression_llm_labels")

    def test_replaces_spaces_and_punctuation(self):
        self.assertEqual(slugify("Run A: 2026-05-11"),
                         "run_a_2026_05_11")

    def test_collapses_repeated_underscores(self):
        self.assertEqual(slugify("foo---bar"), "foo_bar")


class TestClassifyStatus(unittest.TestCase):
    def test_healthy_when_gap_small_and_best_late(self):
        epoch_history = [
            {"epoch": 1, "train_loss": 0.40, "val_loss": 0.42},
            {"epoch": 2, "train_loss": 0.32, "val_loss": 0.34},
            {"epoch": 3, "train_loss": 0.28, "val_loss": 0.30},
        ]
        result = classify_status(epoch_history, best_epoch=3)
        self.assertEqual(result["status"], "healthy")

    def test_overfit_when_val_diverges_after_peak(self):
        epoch_history = [
            {"epoch": 1, "train_loss": 0.40, "val_loss": 0.42},
            {"epoch": 2, "train_loss": 0.25, "val_loss": 0.30},  # peak
            {"epoch": 3, "train_loss": 0.18, "val_loss": 0.40},
            {"epoch": 4, "train_loss": 0.10, "val_loss": 0.52},
        ]
        result = classify_status(epoch_history, best_epoch=2)
        self.assertIn(result["status"], {"overfit", "severe_overfit"})

    def test_severe_overfit_when_val_loss_grows_more_than_50pct(self):
        epoch_history = [
            {"epoch": 1, "train_loss": 0.30, "val_loss": 0.30},
            {"epoch": 2, "train_loss": 0.20, "val_loss": 0.28},  # best
            {"epoch": 10, "train_loss": 0.05, "val_loss": 0.55},
        ]
        result = classify_status(epoch_history, best_epoch=2)
        self.assertEqual(result["status"], "severe_overfit")


class TestUpdateManifest(unittest.TestCase):
    def test_inserts_new_run(self):
        manifest = {"schema_version": 1, "generated_at": "", "runs": []}
        entry = {"slug": "run_a", "best_metric_value": 0.8,
                 "published_at": "2026-05-11T00:00:00Z"}
        updated = update_manifest(manifest, entry)
        self.assertEqual(len(updated["runs"]), 1)
        self.assertEqual(updated["runs"][0]["slug"], "run_a")

    def test_replaces_existing_slug(self):
        manifest = {
            "schema_version": 1, "generated_at": "",
            "runs": [
                {"slug": "run_a", "best_metric_value": 0.5,
                 "published_at": "2026-05-09T00:00:00Z"},
                {"slug": "run_b", "best_metric_value": 0.7,
                 "published_at": "2026-05-10T00:00:00Z"},
            ],
        }
        entry = {"slug": "run_a", "best_metric_value": 0.85,
                 "published_at": "2026-05-11T00:00:00Z"}
        updated = update_manifest(manifest, entry)
        slugs = [r["slug"] for r in updated["runs"]]
        self.assertEqual(slugs.count("run_a"), 1)
        a = next(r for r in updated["runs"] if r["slug"] == "run_a")
        self.assertEqual(a["best_metric_value"], 0.85)

    def test_sorts_by_published_at_desc(self):
        manifest = {"schema_version": 1, "generated_at": "", "runs": []}
        manifest = update_manifest(manifest, {
            "slug": "old", "published_at": "2026-05-01T00:00:00Z"})
        manifest = update_manifest(manifest, {
            "slug": "newest", "published_at": "2026-05-11T00:00:00Z"})
        manifest = update_manifest(manifest, {
            "slug": "middle", "published_at": "2026-05-05T00:00:00Z"})
        self.assertEqual(
            [r["slug"] for r in manifest["runs"]],
            ["newest", "middle", "old"],
        )


class TestBuildIndexJson(unittest.TestCase):
    def test_regression_run_real_shape(self):
        """Mirrors the actual eval_report.json / train_summary.json a real
        regression run writes: flat top-level keys + derived_binary_sweep."""
        eval_report = {
            "target_type": "regression",
            "num_samples": 702,
            "mae": 0.197,
            "rmse": 0.367,
            "pearson_r": 0.51,
            "spearman_r": 0.64,
            "r_squared": 0.21,
            "derived_binary_sweep": [
                {"threshold": 0.3, "precision": 0.71, "recall": 0.79, "f1": 0.74},
                {"threshold": 0.5, "precision": 0.51, "recall": 0.72, "f1": 0.60},
            ],
        }
        train_summary = {
            "target_type": "regression",
            "model_name": "resnet18",
            "epochs": 30,
            "epochs_completed": 16,
            "early_stopped_epoch": 16,
            "head_dropout": 0.3,
            "lr_schedule": "cosine",
            "history": [
                {"epoch": 1, "train_loss": 0.44, "val_loss": 0.14, "val_metric": 0.14},
                {"epoch": 7, "train_loss": 0.20, "val_loss": 0.08, "val_metric": 0.08},
                {"epoch": 16, "train_loss": 0.12, "val_loss": 0.09, "val_metric": 0.09},
            ],
        }
        config = {
            "run_name": "v3_regression_llm_labels",
            "model": "resnet18",
            "target_type": "regression",
            "label_source": "llm",
        }

        idx = build_index_json(
            slug="v3_regression_llm_labels",
            eval_report=eval_report,
            train_summary=train_summary,
            config=config,
            published_at="2026-05-11T00:00:00Z",
        )

        self.assertEqual(idx["config_summary"]["target_type"], "regression")
        self.assertAlmostEqual(idx["metrics"]["pearson_r"], 0.51)
        # best row from derived_binary_sweep is the threshold=0.3 row
        self.assertAlmostEqual(idx["metrics"]["best_f1"], 0.74)
        # val_mse derived from rmse**2
        self.assertAlmostEqual(idx["metrics"]["val_mse"], 0.367 ** 2)
        # best epoch picked from history (lowest val_loss = epoch 7)
        self.assertEqual(idx["metrics"]["best_epoch"], 7)
        self.assertEqual(idx["metrics"]["epochs_completed"], 16)
        self.assertEqual(idx["metrics"]["early_stopped_epoch"], 16)

    def test_binary_run_real_shape(self):
        """Real binary run: flat f1/precision/recall + confusion matrix."""
        eval_report = {
            "target_type": "binary",
            "num_samples": 100,
            "precision": 0.85,
            "recall": 0.78,
            "f1": 0.81,
            "confusion": {"tn": 30, "fp": 10, "fn": 12, "tp": 48},
        }
        train_summary = {
            "target_type": "binary",
            "model_name": "resnet18",
            "epochs": 10,
            "train_class_counts": {"0": 40, "1": 60},
            "history": [
                {"epoch": 1, "train_loss": 0.8, "val_loss": 0.6, "val_metric": 0.7},
                {"epoch": 5, "train_loss": 0.4, "val_loss": 0.3, "val_metric": 0.85},
                {"epoch": 10, "train_loss": 0.2, "val_loss": 0.4, "val_metric": 0.81},
            ],
        }
        config = {"run_name": "v2_baseline", "target_type": "binary"}

        idx = build_index_json(
            slug="v2_baseline",
            eval_report=eval_report,
            train_summary=train_summary,
            config=config,
            published_at="2026-05-11T00:00:00Z",
        )

        self.assertEqual(idx["config_summary"]["target_type"], "binary")
        self.assertAlmostEqual(idx["metrics"]["best_f1"], 0.81)
        self.assertAlmostEqual(idx["metrics"]["val_precision"], 0.85)
        self.assertAlmostEqual(idx["metrics"]["val_recall"], 0.78)
        # accuracy from confusion: (tn + tp) / total = (30+48)/100
        self.assertAlmostEqual(idx["metrics"]["val_accuracy"], 0.78)
        # best epoch picked from history (max val_metric = epoch 5)
        self.assertEqual(idx["metrics"]["best_epoch"], 5)
        self.assertEqual(idx["metrics"]["epochs_completed"], 10)
        # class balance falls back to train_class_counts
        self.assertEqual(idx["data"]["class_balance"]["negative"], 40)
        self.assertEqual(idx["data"]["class_balance"]["positive"], 60)


if __name__ == "__main__":
    unittest.main()
