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


import hashlib
import json


def test_run_manifest_contents(tmp_path):
    from llm_rater import write_run_manifest, RATING_PROMPT

    path = write_run_manifest(
        tmp_path,
        model="claude-sonnet-5",
        provider="anthropic",
        selection={"mode": "flagged_unrated", "limit": 500},
        attempted=500,
        succeeded=497,
        failed=3,
        tokens_in=1_000_000,
        tokens_out=75_000,
        est_cost_usd=4.13,
        started_at="2026-07-29T20:00:00Z",
        finished_at="2026-07-29T21:30:00Z",
    )

    assert path.name.startswith("run_") and path.name.endswith("_manifest.json")
    data = json.loads(path.read_text())
    assert data["model"] == "claude-sonnet-5"
    assert data["provider"] == "anthropic"
    assert data["prompt_version"] == "v2_extended"
    assert data["prompt_sha256"] == hashlib.sha256(
        RATING_PROMPT.encode("utf-8")
    ).hexdigest()
    assert data["selection"] == {"mode": "flagged_unrated", "limit": 500}
    assert data["counts"] == {"attempted": 500, "succeeded": 497, "failed": 3}
    assert data["tokens"] == {"input": 1_000_000, "output": 75_000}
    assert data["est_cost_usd"] == 4.13
    assert data["started_at"] == "2026-07-29T20:00:00Z"
    assert data["finished_at"] == "2026-07-29T21:30:00Z"


from types import SimpleNamespace


def test_build_selection_info_uses_flagged_unrated_mode_when_set():
    from llm_rater import build_selection_info

    args = SimpleNamespace(
        flagged_unrated=True, source="webcam", limit=500, skip_rated=True,
        use_batch_api=True,
    )
    assert build_selection_info(args) == {
        "mode": "flagged_unrated",
        "limit": 500,
        "skip_rated": True,
        "use_batch_api": True,
    }


def test_build_selection_info_falls_back_to_source_and_default_batch_flag():
    from llm_rater import build_selection_info

    # No `use_batch_api` attribute at all (Task 4 hasn't landed yet on some
    # call site) — must default to False rather than raising.
    args = SimpleNamespace(
        flagged_unrated=False, source="external", limit=0, skip_rated=False,
    )
    assert build_selection_info(args) == {
        "mode": "external",
        "limit": 0,
        "skip_rated": False,
        "use_batch_api": False,
    }
