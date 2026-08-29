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
    binary_label_from: str = "quality_threshold"  # quality_threshold | is_sunset


def to_binary(label_value: float, threshold: float = 0.75) -> int:
    """Convert normalized [0,1] label into good/not-good class label.

    See ``LabelPolicy`` for the threshold-space convention.
    """
    return 1 if label_value >= threshold else 0


def resolve_binary_label(
    label_value: float | None,
    is_sunset: bool | None,
    policy: LabelPolicy,
) -> int:
    """Resolve the binary class for one row.

    ``quality_threshold`` reproduces v2-v4: positive means the normalized
    quality score cleared ``binary_threshold`` (0.75 == "rating >= 4"). On
    webcam frames Claude's quality scale tops out near 0.88, so this fires on
    ~0.2% of rows (90 of 46,079) and the positive class ends up almost
    entirely Flickr — v4 trained on 36 positive webcam examples.

    ``is_sunset`` takes the boolean directly, which is what the popup verdict
    is actually asking. Neither input is allowed to be missing in its own
    mode: defaulting an absent value to 0 is how an entire class disappears
    from a training set without anything failing loudly.
    """
    if policy.binary_label_from == "is_sunset":
        if is_sunset is None:
            raise ValueError(
                "binary_label_from=is_sunset requires an is_sunset value; "
                "refusing to default a missing boolean to negative"
            )
        return 1 if is_sunset else 0
    if label_value is None:
        raise ValueError(
            "binary_label_from=quality_threshold requires a label_value"
        )
    return to_binary(float(label_value), policy.binary_threshold)


def map_label(label_value: float, policy: LabelPolicy) -> float | int:
    """Map raw label to task-specific target type."""
    if policy.target_type == "binary":
        return to_binary(label_value, policy.binary_threshold)
    if policy.target_type == "regression":
        return float(label_value)
    raise ValueError(f"Unsupported target_type: {policy.target_type}")
