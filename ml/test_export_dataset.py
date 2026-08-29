"""Tests for the pure helpers in export_dataset.py.

export_dataset.py imports `common.*` unqualified (it is run as a script, not
imported as a package), so ml/ has to be on sys.path before importing it —
same shim ml/test_llm_rater_triage.py uses.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from common.labels import LabelPolicy, resolve_binary_label  # noqa: E402
from common.splits import SplitConfig  # noqa: E402
from export_dataset import external_split  # noqa: E402


class TestExternalSplit(unittest.TestCase):
    """External (Flickr) images must land in the same split every export.

    The previous implementation used Python's builtin hash() on a string,
    which is salted per process unless PYTHONHASHSEED is set. Measured
    consequence: 2,718 of 5,767 Flickr images (47.1%) changed split between
    the two v4 runs, so no two Flickr-inclusive experiments were comparable.
    """

    def test_is_stable_across_calls(self):
        cfg = SplitConfig(seed=20260212)
        self.assertEqual(external_split(12345, cfg), external_split(12345, cfg))

    def test_is_stable_across_processes(self):
        # The regression that matters: a fresh interpreter (a new salt) must
        # produce the same answer. Calling twice in one process would pass
        # even with the old salted-hash implementation.
        import subprocess

        code = (
            "import sys; sys.path.insert(0, 'ml'); "
            "from common.splits import SplitConfig; "
            "from export_dataset import external_split; "
            "print(external_split(12345, SplitConfig(seed=20260212)))"
        )
        seen = set()
        for _ in range(3):
            out = subprocess.run(
                [sys.executable, "-c", code],
                capture_output=True, text=True, check=True,
                cwd=str(Path(__file__).parent.parent),
            )
            seen.add(out.stdout.strip())
        self.assertEqual(len(seen), 1, f"split differed across processes: {seen}")

    def test_returns_a_valid_split_name(self):
        cfg = SplitConfig(seed=20260212)
        self.assertIn(external_split(12345, cfg), {"train", "val", "test"})

    def test_different_seeds_produce_different_assignments(self):
        a = [external_split(i, SplitConfig(seed=1)) for i in range(500)]
        b = [external_split(i, SplitConfig(seed=2)) for i in range(500)]
        self.assertNotEqual(a, b)

    def test_roughly_respects_configured_percentages(self):
        cfg = SplitConfig(seed=20260212, train_pct=70, val_pct=15, test_pct=15)
        splits = [external_split(i, cfg) for i in range(5000)]
        train_frac = splits.count("train") / len(splits)
        self.assertGreater(train_frac, 0.65)
        self.assertLess(train_frac, 0.75)

    def test_does_not_collide_with_the_webcam_namespace(self):
        # Webcam ids and external ids overlap numerically (external ids are
        # 1..5872), so the two must bucket independently or a Flickr image
        # would inherit some camera's split.
        from common.splits import assign_split

        cfg = SplitConfig(seed=20260212)
        differ = sum(
            1 for i in range(1, 500) if external_split(i, cfg) != assign_split(i, cfg)
        )
        self.assertGreater(differ, 100)


class TestResolveBinaryLabel(unittest.TestCase):
    """How the binary head's positive class gets decided.

    v2-v4 used quality_threshold: positive means normalized llm_quality
    cleared 0.75 ("rating >= 4"). Claude's quality scale tops out near 0.88
    on webcam frames, so that fired on 90 of 46,079 webcam rows and left v4's
    positive class 97.5% Flickr with 36 positive webcam training examples.
    is_sunset takes the boolean directly, which is what the popup verdict
    actually means.
    """

    QUALITY = LabelPolicy(target_type="binary", binary_threshold=0.75,
                          binary_label_from="quality_threshold")
    IS_SUNSET = LabelPolicy(target_type="binary", binary_threshold=0.75,
                            binary_label_from="is_sunset")

    def test_quality_mode_uses_the_score(self):
        self.assertEqual(resolve_binary_label(0.80, None, self.QUALITY), 1)
        self.assertEqual(resolve_binary_label(0.74, None, self.QUALITY), 0)

    def test_quality_mode_is_inclusive_at_the_threshold(self):
        self.assertEqual(resolve_binary_label(0.75, None, self.QUALITY), 1)

    def test_quality_mode_ignores_is_sunset(self):
        self.assertEqual(resolve_binary_label(0.10, True, self.QUALITY), 0)

    def test_quality_mode_is_the_default(self):
        # v4 configs set no binary_label_from, so the default must reproduce
        # the old behavior or v4 stops being reproducible.
        self.assertEqual(LabelPolicy().binary_label_from, "quality_threshold")

    def test_is_sunset_mode_uses_the_boolean(self):
        self.assertEqual(resolve_binary_label(0.10, True, self.IS_SUNSET), 1)
        self.assertEqual(resolve_binary_label(0.90, False, self.IS_SUNSET), 0)

    def test_is_sunset_mode_ignores_the_quality_score(self):
        # The 13 operator-rated 4s and 5s that Claude scored at ~0.0 are
        # exactly why: the boolean has to win outright.
        self.assertEqual(resolve_binary_label(0.0, True, self.IS_SUNSET), 1)

    def test_is_sunset_mode_rejects_a_missing_boolean(self):
        # A row with no is_sunset must never silently become a negative —
        # that is how a whole class quietly vanishes from a training set.
        with self.assertRaises(ValueError):
            resolve_binary_label(0.5, None, self.IS_SUNSET)

    def test_quality_mode_rejects_a_missing_score(self):
        with self.assertRaises(ValueError):
            resolve_binary_label(None, True, self.QUALITY)


if __name__ == "__main__":
    unittest.main()
