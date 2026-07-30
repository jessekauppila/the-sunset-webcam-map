"""Tests for the hard-example triage extensions to llm_rater.py."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from llm_rater import build_flagged_unrated_query


def test_flagged_unrated_selects_only_flagged_unrated_webcam_rows():
    q = build_flagged_unrated_query(limit=0)
    assert "model_disagreement_kind IS NOT NULL" in q
    assert "llm_quality IS NULL" in q
    assert "firebase_url IS NOT NULL" in q
    assert "webcam_snapshots" in q


def test_flagged_unrated_orders_per_camera_round_robin():
    q = build_flagged_unrated_query(limit=500)
    assert (
        "ROW_NUMBER() OVER (PARTITION BY s.webcam_id "
        "ORDER BY s.captured_at DESC)" in q
    )
    # Round-robin: rank across cameras is the primary sort key, so a
    # --limit slice spreads across cameras instead of draining one.
    assert "ORDER BY cam_rank, webcam_id" in q
    assert q.rstrip().endswith("LIMIT 500")


def test_flagged_unrated_omits_limit_clause_when_zero():
    q = build_flagged_unrated_query(limit=0)
    assert "LIMIT" not in q
