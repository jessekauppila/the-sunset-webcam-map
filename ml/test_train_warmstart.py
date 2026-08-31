"""Tests for the backbone-only warm start in train.py.

The full --init-checkpoint load is strict on purpose (a silently partial
load would look like a successful warm start and train from noise). The
backbone-only path exists for cross-head transfer — e.g. warm-starting the
regression quality head from the binary detection pretrain — and must stay
just as loud: only head keys may differ, anything else raises.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from train import build_model, load_backbone_state  # noqa: E402


class TestBackboneWarmStart(unittest.TestCase):
    def test_binary_checkpoint_warm_starts_a_regression_model(self):
        import torch

        binary = build_model("resnet18", "binary", head_dropout=0.3)
        regression = build_model("resnet18", "regression", head_dropout=0.3)
        dropped = load_backbone_state(regression, binary.state_dict())
        # The two fc.* tensors (weight, bias) are the only ones dropped.
        self.assertEqual(dropped, 2)
        # Backbone weights actually transferred.
        self.assertTrue(
            torch.equal(
                regression.conv1.weight, binary.conv1.weight
            )
        )

    def test_a_mismatched_backbone_raises_instead_of_partially_loading(self):
        binary = build_model("resnet18", "binary", head_dropout=0.3)
        state = binary.state_dict()
        state.pop("conv1.weight")  # simulate a checkpoint with a hole in it
        regression = build_model("resnet18", "regression", head_dropout=0.3)
        with self.assertRaises(ValueError):
            load_backbone_state(regression, state)


if __name__ == "__main__":
    unittest.main()
