"""
Label mapping helpers.

This module centralizes conversion from raw rating values to the
training target used by the selected task type.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LabelPolicy:
    """Controls how exported labels are transformed for model training.

    IMPORTANT: ``binary_threshold`` is compared against the NORMALIZED
    [0, 1] label values produced by ``merge_label`` in
    ``ml/export_dataset.py``, not the raw 1-5 ratings. Normalized
    values are ``(rating - 1) / 4``, so:

        rating 4.0  →  normalized 0.75
        rating 4.5  →  normalized 0.875
        rating 5.0  →  normalized 1.0

    The historical default ``4.0`` was correct when labels were raw
    1-5 values, but the v3+ pipeline normalizes upstream of
    ``map_label``. A 4.0 threshold against normalized labels never
    matches anything → the dataset reports 0 positives and binary
    training silently produces an "always 0" model. Pass thresholds
    in the normalized space.
    """

    target_type: str = "binary"  # binary | regression
    binary_threshold: float = 0.75  # normalized; was 4.0 before 2026-05-31


def to_binary(label_value: float, threshold: float = 0.75) -> int:
    """Convert normalized [0,1] label into good/not-good class label.

    See ``LabelPolicy`` for the threshold-space convention.
    """
    return 1 if label_value >= threshold else 0


def map_label(label_value: float, policy: LabelPolicy) -> float | int:
    """Map raw label to task-specific target type."""
    if policy.target_type == "binary":
        return to_binary(label_value, policy.binary_threshold)
    if policy.target_type == "regression":
        return float(label_value)
    raise ValueError(f"Unsupported target_type: {policy.target_type}")
