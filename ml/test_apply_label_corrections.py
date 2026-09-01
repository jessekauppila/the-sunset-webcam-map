"""Tests for the pure helpers in apply_label_corrections.py.

The script's risk is not its SQL, it is the classification of which
transitions matter: a correction that does not cross a training threshold
costs the model nothing, and the whole justification for the campaign is
which ones do. Same sys.path shim as ml/test_export_dataset.py.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from apply_label_corrections import (  # noqa: E402
    cat,
    crosses_detection,
    crosses_positive_threshold,
)


class TestCat(unittest.TestCase):
    def test_not_a_sunset_collapses_to_N_regardless_of_rating(self):
        # is_sunset=False rows carry rating NULL, but a stray rating must not
        # promote one out of N — N is decided by the boolean alone.
        self.assertEqual(cat(False, None), "N")
        self.assertEqual(cat(False, 4), "N")

    def test_rated_sunsets_render_as_their_rating(self):
        for r in (1, 2, 3, 4, 5):
            self.assertEqual(cat(True, r), str(r))

    def test_sunset_without_a_rating_is_marked_unknown_not_guessed(self):
        self.assertEqual(cat(True, None), "?")


class TestPositiveThreshold(unittest.TestCase):
    """rating >= 4 is the label the binary head trains on (binary_threshold
    0.75 against normalized (rating-1)/4)."""

    def test_four_to_three_crosses(self):
        self.assertTrue(crosses_positive_threshold("4", "3"))

    def test_four_to_N_crosses(self):
        self.assertTrue(crosses_positive_threshold("4", "N"))

    def test_five_to_three_crosses(self):
        self.assertTrue(crosses_positive_threshold("5", "3"))

    def test_four_to_five_is_free(self):
        # Both sides are the positive class — the measured 4<->5 wobble costs
        # the model nothing, which is why the rubric says not to agonise there.
        self.assertFalse(crosses_positive_threshold("4", "5"))

    def test_two_to_three_is_free(self):
        self.assertFalse(crosses_positive_threshold("2", "3"))

    def test_three_to_N_is_free_for_this_threshold(self):
        # Dramatic, but 3 and N are both negatives at rating >= 4. It shows up
        # under the detection test instead; conflating the two is exactly the
        # mistake this pair of predicates prevents.
        self.assertFalse(crosses_positive_threshold("3", "N"))


class TestDetection(unittest.TestCase):
    def test_any_rating_to_N_flips_is_sunset(self):
        for r in ("1", "2", "3", "4", "5"):
            self.assertTrue(crosses_detection(r, "N"))

    def test_N_to_rating_flips_is_sunset(self):
        self.assertTrue(crosses_detection("N", "1"))

    def test_rating_to_rating_never_flips_is_sunset(self):
        self.assertFalse(crosses_detection("1", "5"))
        self.assertFalse(crosses_detection("4", "3"))

    def test_N_to_N_does_not_flip(self):
        self.assertFalse(crosses_detection("N", "N"))


class TestTheActualCohort(unittest.TestCase):
    """The 24 real transitions this script was written to apply, so the
    headline count in the docs (10 crossing rating>=4) is pinned to code
    rather than to a number someone typed into a markdown file."""

    # (before, after) for the 2026-08-08 webcam positives, from retest_v1.
    COHORT = [
        ("2", "N"), ("2", "1"), ("2", "N"), ("2", "1"), ("2", "1"),
        ("3", "1"), ("3", "1"), ("3", "2"), ("3", "1"), ("3", "1"),
        ("3", "2"), ("3", "N"), ("3", "1"), ("3", "N"),
        ("4", "N"), ("4", "N"), ("4", "N"), ("4", "N"), ("4", "N"),
        ("4", "N"), ("4", "N"), ("4", "2"),
        ("5", "N"), ("5", "3"),
    ]

    def test_cohort_size(self):
        self.assertEqual(len(self.COHORT), 24)

    def test_ten_cross_the_positive_threshold(self):
        crossing = [c for c in self.COHORT if crosses_positive_threshold(*c)]
        self.assertEqual(len(crossing), 10)
        # All ten are frames the first pass called 4 or 5.
        self.assertTrue(all(b in ("4", "5") for b, _ in crossing))

    def test_every_transition_moves_downward(self):
        order = {"N": -1, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5}
        self.assertTrue(all(order[a] < order[b] for b, a in self.COHORT))

    def test_none_of_them_held(self):
        self.assertEqual([c for c in self.COHORT if c[0] == c[1]], [])


if __name__ == "__main__":
    unittest.main()
