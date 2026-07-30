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


def test_normalize_rating_defaults_and_clamps():
    from llm_rater import normalize_rating

    out = normalize_rating({"quality": 1.7, "confidence": -0.2,
                            "time_of_day": "BOGUS", "sky_coverage": "nope"})
    assert out["quality"] == 1.0
    assert out["confidence"] == 0.0
    assert out["is_sunset"] is False
    assert out["is_sunrise"] is False
    assert out["time_of_day"] == "unclear"
    assert out["sky_coverage"] == "partial"
    assert out["rating_explanation"] == ""


def test_parse_custom_id_round_trip():
    from llm_rater import parse_custom_id

    assert parse_custom_id("webcam:123") == ("webcam", 123)
    assert parse_custom_id("external:45") == ("external", 45)


def _fake_rows(n):
    return [
        {"record_id": i, "source_table": "webcam", "webcam_id": i % 7,
         "image_url": f"https://x/{i}.jpg",
         "human_calculated_rating": None, "human_rating_count": 0}
        for i in range(n)
    ]


def test_build_batch_requests_chunks_by_request_count():
    from llm_rater import build_batch_requests

    def fake_download(url, timeout=30.0):
        return b"tinyjpeg", "image/jpeg"

    chunks, failures = build_batch_requests(
        _fake_rows(2500), "claude-sonnet-5", 30.0, download_fn=fake_download,
    )
    assert failures == []
    assert [len(c) for c in chunks] == [1000, 1000, 500]
    first = chunks[0][0]
    assert first["custom_id"] == "webcam:0"
    assert first["params"]["model"] == "claude-sonnet-5"
    assert first["params"]["max_tokens"] == 600
    assert "temperature" not in first["params"]


def test_build_batch_requests_records_download_failures():
    from llm_rater import build_batch_requests

    def flaky_download(url, timeout=30.0):
        if url.endswith("1.jpg"):
            raise RuntimeError("404 dead url")
        return b"tinyjpeg", "image/jpeg"

    chunks, failures = build_batch_requests(
        _fake_rows(3), "claude-sonnet-5", 30.0, download_fn=flaky_download,
    )
    assert len(failures) == 1
    assert failures[0]["custom_id"] == "webcam:1"
    assert sum(len(c) for c in chunks) == 2


def test_build_batch_requests_chunks_by_cumulative_byte_cap(monkeypatch):
    import llm_rater

    # b"abcdef" is 6 raw bytes -> base64.b64encode gives exactly 8 chars
    # (6 is a multiple of 3, so no padding). With the cap patched to 17,
    # two requests (16 bytes) fit but a third (24 bytes) doesn't, so the
    # third request must start a new chunk.
    monkeypatch.setattr(llm_rater, "MAX_BATCH_BYTES", 17)

    def fake_download(url, timeout=30.0):
        return b"abcdef", "image/jpeg"

    chunks, failures = llm_rater.build_batch_requests(
        _fake_rows(3), "claude-sonnet-5", 30.0, download_fn=fake_download,
    )
    assert failures == []
    assert [len(c) for c in chunks] == [2, 1]
    assert chunks[0][0]["custom_id"] == "webcam:0"
    assert chunks[0][1]["custom_id"] == "webcam:1"
    assert chunks[1][0]["custom_id"] == "webcam:2"
