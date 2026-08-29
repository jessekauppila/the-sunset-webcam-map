"""Tests for the metric math in score_manifest.py.

score_manifest exists to judge an already-trained model against a label set
it never saw — the only way to compare v4 against the operator gold labels.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from score_manifest import binary_metrics  # noqa: E402


class TestBinaryMetrics(unittest.TestCase):
    def test_perfect_separation(self):
        m = binary_metrics([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9], threshold=0.5)
        self.assertEqual(m["f1"], 1.0)
        self.assertEqual(m["confusion"], {"tn": 2, "fp": 0, "fn": 0, "tp": 2})

    def test_all_predicted_negative(self):
        m = binary_metrics([0, 1, 1], [0.1, 0.2, 0.3], threshold=0.5)
        self.assertEqual(m["recall"], 0.0)
        self.assertEqual(m["f1"], 0.0)
        self.assertEqual(m["confusion"], {"tn": 1, "fp": 0, "fn": 2, "tp": 0})

    def test_precision_is_zero_not_a_crash_when_nothing_predicted_positive(self):
        m = binary_metrics([1, 1], [0.1, 0.1], threshold=0.5)
        self.assertEqual(m["precision"], 0.0)

    def test_handles_an_empty_input(self):
        # A per-source breakdown can legitimately be empty (e.g. no Flickr
        # rows in a split); it must report zeros, not divide by zero.
        m = binary_metrics([], [], threshold=0.5)
        self.assertEqual(m["confusion"], {"tn": 0, "fp": 0, "fn": 0, "tp": 0})
        self.assertEqual(m["f1"], 0.0)

    def test_threshold_is_inclusive(self):
        m = binary_metrics([1], [0.5], threshold=0.5)
        self.assertEqual(m["confusion"]["tp"], 1)

    def test_balanced_accuracy_averages_the_two_recalls(self):
        # 2 of 4 negatives correct (0.5), 2 of 2 positives correct (1.0)
        m = binary_metrics(
            [0, 0, 0, 0, 1, 1], [0.9, 0.9, 0.1, 0.1, 0.8, 0.8], threshold=0.5
        )
        self.assertAlmostEqual(m["balanced_accuracy"], 0.75)

    def test_f1_is_the_harmonic_mean(self):
        # tp=2 fp=2 fn=1 -> precision 0.5, recall 2/3, f1 = 2*.5*(2/3)/(7/6)
        m = binary_metrics(
            [1, 1, 1, 0, 0], [0.9, 0.9, 0.1, 0.9, 0.9], threshold=0.5
        )
        self.assertAlmostEqual(m["precision"], 0.5)
        self.assertAlmostEqual(m["recall"], 2 / 3)
        self.assertAlmostEqual(m["f1"], 4 / 7)

    def test_a_higher_threshold_trades_recall_for_precision(self):
        y_true = [1, 1, 0, 0]
        y_score = [0.9, 0.6, 0.55, 0.1]
        loose = binary_metrics(y_true, y_score, threshold=0.5)
        strict = binary_metrics(y_true, y_score, threshold=0.7)
        self.assertGreater(loose["recall"], strict["recall"])
        self.assertGreater(strict["precision"], loose["precision"])


class TestSoftmaxPositive(unittest.TestCase):
    def test_returns_the_second_class_probability(self):
        import numpy as np

        from score_manifest import softmax_positive

        self.assertAlmostEqual(softmax_positive(np.array([0.0, 0.0])), 0.5)
        self.assertGreater(softmax_positive(np.array([0.0, 5.0])), 0.99)
        self.assertLess(softmax_positive(np.array([5.0, 0.0])), 0.01)

    def test_is_stable_for_large_logits(self):
        import numpy as np

        from score_manifest import softmax_positive

        v = softmax_positive(np.array([1000.0, 1001.0]))
        self.assertFalse(np.isnan(v))
        self.assertGreater(v, 0.7)


if __name__ == "__main__":
    unittest.main()
