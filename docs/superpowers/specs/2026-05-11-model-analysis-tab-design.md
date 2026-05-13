# Model Analysis Tab — Design Spec

**Date:** 2026-05-11
**Status:** Spec — pending plan + implementation
**Repo:** `the-sunset-webcam-map`

## Summary

A new "Model Analysis" tab in the existing bottom drawer, plus a shareable per-run route at `/models/<run-name>`. Surfaces the artifacts already produced by `ml/run_experiment.py` (loss curves, label distributions, eval metrics, cross-run comparisons) and adds a new **Failure Gallery** view — top-N worst predictions per run, with thumbnails.

Primary audience is the project owner (R&D iteration: "what should I fix next"). Secondary audience is collaborators (technical reviewers, professor consult) reached via shareable URL, and funders/visitors who land on the site and stumble into the tab.

## Goals

1. After running `python ml/run_experiment.py --config <foo>.yaml --publish`, the resulting run appears in the drawer tab and at `sunrisesunset.studio/models/<run-name>` with zero additional UI registration.
2. A leaderboard of all published runs is the default view inside the drawer tab — sorted by val metric, with auto-diagnosis status (healthy / overfit / mild overfit).
3. Each published run has a deep-linkable full-page route (`/models/<run-name>`) suitable for sharing with collaborators.
4. Every run includes a **failure gallery**: the top-20 worst predictions on the validation set, displayed as a thumbnail grid with true label vs. predicted score. This is the new evaluation capability.
5. The drawer tab contains a one-paragraph "What is this?" plaque explaining the view to a non-ML audience (funders, visitors).
6. Publishing is opt-in — a `--publish` flag on `run_experiment.py`. Exploratory/broken runs stay on the local filesystem and never reach git.

## Non-goals (deferred)

- Calibration plots, Grad-CAM/saliency maps, embedding visualizations — flagged as future evaluation perspectives but out of scope for v1.
- A top-level `/models` index route. The drawer tab IS the index. Adding a public nav entry can come later.
- A "compare two runs side-by-side" interactive view. The existing comparison overlay PNG covers most of the need; a richer interactive comparison can come later.
- Re-running models from the UI. The UI is read-only.
- Storage cleanup. Old/bad runs are removed by the user manually via `git rm` of the folder.

## Architecture

### Data flow

```
ml/run_experiment.py  --config foo.yaml  --publish
        │
        ├── 1. existing pipeline: export → train → eval → plot_diagnostics
        │       writes to ml/artifacts/experiments/<run_id>/
        │
        ├── 2. new step: generate failure gallery
        │       writes ml/artifacts/experiments/<run_id>/failure_gallery.json
        │
        └── 3. new step: publish artifacts
                copies a subset of files to public/ml-runs/<run-name>/
                appends/updates public/ml-runs/_manifest.json

Next.js (production or local):
        public/ml-runs/_manifest.json     ← drawer leaderboard reads this
        public/ml-runs/<run-name>/         ← per-run detail reads this
            index.json
            plots/loss_curves.png
            plots/label_distribution.png
            failure_gallery.json
            config.yaml
```

### Why static files instead of a database table

- ~12 runs today, projected <100 over the project's lifetime. A table is overkill.
- Vercel serves `public/` files for free with CDN caching.
- The folder IS the source of truth — no sync/drift to worry about.
- Repo grows by ~200KB JSON + ~1MB of PNGs per published run. At 100 runs that's ~120MB — acceptable.
- Failure gallery image bytes are NOT stored. The JSON references existing Firebase Storage URLs that webcam snapshots already have.

### File formats

**`public/ml-runs/_manifest.json`** — the leaderboard data, regenerated on every `--publish`.

```json
{
  "schema_version": 1,
  "generated_at": "2026-05-11T14:30:22Z",
  "runs": [
    {
      "slug": "v3_regression_llm_labels",
      "display_name": "v3_regression_llm_labels",
      "published_at": "2026-05-10T09:14:11Z",
      "target_type": "regression",
      "binary_metrics": {
        "val_f1": 0.847,
        "val_precision": 0.81,
        "val_recall": 0.88,
        "val_accuracy": 0.86
      },
      "regression_metrics": {
        "pearson_r": 0.82,
        "spearman_r": 0.81,
        "r_squared": 0.67,
        "val_mse": 0.041
      },
      "best_epoch": 7,
      "epochs_total": 15,
      "early_stopped": true,
      "status": "healthy",
      "status_note": "Train/val loss tracked together; no overfit signal."
    }
  ]
}
```

**`public/ml-runs/<run-name>/index.json`** — everything the per-run detail page needs except the PNGs and failure gallery.

```json
{
  "schema_version": 1,
  "slug": "v3_regression_llm_labels",
  "display_name": "v3_regression_llm_labels",
  "published_at": "2026-05-10T09:14:11Z",
  "config_summary": {
    "model": "resnet18",
    "target_type": "regression",
    "epochs_configured": 15,
    "lr_schedule": "cosine",
    "early_stopping_patience": 5,
    "head_dropout": 0.3,
    "class_weighting": "balanced",
    "label_source": "llm"
  },
  "metrics": {
    "best_f1": 0.847,
    "pearson_r": 0.82,
    "spearman_r": 0.81,
    "r_squared": 0.67,
    "val_mse": 0.041,
    "best_epoch": 7,
    "epochs_completed": 12,
    "early_stopped_epoch": 12
  },
  "diagnosis": {
    "status": "healthy",
    "note": "Train/val loss tracked together; no overfit signal."
  },
  "data": {
    "train_samples": 3284,
    "val_samples": 723,
    "test_samples": 731,
    "class_balance": { "negative": 2638, "positive": 646, "ratio": 4.08 }
  },
  "assets": {
    "loss_curves_png": "plots/loss_curves.png",
    "label_distribution_png": "plots/label_distribution.png",
    "config_yaml": "config.yaml",
    "failure_gallery_json": "failure_gallery.json"
  }
}
```

**`public/ml-runs/<run-name>/failure_gallery.json`** — top-20 worst predictions.

```json
{
  "schema_version": 1,
  "generated_at": "2026-05-10T09:14:11Z",
  "split": "val",
  "target_type": "regression",
  "items": [
    {
      "snapshot_id": "snap_abc123",
      "webcam_id": 1842,
      "image_url": "https://firebasestorage.googleapis.com/.../snap_abc123.jpg",
      "true_label": 0.85,
      "predicted_score": 0.21,
      "absolute_error": 0.64,
      "captured_at": "2026-04-22T19:47:00Z",
      "llm_explanation": "Vivid orange and pink, partial cloud cover"
    }
  ]
}
```

### Why `image_url` and not just `snapshot_id`

The artifact JSON is fully self-contained — a collaborator opening the share link doesn't need access to the live database. The Firebase Storage URLs are already public.

## UI

### Drawer tab: "Model Analysis"

Added as a sixth tab in `app/page.tsx` next to the existing five tabs.

**Layout:** Two-column master-detail inside the drawer, at the existing 60vh height.

- **Left (260px sidebar):** A scrollable list of all runs sorted newest first. Each item shows: run name, date, primary metric, status emoji (🟢 healthy / 🟡 mild overfit / 🟠 overfit / 🔴 severe). The selected run is highlighted; default state has no selection.
- **Right (flex 1):** Default state shows:
  1. "What is this?" plaque — a single short paragraph in a callout box explaining what an ML run is and what F1 means. Aimed at non-ML viewers (funders, visitors). Dismissible per-session but not permanently hidden.
  2. **Metric-group toggle** — a small segmented control above the leaderboard: `[ Binary classification | Regression ]`. Defaults to the group most of the published runs use (computed at build time from the manifest). User selection persists in `localStorage`.
  3. Leaderboard table — columns adapt to the toggle:
     - **Binary view:** rank, run name, F1, precision, recall, best epoch, status. Sorted by F1 descending.
     - **Regression view:** rank, run name, Pearson r, Spearman r, R², val MSE, best epoch, status. Sorted by Pearson r descending.
     - Runs without metrics for the active group (e.g., a pure-binary run viewed in regression mode) appear grayed out at the bottom with "—" in the metric cells. They're still clickable.
  4. Comparison overlay PNG embed — the existing output of `compare_experiments.py` showing all val metric curves on one axis.
- **When a run is clicked in the sidebar:** the right panel shows a short summary card with key metrics + a "Open full view →" button that navigates to `/models/<run-name>`. The drawer does NOT try to show full per-run detail; that's the route's job.

### Route: `/models/[slug]`

Full-page server-rendered route. Reads `public/ml-runs/<slug>/index.json` at request time (or build time — see below).

**Layout (single column, max-width ~960px, centered):**

1. Header: run name + share button + "← back to all models" link.
2. Metric tile row (4 tiles): all four metrics relevant to this run's `target_type` shown together — for regression runs that ran threshold sweeps, both binary AND regression metrics are shown side-by-side (8 tiles, two rows). The per-run page doesn't need a toggle because we have room to show everything.
3. **Failure gallery** — top-20 worst predictions in a responsive grid (4 columns desktop, 2 mobile). Each card: thumbnail, true label, predicted score, absolute error, optional LLM explanation tooltip on hover. Clicking a card opens a lightbox with full image + metadata.
4. Two-column row: loss curves PNG | label distribution PNG.
5. Collapsible "Run config" section — formatted YAML.
6. Collapsible "Full eval JSON" — raw dump for debugging.
7. Footer: timestamp the run was published, link to the comparison overlay on the drawer.

**Rendering strategy:** `generateStaticParams` reads `public/ml-runs/_manifest.json` at build time and pre-renders one page per run. New runs trigger a new Vercel deploy (which happens automatically on push). No runtime API route needed.

### Inline definitions and tooltips

Every ML term, metric, and graph element in the tab and route has a hover/tap definition. This is a primary UX requirement, not a polish item — the audience mix (project owner, technical collaborators, non-ML funders) means a viewer at any level should be able to hover a term and understand it.

**Source of truth.** `ml/OPERATING_GUIDE.md` section 16 already defines the project's glossary (manifest, target_type, split, checkpoint, early stopping, cosine LR, head dropout, class weighting, threshold sweep, ONNX, LLM rater, domain shift, model card). The spec ships a parallel glossary file in TypeScript and adds the metric terms the guide didn't cover.

**File:** `app/lib/mlGlossary.ts` — a single exported object keyed by term slug, with three fields per entry:

```ts
export const ML_GLOSSARY = {
  val_f1: {
    label: "F1 score",
    short: "Combined precision + recall, 0 to 1, higher is better.",
    long: "The harmonic mean of precision (how many predicted positives were correct) and recall (how many real positives were caught). F1 of 1.0 is perfect; 0.0 is random. Well-tuned sunset classifiers reach 0.88-0.92.",
  },
  pearson_r: {
    label: "Pearson correlation",
    short: "How strongly predicted scores track true labels, -1 to 1.",
    long: "Measures linear agreement between predicted and actual quality scores. 1.0 = perfectly aligned, 0.0 = no relationship, -1.0 = perfectly inverted. The LLM-vs-human validation gate is Pearson > 0.80.",
  },
  // ... overfitting, label_distribution, loss_curves, threshold_sweep, etc.
};
```

**Required entries (v1):**

| Slug | Where used |
|------|------------|
| `val_f1`, `val_precision`, `val_recall`, `val_accuracy` | Leaderboard, per-run tiles |
| `pearson_r`, `spearman_r`, `r_squared`, `val_mse` | Leaderboard, per-run tiles |
| `best_epoch`, `early_stopped` | Leaderboard, per-run header |
| `overfitting`, `healthy`, `mild_overfit`, `severe_overfit` | Status emoji column |
| `train_loss`, `val_loss` | Loss curves caption |
| `class_balance`, `class_weighting` | Label distribution caption |
| `threshold_sweep` | Per-run regression block |
| `failure_gallery` | Failure gallery section heading |
| `binary_classification`, `regression` | Toggle control |
| `webcam_id`, `snapshot_id` | Failure gallery cards |

**UI patterns:**

- **Metric labels in tables and tiles** — wrap in a `<GlossaryTerm slug="val_f1">F1</GlossaryTerm>` component. Renders as the term text with a subtle dotted underline (matches MUI tooltip convention). Hover or focus shows a tooltip with the `short` definition. Click/tap opens a small popover with `long` plus a link to the operating guide section if applicable.
- **Graph captions** — each embedded PNG (loss curves, label distribution, comparison overlay) gets a caption below with a `?` icon that opens a popover with a 2-3 sentence "how to read this graph" guide. Content is hand-written, not auto-generated; copy lives in the glossary file under slugs like `graph_loss_curves`.
- **Failure gallery cards** — true/pred labels include the metric tooltip inline. Error magnitude shown with a label "off by X" to make the gap legible without ML vocabulary.
- **Status emojis** — emoji + label ("🟠 Overfit") with the standard tooltip pattern on the label.

**Accessibility:**

- Tooltips trigger on hover, focus (keyboard), and tap (mobile). Use MUI `Tooltip` for short text and `Popover` for the longer click-to-expand version — both already in the project's dependency tree.
- All glossary terms must have a non-tooltip fallback — if the tooltip fails, the page is still readable.
- The leaderboard table headers have a permanent "ⓘ" icon (not just dotted underline) because table headers are scanned faster than inline prose.

**Implementation note for the plan:**

A parser that reads `ml/OPERATING_GUIDE.md` section 16 and converts the glossary table into the TS object is appealing (single source of truth), but adds build complexity. For v1, ship a hand-maintained `mlGlossary.ts` and add a unit test that asserts every term in `OPERATING_GUIDE.md` glossary either exists in `mlGlossary.ts` OR is on an explicit skip list. The test fails the build if the guide adds a term that isn't reflected in the UI. This catches drift without coupling the two systems at runtime.

### "What is this?" plaque copy (first draft, for review)

> **What is this?** Each row below is a machine-learning model trained to recognize good sunsets from webcam images. F1 (0–1, higher is better) is the model's overall accuracy. Status indicates training health — "healthy" means the model learned cleanly; "overfit" means it memorized the training images instead of learning the pattern. These models score every new snapshot on `sunrisesunset.studio` and decide which ones the gallery archives.

## New ML pipeline steps

### 1. Failure gallery generation

A new step added to `ml/run_experiment.py` after `evaluate.py` runs. Implementation: extend `evaluate.py` (or add `ml/generate_failure_gallery.py`) to:

1. Load the validation manifest CSV and the model's predictions CSV (`predictions.csv` already exists from eval).
2. Compute absolute error per row (`|y_true - y_pred|` for regression, `1 - p_correct_class` for binary).
3. Sort descending, take top 20.
4. For each item, resolve the `snapshot_id` to the Firebase Storage URL by querying the `webcam_snapshots` table (or by reading from the export manifest if it already includes URLs — TBD during plan phase).
5. Write `failure_gallery.json` to the run's artifact folder.

### 2. `--publish` flag

A new flag on `run_experiment.py` (and `run_training.py` which wraps it). When set:

1. Reads the run's artifacts.
2. Computes the run slug (sanitized run_name).
3. Creates `public/ml-runs/<slug>/`.
4. Copies: `plots/loss_curves.png`, `plots/label_distribution.png`, `config.input.yaml` (renamed `config.yaml`), `failure_gallery.json`.
5. Generates `index.json` from `eval_report.json` + `train_summary.json` + `config.resolved.json`.
6. Updates `public/ml-runs/_manifest.json` (insert or replace the entry for this slug).
7. Prints a one-line summary: `Published → public/ml-runs/<slug>/  (commit + push to deploy)`.

The user manually `git add public/ml-runs/<slug>/` + commits + pushes when they want it live. No automatic git operations from the script.

### 3. Status emoji classification

The diagnosis string already produced by `plot_diagnostics.py` (currently free-text like "overfitting warning" / "healthy" / "modest gap") needs a discrete enum so the UI can map to emoji. Options:

- Extend `plot_diagnostics.py` to write a structured `diagnosis.json` next to the PNGs with `{ "status": "healthy" | "mild_overfit" | "overfit" | "severe_overfit", "note": "..." }`.
- Or compute the status in the `--publish` step from `train_summary.json` (looking at train_loss/val_loss gap at the best epoch + how far the best epoch is from the final epoch).

The plan should pick one; computing in `--publish` is simpler (doesn't require touching `plot_diagnostics.py`) but means the on-disk artifact and the published version disagree.

## Frontend file structure

```
app/
  components/
    ModelAnalysis/
      ModelAnalysisTab.tsx         drawer tab body (master-detail)
      ModelRunList.tsx             left sidebar
      ModelLeaderboard.tsx         default right panel
      ModelRunSummaryCard.tsx      right panel when run selected
      WhatIsThisPlaque.tsx         dismissible callout
      GlossaryTerm.tsx             inline term with tooltip + click-to-expand popover
      GraphCaption.tsx             "how to read this graph" affordance under PNGs
      types.ts                     shared TS types from JSON schemas
  models/
    page.tsx                       redirects to /  (no top-level index for v1)
    [slug]/
      page.tsx                     full per-run detail page
      FailureGallery.tsx
      MetricTiles.tsx
      CollapsibleSection.tsx
  page.tsx                         add 6th tab "Model Analysis"
```

`app/lib/modelRuns.ts` — small helper that reads `public/ml-runs/_manifest.json` and individual `index.json` files using `fs` (server-side only). This is the data layer for both the drawer tab and the routes.

`app/lib/mlGlossary.ts` — exported `ML_GLOSSARY` object keyed by term slug. Single source of glossary content for all `GlossaryTerm` + `GraphCaption` usages. Covered by a unit test that asserts parity with `ml/OPERATING_GUIDE.md` section 16.

## Testing strategy

- **Unit tests (Vitest):** the `--publish` step's manifest update logic (round-trip add/replace/sort).
- **Unit tests (Vitest):** failure gallery JSON schema validation — ensure all required fields are present, image URLs are well-formed.
- **Component tests (Vitest + Testing Library):** ModelRunList renders correct ordering + status emojis. WhatIsThisPlaque dismisses correctly. FailureGallery renders 20 items + handles empty state.
- **Integration test (Vitest):** publish a fixture run end-to-end (mocked filesystem), then read it back through `app/lib/modelRuns.ts` and assert the leaderboard data matches.
- **Manual:** run a real experiment with `--publish` end-to-end on a dev machine, verify the tab + route render correctly.

No E2E browser test for v1 — overkill for an R&D dashboard. Vitest coverage is sufficient.

## Build-time considerations

- `next.config.ts`: ensure `public/ml-runs/` is included in the build output (it is by default — `public/` is always copied).
- `generateStaticParams` in `/models/[slug]/page.tsx` runs at build time and pre-renders one HTML per run. Build time grows linearly with run count. Acceptable up to ~100 runs.
- Image optimization: PNGs in `public/ml-runs/<slug>/plots/` should be served as-is. Failure gallery thumbnails point at external Firebase URLs — use `next/image` with `unoptimized: true` or configure `images.remotePatterns` for the Firebase Storage domain (it may already be configured for the rest of the site — check during planning).

## Open questions / future work

- **Calibration plots.** Reliability diagrams (predicted probability vs. actual positive rate). Highest-value follow-up because the gallery sorts by `llm_quality DESC` — if scores aren't calibrated, sort order is meaningless across models.
- **Embedding visualization.** t-SNE/UMAP of penultimate-layer activations colored by label. Doubles as project art. Probably worth its own spec.
- **Per-webcam breakdown.** Some cameras may systematically fool the model (bad angles, obstructions). A per-webcam error breakdown table would surface this.
- **Per-time-of-day breakdown.** Does the model confuse golden hour with sunset? `llm_time_of_day` column already exists — a quick group-by would expose this.
- **Public `/models` nav entry.** Whether to surface a top-level "Models" link in the site nav for visitors. Currently the analysis is only discoverable via the drawer or a direct URL.
- **Re-running models from the UI.** Out of scope. Would require a queue and worker.

## Success criteria

1. Running `python ml/run_experiment.py --config X --publish` produces a working drawer entry + `/models/<slug>` route after `git push`.
2. A collaborator opening `sunrisesunset.studio/models/v3_regression_llm_labels` (or whatever URL) without prior context can identify: what the model is, how it performed, what its biggest mistakes look like.
3. The "What is this?" plaque is readable to someone with no ML background.
4. The drawer tab loads in <500ms cold on production.
5. Publishing a run adds <2MB to the repo (measured on `v3_regression_llm_labels`).
