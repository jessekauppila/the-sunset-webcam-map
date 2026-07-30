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


def test_anthropic_request_sends_no_temperature(monkeypatch):
    """claude-sonnet-5 rejects non-default sampling params with a 400."""
    captured = {}

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)

            class Block:
                text = '{"quality": 0.5, "is_sunset": true}'

            class Resp:
                content = [Block()]

            return Resp()

    class FakeClient:
        def __init__(self, **kwargs):
            self.messages = FakeMessages()

    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)

    from llm_rater import rate_with_anthropic
    result = rate_with_anthropic(b"fakejpegbytes", "claude-sonnet-5", "key")

    assert "temperature" not in captured
    assert captured["model"] == "claude-sonnet-5"
    assert result["quality"] == 0.5


def test_sonnet_5_has_a_pricing_entry():
    from llm_rater import MODEL_PRICING_USD_PER_MTOK
    entry = MODEL_PRICING_USD_PER_MTOK["claude-sonnet-5"]
    assert entry == {"input": 3.00, "output": 15.00}
