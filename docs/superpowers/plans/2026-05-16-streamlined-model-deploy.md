# Streamlined Model Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `scripts/deploy-model.sh <run_dir>` — a single command that takes a trained PyTorch run from `.pt` to confirmed-running-in-production v4 ONNX on Vercel, with guardrails against the silent-fallback pattern documented in `memory/feedback_silent_ml_fallback.md`.

**Architecture:** Five rerunnable bash stages (export → validate → git stage → Vercel env+deploy → verify) calling existing Python (`export_onnx_versioned.py`), a new Python validator (`validate_deploy_bundle.py`), the `vercel` CLI, and two new HTTP endpoints (`scoringPaths` counter on the existing cron route + a new `/api/debug/scoring-smoke` endpoint). No local state file — the world (git + filesystem + Vercel + cron response) is the source of truth.

**Tech Stack:** Bash 4+, Python 3.11 + PyTorch + onnxruntime, Next.js 15 (TypeScript), vitest, Vercel CLI 39+, `jq`.

**Reference spec:** `docs/superpowers/specs/2026-05-16-streamlined-model-deploy-design.md`

---

## File Structure

**New:**
- `app/api/debug/scoring-smoke/route.ts` — smoke-test endpoint
- `app/api/debug/scoring-smoke/route.test.ts` — vitest tests
- `app/api/debug/scoring-smoke/test-image.jpg` — committed ~50 KB JPEG fixture
- `ml/validate_deploy_bundle.py` — four-check validator called by Stage 2
- `ml/test_validate_deploy_bundle.py` — unittest tests
- `scripts/deploy-model.sh` — orchestrator
- `scripts/deploy-model-config.sh` — portable CONFIG block (sourced by deploy-model.sh)

**Modified:**
- `app/api/cron/update-cameras/route.ts` — add `scoringPaths` counter to response (~15 lines added near existing `windyScores` / `cacheHits` / `fallbacks` accumulation around line 158-272)
- `app/api/cron/update-cameras/route.test.ts` — assert `scoringPaths` shape in response
- `ml/OPERATING_GUIDE.md` — §9 points to `scripts/deploy-model.sh` as canonical workflow
- `package.json` — add `"deploy-model"` script

Each file has one clear responsibility:
- `scoring-smoke/route.ts` does *only* "force one ONNX inference on a known image"
- `validate_deploy_bundle.py` does *only* the four pre-deploy checks
- `deploy-model.sh` does *only* orchestration; all real work delegates to existing tools
- `deploy-model-config.sh` is just bash variable assignments — portability boundary

---

## Branch Setup

- [ ] **Step 1: Create feature branch off main**

Run:
```bash
git fetch origin main
git checkout -b feat/streamlined-model-deploy origin/main
```
Expected: switched to new branch, clean working tree.

---

## Task 1: Add `scoringPaths` counter to cron response

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts:120-273`
- Modify: `app/api/cron/update-cameras/route.test.ts:103-151`

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `describe('GET /api/cron/update-cameras', …)` block in `app/api/cron/update-cameras/route.test.ts` (after the last existing `it(...)`):

```ts
it('returns a scoringPaths breakdown counted from scored.pathTaken', async () => {
  // Three webcams: one onnx, one cache-hit, one baseline-fallback.
  fetchBatchesMock.mockResolvedValueOnce([[
    { webcamId: 7, location: { latitude: 0, longitude: 0 },
      images: { current: { preview: 'https://x/a.jpg' } }, viewCount: 1, rating: 3 },
    { webcamId: 8, location: { latitude: 0, longitude: 0 },
      images: { current: { preview: 'https://x/b.jpg' } }, viewCount: 1, rating: 3 },
    { webcamId: 9, location: { latitude: 0, longitude: 0 },
      images: { current: { preview: 'https://x/c.jpg' } }, viewCount: 1, rating: 3 },
  ]]);
  getIdMapMock.mockResolvedValueOnce(new Map([['7', 700], ['8', 800], ['9', 900]]));
  scoreMock
    .mockResolvedValueOnce({ rawScore: 0.6, aiRating: 3.4, modelVersion: 'v4', imageHash: 'h1', source: 'windy', pathTaken: 'onnx' })
    .mockResolvedValueOnce({ rawScore: 0, aiRating: 0, modelVersion: 'v4', imageHash: 'h2', source: 'windy', pathTaken: 'cache-hit' })
    .mockResolvedValueOnce({ rawScore: 0.4, aiRating: 2.6, modelVersion: 'v4', imageHash: 'h3', source: 'windy', pathTaken: 'baseline-fallback' });
  const res = await GET(makeReq());
  const body = await res.json();
  expect(body.scoringPaths).toEqual({
    onnx: 1,
    'cache-hit': 1,
    'baseline-fallback': 1,
    baseline: 0,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts -t "scoringPaths" --reporter=basic`
Expected: FAIL with `expected undefined to deeply equal { onnx: 1, ... }` (the field doesn't exist yet).

- [ ] **Step 3: Implement scoringPaths in route.ts**

Open `app/api/cron/update-cameras/route.ts`. Find the declarations near line 75-85 where counters like `let fallbacks = 0` are declared (specifically the `cacheHits`, `fallbacks` lines just above the `scoreOneWindy` function). Add:

```ts
const scoringPaths: Record<'onnx' | 'cache-hit' | 'baseline-fallback' | 'baseline', number> = {
  onnx: 0,
  'cache-hit': 0,
  'baseline-fallback': 0,
  baseline: 0,
};
```

Then in `scoreOneWindy` (around line 158-162), update the cache-hit branch and add a counter line for all paths:

```ts
if (scored.pathTaken === 'cache-hit') {
  cacheHits += 1;
  scoringPaths['cache-hit'] += 1;
  return;
}
if (scored.pathTaken === 'baseline-fallback') fallbacks += 1;
scoringPaths[scored.pathTaken] = (scoringPaths[scored.pathTaken] ?? 0) + 1;
windyScores.push(scored.rawScore);
```

Then in the `NextResponse.json({...})` block around line 265-273, add `scoringPaths` to the response:

```ts
return NextResponse.json({
  ok: true,
  sunrise: sunriseList.length,
  sunset: sunsetList.length,
  windyScored: windyScores.length,
  cacheHits,
  fallbacks,
  scoringPaths,
  customBackfill: backfillResult,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts -t "scoringPaths" --reporter=basic`
Expected: PASS. Also re-run the full file to confirm no regression: `npx vitest run app/api/cron/update-cameras/route.test.ts --reporter=basic` — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "feat(cron): add scoringPaths breakdown to update-cameras response

Counts each pathTaken value (onnx / cache-hit / baseline-fallback / baseline)
so 'is ONNX really running' is inspectable from a single curl.
scoringPaths.onnx > 0 && scoringPaths['baseline-fallback'] === 0 is the
green-light condition for any deploy."
```

---

## Task 2: Add `/api/debug/scoring-smoke` test image fixture

**Files:**
- Create: `app/api/debug/scoring-smoke/test-image.jpg`

- [ ] **Step 1: Copy a sample image from the training set**

Find a known-good sunset image already in the repo. Run:
```bash
ls ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr/dataset/20260513_113247/ | head
```

If the dataset has direct image files, copy one. Otherwise, use any small JPEG you trust. Concretely:
```bash
mkdir -p app/api/debug/scoring-smoke
# Pick a small JPEG from somewhere reasonable; the exact image doesn't matter
# as long as it's a real photo (not a 1x1 placeholder) so preprocessing exercises
# the full resize/normalize path.
# Example - find any small JPEG in the existing image_cache:
SOURCE=$(find ml/artifacts/image_cache -name "*.jpg" -size -100k -size +20k | head -1)
cp "$SOURCE" app/api/debug/scoring-smoke/test-image.jpg
ls -lh app/api/debug/scoring-smoke/test-image.jpg
```
Expected: a JPEG between 20-100 KB at the target path.

- [ ] **Step 2: Commit**

```bash
git add app/api/debug/scoring-smoke/test-image.jpg
git commit -m "test(scoring): add fixed JPEG fixture for smoke-test endpoint

Lets the smoke-test endpoint force a deterministic ONNX inference
independent of webcam image rotation."
```

---

## Task 3: Implement `/api/debug/scoring-smoke` endpoint

**Files:**
- Create: `app/api/debug/scoring-smoke/route.ts`
- Create: `app/api/debug/scoring-smoke/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/debug/scoring-smoke/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn(() => true);
const scoreMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('@/app/api/cron/update-cameras/lib/auth', () => ({
  verifyCronAuth: () => verifyAuthMock(),
}));
vi.mock('@/app/api/cron/update-cameras/lib/aiScoring', () => ({
  scoreImage: (...a: unknown[]) => scoreMock(...a),
}));
vi.mock('node:fs/promises', () => ({
  readFile: (...a: unknown[]) => readFileMock(...a),
}));

import { GET } from './route';

beforeEach(() => {
  verifyAuthMock.mockReset().mockReturnValue(true);
  readFileMock.mockReset().mockResolvedValue(Buffer.from('fake-jpeg-bytes'));
  scoreMock.mockReset().mockResolvedValue({
    rawScore: 0.72, aiRating: 3.88, modelVersion: 'v4_test',
    imageHash: 'abc', source: 'windy', pathTaken: 'onnx',
  });
});

function makeReq(): Request {
  return new Request('http://test/api/debug/scoring-smoke');
}

describe('GET /api/debug/scoring-smoke', () => {
  it('returns 401 when auth fails', async () => {
    verifyAuthMock.mockReturnValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(scoreMock).not.toHaveBeenCalled();
  });

  it('reads the test image, scores it, returns pathTaken + rating + latency', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      pathTaken: 'onnx',
      rawScore: 0.72,
      aiRating: 3.88,
      modelVersion: 'v4_test',
    });
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('forces real scoring by passing lastImageHash: undefined', async () => {
    await GET(makeReq());
    expect(scoreMock).toHaveBeenCalledTimes(1);
    const call = scoreMock.mock.calls[0][0];
    expect(call.lastImageHash).toBeUndefined();
    expect(call.source).toBe('windy');
  });

  it('returns 500 with the underlying error when scoreImage throws', async () => {
    scoreMock.mockRejectedValueOnce(new Error('onnx load failed'));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('onnx load failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/debug/scoring-smoke/route.test.ts --reporter=basic`
Expected: FAIL with `Cannot find module './route'` (the route file doesn't exist yet).

- [ ] **Step 3: Implement the route**

Create `app/api/debug/scoring-smoke/route.ts`:

```ts
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/app/api/cron/update-cameras/lib/auth';
import { scoreImage } from '@/app/api/cron/update-cameras/lib/aiScoring';

export const dynamic = 'force-dynamic';

const TEST_IMAGE_PATH = path.join(
  process.cwd(),
  'app/api/debug/scoring-smoke/test-image.jpg'
);

export async function GET(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const imageBytes = await readFile(TEST_IMAGE_PATH);
    const startedAt = Date.now();
    const result = await scoreImage({
      webcamId: 0,
      imageBytes,
      source: 'windy',
      lastImageHash: undefined,
    });
    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      pathTaken: result.pathTaken,
      rawScore: result.rawScore,
      aiRating: result.aiRating,
      modelVersion: result.modelVersion,
      imageHash: result.imageHash,
      latencyMs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/debug/scoring-smoke/route.test.ts --reporter=basic`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/debug/scoring-smoke/route.ts app/api/debug/scoring-smoke/route.test.ts
git commit -m "feat(debug): add /api/debug/scoring-smoke endpoint

Forces a single ONNX inference on a committed test image, returns
pathTaken + rawScore + aiRating + modelVersion + latencyMs. Provides
the canonical 'is ONNX actually running on this deployment, right now,
deterministically' check — independent of cron timing or which webcams
happened to rotate their images.

Same CRON_SECRET auth as the cron endpoint."
```

---

## Task 4: Validator — PyTorch ↔ ONNX parity check

**Files:**
- Create: `ml/validate_deploy_bundle.py`
- Create: `ml/test_validate_deploy_bundle.py`

- [ ] **Step 1: Write the failing test**

Create `ml/test_validate_deploy_bundle.py`:

```python
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from ml.validate_deploy_bundle import check_pt_onnx_parity


class TestParityCheck(unittest.TestCase):
    def _make_tiny_model_and_export(self, tmp: Path):
        """Create a deterministic 3-layer CNN, save both .pt and .onnx forms."""
        torch.manual_seed(0)
        model = nn.Sequential(
            nn.Conv2d(3, 4, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(4, 1),
        )
        model.eval()
        pt_path = tmp / "best.pt"
        onnx_path = tmp / "model.onnx"
        torch.save({"model_state_dict": model.state_dict()}, pt_path)
        dummy = torch.randn(1, 3, 224, 224)
        torch.onnx.export(
            model, dummy, str(onnx_path),
            input_names=["input"], output_names=["output"],
            dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
            opset_version=17,
        )
        return model, pt_path, onnx_path

    def test_matching_pt_and_onnx_pass_parity(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            model, pt_path, onnx_path = self._make_tiny_model_and_export(tmp)
            ok, max_diff = check_pt_onnx_parity(model, onnx_path, atol=1e-5)
            self.assertTrue(ok, f"parity failed with max_diff={max_diff}")
            self.assertLess(max_diff, 1e-5)

    def test_mismatched_weights_fail_parity(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            model, _pt, onnx_path = self._make_tiny_model_and_export(tmp)
            # Mutate the in-memory PyTorch model weights so it no longer matches the ONNX
            with torch.no_grad():
                for p in model.parameters():
                    p.add_(1.0)
            ok, max_diff = check_pt_onnx_parity(model, onnx_path, atol=1e-5)
            self.assertFalse(ok)
            self.assertGreater(max_diff, 0.01)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jessekauppila/GitHub/the-sunset-webcam-map && source .venv/bin/activate && python -m pytest ml/test_validate_deploy_bundle.py -v`
Expected: FAIL with `ImportError: cannot import name 'check_pt_onnx_parity'` (module doesn't exist yet).

- [ ] **Step 3: Implement the parity check**

Create `ml/validate_deploy_bundle.py`:

```python
"""Pre-deploy validator for ONNX-on-Vercel ML bundles.

Run as a CLI from scripts/deploy-model.sh. Four independent checks:
  1. PyTorch ↔ ONNX numerical parity
  2. ONNX file size (≤ 100 MB for GitHub)
  3. Estimated Vercel function bundle size (≤ MAX_BUNDLE_MB)
  4. Eval report sanity (pearson ≥ threshold)
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch


def check_pt_onnx_parity(
    model: torch.nn.Module,
    onnx_path: Path,
    atol: float = 1e-5,
    seed: int = 0,
) -> tuple[bool, float]:
    """Run a fixed-seed random input through both, return (passed, max_abs_diff)."""
    model.eval()
    torch.manual_seed(seed)
    dummy = torch.randn(1, 3, 224, 224)

    with torch.no_grad():
        pt_out = model(dummy).cpu().numpy()

    session = ort.InferenceSession(
        str(onnx_path), providers=["CPUExecutionProvider"]
    )
    onnx_out = session.run(None, {session.get_inputs()[0].name: dummy.numpy()})[0]

    max_diff = float(np.max(np.abs(pt_out - onnx_out)))
    return max_diff < atol, max_diff
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest ml/test_validate_deploy_bundle.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/validate_deploy_bundle.py ml/test_validate_deploy_bundle.py
git commit -m "feat(ml): validate_deploy_bundle parity check

PyTorch model + ONNX file, run fixed-seed random input through each,
assert max abs diff < atol. Catches head-shape mismatches like the
v4 head_dropout=0.3 silent export failure that bit us on 2026-05-15."
```

---

## Task 5: Validator — bundle size estimate + eval report check

**Files:**
- Modify: `ml/validate_deploy_bundle.py` (append two functions)
- Modify: `ml/test_validate_deploy_bundle.py` (append two test classes)

- [ ] **Step 1: Write the failing tests**

Append to `ml/test_validate_deploy_bundle.py`:

```python
from ml.validate_deploy_bundle import (
    estimate_bundle_size_mb,
    check_eval_report,
)


class TestBundleSize(unittest.TestCase):
    def test_returns_sum_of_existing_files_in_mb(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            (tmp / "a.bin").write_bytes(b"x" * (10 * 1024 * 1024))   # 10 MB
            (tmp / "b.bin").write_bytes(b"x" * (5 * 1024 * 1024))    # 5 MB
            size_mb = estimate_bundle_size_mb([tmp / "a.bin", tmp / "b.bin"])
            self.assertAlmostEqual(size_mb, 15.0, places=1)

    def test_silently_ignores_missing_files(self):
        size_mb = estimate_bundle_size_mb([Path("/nonexistent/file.bin")])
        self.assertEqual(size_mb, 0.0)


class TestEvalReport(unittest.TestCase):
    def _write(self, tmp: Path, payload: dict) -> Path:
        p = tmp / "eval_report.json"
        p.write_text(json.dumps(payload))
        return p

    def test_passes_when_pearson_above_threshold(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(Path(tmpdir), {"pearson": 0.9, "r2": 0.8, "mae": 0.4})
            ok, metrics = check_eval_report(p, min_pearson=0.5)
            self.assertTrue(ok)
            self.assertEqual(metrics["pearson"], 0.9)

    def test_fails_when_pearson_below_threshold(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(Path(tmpdir), {"pearson": 0.3, "r2": 0.1, "mae": 0.9})
            ok, metrics = check_eval_report(p, min_pearson=0.5)
            self.assertFalse(ok)

    def test_handles_nested_regression_block(self):
        """Some eval reports nest metrics under {'regression': {...}}."""
        with tempfile.TemporaryDirectory() as tmpdir:
            p = self._write(
                Path(tmpdir),
                {"regression": {"pearson": 0.85, "r2": 0.7, "mae": 0.5}},
            )
            ok, metrics = check_eval_report(p, min_pearson=0.5)
            self.assertTrue(ok)
            self.assertEqual(metrics["pearson"], 0.85)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest ml/test_validate_deploy_bundle.py::TestBundleSize ml/test_validate_deploy_bundle.py::TestEvalReport -v`
Expected: FAIL with `ImportError: cannot import name 'estimate_bundle_size_mb'`.

- [ ] **Step 3: Append the implementations**

Append to `ml/validate_deploy_bundle.py`:

```python
import json
from typing import Iterable


def estimate_bundle_size_mb(paths: Iterable[Path]) -> float:
    """Sum the sizes of files at the given paths, in MB. Missing files contribute 0."""
    total_bytes = 0
    for p in paths:
        try:
            total_bytes += p.stat().st_size
        except FileNotFoundError:
            continue
    return total_bytes / (1024 * 1024)


def check_eval_report(
    report_path: Path,
    min_pearson: float = 0.5,
) -> tuple[bool, dict]:
    """Load eval_report.json and return (passed, metrics_dict).

    Reports may put metrics at top level or nested under 'regression'.
    """
    payload = json.loads(report_path.read_text())
    block = payload.get("regression", payload)
    metrics = {
        "pearson": float(block.get("pearson", 0.0)),
        "r2": float(block.get("r2", 0.0)),
        "mae": float(block.get("mae", 0.0)),
    }
    return metrics["pearson"] >= min_pearson, metrics
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest ml/test_validate_deploy_bundle.py -v`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ml/validate_deploy_bundle.py ml/test_validate_deploy_bundle.py
git commit -m "feat(ml): validate_deploy_bundle bundle-size + eval checks

estimate_bundle_size_mb sums on-disk files (missing = 0 MB).
check_eval_report loads eval_report.json (handles top-level or
nested 'regression' block), returns (passed, metrics) based on
configurable min_pearson threshold."
```

---

## Task 6: Validator — CLI entry point

**Files:**
- Modify: `ml/validate_deploy_bundle.py` (append CLI)

- [ ] **Step 1: Add CLI**

Append to `ml/validate_deploy_bundle.py`:

```python
def main() -> int:
    """CLI: python -m ml.validate_deploy_bundle --run-dir <dir> --version-tag <tag>
            [--max-bundle-mb 200] [--min-pearson 0.5] [--force]
    """
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Pre-deploy validator for Vercel ONNX bundles")
    parser.add_argument("--run-dir", type=Path, required=True,
                        help="Experiment run dir containing train/best.pt and eval/eval_report.json")
    parser.add_argument("--version-tag", required=True,
                        help="Version tag (defaults to run-dir basename in deploy-model.sh)")
    parser.add_argument("--model-family", default="regression_resnet18",
                        help="Subdir under ml/artifacts/models/")
    parser.add_argument("--max-bundle-mb", type=float, default=200.0)
    parser.add_argument("--min-pearson", type=float, default=0.5)
    parser.add_argument("--force", action="store_true",
                        help="Print warnings but always exit 0")
    args = parser.parse_args()

    onnx_path = (Path("ml/artifacts/models") / args.model_family /
                 args.version_tag / "model.onnx")

    print(f"[validate] run_dir       = {args.run_dir}")
    print(f"[validate] version_tag   = {args.version_tag}")
    print(f"[validate] onnx_path     = {onnx_path}")
    print()

    failed: list[str] = []

    # 1. ONNX file size
    if not onnx_path.exists():
        failed.append(f"ONNX missing at {onnx_path}")
    else:
        onnx_mb = onnx_path.stat().st_size / (1024 * 1024)
        if onnx_mb > 100:
            failed.append(f"ONNX file size {onnx_mb:.1f} MB > 100 MB GitHub limit")
        else:
            print(f"✓ ONNX file size: {onnx_mb:.1f} MB (≤ 100 MB)")

    # 2. Parity check
    pt_path = args.run_dir / "train" / "best.pt"
    if not pt_path.exists():
        failed.append(f"PyTorch checkpoint missing at {pt_path}")
    elif onnx_path.exists():
        # Lazy import so failures above still print
        from ml.train import build_model_from_config  # adjust if name differs
        import json as _json
        config_path = args.run_dir / "config.resolved.json"
        if not config_path.exists():
            failed.append(f"config.resolved.json missing at {config_path}")
        else:
            cfg = _json.loads(config_path.read_text())
            model = build_model_from_config(cfg)
            state = torch.load(pt_path, map_location="cpu")
            model.load_state_dict(state.get("model_state_dict", state))
            ok, max_diff = check_pt_onnx_parity(model, onnx_path)
            if ok:
                print(f"✓ PT↔ONNX parity: max_abs_diff = {max_diff:.2e}")
            else:
                failed.append(f"PT↔ONNX parity FAIL: max_abs_diff = {max_diff:.2e}")

    # 3. Estimated bundle size
    bundle_files = [
        Path("node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1"),
        Path("node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node"),
        onnx_path,
    ]
    # Add sharp libvips dir if present
    sharp_root = Path("node_modules/@img/sharp-libvips-linux-x64")
    if sharp_root.exists():
        bundle_files.extend(sharp_root.rglob("*"))
    bundle_mb = estimate_bundle_size_mb(bundle_files)
    if bundle_mb > args.max_bundle_mb:
        failed.append(f"Bundle estimate {bundle_mb:.1f} MB > {args.max_bundle_mb:.1f} MB limit")
    else:
        print(f"✓ Bundle estimate: {bundle_mb:.1f} MB (≤ {args.max_bundle_mb:.1f} MB)")

    # 4. Eval report
    eval_path = args.run_dir / "eval" / "eval_report.json"
    if eval_path.exists():
        ok, metrics = check_eval_report(eval_path, args.min_pearson)
        line = f"pearson={metrics['pearson']:.3f} r2={metrics['r2']:.3f} mae={metrics['mae']:.3f}"
        if ok:
            print(f"✓ Eval report: {line}")
        else:
            failed.append(f"Eval pearson below {args.min_pearson}: {line}")
    else:
        print(f"⚠ Eval report missing at {eval_path} (skipping)")

    print()
    if failed:
        for msg in failed:
            print(f"✗ {msg}")
        if args.force:
            print("\n--force passed; exiting 0 despite failures.")
            return 0
        return 1

    print("✓ All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Test CLI against current v4 deploy (manual smoke test)**

Run:
```bash
python -m ml.validate_deploy_bundle \
  --run-dir ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr \
  --version-tag 20260513_113243_v4_regression_llm_with_flickr
```
Expected: All 4 checks print `✓`, exit 0. If the `build_model_from_config` import fails, fix the import path to match the actual function name in `ml/train.py` (run `grep -n "def build_model\|def create_model\|def make_model" ml/train.py` to find it; adjust the import line in `validate_deploy_bundle.py` accordingly, then re-run).

- [ ] **Step 3: Commit**

```bash
git add ml/validate_deploy_bundle.py
git commit -m "feat(ml): validate_deploy_bundle CLI entry point

Wires parity / file-size / bundle-size / eval-report into a single
'python -m ml.validate_deploy_bundle ...' invocation. Prints each
check's pass/fail, exits non-zero on any failure unless --force."
```

---

## Task 7: Deploy script — CONFIG block + Stage 1 (export) + helpers

**Files:**
- Create: `scripts/deploy-model.sh`
- Create: `scripts/deploy-model-config.sh`

- [ ] **Step 1: Create the CONFIG block**

Create `scripts/deploy-model-config.sh`:

```bash
#!/usr/bin/env bash
# === Project config (edit when porting to a new repo) ===
MODEL_FAMILY="regression_resnet18"
ENV_VAR_MODEL_PATH="AI_ONNX_REGRESSION_MODEL_PATH"
ENV_VAR_MODEL_VERSION="AI_REGRESSION_MODEL_VERSION"
ENV_VAR_SCORING_MODE="AI_SCORING_MODE"
CRON_ENDPOINT="/api/cron/update-cameras"
SMOKE_ENDPOINT="/api/debug/scoring-smoke"
MAX_BUNDLE_MB=200
MIN_PEARSON=0.5
PROD_URL="https://www.sunrisesunset.studio"
```

- [ ] **Step 2: Create the main script skeleton with Stage 1**

Create `scripts/deploy-model.sh`:

```bash
#!/usr/bin/env bash
# Streamlined model deploy. See docs/superpowers/specs/2026-05-16-streamlined-model-deploy-design.md
# Usage: scripts/deploy-model.sh <run_dir> [--start-at N] [--force] [--unattended]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=./deploy-model-config.sh
source "$SCRIPT_DIR/deploy-model-config.sh"

# ---------- arg parsing ----------
RUN_DIR=""
START_AT=1
FORCE=0
UNATTENDED=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-at) START_AT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --unattended) UNATTENDED=1; shift ;;
    -h|--help)
      echo "Usage: $0 <run_dir> [--start-at N] [--force] [--unattended]"; exit 0 ;;
    *)
      if [[ -z "$RUN_DIR" ]]; then RUN_DIR="$1"; shift
      else echo "Unexpected arg: $1" >&2; exit 2; fi ;;
  esac
done

if [[ -z "$RUN_DIR" ]]; then
  echo "Usage: $0 <run_dir> [--start-at N] [--force] [--unattended]" >&2
  exit 2
fi
RUN_DIR="$(cd "$RUN_DIR" && pwd)"
VERSION_TAG="$(basename "$RUN_DIR")"
ONNX_DIR="$REPO_ROOT/ml/artifacts/models/$MODEL_FAMILY/$VERSION_TAG"
ONNX_PATH="$ONNX_DIR/model.onnx"

# ---------- helpers ----------
log() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m⚠\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

confirm() {
  # confirm "prompt" — returns 0 on y, 1 on n. In --unattended mode always y.
  if [[ "$UNATTENDED" -eq 1 ]]; then return 0; fi
  read -r -p "$1 [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]]
}

# ---------- Stage 1: Export ----------
stage_1_export() {
  log "Stage 1: Export ONNX"
  if [[ -f "$ONNX_PATH" ]]; then
    ok "Already exported at $ONNX_PATH"
    return 0
  fi
  python "$REPO_ROOT/ml/export_onnx_versioned.py" \
    --run-dir "$RUN_DIR" \
    --target-type regression \
    --model-name resnet18
  if [[ ! -f "$ONNX_PATH" ]]; then
    err "Export script reported success but $ONNX_PATH does not exist"
    exit 1
  fi
  ok "Exported to $ONNX_PATH"
}

# ---------- Stage 2-5 placeholders (filled in subsequent tasks) ----------
stage_2_validate() { log "Stage 2: TODO (Task 7b)"; }
stage_3_git()       { log "Stage 3: TODO (Task 8)"; }
stage_4_vercel()    { log "Stage 4: TODO (Task 8)"; }
stage_5_verify()    { log "Stage 5: TODO (Task 9)"; }

# ---------- main ----------
echo "Deploying model: $VERSION_TAG"
echo "Run dir:         $RUN_DIR"
echo "ONNX path:       $ONNX_PATH"
[[ "$START_AT" -le 1 ]] && stage_1_export
[[ "$START_AT" -le 2 ]] && stage_2_validate
[[ "$START_AT" -le 3 ]] && stage_3_git
[[ "$START_AT" -le 4 ]] && stage_4_vercel
[[ "$START_AT" -le 5 ]] && stage_5_verify
```

- [ ] **Step 3: Add Stage 2 (calls validator)**

Replace the `stage_2_validate()` placeholder in `scripts/deploy-model.sh` with:

```bash
stage_2_validate() {
  log "Stage 2: Validate deploy bundle"
  local force_flag=""
  [[ "$FORCE" -eq 1 ]] && force_flag="--force"
  python -m ml.validate_deploy_bundle \
    --run-dir "$RUN_DIR" \
    --version-tag "$VERSION_TAG" \
    --model-family "$MODEL_FAMILY" \
    --max-bundle-mb "$MAX_BUNDLE_MB" \
    --min-pearson "$MIN_PEARSON" \
    $force_flag
}
```

- [ ] **Step 4: Make executable and smoke-test Stages 1+2**

Run:
```bash
chmod +x scripts/deploy-model.sh
scripts/deploy-model.sh ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr --start-at 1
```
Expected: Stage 1 reports "Already exported", Stage 2 runs validator and prints all ✓ checks, Stages 3-5 print "TODO" placeholders, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy-model.sh scripts/deploy-model-config.sh
git commit -m "feat(scripts): deploy-model.sh scaffold + Stages 1-2

Bash orchestrator with CONFIG block (portable to other Vercel+ONNX
projects). Stage 1 wraps ml/export_onnx_versioned.py (skips if ONNX
already exists). Stage 2 invokes ml/validate_deploy_bundle.py. Stages
3-5 stubbed for next commits."
```

---

## Task 8: Deploy script — Stage 3 (git) + Stage 4 (Vercel)

**Files:**
- Modify: `scripts/deploy-model.sh`

- [ ] **Step 1: Replace Stage 3 placeholder**

Replace `stage_3_git()` in `scripts/deploy-model.sh` with:

```bash
stage_3_git() {
  log "Stage 3: Stage ONNX in git and push"
  cd "$REPO_ROOT"
  if [[ -z "$(git status --porcelain "$ONNX_DIR")" ]]; then
    # Check if it's already committed by looking at HEAD
    if git ls-files --error-unmatch "$ONNX_DIR/model.onnx" >/dev/null 2>&1; then
      ok "Already committed in git: $ONNX_DIR"
      DEPLOY_TRIGGER="env-only"  # signals Stage 4 to redeploy explicitly
      return 0
    fi
  fi
  git add "$ONNX_DIR"
  echo
  git diff --cached --stat
  echo
  echo "Proposed commit message: deploy: $VERSION_TAG"
  if ! confirm "Commit and push?"; then
    warn "Skipped commit. Stage 4 will not have a fresh deploy to wait for."
    DEPLOY_TRIGGER="skipped"
    return 0
  fi
  git commit -m "deploy: $VERSION_TAG"
  git push
  ok "Pushed to origin (auto-deploy should trigger on Vercel)"
  DEPLOY_TRIGGER="auto"
}
```

- [ ] **Step 2: Replace Stage 4 placeholder**

Replace `stage_4_vercel()` in `scripts/deploy-model.sh` with:

```bash
# Helper: set Vercel env var.
# Vercel hides sensitive env values in `env ls`, so we can only detect
# existence, not value equality. If the var exists we prompt to overwrite;
# if it doesn't exist we add it silently.
set_vercel_env() {
  local name="$1" want="$2"
  local exists
  exists=$(npx vercel env ls production 2>/dev/null | awk -v n="$name" '$1 == n {print "yes"; exit}' || true)
  if [[ "$exists" != "yes" ]]; then
    npx vercel env add "$name" production --value "$want" --force --yes
    ok "Added $name"
    return 0
  fi
  echo
  echo "Vercel env var: $name (exists; Vercel hides current value)"
  echo "  new: $want"
  if ! confirm "Overwrite?"; then
    warn "Skipped $name (assuming current value is correct)"
    return 0
  fi
  npx vercel env add "$name" production --value "$want" --force --yes
  ok "Updated $name"
}

stage_4_vercel() {
  log "Stage 4: Vercel env vars + deploy"
  local model_path="ml/artifacts/models/$MODEL_FAMILY/$VERSION_TAG/model.onnx"
  set_vercel_env "$ENV_VAR_MODEL_PATH"    "$model_path"
  set_vercel_env "$ENV_VAR_MODEL_VERSION" "$VERSION_TAG"
  set_vercel_env "$ENV_VAR_SCORING_MODE"  "onnx"

  if [[ "${DEPLOY_TRIGGER:-auto}" == "env-only" || "${DEPLOY_TRIGGER:-auto}" == "skipped" ]]; then
    warn "No fresh commit pushed; triggering explicit deploy"
    npx vercel --prod --yes
  fi

  log "Waiting for latest production deploy to be READY"
  for _ in {1..30}; do
    local state
    state=$(npx vercel ls --prod --count 1 2>/dev/null | awk 'NR>1 {print $4; exit}' || true)
    if [[ "$state" == "READY" ]]; then
      ok "Latest deploy READY"
      return 0
    fi
    sleep 10
  done
  err "Latest deploy did not reach READY within 5 minutes; check Vercel dashboard"
  exit 1
}
```

- [ ] **Step 3: Smoke-test Stages 3-4 against current state**

This is the trickiest stage to smoke-test because it talks to Vercel. The current production already has v4 deployed, so we expect Stage 3 to detect "already committed" and Stage 4 to detect "env vars already correct" and skip everything. Run:

```bash
scripts/deploy-model.sh ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr --start-at 3
```
Expected: Stage 3 prints `✓ Already committed in git`. Stage 4 prompts to overwrite each of the 3 existing env vars (answer `n` to keep current — they're already correct from the manual setup). Stage 4 then triggers a deploy (because Stage 3 was a skip → `DEPLOY_TRIGGER=env-only`) and ends with `✓ Latest deploy READY`. Stage 5 still prints TODO.

If `vercel ls --prod --count 1` parsing breaks (Vercel CLI output format varies), fix the awk pattern to match what `npx vercel ls --prod` actually prints — capture a sample with `npx vercel ls --prod | head -3` and adjust.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-model.sh
git commit -m "feat(scripts): deploy-model.sh Stages 3-4 (git + Vercel)

Stage 3 detects already-committed ONNX, skips re-commit. Stage 4
prompts before overwriting Vercel env vars, polls for READY state.
Both stages prompt before destructive ops (unless --unattended)."
```

---

## Task 9: Deploy script — Stage 5 (verify)

**Files:**
- Modify: `scripts/deploy-model.sh`

- [ ] **Step 1: Replace Stage 5 placeholder**

Replace `stage_5_verify()` in `scripts/deploy-model.sh` with:

```bash
stage_5_verify() {
  log "Stage 5: Verify ONNX is actually running"
  if [[ -z "${CRON_SECRET:-}" ]]; then
    err "CRON_SECRET not set in environment. Run: export CRON_SECRET=\$(grep ^CRON_SECRET .env.production.tmp | cut -d= -f2-)"
    err "(npx vercel env pull --environment=production .env.production.tmp  # to fetch it first)"
    exit 1
  fi

  # 5a: Smoke test (deterministic)
  echo
  echo "5a. Smoke test ($PROD_URL$SMOKE_ENDPOINT)"
  local smoke_body
  smoke_body=$(curl -s -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL$SMOKE_ENDPOINT")
  local smoke_path
  smoke_path=$(echo "$smoke_body" | jq -r '.pathTaken // "missing"')
  local smoke_version
  smoke_version=$(echo "$smoke_body" | jq -r '.modelVersion // "missing"')
  local smoke_latency
  smoke_latency=$(echo "$smoke_body" | jq -r '.latencyMs // "missing"')
  echo "    response: pathTaken=$smoke_path version=$smoke_version latencyMs=$smoke_latency"
  if [[ "$smoke_path" != "onnx" ]]; then
    err "Smoke test pathTaken=$smoke_path (expected onnx). Full body: $smoke_body"
    npx vercel logs "$PROD_URL" --since=5m | tail -30
    exit 1
  fi
  if [[ "$smoke_version" != "$VERSION_TAG" ]]; then
    err "Smoke test modelVersion=$smoke_version (expected $VERSION_TAG)"
    exit 1
  fi
  ok "Smoke test: ONNX path confirmed, model=$smoke_version"

  # 5b: Cron sample (statistical)
  echo
  echo "5b. Cron sample (3 ticks, 30s apart)"
  for i in 1 2 3; do
    local body
    body=$(curl -s -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL$CRON_ENDPOINT")
    local windyScored fallbacks paths
    windyScored=$(echo "$body" | jq -r '.windyScored // 0')
    fallbacks=$(echo "$body" | jq -r '.fallbacks // 0')
    paths=$(echo "$body" | jq -c '.scoringPaths // {}')
    echo "    tick $i: windyScored=$windyScored fallbacks=$fallbacks paths=$paths"
    if [[ "$windyScored" -gt 0 && "$fallbacks" -gt 0 ]]; then
      err "Cron tick $i: fallbacks=$fallbacks of windyScored=$windyScored. Vercel logs:"
      npx vercel logs "$PROD_URL" --since=5m | tail -30
      exit 1
    fi
    [[ "$i" -lt 3 ]] && sleep 30
  done
  ok "Cron sample: no fallbacks across 3 ticks"

  echo
  ok "ONNX confirmed running in production (version: $VERSION_TAG)"
}
```

- [ ] **Step 2: Smoke-test Stage 5 end-to-end**

Make sure `CRON_SECRET` is set in your shell. Then run:
```bash
scripts/deploy-model.sh ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr --start-at 5
```
Expected:
- `5a` reports `pathTaken=onnx`, `modelVersion=<the v4 tag>`, latency printed
- `5b` reports 3 ticks; `fallbacks=0` on each (or `windyScored=0` with `fallbacks=0`, which also passes)
- Ends with `✓ ONNX confirmed running in production`

The smoke endpoint must exist in the deployed code for this to succeed. If `5a` returns 404, the smoke endpoint commits from Tasks 2-3 haven't deployed yet — push and wait for Vercel READY first.

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy-model.sh
git commit -m "feat(scripts): deploy-model.sh Stage 5 (deterministic + statistical verify)

5a hits /api/debug/scoring-smoke; asserts pathTaken=onnx and modelVersion
matches the just-deployed tag. 5b samples /api/cron/update-cameras 3
times with 30s gaps; asserts fallbacks=0 on every tick where windyScored>0.
On failure, dumps last 30 lines of vercel logs."
```

---

## Task 10: Docs + package.json

**Files:**
- Modify: `ml/OPERATING_GUIDE.md` (§9)
- Modify: `package.json`

- [ ] **Step 1: Update OPERATING_GUIDE §9**

Open `ml/OPERATING_GUIDE.md`. Find the line that says `## 9. ONNX export and deployment`. Insert a new subsection RIGHT AFTER that heading and before `### Training vs export`:

```markdown
### One-command deploy (canonical)

```bash
npm run deploy-model -- ml/artifacts/experiments/<run_dir>
```

This is the canonical workflow. It walks through 5 stages with confirmations:

1. **Export** ONNX from the run (skips if already exported)
2. **Validate** ONNX⇄PyTorch parity, bundle size estimate, eval report
3. **Stage** the model in git and push (skips if already committed)
4. **Set Vercel env vars** if changed; wait for deploy READY
5. **Verify** ONNX is running: deterministic smoke test + 3 cron-tick sample

Flags: `--start-at N` (resume mid-script), `--force` (skip Stage 2 gates), `--unattended` (accept all prompts).

The manual steps below remain documented as fallback for debugging.
```

- [ ] **Step 2: Add npm script entry**

Open `package.json`. Find the `"scripts"` block. Add (keeping existing entries):

```json
"deploy-model": "./scripts/deploy-model.sh"
```

(Place it alphabetically among existing scripts; don't disturb the others.)

- [ ] **Step 3: Verify the npm script works**

Run: `npm run deploy-model -- --help`
Expected: prints `Usage: ./scripts/deploy-model.sh <run_dir> [--start-at N] [--force] [--unattended]`, exits 0.

- [ ] **Step 4: Commit**

```bash
git add ml/OPERATING_GUIDE.md package.json
git commit -m "docs(ml): point §9 at scripts/deploy-model.sh; add npm script

Manual steps stay as fallback documentation. New canonical path is
'npm run deploy-model -- <run_dir>'."
```

---

## Task 11: End-to-end smoke run + PR

- [ ] **Step 1: Full dry-run against current production**

The expectation: every stage skips (the v4 deploy is already done), Stage 5 passes deterministically.
```bash
npm run deploy-model -- ml/artifacts/experiments/20260513_113243_v4_regression_llm_with_flickr
```
Expected output progression:
- Stage 1: `✓ Already exported`
- Stage 2: `✓ All checks passed`
- Stage 3: `✓ Already committed in git`
- Stage 4: For each of the 3 env vars, prompts "Overwrite?" → answer `n` → prints `⚠ Skipped <NAME>`. Then `✓ Latest deploy READY`.
- Stage 5: `✓ Smoke test: ONNX path confirmed`, `✓ Cron sample: no fallbacks across 3 ticks`, `✓ ONNX confirmed running in production`

If any stage fails, fix the underlying issue (typically: an env var name typo, or vercel CLI output format) and re-run with `--start-at <N>`.

- [ ] **Step 2: Push the branch and open PR**

```bash
git push -u origin feat/streamlined-model-deploy
```
Then open https://github.com/jessekauppila/the-sunset-webcam-map/pull/new/feat/streamlined-model-deploy
PR title: `feat: one-command model deploy with silent-fallback guardrails`
PR body: link to spec at `docs/superpowers/specs/2026-05-16-streamlined-model-deploy-design.md` and summarize the 11 tasks.

- [ ] **Step 3: Update memory after merge**

After PR merges, append to `MEMORY.md`:

```markdown
- [Streamlined model deploy workflow](project_streamlined_model_deploy.md) — `npm run deploy-model -- <run_dir>` is the canonical PyTorch→ONNX→Vercel path; 5 stages, no local state, silent-fallback guarded via scoringPaths + smoke endpoint
```

And create `project_streamlined_model_deploy.md` with a brief reference pointing to the spec + plan paths.

---

## Success criteria

1. `npm run deploy-model -- <run_dir>` against the current v4 deploy completes with all stages skipping cleanly and Stage 5 passing — total wall time < 3 minutes
2. The same command against a hypothetical fresh, never-deployed run would take a `.pt` to confirmed-running-in-production under 10 minutes, with every destructive action confirmed by prompt (or `--unattended`)
3. A future broken deploy — bundle size, MODULE_NOT_FOUND, head-shape mismatch, etc. — exits Stage 2 or Stage 5 non-zero with an actionable error; never returns success with a silent fallback running
