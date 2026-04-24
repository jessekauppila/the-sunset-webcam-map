# Artist-CV `.docx` Build Notes

How to reformat an artist's exhibition CV into a clean, classic
gallery-style `.docx` via a reproducible Python script, and convert it
to PDF for grant applications.

This doc exists so that a future agent (or a collaborator) can read a
single file and immediately understand the pipeline, typography
choices, data shapes, and known pitfalls — without reverse-engineering
the original build session.

Companion to `LACMA_DOCX_BUILD_NOTES.md` in the same repo. The LACMA
doc covers prose-heavy grant applications with word-count limits; this
doc covers CV-shaped content (year / title / venue lists).

---

## TL;DR

The CV `.docx` is **generated from a Python script** using
[`python-docx`](https://python-docx.readthedocs.io/). There is no
hand-authored Word file — every revision is produced by editing the
script and re-running it.

```bash
python3 scripts/build_cv_docx.py
```

→ writes `Supporting Text/output/Kauppila_CV_formatted.docx`.

Open in Word, spot-check the visual layout, and export to PDF for the
grant application.

---

## When to use this recipe

Reach for this pipeline when **all of these** are true:

- You (or the person you're helping) have an existing CV in `.pages`,
  `.docx`, or `.pdf` — content is already written.
- The current file's formatting is mangled (Pages→Word conversion
  artifacts, inconsistent tab stops, OCR-like typos) or needs a
  typographic overhaul.
- You want a **grant-ready** artist exhibition CV — year gutter,
  italic titles, classic serif typography.
- The content is stable enough that hard-coding it in a Python script
  is acceptable. This is not a CV CMS; it's a one-off build script
  per person.

Don't use it when:

- You only need light cleanup — use Pages/Word directly.
- The CV is already well-formatted and you just need a PDF — export
  from Pages/Word.
- You need dynamic/parameterized CVs for many people.

---

## Why a script, not a Word document?

Same reasoning as the LACMA builder:

1. **Diffable.** Revisions are text-file diffs.
2. **Reproducible.** One source of truth; the `.docx` is an artifact.
3. **Consistent styling.** Fonts, margins, tab stops defined once.
4. **Parallel drafts.** v2 can coexist with v1 without destroying work.

Trade-off: editing content takes one extra step (edit script → re-run)
versus clicking in Word. For a grant CV — where precision and
versioning matter — this is worth it.

---

## Pipeline overview

```
source CV (.pages / .docx / .pdf)
          │
          │  1. Export to .docx (or read directly if already .docx)
          ▼
source content (transcribed by hand into Python data structures)
          │
          │  2. scripts/build_<person>_cv_docx.py applies style helpers
          ▼
output/<Person>_CV_formatted.docx
          │
          │  3. Open in Word → spot-check → export to PDF
          ▼
final.pdf → upload to grant portal
```

Steps 1 and 3 are manual; step 2 is the script this doc describes.

---

## File layout (repo-local pattern)

```
scripts/
└── build_cv_docx.py                        # The build script

Supporting Text/
├── Kauppila_CV.pages                       # Original source
├── Kauppila_CV.docx                        # Exported from Pages
└── output/
    └── Kauppila_CV_formatted.docx          # Generated artifact

docs/superpowers/
├── specs/2026-04-22-cv-formatter-design.md # Spec (typography, rules)
└── plans/2026-04-22-cv-formatter.md        # Implementation plan

CV_DOCX_BUILD_NOTES.md                      # This file
LACMA_DOCX_BUILD_NOTES.md                   # Sibling pipeline for prose
```

The spec and plan live in `docs/superpowers/` because this work was
produced via the Superpowers brainstorm → spec → plan → implement
flow. If building from scratch without Superpowers, keep the spec
doc — it's where typography decisions are recorded.

---

## Typography — classic gallery CV

These choices encode "established artist, panel-reading-friendly,
ages well." Change them if you want a different feel, but change them
**once** in the style helpers and they apply uniformly.

| Element                    | Choice                                        |
|----------------------------|-----------------------------------------------|
| Page                       | US Letter, 1" margins                         |
| Body font                  | Garamond, 11 pt                               |
| Body leading / space after | Single spacing, 3 pt space-after              |
| Name (contact header)      | `JESSE KAUPPILA` uppercase, 22 pt bold, centered |
| Contact line               | 10 pt italic, centered, 18 pt space-after     |
| Section headings           | Uppercase, 12 pt bold, thin gray rule beneath |
| Year gutter                | Left tab stop at 0.65"                        |
| Entry title                | Italic (for works); not italic (for institutions / award names) |
| Continuation lines         | Left indent 0.65" (hangs under title)         |
| Inter-entry spacing        | 6 pt empty paragraph between entries          |

**Small caps note:** python-docx does not expose a native small-caps
property on runs, so the classic "name in small caps" effect is
approximated by `.upper()`-ing the string and making it bold. If you
want real small caps (OpenType `smcp` feature), you'd need to edit the
run's XML directly (`w:smallCaps val="1"`). Uppercase + bold renders
acceptably for a grant CV.

**Horizontal rule under headings:** python-docx also doesn't have a
high-level API for paragraph borders. Apply via direct XML:

```python
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

def _add_horizontal_rule(paragraph):
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")       # 0.5 pt (sz is in eighths)
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "555555")
    p_bdr.append(bottom)
    p_pr.append(p_bdr)
```

---

## Anatomy of the build script

```
imports + OUTPUT path
────────────────────────────────────────
Style constants
  BASE_FONT    (e.g. "Garamond")
  BODY_SIZE    (Pt(11))
  YEAR_TAB     (Inches(0.65))
────────────────────────────────────────
Style helpers (all operate on a Document)
  configure_document()       — margins, base font, Normal style
  _add_horizontal_rule()     — paragraph bottom border
  add_contact_header()       — name + contact line block at top
  add_section_heading()      — uppercase bold heading + rule
  _set_year_tab()             — attach tab stop at YEAR_TAB
  add_entry()                — year-gutter entry w/ italic title + continuation lines
  add_plain_entry()          — no-year multi-line entry (press, publications)
────────────────────────────────────────
Content constants
  EDUCATION       : list[(title, extras)]
  AWARDS          : list[(year, title, extras)]
  SOLO_SHOWS      : list[(year, title, extras)]
  GROUP_SHOWS     : list[(year, title, extras)]
  PRESS           : list[list[str]]
  PUBLICATIONS    : list[list[str]]
────────────────────────────────────────
build_document()             — assembles sections in order
main()                       — saves to OUTPUT
```

---

## Data shapes

Everything is hard-coded as module-level constants. No parsing. No
external config. If the CV changes, edit the constants.

### Shape A — year + title + continuation lines

For awards, solo shows, group shows. Used with `add_entry()`.

```python
(year, title, extras)  # 3-tuple
```

- `year: str` — e.g. `"2015"`. Pass `""` (empty string) for follow-up
  entries that stack under the same year — the gutter renders blank
  but alignment is preserved. This is the classic CV convention.
- `title: str` — the work / award / institution name. Quoted with
  curly quotes (U+201C / U+201D) for work titles; bare text for award
  names and institutions.
- `extras: list[str]` — one string per continuation line. Typically
  venue, curator, city. Each becomes its own paragraph indented to
  `YEAR_TAB`.

Example entry:

```python
("2015", "“Games”",
 ["Hyptique Pop-Up with Hannah Epstein", "Pittsburgh, PA"])
```

### Shape B — title + continuation (no year gutter)

For Education (institution name, then location). Used with
`add_entry(year="", italic_title=False, ...)`.

```python
(title, extras)  # 2-tuple
```

### Shape C — free-form multi-line block

For Reviews/Press and Publications. Used with `add_plain_entry()`.

```python
list[str]  # first line gets no indent; rest are indented to YEAR_TAB
```

Example press entry:

```python
["“Berkeley Central Arts Passage Unveils Its First Show.”  Alex Bigman",
 "The East Bay Express, January 2013"]
```

---

## Content handling rules — reformat, don't rewrite

Critical boundary for grant work: **the applicant owns the content.**
Formatting changes are fine; content changes need explicit approval.

Safe (do without asking):

- Preserve every year, title, venue, curator, and city verbatim.
- Normalize straight quotes to curly (`"` → `"`/`"`, `'` → `'`).
- Em-dash `--` → `—` (U+2014); en-dash for ranges `2009-2012` → `2009–2012`.
- Coalesce mid-sentence line breaks introduced by Pages→Word conversion
  so each entry reads as one logical unit.
- Fix obvious OCR-style typos (`Comissions` → `Commissions`,
  `Miller Galler` → `Miller Gallery`, missing closing parens). **Annotate each
  correction with a comment directly above the data tuple**, so the
  applicant can see what was changed.

Needs explicit approval:

- Re-ordering entries.
- Removing duplicates (sometimes intentional; the source CV in this
  project lists the Frank-Ratchye 2013 microgrant twice — preserved).
- Updating stale dates (e.g. "MFA expected 2016" in a 2026 CV). These
  are content calls for the applicant to make in Word before PDF
  export.
- Adding missing entries.
- Rewording any title, venue, or description.

Always default to conservative. "Don't edit content" is a strong
signal; err toward preserving the source.

---

## Reusable helper module

Copy the following into `scripts/build_<person>_cv_docx.py` as a
starting point. Below it, define the content constants for the
specific artist.

```python
"""Build a formatted artist-exhibition CV as a .docx."""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Pt, Inches


# Edit these to rename the output file.
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "Supporting Text" / "output" / "Artist_CV_formatted.docx"

BASE_FONT = "Garamond"
BODY_SIZE = Pt(11)
YEAR_TAB = Inches(0.65)


def configure_document(doc: Document) -> None:
    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)
    normal = doc.styles["Normal"]
    normal.font.name = BASE_FONT
    normal.font.size = BODY_SIZE
    normal.paragraph_format.space_after = Pt(3)


def _add_horizontal_rule(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "555555")
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def add_contact_header(doc: Document, name: str, contact_line: str) -> None:
    name_p = doc.add_paragraph()
    name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    name_p.paragraph_format.space_before = Pt(0)
    name_p.paragraph_format.space_after = Pt(2)
    name_run = name_p.add_run(name.upper())
    name_run.font.name = BASE_FONT
    name_run.font.size = Pt(22)
    name_run.font.bold = True

    contact_p = doc.add_paragraph()
    contact_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    contact_p.paragraph_format.space_after = Pt(18)
    contact_run = contact_p.add_run(contact_line)
    contact_run.font.name = BASE_FONT
    contact_run.font.size = Pt(10)
    contact_run.font.italic = True


def add_section_heading(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text.upper())
    run.font.name = BASE_FONT
    run.font.size = Pt(12)
    run.font.bold = True
    _add_horizontal_rule(p)


def _set_year_tab(paragraph) -> None:
    paragraph.paragraph_format.tab_stops.add_tab_stop(
        YEAR_TAB, alignment=WD_TAB_ALIGNMENT.LEFT
    )
    paragraph.paragraph_format.left_indent = Inches(0)


def add_entry(
    doc: Document,
    year: str,
    title: str,
    extra_lines: list[str] | None = None,
    *,
    italic_title: bool = True,
) -> None:
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_after = Pt(0)
    _set_year_tab(title_p)
    if year:
        year_run = title_p.add_run(f"{year}\t")
        year_run.font.name = BASE_FONT
        year_run.font.size = BODY_SIZE
    else:
        title_p.add_run("\t")
    title_run = title_p.add_run(title)
    title_run.font.name = BASE_FONT
    title_run.font.size = BODY_SIZE
    title_run.font.italic = bool(italic_title)

    for line in extra_lines or []:
        cont = doc.add_paragraph()
        cont.paragraph_format.left_indent = YEAR_TAB
        cont.paragraph_format.space_after = Pt(0)
        cont_run = cont.add_run(line)
        cont_run.font.name = BASE_FONT
        cont_run.font.size = BODY_SIZE

    # Pt(6) empty paragraph acts as a small inter-entry spacer.
    trailer = doc.add_paragraph()
    trailer.paragraph_format.space_after = Pt(0)
    trailer.paragraph_format.space_before = Pt(0)
    trailer.add_run("").font.size = Pt(6)


def add_plain_entry(doc: Document, lines: list[str]) -> None:
    if not lines:
        return
    head = doc.add_paragraph()
    head.paragraph_format.space_after = Pt(0)
    head_run = head.add_run(lines[0])
    head_run.font.name = BASE_FONT
    head_run.font.size = BODY_SIZE
    for line in lines[1:]:
        cont = doc.add_paragraph()
        cont.paragraph_format.left_indent = YEAR_TAB
        cont.paragraph_format.space_after = Pt(0)
        cont_run = cont.add_run(line)
        cont_run.font.name = BASE_FONT
        cont_run.font.size = BODY_SIZE
    # Pt(6) empty paragraph acts as a small inter-entry spacer.
    trailer = doc.add_paragraph()
    trailer.paragraph_format.space_after = Pt(0)
    trailer.paragraph_format.space_before = Pt(0)
    trailer.add_run("").font.size = Pt(6)
```

---

## Standard section order

Classic artist-CV sequence (feel free to reorder based on the
applicant's strengths — a heavy-press artist may want Reviews earlier):

1. Contact header (name + links)
2. Education
3. Commissions / Fellowships / Awards / Residencies
4. Solo | Two-Person Shows
5. Group Exhibitions
6. Reviews and Press
7. Publications

Other sections you may need: Teaching, Public Collections, Lectures,
Curatorial Projects. Add them with `add_section_heading()` + an
appropriate loop; they all fit one of Shapes A/B/C above.

---

## Verification pattern (lightweight TDD)

No pytest harness. Each section gets an inline assertion check after
the script runs, using `docx.Document` to read the output back:

```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Artist_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)

# Contact header
assert "ARTIST NAME" in text
assert "artistname.com" in text

# Headings in order
headings = ["EDUCATION", "SOLO | TWO-PERSON SHOWS", "GROUP EXHIBITIONS"]
pos = -1
for h in headings:
    new = text.find(h)
    assert new != -1, f"missing heading: {h}"
    assert new > pos, f"heading out of order: {h}"
    pos = new

# Typo fixes applied
assert "Comissions" not in text

# No straight quotes (all normalized to curly)
assert '"' not in text, "straight quotes still present"

# Specific content markers
for marker in ["Carnegie Mellon", "MassMOCA"]:
    assert marker in text, f"missing content marker: {marker}"

print("OK")
EOF
```

Run this after every edit. It's fast and catches the most common
failure modes.

---

## Common pitfalls

### Python 3.9 and union type syntax

Type hints like `list[str] | None` are Python 3.10+. macOS system
Python is often 3.9. Either:

- Add `from __future__ import annotations` as the **first line** of
  the module (lazy-evaluates annotations — safest), or
- Use `Optional[list[str]]` from `typing`.

### Curly quotes as string delimiters

When assembling a data block with many curly-quoted titles, it's easy
to accidentally let a curly character become the Python string
delimiter. Result: `SyntaxError: unterminated string literal`.

**Rule:** always use ASCII `"` or `'` as the outer Python delimiter;
put curly characters (`"`, `"`, `'`) inside the string as content.

```python
# Correct:
("“Games”", ["..."])          # ASCII "..." delimiters, curly inside
# Wrong — will not parse:
(“Games”, [...])              # curly " as delimiter
```

If editing via an agent tool and you hit this, re-check that all
outer string delimiters in your data block are plain ASCII quotes.

### Trailing whitespace in multi-line string literals

Python auto-concatenates adjacent string literals. Make sure each line
ends with a trailing space or the next line starts with one, or words
will run together:

```python
"this line"       # BAD
"and this"        # → "this lineand this"

"this line "      # GOOD (trailing space)
"and this"        # → "this line and this"
```

### Ambiguous dashes

"2009-2012" with a hyphen is valid but ugly. Use an en-dash: `2009–2012`
(U+2013). For mid-sentence breaks, use an em-dash: `—` (U+2014), not
`--`.

### Font fallbacks

Garamond is widely available on macOS and modern Windows. If you're
targeting a different environment, verify the font or switch to
EB Garamond (free, bundleable) or Baskerville (also widely available).
Change `BASE_FONT` once; everything updates.

---

## Version strategy

Each major revision = its own script + its own output filename.
Nothing is destroyed.

| Script                   | Output                              | Purpose          |
|--------------------------|-------------------------------------|------------------|
| `build_cv_docx.py`       | `Artist_CV_formatted.docx`          | v1 clean draft   |
| `build_cv_docx_v2.py`    | `Artist_CV_formatted_v2.docx`       | After edits / restyle |

To fork a new version: `cp build_cv_docx.py build_cv_docx_v2.py`,
update the `OUTPUT` constant, edit, run.

---

## Converting to PDF

The script produces `.docx`. Grant portals usually want `.pdf`.

Preferred: **open in Word / Pages / Google Docs → File → Export → PDF.**
Manual export gives you one last visual spot-check and preserves
embedded fonts.

Automated (if you do many of these):

```bash
# macOS with LibreOffice installed
soffice --headless --convert-to pdf \
  "Supporting Text/output/Artist_CV_formatted.docx" \
  --outdir "Supporting Text/output/"
```

Trade-off: automated conversion can shift line breaks or font
rendering subtly. For a submission, manual export from Word is the
safer default.

---

## Repurposing this as a Superpowers skill

If packaging this as a reusable skill (e.g. for a grant-writing
toolkit):

- **Skill name:** something like `formatting-artist-cv` or
  `gallery-cv-builder`.
- **Trigger description:** "Use when reformatting an artist's existing
  CV into a classic gallery-style `.docx` for grant applications —
  especially when the source file has Pages→Word conversion artifacts
  or inconsistent styling."
- **Checklist the skill should walk through:**
  1. Confirm the source file is accessible as `.docx` (or ask user to
     export from Pages).
  2. Confirm with the user: style direction (classic / contemporary /
     hybrid), contact header content, and whether to fix obvious typos.
  3. Transcribe source content into Python data structures (Shapes A/B/C).
  4. Apply style helpers (from this doc's "Reusable helper module").
  5. Run verification assertions.
  6. Manual spot-check in Word + PDF export.
- **Non-obvious content rules:** the "reformat don't rewrite"
  boundary. Write it into the skill's instructions so future agents
  don't drift into content edits.
- **Required helper module:** ship the code from the "Reusable helper
  module" section as a skill asset so the agent doesn't have to
  re-derive the horizontal-rule XML or small-caps approximation.

Companion skill worth building alongside: a grant-prose formatter for
the LACMA-style prose pipeline (see `LACMA_DOCX_BUILD_NOTES.md`).
Together they cover the two dominant shapes of artist grant material:
structured CV + narrative prose with word caps.
