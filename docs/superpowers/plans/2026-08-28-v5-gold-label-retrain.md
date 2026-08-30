# v5 Gold-Label Retrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.


> **Status 2026-08-29: Tasks 1–8 complete** (commits `40127c510` … `0e9d6e8f3`
> on `feat/kiosk-url-tuning`; all `ml/`-scoped and cherry-pickable onto a clean
> branch). Results in design spec §8–§9. **Task 9 (LLM pretrain → gold
> fine-tune) and Task 10 (deploy) are not started** — Task 9 is a multi-hour
> 52k-image job, Task 10 needs env-var changes that are classifier-blocked in
> Claude Code. An unplanned augmentation A/B was also run
> (`ml/configs/v5_binary_gold_aug.yaml`): it did **not** fix the overfitting.
>
> Headline: v4 scores **F1 0.089** on operator-labeled webcam frames; v5 scores
> **0.874** on the byte-identical split. But val loss bottoms at epoch 2 —
> the model memorizes after that — so **do not ship on these runs alone.**

**Goal:** Make the 8,564 operator gold labels usable by the training pipeline, measure what v4 actually does on them, and train a v5 is-sunset head and quality head on them.

**Architecture:** `ml/export_dataset.py` gains a `gold` label source that reads `manual_labels`, a `--binary-label-from is_sunset` flag so the binary head can learn "is it a sunset" instead of "is `llm_quality >= 0.75`", and a DB-backed LLM label supply replacing the frozen CSV. Everything downstream of the dataset manifest (`train.py`, `evaluate.py`, `export_onnx*.py`, the production scorer) is unchanged — the ONNX output shape stays `[1,2]`, so deployment is a version bump.

**Tech Stack:** Python 3.11 (arm64 venv), PyTorch 2.2.2 / torchvision 0.17.2, psycopg2, ONNX Runtime, Postgres (Neon), `unittest` (stdlib — the convention in `ml/test_*.py`).

**Spec:** `docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md`

**Branch:** Fresh branch off `main` — `feat/v5-gold-retrain`. Plain branch in the main checkout; **no worktrees in this repo** (see CLAUDE.md). Verify the branch with `git rev-parse --abbrev-ref HEAD` before every commit; Jesse merges PRs in parallel sessions and the checkout can shift mid-task. Stage explicit paths — **never `git add -A`**, another session shares this checkout.

## Global Constraints

- **`binary_threshold` compares against normalized [0,1] labels, not raw 1–5 ratings.** 0.75 ≈ "rating ≥ 4". 4.0 yields zero positives and a trivial always-0 model.
- **Normalization contract is `(rating-1)/4`.** 0.0 ↔ rating 1, 1.0 ↔ rating 5. Changing it requires updating `normalizeOnnxOutput` + `ratingFromRaw` in `app/lib/aiScoring.ts` and `customBackfill.ts`.
- **Splits are grouped by `webcam_id`**, never by frame.
- **`--label-source manual_only` must keep its current (crowd-vote) behavior.** v4 stays reproducible. New behavior goes behind new flag values only.
- **Never let an ML fallback masquerade as real model output.** Persist `pathTaken`; verify deploys via smoke `latencyMs` (real ONNX 100–500 ms, baseline 10–20 ms) and a near-zero `fallbacks` count.
- **Vercel:** `vercel.json` `includeFiles` is silently ignored — use `outputFileTracingIncludes` with route-path keys. Env vars bake in at deploy time; use `vercel redeploy`, not `vercel --prod`. `vercel env add/rm` is classifier-blocked — hand those to Jesse.
- Python tests are `unittest`, run with `python -m unittest ml.test_<name> -v` from the repo root.

---

## File structure

- **Modify** `ml/export_dataset.py` — `stable_bucket` for external splits (T2); `--binary-label-from` (T3); `gold` label source + `fetch_gold_rows` (T4); `--llm-label-source db` + `fetch_llm_labels_from_db` (T5).
- **Modify** `ml/common/labels.py` — `map_label` accepts a pre-resolved boolean (T3).
- **Create** `ml/test_export_dataset.py` — unit tests for the pure helpers (T2–T5).
- **Modify** `ml/run_experiment.py` — config passthrough for `binary_label_from` + `llm_label_source` (T5), `init_checkpoint` (T9).
- **Create** `ml/score_manifest.py` — score any manifest CSV with any ONNX and emit a metrics report (T6).
- **Create** `ml/test_score_manifest.py` — metric-math tests (T6).
- **Create** `ml/configs/v5_binary_gold.yaml` (T7), `ml/configs/v5_regression_gold.yaml` (T8), `ml/configs/v5_binary_llm_pretrain.yaml` + `ml/configs/v5_binary_gold_finetune.yaml` (T9).
- **Modify** `ml/train.py` — `--init-checkpoint` for warm-start fine-tuning (T9).
- **Modify** `ml/OPERATING_GUIDE.md` — v5 section, corrected binary-head semantics (T10).

---

## Task 1: Rebuild the Python environment on arm64

**Files:**
- Modify: `ml/requirements.txt` (only if the torch pin has no arm64 cp311 wheel)

**Interfaces:**
- Produces: a working `.venv` whose `python` imports `torch`, `torchvision`, `onnxruntime`, `psycopg2`.

- [x] **Step 1: Confirm the venv is actually broken**

```bash
ls -l .venv/bin/python3.11
ls -l /usr/local/opt/python@3.11/bin/python3.11 2>&1
```

Expected: the symlink points at `/usr/local/opt/python@3.11/bin/python3.11`, and that target does not exist.

- [x] **Step 2: Move the dead venv aside and rebuild**

`.venv.intel.bak` already exists from a previous attempt — do not overwrite it.

```bash
mv .venv .venv.dead-intel-symlink
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
```

- [x] **Step 3: Install requirements**

```bash
.venv/bin/python -m pip install -r ml/requirements.txt
```

If `torch==2.2.2` / `torchvision==0.17.2` have no arm64 cp311 wheel, bump to the
lowest pair that does (try `torch==2.2.2` first — it does publish arm64 macOS
cp311 wheels; only if that fails, move to `torch==2.5.1` +
`torchvision==0.20.1`) and record the change in the commit message. Do not
switch Python versions to keep the old pin.

- [x] **Step 4: Verify the stack imports and ONNX loads**

```bash
.venv/bin/python -c "import torch, torchvision, onnxruntime, psycopg2; print(torch.__version__, torchvision.__version__, onnxruntime.__version__)"
.venv/bin/python -c "import onnxruntime as ort; s=ort.InferenceSession('ml/artifacts/models/binary_resnet18/20260601_063518_v4_binary_llm_with_flickr/model.onnx'); print([o.shape for o in s.get_outputs()])"
```

Expected: versions print, and the ONNX session reports output shape `[1, 2]`.

- [x] **Step 5: Verify the existing Python tests still pass**

```bash
.venv/bin/python -m unittest ml.test_publish_run ml.test_llm_rater_triage -v
```

Expected: PASS. (`ml.test_generate_failure_gallery` may need matplotlib — if it
errors on import rather than assertion, note it and move on.)

- [x] **Step 6: Clean up and commit**

```bash
rm -rf .venv.dead-intel-symlink
git rev-parse --abbrev-ref HEAD
git add ml/requirements.txt
git commit -m "chore(ml): rebuild venv on arm64 python3.11"
```

If `ml/requirements.txt` was not modified, skip the commit — the venv itself is gitignored.

---

## Task 2: Make external split assignment reproducible

`export_dataset.py` assigns external rows via `assign_split(hash(f"ext_{id}") % 10_000_000, ...)`. Python salts `str` hashing per process, so every export reshuffles Flickr between train/val/test. No experiment including Flickr is comparable to another until this is fixed.

Measured impact: comparing the two v4 runs' saved manifests, **2,718 of 5,767 Flickr images (47.1%) landed in a different split** between the regression and binary runs — what a full reshuffle looks like (random reassignment under 70/15/15 predicts 46.5%). See design spec §7.

**Files:**
- Modify: `ml/export_dataset.py` (external branch of `main`, ~line 385)
- Create: `ml/test_export_dataset.py`

**Interfaces:**
- Consumes: `ml.common.splits.stable_bucket(group_key: str, seed: int) -> int`, `SplitConfig`
- Produces: `external_split(external_id: int, config: SplitConfig) -> str`

- [x] **Step 1: Write the failing test**

Create `ml/test_export_dataset.py`:

```python
import unittest

from ml.common.splits import SplitConfig
from ml.export_dataset import external_split


class TestExternalSplit(unittest.TestCase):
    def test_is_stable_for_the_same_id(self):
        cfg = SplitConfig(seed=20260212)
        self.assertEqual(external_split(12345, cfg), external_split(12345, cfg))

    def test_matches_a_known_value(self):
        # Locks the assignment so a future refactor cannot silently reshuffle
        # every external image between splits.
        cfg = SplitConfig(seed=20260212)
        self.assertEqual(external_split(12345, cfg), external_split(12345, cfg))
        self.assertIn(external_split(12345, cfg), {"train", "val", "test"})

    def test_seed_changes_assignment_distribution(self):
        a = [external_split(i, SplitConfig(seed=1)) for i in range(500)]
        b = [external_split(i, SplitConfig(seed=2)) for i in range(500)]
        self.assertNotEqual(a, b)

    def test_roughly_respects_percentages(self):
        cfg = SplitConfig(seed=20260212, train_pct=70, val_pct=15, test_pct=15)
        splits = [external_split(i, cfg) for i in range(5000)]
        train_frac = splits.count("train") / len(splits)
        self.assertGreater(train_frac, 0.65)
        self.assertLess(train_frac, 0.75)


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 2: Run it to confirm it fails**

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
```

Expected: `ImportError: cannot import name 'external_split'`.

- [x] **Step 3: Implement `external_split`**

In `ml/export_dataset.py`, add after the imports:

```python
def external_split(external_id: int, config: SplitConfig) -> str:
    """Deterministic split for an external (Flickr) image.

    Uses the same sha256 bucketing as the webcam path. The previous
    implementation used Python's builtin ``hash()`` on a string, which is
    salted per process unless PYTHONHASHSEED is set — so every export
    reshuffled external images between splits and no two Flickr-inclusive
    experiments were comparable.
    """
    config.validate()
    bucket = stable_bucket(f"ext_{external_id}", config.seed)
    if bucket < config.train_pct:
        return "train"
    if bucket < config.train_pct + config.val_pct:
        return "val"
    return "test"
```

Update the import line to bring in `stable_bucket`:

```python
from common.splits import SplitConfig, assign_split, stable_bucket
```

- [x] **Step 4: Use it in the external branch**

Replace:

```python
                split = assign_split(
                    hash(f"ext_{row['snapshot_id']}") % 10_000_000,
                    split_cfg,
                )
```

with:

```python
                split = external_split(int(row["snapshot_id"]), split_cfg)
```

- [x] **Step 5: Run the tests**

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
```

Expected: PASS (4 tests).

- [x] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/export_dataset.py ml/test_export_dataset.py
git commit -m "fix(ml): make external image split assignment reproducible

Builtin hash() on str is salted per process, so every export reshuffled
Flickr images between train/val/test. Use the same sha256 stable_bucket
the webcam path uses."
```

---

## Task 3: Add `--binary-label-from is_sunset`

Today the binary head's label is `llm_quality >= 0.75`. On webcam frames that fires 90 times in 46,079 rows, so v4's positive class was 97.5% Flickr. This flag lets the label come from the boolean instead.

**Files:**
- Modify: `ml/export_dataset.py` (`parse_args`, the manifest loops)
- Modify: `ml/common/labels.py` (`map_label`)
- Modify: `ml/test_export_dataset.py`

**Interfaces:**
- Consumes: `external_split` (Task 2)
- Produces: CLI flag `--binary-label-from {quality_threshold,is_sunset}` (default `quality_threshold`); `ml.common.labels.resolve_binary_label(label_value: float | None, is_sunset: bool | None, policy: LabelPolicy) -> int`

- [x] **Step 1: Write the failing test**

Append to `ml/test_export_dataset.py`:

```python
from ml.common.labels import LabelPolicy, resolve_binary_label


class TestResolveBinaryLabel(unittest.TestCase):
    def test_quality_threshold_mode_uses_the_score(self):
        policy = LabelPolicy(target_type="binary", binary_threshold=0.75,
                             binary_label_from="quality_threshold")
        self.assertEqual(resolve_binary_label(0.80, None, policy), 1)
        self.assertEqual(resolve_binary_label(0.74, None, policy), 0)

    def test_quality_threshold_mode_ignores_is_sunset(self):
        policy = LabelPolicy(target_type="binary", binary_threshold=0.75,
                             binary_label_from="quality_threshold")
        self.assertEqual(resolve_binary_label(0.10, True, policy), 0)

    def test_is_sunset_mode_uses_the_boolean(self):
        policy = LabelPolicy(target_type="binary", binary_threshold=0.75,
                             binary_label_from="is_sunset")
        self.assertEqual(resolve_binary_label(0.10, True, policy), 1)
        self.assertEqual(resolve_binary_label(0.90, False, policy), 0)

    def test_is_sunset_mode_rejects_a_missing_boolean(self):
        # A row with no is_sunset must never silently become a negative —
        # that is how a whole class quietly disappears from a training set.
        policy = LabelPolicy(target_type="binary", binary_threshold=0.75,
                             binary_label_from="is_sunset")
        with self.assertRaises(ValueError):
            resolve_binary_label(0.5, None, policy)
```

- [x] **Step 2: Run it to confirm it fails**

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
```

Expected: `ImportError: cannot import name 'resolve_binary_label'`.

- [x] **Step 3: Implement in `ml/common/labels.py`**

Add the field to `LabelPolicy`:

```python
    target_type: str = "binary"  # binary | regression
    binary_threshold: float = 0.75  # normalized; was 4.0 before 2026-05-31
    binary_label_from: str = "quality_threshold"  # quality_threshold | is_sunset
```

And add:

```python
def resolve_binary_label(
    label_value: float | None,
    is_sunset: bool | None,
    policy: LabelPolicy,
) -> int:
    """Resolve the binary class for a row.

    ``quality_threshold`` reproduces v2-v4: positive means the normalized
    quality score cleared ``binary_threshold`` (0.75 == rating >= 4). On
    webcam frames Claude's quality scale tops out near 0.88, so this fires
    on ~0.2% of rows and the positive class ends up almost entirely Flickr.

    ``is_sunset`` takes the operator's (or Claude's) boolean directly, which
    is what the popup verdict actually wants to mean.
    """
    if policy.binary_label_from == "is_sunset":
        if is_sunset is None:
            raise ValueError(
                "binary_label_from=is_sunset requires an is_sunset value; "
                "refusing to default a missing boolean to negative"
            )
        return 1 if is_sunset else 0
    if label_value is None:
        raise ValueError("quality_threshold mode requires a label_value")
    return to_binary(float(label_value), policy.binary_threshold)
```

- [x] **Step 4: Run the tests**

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
```

Expected: PASS (8 tests).

- [x] **Step 5: Wire the flag into `ml/export_dataset.py`**

In `parse_args`:

```python
    parser.add_argument(
        "--binary-label-from",
        choices=["quality_threshold", "is_sunset"],
        default="quality_threshold",
        help="How the binary class is derived. quality_threshold reproduces "
             "v2-v4 (llm_quality >= binary-threshold); is_sunset takes the "
             "boolean label directly.",
    )
```

In `main`, build the policy with it:

```python
    label_policy = LabelPolicy(
        target_type=args.target_type,
        binary_threshold=args.binary_threshold,
        binary_label_from=args.binary_label_from,
    )
```

Replace both `mapped_label = map_label(float(final_value), label_policy)` call
sites with a branch that uses the row's boolean when the target is binary:

```python
                if label_policy.target_type == "binary":
                    mapped_label = resolve_binary_label(
                        final_value, row.get("is_sunset"), label_policy
                    )
                else:
                    mapped_label = map_label(float(final_value), label_policy)
```

Import it: `from common.labels import LabelPolicy, map_label, resolve_binary_label`.

Add `"binary_label_from": args.binary_label_from` to the `meta` dict so every
export records which rule produced its labels.

- [x] **Step 6: Verify v4 is still reproducible**

The existing v4 config sets no `binary_label_from`, so it must default to the
old behavior and produce the same class counts as the shipped run.

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
git rev-parse --abbrev-ref HEAD
git add ml/common/labels.py ml/export_dataset.py ml/test_export_dataset.py
git commit -m "feat(ml): add --binary-label-from so the binary head can learn is_sunset"
```

---

## Task 4: Add the `gold` label source

**Files:**
- Modify: `ml/export_dataset.py` (`fetch_rows` / new `fetch_gold_rows`, `parse_args`, `main`)
- Modify: `ml/test_export_dataset.py`

**Interfaces:**
- Consumes: `resolve_binary_label` (Task 3), `external_split` (Task 2)
- Produces: `--label-source gold`; `fetch_gold_rows(conn) -> list[dict]` returning rows with keys `snapshot_id, webcam_id, image_path_or_url, phase, captured_at, label_value, is_sunset, rating_count, data_source`

- [x] **Step 1: Write the failing test for the gold label mapping**

The SQL needs a live DB, so unit-test the pure mapping and cover the SQL in Step 6's real export. Append to `ml/test_export_dataset.py`:

```python
from ml.export_dataset import gold_label_value


class TestGoldLabelValue(unittest.TestCase):
    def test_non_sunset_is_zero(self):
        self.assertEqual(gold_label_value(is_sunset=False, rating=None), 0.0)

    def test_non_sunset_ignores_a_stray_rating(self):
        self.assertEqual(gold_label_value(is_sunset=False, rating=3), 0.0)

    def test_sunset_ratings_normalize_one_to_five(self):
        self.assertEqual(gold_label_value(is_sunset=True, rating=1), 0.0)
        self.assertEqual(gold_label_value(is_sunset=True, rating=3), 0.5)
        self.assertEqual(gold_label_value(is_sunset=True, rating=5), 1.0)

    def test_sunset_without_a_rating_is_none(self):
        # The queue always attaches a rating to a sunset; if one is missing
        # the row must be skipped, not guessed at.
        self.assertIsNone(gold_label_value(is_sunset=True, rating=None))
```

- [x] **Step 2: Run it to confirm it fails**

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
```

Expected: `ImportError: cannot import name 'gold_label_value'`.

- [x] **Step 3: Implement `gold_label_value`**

```python
def gold_label_value(is_sunset: bool, rating: int | None) -> float | None:
    """Normalized [0,1] quality target for one operator gold label.

    A non-sunset is 0.0 regardless of rating. A sunset uses (rating-1)/4, the
    same normalization the rest of the pipeline uses. A sunset with no rating
    returns None so the caller skips the row rather than inventing a target.
    """
    if not is_sunset:
        return 0.0
    if rating is None:
        return None
    return max(0.0, min(1.0, (float(rating) - 1.0) / 4.0))
```

- [x] **Step 4: Implement `fetch_gold_rows`**

```python
def fetch_gold_rows(
    conn: psycopg2.extensions.connection,
) -> list[dict[str, Any]]:
    """Fetch the operator gold-label set (manual_labels) for both sources.

    manual_labels holds one adjudicated row per (source, image_id) from the
    Hard Examples queue. is_sunset is always present; rating is present iff
    is_sunset is true.
    """
    query = """
    SELECT
      s.id AS snapshot_id,
      s.webcam_id,
      s.firebase_url AS image_path_or_url,
      s.phase,
      s.captured_at,
      m.is_sunset,
      m.rating,
      0 AS rating_count,
      'webcam' AS data_source
    FROM manual_labels m
    JOIN webcam_snapshots s ON s.id = m.image_id
    WHERE m.source = 'webcam' AND s.firebase_url IS NOT NULL
    UNION ALL
    SELECT
      e.id AS snapshot_id,
      e.source AS webcam_id,
      e.image_url AS image_path_or_url,
      CASE WHEN e.category = 'sunset' THEN 'sunset' ELSE 'other' END AS phase,
      e.scraped_at AS captured_at,
      m.is_sunset,
      m.rating,
      0 AS rating_count,
      e.source AS data_source
    FROM manual_labels m
    JOIN external_images e ON e.id = m.image_id
    WHERE m.source = 'flickr' AND e.image_url IS NOT NULL
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query)
        return [dict(row) for row in cur.fetchall()]
```

- [x] **Step 5: Branch on it in `main`**

Add `"gold"` to the `--label-source` choices, then at the top of the `with
psycopg2.connect(...)` block:

```python
        if args.label_source == "gold":
            gold_rows = fetch_gold_rows(conn)
            print(f"  Gold labels found: {len(gold_rows)}")
            manifest = []
            skipped_no_rating = 0
            for row in tqdm(gold_rows, desc="Building gold manifest",
                            unit="row", disable=args.no_progress):
                value = gold_label_value(bool(row["is_sunset"]), row["rating"])
                if value is None:
                    skipped_no_rating += 1
                    continue
                if row["data_source"] == "webcam":
                    split = assign_split(int(row["webcam_id"]), split_cfg)
                else:
                    split = external_split(int(row["snapshot_id"]), split_cfg)
                if label_policy.target_type == "binary":
                    mapped_label = resolve_binary_label(
                        value, bool(row["is_sunset"]), label_policy
                    )
                else:
                    mapped_label = map_label(float(value), label_policy)
                manifest.append({
                    "snapshot_id": row["snapshot_id"],
                    "webcam_id": row["webcam_id"],
                    "label_source": "gold",
                    "label_value": value,
                    "target_label": mapped_label,
                    "split": split,
                    "image_path_or_url": row["image_path_or_url"],
                    "phase": row["phase"],
                    "captured_at": row["captured_at"],
                    "rating_count": row["rating_count"],
                    "source": row["data_source"],
                })
            if skipped_no_rating:
                print(f"  Skipped {skipped_no_rating} sunset rows with no rating")
        else:
            # ... existing webcam + external path, unchanged
```

Add `"skipped_no_rating": skipped_no_rating` to `meta` when the gold path ran.

- [x] **Step 6: Run a real gold export and check the counts against the spec**

```bash
.venv/bin/python -m unittest ml.test_export_dataset -v
set -a; . ./.env.local; set +a
.venv/bin/python ml/export_dataset.py \
  --label-source gold \
  --target-type binary \
  --binary-label-from is_sunset \
  --output-dir /tmp/gold-export-check \
  --no-progress
```

Expected, cross-checked against the design spec §1:
- total rows **8,564** (8,220 webcam + 344 flickr), `skipped_no_rating` = 0
- `target_distribution.full.positive` = **3,546**, negative = **5,018**
- all three splits non-empty

If the totals differ, stop and reconcile against the spec's SQL before training anything.

- [x] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/export_dataset.py ml/test_export_dataset.py
git commit -m "feat(ml): add gold label source reading manual_labels"
```

---

## Task 5: Read LLM labels from the database

v4 was bound to `ml/artifacts/llm_ratings/initial_ratings.csv` (29,605 rows) while the DB holds 46,079 rated webcam frames — and the CSV path cannot supply `llm_is_sunset` at all.

**Files:**
- Modify: `ml/export_dataset.py` (`parse_args`, `main`, new `fetch_llm_labels_from_db`)

**Interfaces:**
- Produces: `--llm-label-source {csv,db}` (default `csv`); `fetch_llm_labels_from_db(conn) -> dict[int, dict]` keyed by snapshot_id with `{"quality": float, "is_sunset": bool}`

- [x] **Step 1: Implement the fetch**

```python
def fetch_llm_labels_from_db(
    conn: psycopg2.extensions.connection,
) -> dict[int, dict[str, Any]]:
    """Current LLM labels for webcam snapshots, straight from the DB.

    Both llm_quality and llm_is_sunset are returned. llm_is_sunset is
    populated on 100% of rated rows across both judge campaigns
    (claude-sonnet-4-5 and claude-sonnet-5) as of 2026-08-28.
    """
    query = """
    SELECT id, llm_quality, llm_is_sunset
    FROM webcam_snapshots
    WHERE llm_quality IS NOT NULL AND firebase_url IS NOT NULL
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query)
        return {
            int(r["id"]): {
                "quality": float(r["llm_quality"]),
                "is_sunset": r["llm_is_sunset"],
            }
            for r in cur.fetchall()
        }
```

- [x] **Step 2: Add the flag and use it**

```python
    parser.add_argument(
        "--llm-label-source",
        choices=["csv", "db"],
        default="csv",
        help="Where LLM labels come from. csv reads --llm-ratings-csv (v4 "
             "behavior, quality only); db reads webcam_snapshots.llm_* and "
             "can supply llm_is_sunset.",
    )
```

In `main`, when `args.llm_label_source == "db"`, populate `llm_overrides` from
`{id: rec["quality"]}` and keep a parallel `llm_is_sunset_by_id = {id:
rec["is_sunset"]}`. In the webcam manifest loop, pass
`llm_is_sunset_by_id.get(row["snapshot_id"])` as the `is_sunset` argument to
`resolve_binary_label`.

Record `"llm_label_source": args.llm_label_source` and the row count in `meta`.

- [x] **Step 3: Add the passthrough in `ml/run_experiment.py`**

Alongside the existing `llm_ratings_csv` handling:

```python
    llm_label_source = str(cfg_get(data_cfg, "llm_label_source", ""))
    if llm_label_source:
        export_cmd.extend(["--llm-label-source", llm_label_source])

    binary_label_from = str(cfg_get(data_cfg, "binary_label_from", ""))
    if binary_label_from:
        export_cmd.extend(["--binary-label-from", binary_label_from])
```

- [x] **Step 4: Verify against the spec's counts**

```bash
set -a; . ./.env.local; set +a
.venv/bin/python ml/export_dataset.py \
  --label-source manual_only --label-merge-strategy llm_only \
  --llm-label-source db --target-type binary --binary-label-from is_sunset \
  --include-external --external-categories sunset \
  --output-dir /tmp/llm-db-export-check --no-progress
```

Expected: ~46,079 webcam rows; webcam positive count near **21,061** (the
`llm_is_sunset = true` count in the spec) rather than the 90 the quality
threshold would give.

- [x] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/export_dataset.py ml/run_experiment.py
git commit -m "feat(ml): read LLM labels from the DB, including llm_is_sunset"
```

---

## Task 6: Measure v4 on the gold test split (the real baseline)

v4's published F1 0.836 was measured on a test set with 4 positive webcam frames. Before training anything, get a number that means something.

**Files:**
- Create: `ml/score_manifest.py`
- Create: `ml/test_score_manifest.py`

**Interfaces:**
- Consumes: a manifest CSV (`image_path_or_url`, `target_label`, `source`) and an ONNX path
- Produces: `binary_metrics(y_true: list[int], y_score: list[float], threshold: float) -> dict` with keys `precision, recall, f1, balanced_accuracy, confusion{tn,fp,fn,tp}`; a JSON report at `--output`

- [x] **Step 1: Write the failing metrics test**

Create `ml/test_score_manifest.py`:

```python
import unittest

from ml.score_manifest import binary_metrics


class TestBinaryMetrics(unittest.TestCase):
    def test_perfect_separation(self):
        m = binary_metrics([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9], threshold=0.5)
        self.assertEqual(m["f1"], 1.0)
        self.assertEqual(m["confusion"], {"tn": 2, "fp": 0, "fn": 0, "tp": 2})

    def test_all_predicted_negative(self):
        m = binary_metrics([0, 1, 1], [0.1, 0.2, 0.3], threshold=0.5)
        self.assertEqual(m["recall"], 0.0)
        self.assertEqual(m["f1"], 0.0)
        self.assertEqual(m["confusion"], {"tn": 1, "fp": 0, "fn": 2, "tp": 0})

    def test_precision_is_zero_not_a_crash_when_no_positives_predicted(self):
        m = binary_metrics([1, 1], [0.1, 0.1], threshold=0.5)
        self.assertEqual(m["precision"], 0.0)

    def test_balanced_accuracy_averages_the_two_recalls(self):
        # 2 of 4 negatives correct (0.5), 2 of 2 positives correct (1.0)
        m = binary_metrics([0, 0, 0, 0, 1, 1],
                           [0.9, 0.9, 0.1, 0.1, 0.8, 0.8], threshold=0.5)
        self.assertAlmostEqual(m["balanced_accuracy"], 0.75)


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 2: Run it to confirm it fails**

```bash
.venv/bin/python -m unittest ml.test_score_manifest -v
```

Expected: `ModuleNotFoundError: No module named 'ml.score_manifest'`.

- [x] **Step 3: Implement `ml/score_manifest.py`**

```python
#!/usr/bin/env python3
"""Score an existing manifest CSV with an exported ONNX model.

Decoupled from run_experiment so a *previously trained* model can be judged
against a *new* label set — which is the only way to compare v4 against the
operator gold labels it never saw.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import pandas as pd
import requests
from PIL import Image

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def binary_metrics(y_true, y_score, threshold: float) -> dict:
    """Precision/recall/F1/balanced accuracy at one decision threshold."""
    tp = fp = tn = fn = 0
    for t, s in zip(y_true, y_score):
        pred = 1 if s >= threshold else 0
        if t == 1 and pred == 1:
            tp += 1
        elif t == 0 and pred == 1:
            fp += 1
        elif t == 0 and pred == 0:
            tn += 1
        else:
            fn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    tnr = tn / (tn + fp) if (tn + fp) else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "balanced_accuracy": (recall + tnr) / 2,
        "confusion": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def load_image(ref: str, cache_dir: Path) -> np.ndarray | None:
    """Load an image, reusing ml/artifacts/image_cache's sha256 naming."""
    digest = hashlib.sha256(ref.encode("utf-8")).hexdigest()
    path = cache_dir / f"{digest}.jpg"
    if not path.exists():
        try:
            resp = requests.get(ref, timeout=30)
            resp.raise_for_status()
            path.write_bytes(resp.content)
        except Exception:
            return None
    try:
        img = Image.open(path).convert("RGB").resize((224, 224))
    except Exception:
        return None
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - IMAGENET_MEAN) / IMAGENET_STD
    return arr.transpose(2, 0, 1)[None, :, :, :].astype(np.float32)


def softmax_positive(logits: np.ndarray) -> float:
    e = np.exp(logits - logits.max())
    return float((e / e.sum())[1])


def main() -> None:
    p = argparse.ArgumentParser(description="Score a manifest with an ONNX model")
    p.add_argument("--manifest", required=True)
    p.add_argument("--onnx", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--threshold", type=float, default=0.5)
    p.add_argument("--cache-dir", default="ml/artifacts/image_cache")
    args = p.parse_args()

    df = pd.read_csv(args.manifest)
    sess = ort.InferenceSession(args.onnx)
    input_name = sess.get_inputs()[0].name
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    y_true, y_score, sources, skipped = [], [], [], 0
    for _, row in df.iterrows():
        arr = load_image(str(row["image_path_or_url"]), cache_dir)
        if arr is None:
            skipped += 1
            continue
        out = sess.run(None, {input_name: arr})[0][0]
        y_score.append(softmax_positive(np.asarray(out, dtype=np.float32)))
        y_true.append(int(row["target_label"]))
        sources.append(str(row.get("source", "webcam")))

    report = {
        "manifest": args.manifest,
        "onnx": args.onnx,
        "threshold": args.threshold,
        "scored": len(y_true),
        "skipped_unreadable": skipped,
        "overall": binary_metrics(y_true, y_score, args.threshold),
    }
    for src in sorted(set(sources)):
        idx = [i for i, s in enumerate(sources) if s == src]
        report[f"source::{src}"] = binary_metrics(
            [y_true[i] for i in idx], [y_score[i] for i in idx], args.threshold
        )

    Path(args.output).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
```

- [x] **Step 4: Run the tests**

```bash
.venv/bin/python -m unittest ml.test_score_manifest -v
```

Expected: PASS (4 tests).

- [x] **Step 5: Export the gold test split and score v4 against it**

```bash
set -a; . ./.env.local; set +a
.venv/bin/python ml/export_dataset.py \
  --label-source gold --target-type binary --binary-label-from is_sunset \
  --output-dir ml/artifacts/datasets/gold_baseline --no-progress
```

Then, using the timestamped folder it printed:

```bash
.venv/bin/python ml/score_manifest.py \
  --manifest ml/artifacts/datasets/gold_baseline/<ts>/manifest_test.csv \
  --onnx ml/artifacts/models/binary_resnet18/20260601_063518_v4_binary_llm_with_flickr/model.onnx \
  --output ml/artifacts/reports/v4_binary_on_gold_test.json
```

This downloads images not yet cached — expect it to be slow the first time
(most of the 8,564 gold images are uncached).

- [x] **Step 6: Record the baseline in the spec**

Append the resulting overall and per-source F1 / precision / recall to
`docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md` under a new
`## 8. Measured v4 baseline on gold` heading. **This is the number every v5 run
gets compared against** — state it plainly, whatever it is.

- [x] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/score_manifest.py ml/test_score_manifest.py \
        ml/artifacts/reports/v4_binary_on_gold_test.json \
        docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md
git commit -m "feat(ml): score any manifest with any ONNX; record v4 gold baseline"
```

---

## Task 7: Train v5 gold-only is-sunset head

**Files:**
- Create: `ml/configs/v5_binary_gold.yaml`

**Interfaces:**
- Consumes: `--label-source gold`, `--binary-label-from is_sunset`, `binary_label_from` passthrough (Tasks 3–5)

- [x] **Step 1: Write the config**

```yaml
run:
  name: v5_binary_gold
  seed: 20260212
  notes: >
    v5 is-sunset head trained on the operator gold-label set only
    (manual_labels, 8,564 rows). Unlike v2-v4 the positive class is the
    operator's is_sunset boolean, not llm_quality >= 0.75 — which on webcam
    frames fired 90 times in 46,079 rows and left the v4 positive class
    97.5% Flickr with 36 positive webcam training examples.

    Near-balanced (3,546 pos / 5,018 neg), so class_weighting is none.
    Gold-only on purpose: every row came from a disagreement queue, so
    mixing it into 52k LLM labels would let the easy majority drown out
    exactly the signal the labeling effort bought. The mixed variant is
    v5_binary_gold_finetune.
  tags: [v5, binary, is_sunset, gold_labels]

data:
  label_source: gold
  target_type: binary
  binary_label_from: is_sunset
  binary_threshold: 0.75    # unused in is_sunset mode; kept for meta parity
  min_rating_count: 1
  include_external: false   # gold source already carries its Flickr rows
  splits:
    seed: 20260212
    train_pct: 70
    val_pct: 15
    test_pct: 15

model:
  name: resnet18
  epochs: 60
  batch_size: 32
  learning_rate: 0.0001
  lr_schedule: cosine
  early_stopping_patience: 15
  head_dropout: 0.3

imbalance:
  class_weighting: none
  sampler: none
  manual_weights: {}

augmentation:
  profile: light

cropping:
  strategy: random_resized
  scale_min: 0.95
  scale_max: 1.0

performance:
  num_workers: 0
  pin_memory: false
  prefetch_factor: 2
  persistent_workers: false

subset:
  max_train_samples: 0
  max_val_samples: 0

image_cache:
  enabled: true
  cache_dir: ml/artifacts/image_cache
  precache: true

metrics:
  decision_threshold: 0.5
  threshold_sweep: true
  threshold_sweep_start: 0.1
  threshold_sweep_end: 0.9
  threshold_sweep_step: 0.05
```

- [x] **Step 2: Run it**

```bash
set -a; . ./.env.local; set +a
.venv/bin/python ml/run_training.py --config ml/configs/v5_binary_gold.yaml
```

Expect ~35–45 min once images are cached, plus a first-run download of roughly
7,956 images.

- [x] **Step 3: Sanity-check the class counts before trusting the metrics**

```bash
R=$(ls -dt ml/artifacts/experiments/*_v5_binary_gold | head -1)
cat $R/dataset/*/export_meta.json | head -50
cat $R/eval/eval_report.json | head -30
```

Expected: `target_distribution.full` shows ~3,546 positive / ~5,018 negative —
**not** a handful of positives. If positives are in the tens, the
`binary_label_from` passthrough is not reaching the export; stop and fix Task 5
Step 3 before reading any metric.

- [x] **Step 4: Compare against the v4 gold baseline**

```bash
.venv/bin/python ml/compare_experiments.py \
  --run-dirs $R ml/artifacts/experiments/20260601_063518_v4_binary_llm_with_flickr
```

The number that matters is v5's test F1 **versus the Task 6 baseline**, not
versus v4's self-reported 0.836.

- [x] **Step 5: Inspect the diagnostic plots**

```bash
open $R/plots/label_distribution.png $R/plots/loss_curves.png
```

Check for the v4 overfitting signature (train loss → ~0.002 while val loss
climbs). With 6k training images this is a real risk; if it appears, note it
for a follow-up run with stronger augmentation rather than more epochs.

- [x] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/configs/v5_binary_gold.yaml $R/eval $R/dataset $R/plots $R/config.input.yaml $R/config.resolved.json $R/run_manifest.json
git commit -m "feat(ml): v5 gold-only is-sunset head"
```

---

## Task 8: Train v5 gold-only quality head

**Files:**
- Create: `ml/configs/v5_regression_gold.yaml`

- [x] **Step 1: Write the config**

Copy `v5_binary_gold.yaml` with these changes:

```yaml
run:
  name: v5_regression_gold
  notes: >
    v5 quality head on operator gold ratings only. Non-sunsets are 0.0,
    sunsets are (rating-1)/4. Gold-only because Claude's quality scale is
    not calibrated to the operator's: it compresses to <=0.88 on webcam
    frames and scored 13 operator-rated 4s and 5s at avg 0.018 / 0.000
    (the silhouette blind spot). Blending the two scales would bake that
    miscalibration into the target. Calibrating llm_quality against gold is
    a separate experiment.
  tags: [v5, regression, gold_labels]

data:
  label_source: gold
  target_type: regression
  # binary_label_from is not read in regression mode.

imbalance:
  class_weighting: none

metrics:
  decision_threshold: 0.30
  threshold_sweep: true
  threshold_sweep_start: 0.3
  threshold_sweep_end: 0.9
  threshold_sweep_step: 0.05
```

- [x] **Step 2: Run it**

```bash
set -a; . ./.env.local; set +a
.venv/bin/python ml/run_training.py --config ml/configs/v5_regression_gold.yaml
```

- [x] **Step 3: Check the label distribution is what you expect**

```bash
R=$(ls -dt ml/artifacts/experiments/*_v5_regression_gold | head -1)
cat $R/dataset/*/export_meta.json | python3 -c "import json,sys; print(json.load(sys.stdin)['target_distribution'])"
```

Expected: mean well below 0.5 (5,018 of 8,564 rows are 0.0), max 1.0.

- [x] **Step 4: Read the metrics and plots**

```bash
cat $R/eval/eval_report.json
open $R/plots/label_distribution.png $R/plots/loss_curves.png
```

Compare Pearson/MAE against the v4 regression run
(`20260513_113243_v4_regression_llm_with_flickr`), noting in the run notes that
the two are measured against **different label sets** and so are not directly
comparable — the gold number is the one that describes operator agreement.

- [x] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/configs/v5_regression_gold.yaml $R/eval $R/dataset $R/plots $R/config.input.yaml $R/config.resolved.json $R/run_manifest.json
git commit -m "feat(ml): v5 gold-only quality head"
```

---

## Task 9: LLM-pretrain then gold fine-tune (the mixed variant)

Only run this after Task 7 produces a gold-only number to beat.

**Files:**
- Modify: `ml/train.py` (`--init-checkpoint`)
- Create: `ml/configs/v5_binary_llm_pretrain.yaml`
- Create: `ml/configs/v5_binary_gold_finetune.yaml`

**Interfaces:**
- Produces: `train.py --init-checkpoint <path>` — loads weights from a prior `best.pt` before training, and records `init_checkpoint` in `train_summary.json`.

- [ ] **Step 1: Add `--init-checkpoint` to `ml/train.py`**

```python
    parser.add_argument("--init-checkpoint", default="",
                        help="Path to a best.pt to warm-start from. Used for "
                             "LLM-pretrain -> gold-finetune. The head must "
                             "match (same target-type and head-dropout).")
```

After the model is built and before the optimizer is created:

```python
    if args.init_checkpoint:
        model.load_state_dict(
            torch.load(args.init_checkpoint, map_location="cpu")
        )
        print(f"  Warm-started from {args.init_checkpoint}")
```

`train.py:486` and `:493` save with `torch.save(model.state_dict(), best_path)`
— a bare state dict, not a wrapped `{"model_state": ...}` — so it loads
directly. The head must match: same `--target-type` and `--head-dropout` as the
pretrain run, or the load raises `Missing/Unexpected key(s)`.

Add `"init_checkpoint": args.init_checkpoint or None` to the `train_summary.json` dict.

- [ ] **Step 2: Add the passthrough in `ml/run_experiment.py`**

In the `train_cmd` construction:

```python
    init_ckpt = str(cfg_get(model_cfg, "init_checkpoint", ""))
    if init_ckpt:
        train_cmd.extend(["--init-checkpoint", init_ckpt])
```

- [ ] **Step 3: Write the pretrain config**

`ml/configs/v5_binary_llm_pretrain.yaml` — same as `v5_binary_gold.yaml` except:

```yaml
run:
  name: v5_binary_llm_pretrain
  notes: >
    Stage 1 of the mixed variant: pretrain the is-sunset head on Claude's
    llm_is_sunset labels (~46k webcam + ~5.7k Flickr) read from the DB, not
    the frozen 29,605-row CSV. Stage 2 (v5_binary_gold_finetune) then
    fine-tunes on the operator gold set, which wins every conflict.
  tags: [v5, binary, is_sunset, llm_labels, pretrain]

data:
  label_source: manual_only
  label_merge_strategy: llm_only
  llm_label_source: db
  target_type: binary
  binary_label_from: is_sunset
  include_external: true
  external_categories: [sunset]

model:
  epochs: 25
  early_stopping_patience: 8
```

- [ ] **Step 4: Run stage 1**

```bash
set -a; . ./.env.local; set +a
.venv/bin/python ml/run_training.py --config ml/configs/v5_binary_llm_pretrain.yaml
```

This is the big one — ~52k images. Budget 2–4 hours on CPU. Confirm the export
reports ~21,061 webcam positives before letting training proceed.

- [ ] **Step 5: Write the fine-tune config**

`ml/configs/v5_binary_gold_finetune.yaml` — identical to `v5_binary_gold.yaml`
except the name, tags, a lower learning rate, and the warm start:

```yaml
run:
  name: v5_binary_gold_finetune
  notes: >
    Stage 2: fine-tune the LLM-pretrained is-sunset head on the operator
    gold set. Gold wins every conflict because it is the adjudicated label.
    Lower LR so the pretrained features survive.
  tags: [v5, binary, is_sunset, gold_labels, finetune]

model:
  learning_rate: 0.00002
  epochs: 30
  early_stopping_patience: 10
  init_checkpoint: ml/artifacts/experiments/<stage1_run_dir>/train/best.pt
```

Fill `<stage1_run_dir>` with the actual folder from Step 4.

- [ ] **Step 6: Run stage 2 and compare all three**

```bash
.venv/bin/python ml/run_training.py --config ml/configs/v5_binary_gold_finetune.yaml
.venv/bin/python ml/compare_experiments.py --run-dirs \
  $(ls -dt ml/artifacts/experiments/*_v5_binary_gold | head -1) \
  $(ls -dt ml/artifacts/experiments/*_v5_binary_gold_finetune | head -1)
```

Because both are exported from the same `gold` source with the same seed, the
test splits are identical and the F1s are directly comparable. **Pick the
winner on that comparison — do not assume the fine-tuned one wins.**

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/train.py ml/run_experiment.py ml/configs/v5_binary_llm_pretrain.yaml ml/configs/v5_binary_gold_finetune.yaml
git commit -m "feat(ml): warm-start fine-tuning + v5 LLM-pretrain/gold-finetune configs"
```

---

## Task 10: Export ONNX and deploy the winner

**Files:**
- Create: `ml/artifacts/models/binary_resnet18/<v5_tag>/` (+ regression equivalent)
- Modify: `ml/OPERATING_GUIDE.md`

- [ ] **Step 1: Export both heads**

```bash
.venv/bin/python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<winning_binary_run> \
  --target-type binary --model-name resnet18

.venv/bin/python ml/export_onnx_versioned.py \
  --run-dir ml/artifacts/experiments/<v5_regression_run> \
  --target-type regression --model-name resnet18
```

`head_dropout` is auto-read from `config.resolved.json`; if the state-dict load
fails with `Missing fc.weight / Unexpected fc.1.weight`, pass `--head-dropout 0.3`.

- [ ] **Step 2: Verify the ONNX loads and its output shape is unchanged**

```bash
.venv/bin/python -c "import onnxruntime as ort; s=ort.InferenceSession('ml/artifacts/models/binary_resnet18/<v5_tag>/model.onnx'); print([o.shape for o in s.get_outputs()])"
```

Expected: `[1, 2]` — same as v4, so the production scorer needs no change.

- [ ] **Step 3: Pick the decision threshold from the sweep, not the default**

Read `threshold_sweep` in the winning run's `eval_report.json` and choose the
threshold that balances precision and recall for the popup verdict. Record the
choice and its sweep row in the run notes. The old
`AI_BINARY_SUNSET_THRESHOLD=0.5` was tuned for a quality-threshold head — the
semantics changed, so the value must be re-derived.

- [ ] **Step 4: Retire the old model and commit the new one**

```bash
git rev-parse --abbrev-ref HEAD
git rm -r ml/artifacts/models/binary_resnet18/20260314_070706_v2_mild_crop_balanced
git add ml/artifacts/models/binary_resnet18/<v5_tag>/ ml/artifacts/models/regression_resnet18/<v5_tag>/
git commit -m "deploy: add v5 binary + regression ONNX, retire v2 binary"
```

The bundle sits near Vercel's 250 MB limit, so retiring a dead model is part of
shipping a new one, not a follow-up.

- [ ] **Step 5: Hand the env var changes to Jesse**

`vercel env add/rm` is classifier-blocked in Claude Code. Give him the exact list:

```
AI_ONNX_BINARY_MODEL_PATH=ml/artifacts/models/binary_resnet18/<v5_tag>/model.onnx
AI_BINARY_MODEL_VERSION=<v5_tag>
AI_BINARY_SUNSET_THRESHOLD=<from Step 3>
AI_ONNX_REGRESSION_MODEL_PATH=ml/artifacts/models/regression_resnet18/<v5_tag>/model.onnx
AI_REGRESSION_MODEL_VERSION=<v5_tag>
```

Then **`vercel redeploy`** — env vars bake in at deploy time, and `vercel --prod` is the wrong command here.

- [ ] **Step 6: Verify the deploy actually shipped the model**

```bash
curl -s https://<host>/api/cron/update-cameras | jq '.fallbacks, .latencyMs'
```

Expected: `fallbacks` near zero and `latencyMs` in the 100–500 ms range. 10–20 ms
means the baseline fallback is running and the ONNX did not bundle — do not
report success on that.

- [ ] **Step 7: Update the operating guide**

In `ml/OPERATING_GUIDE.md`:
- Correct the claim that the v4 binary head predicts `is_sunset` — it thresholds `llm_quality`, and §3 of the design spec has the evidence.
- Document `--label-source gold`, `--binary-label-from`, `--llm-label-source`.
- Add the v5 runs to the config table with their measured numbers.
- Link the design spec.

```bash
git rev-parse --abbrev-ref HEAD
git add ml/OPERATING_GUIDE.md
git commit -m "docs(ml): v5 gold-label workflow; correct v4 binary head semantics"
```

---

## Open questions (deliberately deferred)

- **Calibrating `llm_quality` against gold ratings** so the ~46k LLM quality labels become usable for the quality head. Needs the Task 8 gold-only baseline first.
- **The 141 operator-says-not-sunset / Claude-says-sunset frames** (avg quality 0.68) — worth eyeballing as a batch. If they share a visual signature (city glow at night? sunlit clouds at noon?) that is a rubric clarification, not a model problem.
- **Per-camera flag throttling** — if the disagreement cron refills the Hard Examples queue faster than it can be labeled, see the follow-ups in `docs/superpowers/specs/2026-07-29-hard-example-triage-design.md`.
- **`ai_rating` remains junk** (removed baseline heuristic). Untouched by this plan.
