# Hard-Example Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude (claude-sonnet-5) rates every unrated flagged webcam snapshot via the Batch API, and `computeDisagreementKind` treats Claude as the adjudicator so the Hard Examples queue collapses to genuine model-vs-Claude contests.

**Architecture:** Three components per the spec (`docs/superpowers/specs/2026-07-29-hard-example-triage-design.md`): (1) extensions to the existing `ml/llm_rater.py` (selection, sonnet-5, Batch API, run manifest), (2) a semantic change to the pure TS function `computeDisagreementKind` in `app/api/cron/update-cameras/lib/aiScoring.ts`, (3) an operator runbook (dry-run → smoke slice → full run → recompute-reset SQL) documented in `ml/OPERATING_GUIDE.md`. No schema changes.

**Tech Stack:** Python 3 + psycopg2 + `anthropic` SDK (Message Batches) + pytest; TypeScript + vitest.

## Global Constraints

- Branch: `feat/hard-example-triage` in the main checkout (`/Users/jessekauppila/GitHub/the-sunset-webcam-map`). NO worktrees in this repo.
- No DB schema changes anywhere in this plan.
- Judge provenance: every DB rating write must go through the existing `DbWriter.write_rating`, which stamps `llm_model`, `llm_provider`, `llm_rated_at`, and `prompt_version` — never write `llm_*` columns any other way.
- Never fabricate a rating: a frame that fails (download error, batch error, unparseable JSON) is logged and left unrated. The `--flagged-unrated` predicate is the retry mechanism.
- Python tests: `python3 -m pytest ml/test_llm_rater_triage.py -v` (new file; existing ml tests are `ml/test_*.py`). TS tests: `npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts`.
- The plan only builds the tooling. The operator (Jesse) runs the actual spend steps (dry-run / smoke / full run / reset SQL) from the runbook — no task in this plan calls the Anthropic API against production data.
- Model pricing constants: `claude-sonnet-5` = $3.00 input / $15.00 output per MTok (sticker; intro $2/$10 through 2026-08-31 — comment only). Thresholds referenced in TS: `SUNSET_DISAGREEMENT_HIGH=3.0`, `SUNSET_DISAGREEMENT_LOW=2.0`, `MODEL_VS_CLAUDE_MODEL_HIGH=3.5`, `MODEL_VS_CLAUDE_MODEL_LOW=2.0`, `MODEL_VS_CLAUDE_CLAUDE_HIGH=0.6` (all already in `app/lib/masterConfig.ts` — do not change them).

---

### Task 1: `--flagged-unrated` selection in `llm_rater.py`

**Files:**
- Modify: `ml/llm_rater.py` (arg parser ~line 90-184; add functions near `fetch_webcam_rows` ~line 486; wire into `main()`)
- Test: `ml/test_llm_rater_triage.py` (create)

**Interfaces:**
- Produces: `build_flagged_unrated_query(limit: int) -> str` (pure), `fetch_flagged_unrated_rows(conn, limit: int) -> list[dict]` (rows shaped exactly like `fetch_webcam_rows` output: keys `record_id, source_table, webcam_id, image_url, human_calculated_rating, human_rating_count`), argparse flag `args.flagged_unrated`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Create `ml/test_llm_rater_triage.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v`
Expected: FAIL with `ImportError: cannot import name 'build_flagged_unrated_query'`

- [ ] **Step 3: Implement the query builder + fetcher**

In `ml/llm_rater.py`, directly below `fetch_webcam_rows` (~line 514), add:

```python
def build_flagged_unrated_query(limit: int) -> str:
    """Selection SQL for the hard-example triage pass (2026-07-29 spec).

    Every webcam snapshot the live cron flagged (model_disagreement_kind
    set) that Claude has not yet rated. Per-camera round-robin ordering so
    a --limit slice spreads coverage across cameras.
    """
    limit_clause = f"LIMIT {limit}" if limit > 0 else ""
    return f"""
    SELECT record_id, source_table, webcam_id, image_url,
           human_calculated_rating, human_rating_count
    FROM (
      SELECT
        s.id AS record_id,
        'webcam' AS source_table,
        s.webcam_id,
        s.firebase_url AS image_url,
        s.calculated_rating AS human_calculated_rating,
        0 AS human_rating_count,
        ROW_NUMBER() OVER (PARTITION BY s.webcam_id ORDER BY s.captured_at DESC) AS cam_rank
      FROM webcam_snapshots s
      WHERE s.firebase_url IS NOT NULL
        AND s.model_disagreement_kind IS NOT NULL
        AND s.llm_quality IS NULL
    ) ranked
    ORDER BY cam_rank, webcam_id
    {limit_clause}
    """


def fetch_flagged_unrated_rows(
    conn: psycopg2.extensions.connection,
    limit: int,
) -> list[dict[str, Any]]:
    """Fetch flagged-but-Claude-unrated webcam snapshots (triage pass)."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(build_flagged_unrated_query(limit))
        return [dict(r) for r in cur.fetchall()]
```

Note: `human_rating_count` is hardcoded 0 (the LEFT JOIN in `fetch_webcam_rows` exists only for the dry-run HTML report's agreement column; the triage pass doesn't need it and skipping the join keeps the window query cheap).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v`
Expected: 3 PASS

- [ ] **Step 5: Add the CLI flag and wire into `main()`**

In `parse_args()` (after the `--skip-rated` argument, ~line 147):

```python
    parser.add_argument(
        "--flagged-unrated", action="store_true",
        help="Triage mode: select only webcam snapshots with "
             "model_disagreement_kind set and no llm_quality yet "
             "(per-camera round-robin order). Implies --source webcam.",
    )
```

In `main()`, find the row-fetch dispatch (search for `fetch_webcam_rows(` inside `main()`); it looks like `rows = []` followed by `if args.source in (...)` branches. Add the triage branch FIRST, before the source branches, so it takes precedence:

```python
    if args.flagged_unrated:
        if args.source != "webcam":
            print("--flagged-unrated implies --source webcam; ignoring --source", file=sys.stderr)
        rows = fetch_flagged_unrated_rows(conn, args.limit)
    elif ...  # existing source branches unchanged, now guarded by elif
```

(Adjust the existing `if` chain to `elif` as needed — the existing `webcam` / `external` / `all` behavior must be unchanged when `--flagged-unrated` is absent.)

- [ ] **Step 6: Sanity-check the script still parses and the full ml test files still pass**

Run: `python3 -c "import sys; sys.path.insert(0, 'ml'); import llm_rater"` and `python3 -m pytest ml/ -v`
Expected: import OK; all ml tests PASS

- [ ] **Step 7: Commit**

```bash
git add ml/llm_rater.py ml/test_llm_rater_triage.py
git commit -m "feat(ml): --flagged-unrated triage selection with per-camera round-robin"
```

---

### Task 2: claude-sonnet-5 support (pricing + no sampling params)

**Files:**
- Modify: `ml/llm_rater.py` (`MODEL_PRICING_USD_PER_MTOK` ~line 203; `rate_with_anthropic` ~line 383)
- Test: `ml/test_llm_rater_triage.py` (append)

**Interfaces:**
- Produces: `rate_with_anthropic` no longer sends `temperature` (any model); pricing entry key `"claude-sonnet-5"`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Append to `ml/test_llm_rater_triage.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v -k "temperature or pricing"`
Expected: `test_anthropic_request_sends_no_temperature` FAILS (`temperature` IS in captured); `test_sonnet_5_has_a_pricing_entry` FAILS (KeyError)

- [ ] **Step 3: Implement**

In `MODEL_PRICING_USD_PER_MTOK` (~line 205), add above `"claude-sonnet-4-5"`:

```python
    # Sticker price; intro $2/$10 through 2026-08-31, Batch API halves either.
    "claude-sonnet-5":     {"input": 3.00, "output": 15.00},
```

(Prefix matching is longest-match-wins, and `"claude-sonnet-5"` vs `"claude-sonnet-4-5"` don't prefix-collide, so placement is for readability only.)

In `rate_with_anthropic` (~line 397), delete the `temperature=0.1,` line from `client.messages.create(...)`. Gemini/OpenAI providers keep their temperature settings — this change is Anthropic-path only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add ml/llm_rater.py ml/test_llm_rater_triage.py
git commit -m "feat(ml): claude-sonnet-5 support — pricing entry, drop temperature from anthropic path"
```

---

### Task 3: Run manifest (campaign provenance)

**Files:**
- Modify: `ml/llm_rater.py` (new function near the CSV/artifacts handling; wire at end of `main()`)
- Test: `ml/test_llm_rater_triage.py` (append)

**Interfaces:**
- Produces: `write_run_manifest(out_dir: str | Path, *, model: str, provider: str, selection: dict, attempted: int, succeeded: int, failed: int, tokens_in: int, tokens_out: int, est_cost_usd: float, started_at: str, finished_at: str) -> Path` — writes `run_<YYYYmmdd_HHMMSS>_manifest.json` and returns its path. JSON includes `prompt_sha256` (sha256 of `RATING_PROMPT`) and `prompt_version: "v2_extended"`.
- Consumes: `RATING_PROMPT` (existing module constant, line 60).

- [ ] **Step 1: Write the failing test**

Append to `ml/test_llm_rater_triage.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest ml/test_llm_rater_triage.py::test_run_manifest_contents -v`
Expected: FAIL with ImportError on `write_run_manifest`

- [ ] **Step 3: Implement**

In `ml/llm_rater.py` (near the other artifact-path helpers; `import hashlib` at top with the other stdlib imports):

```python
def write_run_manifest(
    out_dir: "str | Path",
    *,
    model: str,
    provider: str,
    selection: dict,
    attempted: int,
    succeeded: int,
    failed: int,
    tokens_in: int,
    tokens_out: int,
    est_cost_usd: float,
    started_at: str,
    finished_at: str,
) -> Path:
    """Write a per-campaign provenance manifest (2026-07-29 triage spec).

    Documents exactly how a rating run was produced so training exports
    can slice by judge/campaign later. The prompt has no version constant;
    its sha256 IS the version.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"run_{stamp}_manifest.json"
    path.write_text(json.dumps({
        "model": model,
        "provider": provider,
        "prompt_version": "v2_extended",
        "prompt_sha256": hashlib.sha256(RATING_PROMPT.encode("utf-8")).hexdigest(),
        "selection": selection,
        "counts": {"attempted": attempted, "succeeded": succeeded, "failed": failed},
        "tokens": {"input": tokens_in, "output": tokens_out},
        "est_cost_usd": est_cost_usd,
        "started_at": started_at,
        "finished_at": finished_at,
    }, indent=2))
    return path
```

(If `from pathlib import Path` isn't already imported at module top, add it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest ml/test_llm_rater_triage.py::test_run_manifest_contents -v`
Expected: PASS

- [ ] **Step 5: Wire into `main()`**

At the end of `main()` where the run summary is printed (search for the final summary/`print` block after the rating loop), add — for every run that is NOT `--dry-run` and NOT `--estimate-only`:

```python
    manifest_path = write_run_manifest(
        Path("ml/artifacts/llm_ratings"),
        model=model,
        provider=args.provider,
        selection={
            "mode": "flagged_unrated" if args.flagged_unrated else args.source,
            "limit": args.limit,
            "skip_rated": args.skip_rated,
            "use_batch_api": getattr(args, "use_batch_api", False),
        },
        attempted=attempted_count,
        succeeded=success_count,
        failed=failure_count,
        tokens_in=total_tokens_in,
        tokens_out=total_tokens_out,
        est_cost_usd=round(est_cost, 2),
        started_at=run_started_at_iso,
        finished_at=datetime.now(timezone.utc).isoformat(),
    )
    print(f"Run manifest: {manifest_path}")
```

Map the count/token variables onto whatever `main()`'s loop already tracks (it accumulates success/failure counts and token totals for the cost summary — reuse those names; capture `run_started_at_iso = datetime.now(timezone.utc).isoformat()` at loop start). If a token total isn't tracked on some path, pass 0 — never invent numbers.

- [ ] **Step 6: Run all triage tests + import check**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v && python3 -c "import sys; sys.path.insert(0, 'ml'); import llm_rater"`
Expected: all PASS, import OK

- [ ] **Step 7: Commit**

```bash
git add ml/llm_rater.py ml/test_llm_rater_triage.py
git commit -m "feat(ml): per-campaign run manifest with prompt hash provenance"
```

---

### Task 4: Batch API mode (`--use-batch-api`)

**Files:**
- Modify: `ml/llm_rater.py` (extract `normalize_rating` from `rate_image` ~line 438-483; new batch functions; arg + `main()` wiring)
- Modify: `ml/requirements.txt` (ensure `anthropic>=0.40`)
- Test: `ml/test_llm_rater_triage.py` (append)

**Interfaces:**
- Produces:
  - `normalize_rating(result: dict) -> dict` — applies the exact defaulting/clamping currently inline in `rate_image` (setdefaults for `is_sunset/is_sunrise/quality/confidence/has_clouds/color_palette/obstruction/time_of_day/sky_coverage/rating_explanation`, clamps quality+confidence to [0,1], normalizes `time_of_day` and `sky_coverage` enums).
  - `build_batch_requests(rows, model, download_timeout, download_fn=download_image_bytes) -> tuple[list[list[dict]], list[dict]]` — returns (chunks, failures). Each request dict: `{"custom_id": "<source_table>:<record_id>", "params": {...}}`. Chunk caps: `MAX_BATCH_REQUESTS = 1000`, `MAX_BATCH_BYTES = 200_000_000` (sum of base64 lengths).
  - `parse_custom_id(custom_id: str) -> tuple[str, int]` — `"webcam:123"` → `("webcam", 123)`.
  - argparse flag `args.use_batch_api`.
- Consumes: `fetch_flagged_unrated_rows` rows shape (Task 1), `DbWriter.write_rating` (existing), `rate_with_anthropic`'s message shape (existing), `write_run_manifest` (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `ml/test_llm_rater_triage.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v -k "normalize or custom_id or batch_requests"`
Expected: 4 FAIL with ImportError

- [ ] **Step 3: Extract `normalize_rating` (refactor, behavior-preserving)**

In `ml/llm_rater.py`, move the defaulting/clamping block currently inside `rate_image`'s try (lines ~452-472) into a module-level function, and call it from `rate_image`:

```python
def normalize_rating(result: dict) -> dict:
    """Apply defaults + clamps to a raw LLM rating dict (shared by the
    sequential path and the Batch API path)."""
    result.setdefault("is_sunset", False)
    result.setdefault("is_sunrise", False)
    result.setdefault("quality", 0.0)
    result.setdefault("confidence", 0.5)
    result.setdefault("has_clouds", False)
    result.setdefault("color_palette", "")
    result.setdefault("obstruction", None)
    result.setdefault("time_of_day", "unclear")
    result.setdefault("sky_coverage", "partial")
    result.setdefault("rating_explanation", "")
    result["quality"] = max(0.0, min(1.0, float(result["quality"])))
    result["confidence"] = max(0.0, min(1.0, float(result["confidence"])))
    time_of_day = str(result["time_of_day"]).strip().lower()
    if time_of_day not in {"golden_hour", "blue_hour", "twilight",
                           "day", "night", "unclear"}:
        time_of_day = "unclear"
    result["time_of_day"] = time_of_day
    sky_coverage = str(result["sky_coverage"]).strip().lower()
    if sky_coverage not in {"none", "partial", "mostly", "full"}:
        sky_coverage = "partial"
    result["sky_coverage"] = sky_coverage
    return result
```

Inside `rate_image`, replace the moved block with `result = normalize_rating(result)` followed by `return result`.

- [ ] **Step 4: Implement `parse_custom_id` and `build_batch_requests`**

```python
MAX_BATCH_REQUESTS = 1000
MAX_BATCH_BYTES = 200_000_000  # ~200 MB of base64 payload per batch (API cap 256 MB)


def parse_custom_id(custom_id: str) -> tuple[str, int]:
    source_table, _, record_id = custom_id.partition(":")
    return source_table, int(record_id)


def build_batch_requests(
    rows: list[dict],
    model: str,
    download_timeout: float,
    download_fn=download_image_bytes,
) -> tuple[list[list[dict]], list[dict]]:
    """Download images and build Message Batches request chunks.

    Returns (chunks, failures): chunks is a list of request-lists sized
    under MAX_BATCH_REQUESTS / MAX_BATCH_BYTES; failures records rows whose
    image could not be downloaded (they stay unrated — the
    --flagged-unrated predicate re-selects them on the next run).
    """
    chunks: list[list[dict]] = []
    current: list[dict] = []
    current_bytes = 0
    failures: list[dict] = []

    for row in rows:
        custom_id = f"{row['source_table']}:{row['record_id']}"
        try:
            image_bytes, content_type = download_fn(
                row["image_url"], timeout=download_timeout,
            )
        except Exception as exc:
            failures.append({"custom_id": custom_id, "error": str(exc)})
            continue
        media_type = detect_image_media_type(image_bytes, content_type)
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        request = {
            "custom_id": custom_id,
            "params": {
                "model": model,
                "max_tokens": 600,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image",
                         "source": {"type": "base64",
                                    "media_type": media_type,
                                    "data": b64}},
                        {"type": "text", "text": RATING_PROMPT},
                    ],
                }],
            },
        }
        if (len(current) >= MAX_BATCH_REQUESTS
                or current_bytes + len(b64) > MAX_BATCH_BYTES):
            if current:
                chunks.append(current)
            current, current_bytes = [], 0
        current.append(request)
        current_bytes += len(b64)

    if current:
        chunks.append(current)
    return chunks, failures
```

Note: the image/text content order matches `rate_with_anthropic` (image first, then `RATING_PROMPT`) so the sequential and batch paths send byte-identical prompts.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest ml/test_llm_rater_triage.py -v`
Expected: all PASS

- [ ] **Step 6: Implement submission/polling + `main()` wiring**

Add the runner (not unit-tested — exercised by the smoke slice in the runbook; keep it thin):

```python
def run_batch_chunks(
    api_key: str,
    chunks: list[list[dict]],
    poll_seconds: int = 60,
):
    """Submit each chunk as a Message Batch, poll to completion, and yield
    (custom_id, ok, payload, usage) tuples. payload is the parsed rating
    dict when ok, else an error string; usage is (input_tokens,
    output_tokens) for succeeded entries, (0, 0) otherwise."""
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    for i, chunk in enumerate(chunks, 1):
        batch = client.messages.batches.create(requests=chunk)
        print(f"Batch {i}/{len(chunks)} submitted: {batch.id} "
              f"({len(chunk)} requests)")
        while True:
            batch = client.messages.batches.retrieve(batch.id)
            if batch.processing_status == "ended":
                break
            time.sleep(poll_seconds)
        for result in client.messages.batches.results(batch.id):
            if result.result.type == "succeeded":
                message = result.result.message
                usage = (message.usage.input_tokens, message.usage.output_tokens)
                text = message.content[0].text.strip()
                if text.startswith("```"):
                    lines = text.split("\n")
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].startswith("```"):
                        lines = lines[:-1]
                    text = "\n".join(lines).strip()
                try:
                    yield result.custom_id, True, json.loads(text), usage
                except Exception as exc:
                    yield result.custom_id, False, f"unparseable JSON: {exc}", (0, 0)
            else:
                yield result.custom_id, False, result.result.type, (0, 0)
```

Add the argparse flag (after `--flagged-unrated`):

```python
    parser.add_argument(
        "--use-batch-api", action="store_true",
        help="Anthropic only: submit via the Message Batches API (50%% "
             "cheaper, hours not days). Requires --write-to-db; "
             "incompatible with --dry-run. CSV/HTML reports are skipped — "
             "the run manifest carries the accounting.",
    )
```

In `main()`, immediately after args are resolved, validate:

```python
    if args.use_batch_api:
        if args.provider != "anthropic":
            sys.exit("--use-batch-api requires --provider anthropic")
        if not args.write_to_db:
            sys.exit("--use-batch-api requires --write-to-db (no CSV path)")
        if args.dry_run:
            sys.exit("--use-batch-api is incompatible with --dry-run")
```

Then, where the sequential rating loop would begin, branch: if `args.use_batch_api`, run this flow INSTEAD of the sequential loop (then fall through to the manifest write from Task 3, then exit):

```python
    if args.use_batch_api:
        run_started_at_iso = datetime.now(timezone.utc).isoformat()
        chunks, failures = build_batch_requests(
            rows, model, args.download_timeout,
        )
        for f in failures:
            print(f"  download failed, left unrated: {f['custom_id']}: {f['error']}")
        db = DbWriter(database_url)
        success_count, failure_count = 0, len(failures)
        total_tokens_in = total_tokens_out = 0
        for custom_id, ok, payload, usage in run_batch_chunks(api_key, chunks):
            source_table, record_id = parse_custom_id(custom_id)
            total_tokens_in += usage[0]
            total_tokens_out += usage[1]
            if not ok:
                failure_count += 1
                print(f"  batch entry failed, left unrated: {custom_id}: {payload}")
                continue
            rating = normalize_rating(payload)
            db.write_rating(source_table, record_id, rating, model, args.provider)
            success_count += 1
        db.close()
        attempted_count = len(rows)
        # Sticker-rate estimate from real usage; the Batch API bills ~50% of
        # this (and intro pricing less again) — the manifest field is an
        # upper-bound estimate, actual billing is whatever Anthropic charges.
        price = MODEL_PRICING_USD_PER_MTOK.get(model, {"input": 0.0, "output": 0.0})
        est_cost = (total_tokens_in / 1e6) * price["input"] \
            + (total_tokens_out / 1e6) * price["output"]
        # ... Task 3 manifest write runs here ...
        print(f"Batch run complete: {success_count} rated, {failure_count} failed/skipped "
              f"of {attempted_count} selected.")
        return
```

- [ ] **Step 7: Ensure the SDK version supports Message Batches**

Check `ml/requirements.txt` for the `anthropic` line. If missing or older, set:

```
anthropic>=0.40
```

Then run: `python3 -c "import anthropic; print(anthropic.__version__); c=anthropic.Anthropic(api_key='x'); print(type(c.messages.batches))"`
Expected: prints a version ≥ 0.40 and a Batches resource type (no AttributeError). If the import fails locally, `pip3 install -U anthropic` first.

- [ ] **Step 8: Run the whole triage test file + ml suite**

Run: `python3 -m pytest ml/ -v`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add ml/llm_rater.py ml/test_llm_rater_triage.py ml/requirements.txt
git commit -m "feat(ml): Message Batches mode for the triage pass (--use-batch-api)"
```

---

### Task 5: `computeDisagreementKind` v2 — Claude adjudicates

**Files:**
- Modify: `app/api/cron/update-cameras/lib/aiScoring.ts` (function at ~line 217-257 + its doc comment)
- Test: `app/api/cron/update-cameras/lib/aiScoring.test.ts` (describe block at ~line 264)

**Interfaces:**
- Consumes: existing masterConfig thresholds (Global Constraints).
- Produces: unchanged signature `computeDisagreementKind(input: { binaryIsSunset?: boolean; aiRating?: number; llmQuality?: number | null; llmIsSunset?: boolean | null }): DisagreementKind | null`. New semantics: Claude-present ⇒ only model-vs-Claude kinds (with the two-judges-agree guard) or null; Claude-absent ⇒ binary-vs-regression rules unchanged. The recompute loop and live cron call sites need NO changes.

- [ ] **Step 1: Write the failing tests**

In `aiScoring.test.ts`, inside the existing `describe('computeDisagreementKind', ...)` block, add:

```typescript
  describe('v2: Claude adjudicates once present (2026-07-29 triage spec)', () => {
    it('clears a binary-vs-regression flag when Claude has rated and no model-vs-Claude contest applies', () => {
      // Dark frame: binary says no, regression 3.2 (>= 3.0 would have
      // flagged it), Claude confirms not-a-sunset. Settled.
      expect(
        computeDisagreementKind({
          binaryIsSunset: false,
          aiRating: 3.2,
          llmQuality: 0.05,
          llmIsSunset: false,
        }),
      ).toBeNull();
    });

    it('two judges agreeing not-sunset settles even a high regression score', () => {
      // Binary head AND Claude both say not-a-sunset: 2 of 3 judges agree,
      // so no promotion to model_high_claude_not_sunset despite rating >= 3.5.
      expect(
        computeDisagreementKind({
          binaryIsSunset: false,
          aiRating: 4.2,
          llmQuality: 0.05,
          llmIsSunset: false,
        }),
      ).toBeNull();
    });

    it('still flags model_high_claude_not_sunset when the binary head sides with the regression head', () => {
      expect(
        computeDisagreementKind({
          binaryIsSunset: true,
          aiRating: 4.0,
          llmQuality: 0.1,
          llmIsSunset: false,
        }),
      ).toBe('model_high_claude_not_sunset');
    });

    it('keeps model_high_claude_not_sunset when the binary verdict is absent (June archive rows)', () => {
      expect(
        computeDisagreementKind({
          aiRating: 4.0,
          llmQuality: 0.1,
          llmIsSunset: false,
        }),
      ).toBe('model_high_claude_not_sunset');
    });

    it('model_low_claude_sunset is unchanged', () => {
      expect(
        computeDisagreementKind({
          binaryIsSunset: false,
          aiRating: 1.5,
          llmQuality: 0.8,
          llmIsSunset: true,
        }),
      ).toBe('model_low_claude_sunset');
    });

    it('Claude-present with a mediocre verdict settles a binary_positive_regression_low flag', () => {
      // Would be binary_positive_regression_low (yes + 1.8 <= 2.0) without
      // Claude; Claude's mediocre-sunset verdict settles it.
      expect(
        computeDisagreementKind({
          binaryIsSunset: true,
          aiRating: 1.8,
          llmQuality: 0.3,
          llmIsSunset: true,
        }),
      ).toBeNull();
    });

    it('Claude-absent binary-vs-regression flags are unchanged (live cron path)', () => {
      expect(
        computeDisagreementKind({ binaryIsSunset: false, aiRating: 3.21 }),
      ).toBe('binary_negative_regression_high');
      expect(
        computeDisagreementKind({ binaryIsSunset: true, aiRating: 1.9 }),
      ).toBe('binary_positive_regression_low');
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts`
Expected: the first, second, and sixth new tests FAIL (old code falls through to binary rules / promotes without the binary guard); the rest of the new tests PASS; pre-existing tests PASS.

- [ ] **Step 3: Implement**

Replace the body of `computeDisagreementKind` (keep the signature and the doc comment's first paragraphs; extend the doc comment to describe adjudication):

```typescript
export function computeDisagreementKind(input: {
  binaryIsSunset?: boolean;
  aiRating?: number;
  llmQuality?: number | null;
  llmIsSunset?: boolean | null;
}): DisagreementKind | null {
  const { aiRating } = input;
  const hasClaude =
    typeof input.llmIsSunset === 'boolean' &&
    typeof input.llmQuality === 'number';

  // 1) Claude present → Claude adjudicates. Only genuine model-vs-Claude
  //    contests survive; everything else is settled (null). Binary-vs-
  //    regression flags are provisional pending this adjudication.
  if (hasClaude && typeof aiRating === 'number') {
    // miss: Claude confident it's a good sunset, model rated it low.
    if (
      input.llmIsSunset &&
      (input.llmQuality as number) >= MODEL_VS_CLAUDE_CLAUDE_HIGH &&
      aiRating <= MODEL_VS_CLAUDE_MODEL_LOW
    ) {
      return 'model_low_claude_sunset';
    }
    // false positive: model rated it high, Claude says it isn't a sunset —
    // UNLESS the binary head also says not-a-sunset, in which case two of
    // three judges agree and the case is settled (the regression head's
    // overrating is captured by the Claude label itself).
    if (
      !input.llmIsSunset &&
      aiRating >= MODEL_VS_CLAUDE_MODEL_HIGH &&
      input.binaryIsSunset !== false
    ) {
      return 'model_high_claude_not_sunset';
    }
    return null;
  }

  // 2) Claude absent → the model's internal split provisionally flags the
  //    frame for adjudication (live cron path; unchanged).
  if (typeof input.binaryIsSunset === 'boolean' && typeof aiRating === 'number') {
    if (!input.binaryIsSunset && aiRating >= SUNSET_DISAGREEMENT_HIGH) {
      return 'binary_negative_regression_high';
    }
    if (input.binaryIsSunset && aiRating <= SUNSET_DISAGREEMENT_LOW) {
      return 'binary_positive_regression_low';
    }
  }

  return null;
}
```

One behavior note for the doc comment: when Claude data is present but `aiRating` is undefined (no regression score), the function returns null — same as before, since every rule requires `aiRating`.

- [ ] **Step 4: Run the aiScoring suite; reconcile any pre-existing tests**

Run: `npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts`
Expected: all new tests PASS. If any PRE-EXISTING test fails, it encodes the old fall-through semantics (a case passing Claude data AND expecting a `binary_*` kind). For each such test: change the expectation to the v2 semantics (usually `null`) and add a one-line comment `// v2 (2026-07-29): Claude present ⇒ adjudicated, binary flags cleared`. Do NOT weaken tests that don't involve Claude data.

- [ ] **Step 5: Run the full TS suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass. `tsc` has ONE pre-existing unrelated error in `app/api/cameras/[id]/snapshot/route.test.ts` (Buffer/BlobPart) — ignore that one; anything else must be fixed.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/update-cameras/lib/aiScoring.ts app/api/cron/update-cameras/lib/aiScoring.test.ts
git commit -m "feat(scoring): computeDisagreementKind v2 — Claude adjudicates, two agreeing judges settle"
```

---

### Task 6: Operating guide — rating provenance + triage runbook

**Files:**
- Modify: `ml/OPERATING_GUIDE.md` (append two sections at the end)

**Interfaces:**
- Consumes: CLI flags from Tasks 1–4 (exact spellings: `--flagged-unrated`, `--use-batch-api`).
- Produces: the operator-facing runbook; no code.

- [ ] **Step 1: Append the two sections**

Append to `ml/OPERATING_GUIDE.md`:

```markdown
## Rating provenance

Every LLM rating is traceable; training exports may slice by any of these:

- **Judge:** `llm_model` + `llm_provider` + `llm_rated_at` are stamped on
  every `llm_*` write (e.g. `claude-sonnet-4-5` for the May/June campaigns,
  `claude-sonnet-5` for the 2026-07 triage pass). `llm_metadata.prompt_version`
  records the prompt revision. Exports that mix campaigns MUST carry
  `llm_model` into the dataset manifest so labels can be filtered or
  calibrated per judge.
- **Source:** webcam frames live in `webcam_snapshots`, Flickr in
  `external_images`. A webcam-only (or Flickr-free) model is a source filter
  in `export_dataset.py` — no data changes needed.
- **Model heads:** `ai_model_version_regression` / `ai_model_version_binary`
  stamp which ONNX versions scored each frame.
- **Campaign:** each non-dry `llm_rater.py` run writes
  `ml/artifacts/llm_ratings/run_<timestamp>_manifest.json` (model, prompt
  sha256, selection filters, counts, est. spend, timestamps).

## Hard-example triage runbook (2026-07 backlog)

Spec: `docs/superpowers/specs/2026-07-29-hard-example-triage-design.md`.
Each step is a manual operator action — the script never auto-escalates spend.

1. **Dry run (free):**
   `python3 ml/llm_rater.py --provider anthropic --model claude-sonnet-5 --flagged-unrated --dry-run`
   Check the selection count and eyeball the HTML sample.
2. **Smoke slice (~$1.50):**
   `python3 ml/llm_rater.py --provider anthropic --model claude-sonnet-5 --flagged-unrated --limit 500 --use-batch-api --write-to-db`
   Then verify: `llm_*` columns landed (`llm_model = 'claude-sonnet-5'`);
   within ~an hour the update-cameras cron's recompute step clears/promotes
   those 500 flags; Hard Examples queue counts move the right way.
3. **Full run (~$35–45):** same command without `--limit`.
4. **Recompute reset (one-time, after the v2 rule deploys):**
   ```sql
   UPDATE webcam_snapshots
   SET disagreement_computed_at = NULL
   WHERE model_disagreement_kind IS NOT NULL
     AND llm_quality IS NOT NULL;
   ```
   The hourly recompute loop then re-derives the June-rated rows under the
   v2 rule, page by page.
5. **Eyeball the queue.** Expect ~790 existing model-vs-Claude rows plus
   ~10% of the backlog as genuine contests; if the live cron refills the
   queue too fast afterward, see the spec's follow-ups (per-camera flag
   throttling, `SUNSET_DISAGREEMENT_HIGH` tuning).

Failed/errored frames stay unrated by design — re-running step 2/3 picks
them up (`--flagged-unrated` selects `llm_quality IS NULL`).
```

- [ ] **Step 2: Commit**

```bash
git add ml/OPERATING_GUIDE.md
git commit -m "docs(ml): rating-provenance contract + hard-example triage runbook"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suites**

Run: `npx vitest run && python3 -m pytest ml/ -v && npx tsc --noEmit`
Expected: all vitest + pytest pass; `tsc` shows only the one pre-existing `app/api/cameras/[id]/snapshot/route.test.ts` Buffer error.

- [ ] **Step 2: CLI smoke (no network, no spend)**

Run: `python3 ml/llm_rater.py --help | grep -E "flagged-unrated|use-batch-api"`
Expected: both flags listed with their help text.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin feat/hard-example-triage
```

Then hand back to Jesse for the runbook (dry-run → smoke → full → reset SQL) and the PR.
