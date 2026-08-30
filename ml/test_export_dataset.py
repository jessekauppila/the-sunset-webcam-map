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
from export_dataset import (  # noqa: E402
    external_split,
    fetch_llm_labels_from_db,
    fetch_rows,
    gold_label_value,
    summarize_judges,
)


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


class TestGoldLabelValue(unittest.TestCase):
    """Normalized quality target for one operator gold label.

    The Hard Examples queue writes is_sunset always, and rating only when
    is_sunset is true (measured 2026-08-28: 3,546 rated sunsets, 5,018
    unrated non-sunsets, zero rows breaking that shape).
    """

    def test_non_sunset_is_zero(self):
        self.assertEqual(gold_label_value(is_sunset=False, rating=None), 0.0)

    def test_non_sunset_ignores_a_stray_rating(self):
        self.assertEqual(gold_label_value(is_sunset=False, rating=3), 0.0)

    def test_sunset_ratings_normalize_one_to_five(self):
        self.assertEqual(gold_label_value(is_sunset=True, rating=1), 0.0)
        self.assertEqual(gold_label_value(is_sunset=True, rating=2), 0.25)
        self.assertEqual(gold_label_value(is_sunset=True, rating=3), 0.5)
        self.assertEqual(gold_label_value(is_sunset=True, rating=4), 0.75)
        self.assertEqual(gold_label_value(is_sunset=True, rating=5), 1.0)

    def test_a_rating_four_sunset_clears_the_binary_threshold(self):
        # Ties the normalization to the threshold convention: 0.75 is exactly
        # "rating >= 4", the trap documented in ml/common/labels.py.
        self.assertGreaterEqual(gold_label_value(is_sunset=True, rating=4), 0.75)

    def test_sunset_without_a_rating_is_none(self):
        # Skip the row rather than invent a target.
        self.assertIsNone(gold_label_value(is_sunset=True, rating=None))

    def test_stays_inside_the_unit_interval(self):
        for r in range(1, 6):
            v = gold_label_value(is_sunset=True, rating=r)
            self.assertGreaterEqual(v, 0.0)
            self.assertLessEqual(v, 1.0)


class TestMinRatingBinaryLabel(unittest.TestCase):
    """rating>=N mode: a sunset only counts if it cleared the bar.

    Operator rating 1 means "a sunset is happening and there is nothing to
    see" (dusk over a field) and still writes is_sunset=true, so is_sunset is
    too permissive a positive class for the product. Measured: the v5 head
    trained on is_sunset fired on 54.7% of ordinary frames against a 43.0%
    base rate. See docs/ml/rating-rubric.md and design spec section 11.
    """

    def policy(self, n):
        return LabelPolicy(target_type="binary", binary_label_from="min_rating",
                           min_positive_rating=n)

    def test_rating_below_the_bar_is_negative(self):
        self.assertEqual(resolve_binary_label(None, True, self.policy(3), rating=1), 0)
        self.assertEqual(resolve_binary_label(None, True, self.policy(3), rating=2), 0)

    def test_rating_at_the_bar_is_positive(self):
        self.assertEqual(resolve_binary_label(None, True, self.policy(3), rating=3), 1)

    def test_rating_above_the_bar_is_positive(self):
        self.assertEqual(resolve_binary_label(None, True, self.policy(3), rating=5), 1)

    def test_the_bar_is_configurable(self):
        self.assertEqual(resolve_binary_label(None, True, self.policy(4), rating=3), 0)
        self.assertEqual(resolve_binary_label(None, True, self.policy(4), rating=4), 1)

    def test_not_a_sunset_is_negative_regardless_of_rating(self):
        self.assertEqual(resolve_binary_label(None, False, self.policy(3), rating=None), 0)
        self.assertEqual(resolve_binary_label(None, False, self.policy(3), rating=5), 0)

    def test_a_sunset_with_no_rating_raises(self):
        # Never silently treat a missing rating as below the bar — that would
        # quietly drop real positives out of the training set.
        with self.assertRaises(ValueError):
            resolve_binary_label(None, True, self.policy(3), rating=None)

    def test_quality_and_is_sunset_modes_ignore_rating(self):
        q = LabelPolicy(target_type="binary", binary_label_from="quality_threshold")
        self.assertEqual(resolve_binary_label(0.9, None, q, rating=1), 1)
        b = LabelPolicy(target_type="binary", binary_label_from="is_sunset")
        self.assertEqual(resolve_binary_label(None, True, b, rating=1), 1)


class _RecordingCursor:
    """Captures executed SQL and returns canned rows, standing in for psycopg2."""

    def __init__(self, rows):
        self.rows = rows
        self.executed = []

    def execute(self, query, params=None):
        self.executed.append(query)

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _RecordingConn:
    def __init__(self, rows):
        self.cursor_obj = _RecordingCursor(rows)

    def cursor(self, cursor_factory=None):
        return self.cursor_obj


class TestEvalQuarantine(unittest.TestCase):
    """label_samples frames are evaluation ground truth, never training data.

    The gold export has excluded them since the sample was drawn; the LLM
    pretrain export (llm_only merge strategy) reads *every* imaged snapshot,
    and all 500 eval frames are LLM-rated — without the same NOT EXISTS
    guard the pretrain trains on the yardstick it is later measured with.
    """

    def test_llm_only_query_excludes_label_samples(self):
        conn = _RecordingConn([])
        fetch_rows(conn, "manual_only", 1, label_merge_strategy="llm_only")
        query = conn.cursor_obj.executed[0]
        self.assertIn("label_samples", query)
        self.assertIn("NOT EXISTS", query)


class TestLlmLabelsCarryTheJudge(unittest.TestCase):
    """llm_model must ride along with every DB-sourced LLM label.

    sonnet-4-5 and sonnet-5 are different instruments (measured 2026-08-29:
    35.9% vs 63.6% sunset call rate on the same prompt). A pretrain export
    that drops the judge column cannot be stratified after the fact.
    """

    def test_fetch_selects_and_returns_llm_model(self):
        conn = _RecordingConn([
            {"id": 7, "llm_quality": 0.4, "llm_is_sunset": True,
             "llm_model": "claude-sonnet-5"},
        ])
        labels = fetch_llm_labels_from_db(conn)
        self.assertIn("llm_model", conn.cursor_obj.executed[0])
        self.assertEqual(labels[7]["model"], "claude-sonnet-5")

    def test_judge_mix_counts_by_model(self):
        rows = [
            {"llm_model": "claude-sonnet-5"},
            {"llm_model": "claude-sonnet-5"},
            {"llm_model": "claude-sonnet-4-5"},
            {"llm_model": None},
        ]
        self.assertEqual(
            summarize_judges(rows),
            {"claude-sonnet-5": 2, "claude-sonnet-4-5": 1, "unlabeled": 1},
        )


if __name__ == "__main__":
    unittest.main()
