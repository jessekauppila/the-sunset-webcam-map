"""Tests for the circularity guard in analyze_retest.py.

The guard exists because applying a correction campaign silently invalidates
the ceiling measurement. ml/apply_label_corrections.py copies pass 2's ratings
onto the pass-1 gold rows, so those frames then agree with themselves by
construction. Measured on retest_v1 after its 24 corrections landed:

    self-Pearson  0.673 -> 0.779
    gap           -0.024 -> +0.082
    confusion '4' row lost all seven of its N entries

The number moves in the direction that reads as "the operator is MORE
consistent than the model, so there is headroom" — reopening a settled
question on an artifact, while the verdict line still prints CEILING REACHED.
Same sys.path shim as ml/test_export_dataset.py.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from analyze_retest import (  # noqa: E402
    cat,
    corrected_origin,
    count_circular,
)


class TestCorrectedOrigin(unittest.TestCase):
    def test_matches_the_stamp_apply_label_corrections_writes(self):
        # apply_label_corrections.py builds new_origin as f"correction_{retest}".
        # If these two ever disagree the guard silently stops firing, so this
        # test is the contract between the two scripts.
        self.assertEqual(corrected_origin("retest_v1"), "correction_retest_v1")

    def test_is_sample_specific(self):
        self.assertNotEqual(corrected_origin("retest_v1"), corrected_origin("retest_v2"))


class TestCountCircular(unittest.TestCase):
    def test_clean_gold_counts_zero(self):
        origins = ["hard_example"] * 120 + ["random_ordinary_v2"] * 6
        self.assertEqual(count_circular(origins, "retest_v1"), 0)

    def test_counts_rows_this_retest_overwrote(self):
        origins = ["hard_example"] * 116 + ["correction_retest_v1"] * 24 + ["random_ordinary_v2"] * 6
        self.assertEqual(count_circular(origins, "retest_v1"), 24)

    def test_a_different_campaigns_corrections_are_not_circular_here(self):
        # Gold corrected by SOME OTHER retest is still independent evidence for
        # this one — over-firing would block legitimate analyses.
        origins = ["correction_retest_v2"] * 10 + ["hard_example"] * 50
        self.assertEqual(count_circular(origins, "retest_v1"), 0)

    def test_substring_collisions_do_not_count(self):
        origins = ["correction_retest_v10", "correction_retest_v1_old", "hard_example"]
        self.assertEqual(count_circular(origins, "retest_v1"), 0)

    def test_the_real_retest_v1_shape(self):
        # The actual post-correction population, from the DB on 2026-09-01.
        origins = (["hard_example"] * 116
                   + ["correction_retest_v1"] * 24
                   + ["random_ordinary_v2"] * 6)
        self.assertEqual(len(origins), 146)
        self.assertEqual(count_circular(origins, "retest_v1"), 24)


class TestCat(unittest.TestCase):
    """cat() decides which cell of the confusion matrix a label lands in; the
    guard's evidence is expressed in those cells."""

    def test_not_a_sunset_is_N_whatever_the_rating_says(self):
        self.assertEqual(cat(False, None), "N")
        self.assertEqual(cat(False, 3), "N")

    def test_rated_sunset_is_its_rating(self):
        self.assertEqual(cat(True, 4), "4")

    def test_unrated_sunset_is_flagged_not_guessed(self):
        self.assertEqual(cat(True, None), "?")


if __name__ == "__main__":
    unittest.main()
