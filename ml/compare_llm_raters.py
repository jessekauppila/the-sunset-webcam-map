#!/usr/bin/env python3
"""
Rate the SAME sample of images with two different vision LLMs and
render a single side-by-side HTML comparison report.

Use this to decide whether the price step from a cheaper model (e.g.
`claude-haiku-4-5`) to a pricier model (e.g. `claude-sonnet-4-5`) is
worth it on YOUR data, especially for the edge cases that the cheaper
model gets wrong. Model labeling is preserved everywhere in the report
so you always know which rating came from which model.

Cost example for 50 images:
  - claude-haiku-4-5  ≈ $0.13
  - claude-sonnet-4-5 ≈ $0.38
  Total side-by-side run ≈ $0.50

Usage:
  # Default: Haiku 4.5 vs Sonnet 4.5
  python3 ml/compare_llm_raters.py --count 50

  # Cross-provider comparison
  python3 ml/compare_llm_raters.py --count 50 \\
    --provider-a anthropic --model-a claude-haiku-4-5 \\
    --provider-b openai    --model-b gpt-4o-mini

Outputs:
  ml/artifacts/llm_comparisons/comparison_<timestamp>.html
  ml/artifacts/llm_comparisons/comparison_<timestamp>.csv
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from html import escape as html_escape
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg2
import psycopg2.extras
from tqdm.auto import tqdm

# Local imports — ml/ is the package root for these scripts.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common.io import ensure_dir, get_env_or_file, utc_timestamp
from llm_rater import (
    DEFAULT_MODELS,
    PROVIDER_RATE_FNS,
    download_image_bytes,
    fetch_external_rows,
    fetch_webcam_rows,
    rate_image,
    resolve_api_key,
    sample_rows,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Side-by-side comparison of two vision LLMs on the same sample"
    )
    parser.add_argument("--count", type=int, default=50,
                        help="Number of images to rate (default: 50)")
    parser.add_argument("--sample-mode",
                        choices=["sequential", "random", "spread"],
                        default="spread",
                        help="How to pick the shared sample (default: spread)")
    parser.add_argument("--source", choices=["webcam", "external", "all"],
                        default="webcam")

    parser.add_argument("--provider-a",
                        choices=["anthropic", "gemini", "openai"],
                        default="anthropic")
    parser.add_argument("--model-a", default="claude-haiku-4-5")
    parser.add_argument("--provider-b",
                        choices=["anthropic", "gemini", "openai"],
                        default="anthropic")
    parser.add_argument("--model-b", default="claude-sonnet-4-5")

    parser.add_argument("--rpm", type=int, default=30,
                        help="Per-model max requests per minute (default: 30)")
    parser.add_argument("--download-timeout", type=float, default=30.0)
    parser.add_argument("--api-timeout", type=float, default=60.0)
    parser.add_argument("--verbose", action="store_true")

    parser.add_argument("--output-html", default="",
                        help="Override output HTML path "
                             "(default: ml/artifacts/llm_comparisons/comparison_<ts>.html)")
    parser.add_argument("--database-url", default="",
                        help="Postgres connection string "
                             "(default: DATABASE_URL from env or .env.local)")
    parser.add_argument("--env-file", default=".env.local")
    parser.add_argument("--no-progress", action="store_true")
    return parser.parse_args()


def fetch_sample(
    conn: psycopg2.extensions.connection,
    source: str,
    count: int,
    sample_mode: str,
) -> list[dict[str, Any]]:
    """Pull the candidate pool then sample N rows. Both models see the same N."""
    rows: list[dict[str, Any]] = []
    if source in ("webcam", "all"):
        rows.extend(fetch_webcam_rows(conn, skip_rated=False, limit=0))
    if source in ("external", "all"):
        rows.extend(fetch_external_rows(conn, skip_rated=False, limit=0))
    return sample_rows(rows, count, sample_mode)


def rate_one(
    image_bytes: bytes,
    provider: str,
    model: str,
    api_key: str,
    timeout: float,
) -> tuple[dict | None, str | None, float]:
    """Wrapper around rate_image that returns (rating, error, elapsed_seconds)."""
    t0 = time.monotonic()
    try:
        rating = rate_image(image_bytes, provider, model, api_key, timeout)
        return rating, None, time.monotonic() - t0
    except Exception as exc:
        return None, str(exc), time.monotonic() - t0


def render_card_block(label_id: str, rating: dict | None, error: str | None) -> str:
    """One model's rating block inside a comparison row. Self-contained HTML."""
    if rating is None:
        return f"""
        <div class="model-block error" data-model="{label_id}">
          <div class="model-error">FAILED: {html_escape(error or 'unknown error')}</div>
        </div>
        """

    quality = float(rating.get("quality") or 0)
    is_sunset = bool(rating.get("is_sunset"))
    confidence = float(rating.get("confidence") or 0)
    has_clouds = bool(rating.get("has_clouds"))
    palette = html_escape(str(rating.get("color_palette") or ""))
    obstruction_raw = str(rating.get("obstruction") or "")
    obstruction = html_escape(obstruction_raw)

    bar_color = (
        "#c62828" if quality < 0.3 else
        "#ed6c02" if quality < 0.6 else
        "#2e7d32"
    )
    bar_pct = int(quality * 100)

    return f"""
    <div class="model-block" data-model="{label_id}">
      <div class="quality-row">
        <div class="quality-num" style="color:{bar_color};">{quality:.2f}</div>
        <div class="quality-bar">
          <div class="quality-fill" style="width:{bar_pct}%; background:{bar_color};"></div>
        </div>
      </div>
      <div class="badges">
        <span class="badge {'on' if is_sunset else 'off'}">
          {'sunset' if is_sunset else 'not sunset'}
        </span>
        <span class="badge {'on' if has_clouds else 'off'}">
          {'has clouds' if has_clouds else 'no clouds'}
        </span>
        <span class="badge muted">conf {confidence:.2f}</span>
        {f'<span class="badge obstructed">obstructed</span>' if obstruction_raw else ''}
      </div>
      <div class="palette">{palette}</div>
      {f'<div class="obstruction">obstruction: {obstruction}</div>' if obstruction_raw else ''}
    </div>
    """


def render_comparison_html(
    rows: list[dict[str, Any]],
    a_label: str,
    b_label: str,
    output_path: str,
    sample_mode: str,
) -> None:
    """Build a self-contained HTML page with row-per-image, two model blocks each."""

    rows_sorted = sorted(
        rows,
        key=lambda r: float(r.get("max_delta") or 0),
        reverse=True,
    )

    cards: list[str] = []
    successes = 0
    obstructed_a = 0
    obstructed_b = 0
    big_disagree = 0

    for r in rows_sorted:
        rating_a = r.get("rating_a")
        rating_b = r.get("rating_b")
        error_a = r.get("error_a")
        error_b = r.get("error_b")

        if rating_a and rating_b:
            successes += 1
        if rating_a and rating_a.get("obstruction"):
            obstructed_a += 1
        if rating_b and rating_b.get("obstruction"):
            obstructed_b += 1

        q_a = float(rating_a.get("quality") if rating_a else 0)
        q_b = float(rating_b.get("quality") if rating_b else 0)
        c_a = float(rating_a.get("confidence") if rating_a else 0)
        c_b = float(rating_b.get("confidence") if rating_b else 0)
        s_a = bool(rating_a.get("is_sunset")) if rating_a else False
        s_b = bool(rating_b.get("is_sunset")) if rating_b else False
        delta_q = abs(q_a - q_b)
        delta_c = abs(c_a - c_b)
        sunset_disagree = s_a != s_b
        if delta_q >= 0.30 or sunset_disagree:
            big_disagree += 1

        # Use diff bar to highlight magnitude of disagreement.
        delta_color = (
            "#2e7d32" if delta_q < 0.10 else
            "#ed6c02" if delta_q < 0.25 else
            "#c62828"
        )
        delta_label = (
            "match" if delta_q < 0.10 else
            "mild" if delta_q < 0.25 else
            "BIG"
        )

        record_id = r.get("record_id", "")
        source = str(r.get("source_table") or "")
        image_url = str(r.get("image_url") or "")
        human = r.get("human_calculated_rating")
        human_html = (
            f'<div class="human">Human: {float(human):.2f}/5 '
            f'({int(r.get("human_rating_count") or 0)} raters)</div>'
            if human is not None else
            '<div class="human muted">No human rating</div>'
        )

        sunset_disagree_html = (
            'sunset: <strong style="color:#c62828;">DISAGREE</strong>'
            if sunset_disagree else 'sunset: agree'
        )

        # Searchable text blob across both models.
        search_text = " ".join(filter(None, [
            str(record_id), source,
            (rating_a or {}).get("color_palette") or "",
            (rating_a or {}).get("obstruction") or "",
            (rating_b or {}).get("color_palette") or "",
            (rating_b or {}).get("obstruction") or "",
            "sunset-disagree" if sunset_disagree else "sunset-agree",
        ])).lower()

        cards.append(f"""
        <div class="row"
             data-record-id="{html_escape(str(record_id))}"
             data-quality-a="{q_a:.4f}"
             data-quality-b="{q_b:.4f}"
             data-confidence-a="{c_a:.4f}"
             data-confidence-b="{c_b:.4f}"
             data-delta-quality="{delta_q:.4f}"
             data-delta-confidence="{delta_c:.4f}"
             data-sunset-disagree="{int(sunset_disagree)}"
             data-search="{html_escape(search_text, quote=True)}">
          <div class="row-image">
            <img src="{html_escape(image_url, quote=True)}"
                 alt="image {html_escape(str(record_id))}" loading="lazy"/>
            <div class="row-meta">
              <div class="row-id">#{html_escape(str(record_id))}</div>
              <div class="row-source">{html_escape(source)}</div>
              {human_html}
            </div>
          </div>
          <div class="model-col">
            <div class="model-label model-a-label">A · {html_escape(a_label)}</div>
            {render_card_block('a', rating_a, error_a)}
          </div>
          <div class="model-col">
            <div class="model-label model-b-label">B · {html_escape(b_label)}</div>
            {render_card_block('b', rating_b, error_b)}
          </div>
          <div class="delta-col">
            <div class="delta-label" style="color:{delta_color};">{delta_label}</div>
            <div class="delta-num" style="color:{delta_color};">|Δq| {delta_q:.2f}</div>
            <div class="delta-detail">|Δconf| {delta_c:.2f}</div>
            <div class="delta-detail">{sunset_disagree_html}</div>
          </div>
        </div>
        """)

    js = """
<script>
(function() {
  const grid = document.getElementById('grid');
  const rows = Array.from(grid.querySelectorAll('.row'));
  const counter = document.getElementById('count');
  const total = rows.length;

  const ctrls = {
    search:           document.getElementById('f-search'),
    minDeltaQuality:  document.getElementById('f-min-dq'),
    minDeltaConf:     document.getElementById('f-min-dc'),
    sunsetDisagree:   document.getElementById('f-sunset-disagree'),
    sort:             document.getElementById('f-sort'),
  };
  const minDQLabel = document.getElementById('f-min-dq-val');
  const minDCLabel = document.getElementById('f-min-dc-val');

  function apply() {
    const q = (ctrls.search.value || '').trim().toLowerCase();
    const minDQ = parseFloat(ctrls.minDeltaQuality.value);
    const minDC = parseFloat(ctrls.minDeltaConf.value);
    minDQLabel.textContent = minDQ.toFixed(2);
    minDCLabel.textContent = minDC.toFixed(2);
    const sunsetWanted = ctrls.sunsetDisagree.value;

    let visible = 0;
    for (const row of rows) {
      const text = row.dataset.search || '';
      const dq = parseFloat(row.dataset.deltaQuality);
      const dc = parseFloat(row.dataset.deltaConfidence);
      const sd = row.dataset.sunsetDisagree;

      let show = true;
      if (q && !text.includes(q)) show = false;
      if (show && dq < minDQ) show = false;
      if (show && dc < minDC) show = false;
      if (show && sunsetWanted === 'yes' && sd !== '1') show = false;
      if (show && sunsetWanted === 'no'  && sd !== '0') show = false;

      row.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    counter.textContent = `${visible} of ${total}`;
  }

  function sortRows() {
    const mode = ctrls.sort.value;
    const cmp = {
      'delta-desc':       (a,b) => b.dq - a.dq,
      'delta-asc':        (a,b) => a.dq - b.dq,
      'quality-a-desc':   (a,b) => b.qa - a.qa,
      'quality-b-desc':   (a,b) => b.qb - a.qb,
      'record-id':        (a,b) => String(a.r).localeCompare(String(b.r)),
    }[mode] || ((a,b) => b.dq - a.dq);

    const sorted = rows.map(row => ({
      row,
      dq: parseFloat(row.dataset.deltaQuality),
      qa: parseFloat(row.dataset.qualityA),
      qb: parseFloat(row.dataset.qualityB),
      r:  row.dataset.recordId,
    })).sort(cmp);
    for (const item of sorted) grid.appendChild(item.row);
  }

  for (const ctrl of Object.values(ctrls)) {
    if (!ctrl) continue;
    const evt = ctrl.tagName === 'INPUT' && (ctrl.type === 'text' || ctrl.type === 'range')
      ? 'input' : 'change';
    ctrl.addEventListener(evt, () => {
      if (ctrl === ctrls.sort) sortRows();
      apply();
    });
  }

  document.getElementById('f-reset').addEventListener('click', () => {
    ctrls.search.value = '';
    ctrls.minDeltaQuality.value = '0';
    ctrls.minDeltaConf.value = '0';
    ctrls.sunsetDisagree.value = 'all';
    ctrls.sort.value = 'delta-desc';
    sortRows();
    apply();
  });

  apply();
})();
</script>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>LLM Rater Comparison — {html_escape(a_label)} vs {html_escape(b_label)}</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; background: #fafafa; margin: 0; padding: 24px; color: #222; }}
  h1 {{ font-size: 22px; margin: 0 0 4px 0; }}
  .summary {{ color: #555; margin-bottom: 16px; font-size: 14px; }}
  .legend {{ display: flex; gap: 16px; margin-bottom: 16px; font-size: 13px; }}
  .legend .swatch {{ display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: middle; margin-right: 6px; }}
  .toolbar {{
    background: white; border-radius: 12px; padding: 12px 16px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px 16px; margin-bottom: 16px; align-items: end;
  }}
  .toolbar label {{ display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #555; }}
  .toolbar input[type=text],
  .toolbar select {{
    padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px;
    font-size: 13px; background: white; color: #222;
  }}
  .toolbar input[type=range] {{ width: 100%; }}
  .toolbar button {{
    padding: 7px 12px; border: 1px solid #ddd; background: #fafafa;
    border-radius: 6px; cursor: pointer; font-size: 13px;
  }}
  .toolbar button:hover {{ background: #eee; }}
  .toolbar .count-row {{ font-size: 13px; color: #333; }}

  .grid {{ display: flex; flex-direction: column; gap: 12px; }}
  .row {{
    background: white; border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    display: grid; grid-template-columns: 320px 1fr 1fr 140px;
    gap: 12px; padding: 12px; align-items: stretch;
  }}
  @media (max-width: 1100px) {{
    .row {{ grid-template-columns: 1fr; }}
  }}
  .row-image img {{ width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: #eee; display: block; }}
  .row-meta {{ font-size: 12px; color: #666; margin-top: 6px; line-height: 1.4; }}
  .row-id {{ font-family: monospace; }}
  .row-source {{ text-transform: uppercase; letter-spacing: 0.5px; color: #888; }}

  .model-col {{ display: flex; flex-direction: column; gap: 4px; }}
  .model-label {{
    font-size: 12px; font-weight: 600; padding: 4px 8px; border-radius: 6px;
    align-self: flex-start; letter-spacing: 0.3px;
  }}
  .model-a-label {{ background: #e3f2fd; color: #1565c0; }}
  .model-b-label {{ background: #f3e5f5; color: #6a1b9a; }}
  .model-block {{
    background: #fafafa; border-radius: 8px; padding: 10px 12px;
    flex: 1; display: flex; flex-direction: column; gap: 6px;
  }}
  .model-block.error {{ background: #fdecea; }}
  .model-error {{ color: #c62828; font-size: 12px; }}

  .quality-row {{ display: flex; align-items: center; gap: 10px; }}
  .quality-num {{ font-size: 22px; font-weight: 600; min-width: 50px; }}
  .quality-bar {{ flex: 1; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; }}
  .quality-fill {{ height: 100%; }}
  .badges {{ display: flex; flex-wrap: wrap; gap: 4px; }}
  .badge {{ font-size: 11px; padding: 3px 8px; border-radius: 10px; background: #eee; color: #555; }}
  .badge.on {{ background: #e8f5e9; color: #2e7d32; }}
  .badge.off {{ background: #fafafa; color: #999; }}
  .badge.muted {{ background: #f0f0f0; color: #666; }}
  .badge.obstructed {{ background: #fdecea; color: #c62828; }}
  .palette {{ font-size: 12px; color: #444; line-height: 1.4; }}
  .obstruction {{ font-size: 11px; color: #c62828; }}
  .human {{ font-size: 11px; color: #666; }}
  .human.muted {{ color: #aaa; }}

  .delta-col {{
    display: flex; flex-direction: column; gap: 4px;
    background: #fafafa; border-radius: 8px; padding: 10px 12px;
    align-items: center; justify-content: center; text-align: center;
  }}
  .delta-label {{ font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }}
  .delta-num {{ font-size: 16px; font-weight: 600; }}
  .delta-detail {{ font-size: 11px; color: #666; }}
</style>
</head>
<body>
  <h1>LLM Rater comparison</h1>
  <div class="summary">
    <strong style="background:#e3f2fd;color:#1565c0;padding:2px 8px;border-radius:4px;">A · {html_escape(a_label)}</strong>
    &nbsp;vs&nbsp;
    <strong style="background:#f3e5f5;color:#6a1b9a;padding:2px 8px;border-radius:4px;">B · {html_escape(b_label)}</strong>
    &nbsp;·&nbsp; {len(rows)} images ({sample_mode} sample)
    &nbsp;·&nbsp; both succeeded: {successes}
    &nbsp;·&nbsp; obstructed (A/B): {obstructed_a}/{obstructed_b}
    &nbsp;·&nbsp; large disagreements (|Δq|≥0.30 or sunset flips): {big_disagree}
  </div>

  <div class="legend">
    <div><span class="swatch" style="background:#2e7d32;"></span>match (|Δq|&lt;0.10)</div>
    <div><span class="swatch" style="background:#ed6c02;"></span>mild (0.10–0.25)</div>
    <div><span class="swatch" style="background:#c62828;"></span>BIG (≥0.25)</div>
  </div>

  <div class="toolbar">
    <label>Search
      <input type="text" id="f-search" placeholder="palette, obstruction, id…"/>
    </label>
    <label>Sunset disagreement only
      <select id="f-sunset-disagree">
        <option value="all">all</option>
        <option value="yes">disagreement only</option>
        <option value="no">agreement only</option>
      </select>
    </label>
    <label>Min |Δquality| <span id="f-min-dq-val">0.00</span>
      <input type="range" id="f-min-dq" min="0" max="1" step="0.05" value="0"/>
    </label>
    <label>Min |Δconfidence| <span id="f-min-dc-val">0.00</span>
      <input type="range" id="f-min-dc" min="0" max="1" step="0.05" value="0"/>
    </label>
    <label>Sort by
      <select id="f-sort">
        <option value="delta-desc">disagreement (worst first)</option>
        <option value="delta-asc">agreement (best first)</option>
        <option value="quality-a-desc">A: quality (high → low)</option>
        <option value="quality-b-desc">B: quality (high → low)</option>
        <option value="record-id">record id</option>
      </select>
    </label>
    <div class="count-row">
      Showing <strong id="count">{len(rows)} of {len(rows)}</strong>
      <button id="f-reset" type="button" style="margin-left: 8px;">Reset</button>
    </div>
  </div>

  <div class="grid" id="grid">
    {''.join(cards)}
  </div>
  {js}
</body>
</html>
"""
    Path(output_path).write_text(html, encoding="utf-8")


def main() -> None:
    args = parse_args()

    api_key_a = resolve_api_key(args.provider_a, "", args.env_file)
    api_key_b = resolve_api_key(args.provider_b, "", args.env_file)

    database_url = (
        args.database_url
        or get_env_or_file("DATABASE_URL", args.env_file)
    )
    if not database_url:
        raise RuntimeError(
            "DATABASE_URL not found. Pass --database-url, export it, "
            f"or set DATABASE_URL=... in {args.env_file}."
        )

    a_label = f"{args.provider_a} / {args.model_a}"
    b_label = f"{args.provider_b} / {args.model_b}"

    ts = utc_timestamp()
    output_html = args.output_html or str(
        Path("ml/artifacts/llm_comparisons") / f"comparison_{ts}.html"
    )
    output_csv = str(
        Path("ml/artifacts/llm_comparisons") / f"comparison_{ts}.csv"
    )
    ensure_dir(Path(output_html).parent)

    print("LLM Rater comparison", flush=True)
    print(f"  A: {a_label}", flush=True)
    print(f"  B: {b_label}", flush=True)
    print(f"  Source:        {args.source}", flush=True)
    print(f"  Sample size:   {args.count}", flush=True)
    print(f"  Sample mode:   {args.sample_mode}", flush=True)
    print(f"  RPM (per LLM): {args.rpm}", flush=True)
    print(f"  Output HTML:   {output_html}", flush=True)
    print(f"  Output CSV:    {output_csv}", flush=True)

    print("Connecting to Postgres…", flush=True)
    conn = psycopg2.connect(database_url)
    print("  connected.", flush=True)

    rows = fetch_sample(conn, args.source, args.count, args.sample_mode)
    print(f"  Sampled rows: {len(rows)}", flush=True)
    conn.close()

    if not rows:
        print("Nothing to rate.")
        return

    delay = 60.0 / args.rpm if args.rpm > 0 else 0
    progress = tqdm(rows, desc="Rating", unit="img", disable=args.no_progress)

    for idx, row in enumerate(progress, start=1):
        record_id = row["record_id"]
        image_url = row["image_url"]

        try:
            image_bytes = download_image_bytes(
                image_url, timeout=args.download_timeout,
            )
        except Exception as exc:
            row["error_a"] = f"download failed: {exc}"
            row["error_b"] = f"download failed: {exc}"
            row["rating_a"] = None
            row["rating_b"] = None
            row["max_delta"] = 0.0
            tqdm.write(
                f"[{idx}/{len(rows)}] record {record_id}: download FAILED: {exc}"
            )
            continue

        rating_a, error_a, t_a = rate_one(
            image_bytes, args.provider_a, args.model_a, api_key_a, args.api_timeout,
        )
        if delay > 0:
            time.sleep(delay)
        rating_b, error_b, t_b = rate_one(
            image_bytes, args.provider_b, args.model_b, api_key_b, args.api_timeout,
        )
        if delay > 0:
            time.sleep(delay)

        q_a = float(rating_a.get("quality") if rating_a else 0)
        q_b = float(rating_b.get("quality") if rating_b else 0)
        max_delta = abs(q_a - q_b)

        row["rating_a"] = rating_a
        row["rating_b"] = rating_b
        row["error_a"] = error_a
        row["error_b"] = error_b
        row["max_delta"] = max_delta

        if args.verbose or rating_a is None or rating_b is None:
            tqdm.write(
                f"[{idx}/{len(rows)}] record {record_id}: "
                f"A={q_a:.2f} ({t_a:.1f}s) B={q_b:.2f} ({t_b:.1f}s) "
                f"|Δ|={max_delta:.2f}"
                + (f"  err_a={error_a}" if error_a else "")
                + (f"  err_b={error_b}" if error_b else "")
            )

    csv_rows = []
    for r in rows:
        rating_a = r.get("rating_a") or {}
        rating_b = r.get("rating_b") or {}
        csv_rows.append({
            "record_id": r.get("record_id"),
            "source_table": r.get("source_table"),
            "image_url": r.get("image_url"),
            "human_calculated_rating": r.get("human_calculated_rating"),
            "human_rating_count": r.get("human_rating_count"),
            "a_provider": args.provider_a,
            "a_model": args.model_a,
            "a_quality": rating_a.get("quality"),
            "a_is_sunset": rating_a.get("is_sunset"),
            "a_confidence": rating_a.get("confidence"),
            "a_has_clouds": rating_a.get("has_clouds"),
            "a_color_palette": rating_a.get("color_palette"),
            "a_obstruction": rating_a.get("obstruction"),
            "a_error": r.get("error_a"),
            "b_provider": args.provider_b,
            "b_model": args.model_b,
            "b_quality": rating_b.get("quality"),
            "b_is_sunset": rating_b.get("is_sunset"),
            "b_confidence": rating_b.get("confidence"),
            "b_has_clouds": rating_b.get("has_clouds"),
            "b_color_palette": rating_b.get("color_palette"),
            "b_obstruction": rating_b.get("obstruction"),
            "b_error": r.get("error_b"),
            "delta_quality": r.get("max_delta"),
            "rated_at": datetime.now(timezone.utc).isoformat(),
        })
    pd.DataFrame(csv_rows).to_csv(output_csv, index=False)

    render_comparison_html(rows, a_label, b_label, output_html, args.sample_mode)

    successes = sum(1 for r in rows if r.get("rating_a") and r.get("rating_b"))
    big_disagree = sum(
        1 for r in rows
        if (r.get("max_delta") or 0) >= 0.30
        or (
            r.get("rating_a") and r.get("rating_b")
            and bool(r["rating_a"].get("is_sunset")) != bool(r["rating_b"].get("is_sunset"))
        )
    )

    summary = {
        "a_label": a_label,
        "b_label": b_label,
        "total_images": len(rows),
        "both_succeeded": successes,
        "large_disagreements": big_disagree,
        "output_html": output_html,
        "output_csv": output_csv,
    }
    print("\n--- Summary ---")
    print(json.dumps(summary, indent=2))
    print(f"\nOpen the report with: open '{output_html}'")


if __name__ == "__main__":
    main()
