# LACMA Grant `.docx` Build Notes

How the LACMA Art + Technology Lab 2026 grant application `.docx` files
are generated, edited, and formatted.

This doc exists so that future-you (or a collaborator) can open a single
file and immediately understand the pipeline, without reverse-engineering
the scripts.

---

## TL;DR

The application `.docx` is **generated from a Python script** using the
[`python-docx`](https://python-docx.readthedocs.io/) library. There is no
hand-authored Word file — every revision is produced by editing the
script and re-running it.

```bash
python3 art-grant-skill/scripts/build_lacma_docx_v2.py
```

→ writes `Supporting Text/output/LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx`.

> **Note — scripts moved 2026-04-23.** The LACMA build scripts were
> relocated from `scripts/` at the repo root into
> `art-grant-skill/scripts/` as part of consolidating the grant-writing
> patterns into a portable `art-grant-skill/` folder. The scripts now
> write directly to `Supporting Text/output/` (the `OUTPUT` path was
> updated when they moved). See `art-grant-skill/SKILL.md` for the full
> process and `art-grant-skill/README.md` for quickstart. This file
> (`LACMA_DOCX_BUILD_NOTES.md`) remains the LACMA-specific reference;
> the grant-agnostic template lives at
> `art-grant-skill/templates/docx-build-notes.md`.

---

## Why a script, not a Word document?

1. **Diffable.** Every revision is a text-file diff on GitHub. You can
   compare v1 → v2 line-by-line, annotate why a sentence changed, and
   roll back.
2. **Reproducible.** No "which version is this Word file?" confusion.
   The script is the source of truth; the `.docx` is an artifact.
3. **Consistent styling.** Fonts, margins, heading sizes, and table
   formatting are defined in one place and applied uniformly. No drift
   between drafts.
4. **Word-count honesty.** You can count words in any section
   programmatically (see "Verifying word counts" below) instead of
   trusting Word's counter on styled tables and bullets.
5. **Parallel drafts.** A v2 can exist alongside v1 without destroying
   earlier work — each is its own script + its own output file.

Trade-off: it takes one extra step (editing the script) to change
content, versus clicking into Word. Worth it for grant work where
precision and versioning matter.

---

## File layout

```
art-grant-skill/scripts/
├── _style.py                         # shared python-docx helpers
├── build_lacma_docx.py               # v1 — first clean draft (Jesse solo)
├── build_lacma_docx_v2.py            # v2 — collaboration version
│                                     #   (Jesse + Kameron Decker Harris)
├── build_lacma_docx_v5_part2.py      # v5 §11 + §12 only (partial builder)
├── build_cv_docx.py                  # Jesse's CV builder
├── grant_docx_template.py            # starter for other grants
├── cv_docx_template.py               # starter for other CVs
└── to_pdf.py                         # docx → pdf via LibreOffice

Supporting Text/
├── LACMA_PROPOSAL_CLAUDE_PROJECT_NOTES.md      # canonical notes
├── LACMA_ART_TECH_LAB_APPLICATION_2026_v2.md   # v2 markdown draft (editor notes)
├── LACMA_ART_TECH_LAB_APPLICATION_2026_v3.md   # v3 clean markdown
├── LACMA_ART_TECH_LAB_APPLICATION_2026_v4.md   # v4 research reframe
├── LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md   # v5 budget rebalance (current)
├── lacma-grant-context.md                      # personal context / bio source
└── output/
    ├── LACMA_Art_Tech_Lab_2026_Kauppila.docx                  # v1 artifact
    ├── LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx        # v2 artifact
    ├── LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v5_part2.docx  # v5 partial
    └── LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v5_part2.pdf   # v5 partial as PDF

LACMA_DOCX_BUILD_NOTES.md             # this file
```

The markdown `v2` / `v3` files and the script are kept in sync by hand.
Treat `v3.md` as the "canonical clean text" and the Python script as the
"formatted deliverable." When you change copy, change both.

---

## Anatomy of the build script

Each script follows the same shape. Here is the map of
`build_lacma_docx_v2.py`:

```
┌─────────────────────────────────────────────────────────┐
│  imports + OUTPUT path                                  │
├─────────────────────────────────────────────────────────┤
│  Style helpers                                          │
│    set_cell_border()      — table borders               │
│    shade_cell()           — table row shading           │
│    configure_document()   — margins, fonts, headings    │
│    add_heading()          — H1/H2/H3                    │
│    add_para()             — body paragraph              │
│    add_bullets()          — bulleted list               │
├─────────────────────────────────────────────────────────┤
│  Table helpers                                          │
│    add_budget_table()     — 3-col budget table          │
│    add_plan_table()       — 4-col implementation table  │
├─────────────────────────────────────────────────────────┤
│  build_document()         — the content, section by     │
│                             section (§1 – §12)          │
├─────────────────────────────────────────────────────────┤
│  main()                   — save to OUTPUT              │
└─────────────────────────────────────────────────────────┘
```

### Style baseline

`configure_document()` sets:

- Page: US Letter, 1" margins
- Body font: Calibri 11, 1.15 line spacing, 6 pt space-after
- Headings: Calibri, bold, dark gray (H1 16pt, H2 13pt, H3 11pt)

If LACMA ever specifies a different font or margin, change it here —
once — and every section adopts it.

### Content structure

`build_document()` builds the doc top-to-bottom in the order LACMA
asks for:

1. Title block (centered)
2. Applicant metadata (names, project, URLs, deadline)
3. §1 Name of Project
4. §2 Three Words
5. §3 One-Sentence Description
6. §4 Full Description (**500-word limit**)
7. §5 Bio (no limit; currently ~283 words — Jesse + Kameron)
8. §6 Artistic Merit (**100-word limit**)
9. §7 Dialogue Between Technology and Culture (**100-word limit**)
10. §8 Public Engagement Plan (**100-word limit**)
11. §9 Other Funding Sources and In-Kind Support
12. §10 Total Amount Requested
13. §11 Detailed Budget (table)
14. §12 Implementation Plan (table)
15. Supporting Images (placeholder list)

Every prose section is a sequence of `add_para(doc, "…")` and
`add_bullets(doc, [...])` calls. Tables are built by passing a list of
tuples to `add_budget_table` / `add_plan_table`.

---

## Editing a section

### Editing prose (§1 – §10)

1. Open `art-grant-skill/scripts/build_lacma_docx_v2.py`.
2. Find the section's heading comment (e.g. `# ---- 4. Full Description ---`).
3. Edit the string literals inside `add_para(...)` or list items inside
   `add_bullets(...)`.
4. Re-run the script.
5. If the section has a word-count cap, verify (see next section).

**Rule of thumb for paragraph breaks:** one `add_para(...)` call =
one visible paragraph in Word.

### Editing the budget (§11)

The budget is a list of 3-tuples: `(category, item, cost)`.

```python
budget_rows = [
    ("Principal Fees",
     "Jesse Kauppila — artist time: research, development, "
     "installation, documentation (24 months)", "$17,000"),
    ...
    ("TOTAL", "", "$50,000"),
]
```

- Rows with the same `category` as the previous row collapse their
  category cell (it shows empty). This is automatic — see
  `add_budget_table`.
- The row with category `"TOTAL"` (or an item equal to `"TOTAL"`) is
  bolded and shaded. Keep it as the last row.
- To keep the total at $50,000, adjust lines by hand and re-verify
  arithmetic. There is no automatic balancer; add a quick Python check
  if you want one (see "Verifying totals" below).

### Editing the implementation plan (§12)

The plan is a list of 4-tuples:
`(phase, timeline, milestones, cost)`.

```python
plan_rows = [
    (
        "Phase 1: Foundation + Webcam v1",
        "Fall 2026 (Months 1–4)",
        "Formalize the co-lead agreement with Kameron Decker Harris "
        "and kick off ML architecture and training-strategy work. "
        "...",
        "$11,000",
    ),
    ...
]
```

Phase costs should sum to the grant total.

### Editing header metadata

The applicant block at the top is a list of `(text, bold?)` tuples:

```python
meta_lines = [
    ("Applicants: ", True),
    ("Jesse Kauppila  &  Kameron Decker Harris", False),
    ("\nProject: ", True),
    ("Sunrise / Sunset", False),
    ...
]
```

Newlines (`"\n"`) inside a string create line breaks inside the same
centered block. Use sparingly.

---

## Running the build

```bash
# from repo root
python3 art-grant-skill/scripts/build_lacma_docx_v2.py
```

Requirements: `python-docx` must be installed in the Python you use.

```bash
python3 -m pip install python-docx
```

(The only non-stdlib import is `docx`. No other setup.)

The script prints the output path on success:

```
Wrote /…/the-sunset-webcam-map/output/LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx
```

---

## Verifying word counts

LACMA enforces hard caps on §4, §6, §7, §8. Run this one-liner after
every build to confirm you are under the limit:

```bash
python3 - <<'EOF'
from docx import Document
doc = Document('output/LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx')
sections, current = {}, None
for p in doc.paragraphs:
    t = p.text.strip()
    if not t:
        continue
    if t[0].isdigit() and '.' in t[:4]:
        current = t.split('.')[0]
        sections[current] = []
        continue
    if current:
        sections[current].append(t)
for k in ['4', '5', '6', '7', '8']:
    body = ' '.join(sections.get(k, []))
    print(f"§{k}: {len(body.split())} words")
EOF
```

Current targets in `_v2.docx`:

| Section | Limit | Current |
|---------|-------|---------|
| §4 Full Description | 500 | 496 |
| §5 Bio | n/a | 283 |
| §6 Artistic Merit | 100 | 95 |
| §7 Tech + Culture | 100 | 97 |
| §8 Public Engagement | 100 | 98 |

Leave yourself a 2–5 word buffer under each cap; different word counters
(Word, Google Docs, LACMA's submission system) can split em-dashes and
hyphenated words differently.

### Verifying budget totals

Optional quick sanity check — paste into a terminal after editing the
budget:

```bash
python3 - <<'EOF'
import re, sys
src = open('art-grant-skill/scripts/build_lacma_docx_v2.py').read()
costs = re.findall(r'"\$([0-9,]+)"', src)
nums = [int(c.replace(',', '')) for c in costs]
total_line = nums[-1]
lines = nums[:-1]
print(f"Line items sum: ${sum(lines):,}")
print(f"Stated TOTAL:   ${total_line:,}")
print("MATCH" if sum(lines) == total_line else "MISMATCH")
EOF
```

This is naive (it treats every `"$…"` literal in the file as a budget
line), but with the current script structure it is correct. If you add
other dollar strings elsewhere in the script, either revise this check
or rely on manual arithmetic.

---

## Version strategy

Each major drafting milestone gets its own script + its own output
filename, so nothing is destroyed:

| Script | Output | Purpose |
|--------|--------|---------|
| `build_lacma_docx.py` | `…_Kauppila.docx` | Jesse-only v1 (original clean draft) |
| `build_lacma_docx_v2.py` | `…_Kauppila_Harris_v2.docx` | Collaboration draft — real URLs, trims, Kameron bio |

If you need a v3:

1. `cp art-grant-skill/scripts/build_lacma_docx_v2.py art-grant-skill/scripts/build_lacma_docx_v3.py`
2. Update `OUTPUT` at the top to a new filename (e.g. `…_v3_final.docx`).
3. Edit content.
4. Run.

This keeps every previous artifact available for comparison.

---

## Opening the `.docx` and final polish

After generating, open the file in Word / Pages / Google Docs and:

1. **Spot-check word counts** with the host's counter in addition to the
   Python verification above.
2. **Embed the five supporting images** (§Supporting Images). The
   script lists placeholders only; insert the actual JPEGs by hand. This
   is the one step intentionally left manual, because image sizing is
   easier to adjust visually than programmatically.
3. **Print-preview** to confirm no orphan table rows break awkwardly
   across pages. If they do, you can either:
   - Tweak Calibri size (Pt 11 → Pt 10.5) in `configure_document()`, or
   - Adjust row content to be shorter.
4. **Export to PDF** if LACMA's submission system prefers PDF — most do.

---

## Common pitfalls

- **Smart quotes vs. straight quotes.** The script uses curly quotes
  (`’`, `“`, `”`) directly in string literals. If you copy-paste from a
  draft that uses straight quotes, re-smart them for visual consistency.
- **Em-dashes.** Same deal — use `—` (U+2014), not `--`.
- **`output/` vs. `Supporting Text/output/`.** The script writes to
  `output/` at the repo root. The user-facing copies have been moved
  into `Supporting Text/output/`. If you re-run, remember to move the
  new file.
- **Trailing whitespace in strings.** Python auto-concatenates adjacent
  string literals, so make sure each line either ends with a trailing
  space or has one at the start of the next line — otherwise words run
  together in the output.
  ```python
  "this line"
  "and this"   # → "this lineand this"   ❌
  "this line "
  "and this"   # → "this line and this"  ✓
  ```

---

## Quick reference: one-shot rebuild + verify

```bash
python3 art-grant-skill/scripts/build_lacma_docx_v2.py && python3 - <<'EOF'
from docx import Document
doc = Document('output/LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx')
sections, current = {}, None
for p in doc.paragraphs:
    t = p.text.strip()
    if not t:
        continue
    if t[0].isdigit() and '.' in t[:4]:
        current = t.split('.')[0]
        sections[current] = []
        continue
    if current:
        sections[current].append(t)
for k, limit in [('4', 500), ('6', 100), ('7', 100), ('8', 100)]:
    body = ' '.join(sections.get(k, []))
    n = len(body.split())
    flag = "" if n <= limit else "  ⚠ OVER"
    print(f"§{k}: {n} / {limit}{flag}")
EOF
```

That's the entire loop: edit the Python → re-run → confirm word counts
→ open the `.docx` → embed images → submit.
