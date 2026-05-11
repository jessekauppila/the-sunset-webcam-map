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
    def test_minimal_regression_run(self):
        eval_report = {
            "target_type": "regression",
            "metrics": {
                "pearson_r": 0.82,
                "spearman_r": 0.81,
                "r_squared": 0.67,
                "val_mse": 0.041,
                "binary_threshold_sweep": {"best_f1": 0.847, "threshold": 0.5},
            },
            "data": {
                "train_samples": 3284, "val_samples": 723, "test_samples": 731,
                "class_balance": {"negative": 2638, "positive": 646},
            },
        }
        train_summary = {
            "epochs_completed": 12,
            "early_stopped_epoch": 12,
            "best_epoch": 7,
            "epoch_history": [
                {"epoch": 1, "train_loss": 0.4, "val_loss": 0.4},
                {"epoch": 7, "train_loss": 0.2, "val_loss": 0.22},
                {"epoch": 12, "train_loss": 0.15, "val_loss": 0.23},
            ],
        }
        config = {
            "run_name": "v3_regression_llm_labels",
            "model": "resnet18",
            "target_type": "regression",
            "epochs": 15,
            "lr_schedule": "cosine",
            "early_stopping_patience": 5,
            "head_dropout": 0.3,
            "class_weighting": "balanced",
            "label_source": "llm",
        }

        idx = build_index_json(
            slug="v3_regression_llm_labels",
            eval_report=eval_report,
            train_summary=train_summary,
            config=config,
            published_at="2026-05-11T00:00:00Z",
        )

        self.assertEqual(idx["schema_version"], 1)
        self.assertEqual(idx["slug"], "v3_regression_llm_labels")
        self.assertEqual(idx["config_summary"]["target_type"], "regression")
        self.assertAlmostEqual(idx["metrics"]["pearson_r"], 0.82)
        self.assertAlmostEqual(idx["metrics"]["best_f1"], 0.847)
        self.assertIn(idx["diagnosis"]["status"],
                      {"healthy", "mild_overfit", "overfit", "severe_overfit"})
        self.assertEqual(idx["data"]["class_balance"]["ratio"],
                         round(2638 / 646, 2))


if __name__ == "__main__":
    unittest.main()
