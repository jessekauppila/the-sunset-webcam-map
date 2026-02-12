"""
Label mapping helpers.

This module centralizes conversion from raw rating values to the
training target used by the selected task type.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LabelPolicy:
    """Controls how exported labels are transformed for model training."""

    target_type: str = "binary"  # binary | regression
    binary_threshold: float = 4.0


def to_binary(label_value: float, threshold: float = 4.0) -> int:
    """Convert continuous rating into good/not-good class label."""
    return 1 if label_value >= threshold else 0


def map_label(label_value: float, policy: LabelPolicy) -> float | int:
    """Map raw label to task-specific target type."""
    if policy.target_type == "binary":
        return to_binary(label_value, policy.binary_threshold)
    if policy.target_type == "regression":
        return float(label_value)
    raise ValueError(f"Unsupported target_type: {policy.target_type}")
