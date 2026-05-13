import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ml.generate_failure_gallery import (
    compute_top_failures,
    write_failure_gallery,
)


class TestComputeTopFailures(unittest.TestCase):
    def test_regression_orders_by_absolute_error_descending(self):
        df = pd.DataFrame({
            "snapshot_id": ["a", "b", "c", "d"],
            "y_true": [0.85, 0.50, 0.10, 0.20],
            "y_pred": [0.21, 0.49, 0.12, 0.78],
        })
        top = compute_top_failures(df, target_type="regression", n=3)
        self.assertEqual(list(top["snapshot_id"]), ["a", "d", "c"])
        self.assertAlmostEqual(top.iloc[0]["absolute_error"], 0.64, places=2)

    def test_binary_orders_by_distance_from_correct_class(self):
        df = pd.DataFrame({
            "snapshot_id": ["a", "b", "c"],
            "y_true": [1, 0, 1],
            "y_pred_proba": [0.1, 0.9, 0.55],
        })
        top = compute_top_failures(df, target_type="binary", n=2)
        # a: true=1, pred=0.1 → distance 0.9
        # b: true=0, pred=0.9 → distance 0.9
        # c: true=1, pred=0.55 → distance 0.45
        self.assertEqual(set(top["snapshot_id"].tolist()[:2]), {"a", "b"})

    def test_n_larger_than_dataset_returns_all_rows(self):
        df = pd.DataFrame({
            "snapshot_id": ["a", "b"],
            "y_true": [0.5, 0.5],
            "y_pred": [0.4, 0.6],
        })
        top = compute_top_failures(df, target_type="regression", n=20)
        self.assertEqual(len(top), 2)


class TestWriteFailureGallery(unittest.TestCase):
    def test_writes_well_formed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_path = Path(tmp) / "failure_gallery.json"
            items = [
                {
                    "snapshot_id": "snap_001",
                    "webcam_id": 42,
                    "image_url": "https://example.com/snap_001.jpg",
                    "true_label": 0.85,
                    "predicted_score": 0.21,
                    "absolute_error": 0.64,
                    "captured_at": "2026-04-22T19:47:00Z",
                    "llm_explanation": "Vivid orange and pink",
                },
            ]
            write_failure_gallery(
                out_path=out_path,
                split="val",
                target_type="regression",
                items=items,
            )
            payload = json.loads(out_path.read_text())
            self.assertEqual(payload["schema_version"], 1)
            self.assertEqual(payload["split"], "val")
            self.assertEqual(payload["target_type"], "regression")
            self.assertEqual(len(payload["items"]), 1)
            self.assertEqual(payload["items"][0]["snapshot_id"], "snap_001")
            self.assertIn("generated_at", payload)


if __name__ == "__main__":
    unittest.main()
