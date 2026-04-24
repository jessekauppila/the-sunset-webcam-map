# CV Formatter — Design

Reformat `Supporting Text/Kauppila_CV.docx` into a clean, classic artist
exhibition CV, delivered as an editable `.docx` that Jesse converts to
PDF by hand for grant submissions.

Modeled on the `build_lacma_docx_v2.py` pipeline: the script is the
source of truth, the generated `.docx` is an artifact.

---

## Goal

Produce `Supporting Text/output/Kauppila_CV_formatted.docx` — a
well-typeset artist exhibition CV preserving the existing content verbatim,
with formatting issues fixed and obvious typos corrected.

## Non-goals

- Content edits (no new entries, no rewording, no removed entries,
  no reordering).
- PDF generation (Jesse exports to PDF manually from Word).
- Supporting the LACMA pipeline. This is a separate, parallel script.
- Parameterizing the CV content for other artists. This is Jesse's CV,
  hard-coded in the script like the LACMA builder.

## Inputs

- `Supporting Text/Kauppila_CV.docx` — source content (converted from
  `.pages`). Has ragged line breaks and inconsistent heading styles
  from the Pages→Word conversion. Treated as a content reference, not
  programmatically parsed; content is transcribed by hand into
  structured Python data in the build script.

## Outputs

- `scripts/build_cv_docx.py` — the build script.
- `Supporting Text/output/Kauppila_CV_formatted.docx` — generated
  artifact.

## Design direction

Classic gallery CV. Serif typography, year in left gutter, entry title
italicized, venue/city on subsequent lines. Dense but readable. Ages
well.

## Typography and layout

- **Page:** US Letter, 1" margins all sides.
- **Body font:** Garamond, 11 pt, single line spacing, 3 pt space-after
  on body paragraphs, 0 pt on continuation lines within an entry.
- **Contact header (top of document):**
  - Name `JESSE KAUPPILA` — Garamond small caps, 22 pt, bold,
    centered, no space-before, 2 pt space-after.
  - Contact line `jessekauppila.art  ·  github.com/jessekauppila` —
    Garamond italic, 10 pt, centered, 18 pt space-after.
- **Section headings** (e.g. Education, Solo | Two-Person Shows):
  - Garamond small caps, 12 pt, bold.
  - Thin horizontal rule (0.5 pt, dark gray #555) directly beneath the
    heading text.
  - 14 pt space-before, 6 pt space-after.
- **Entries:**
  - Single left tab stop at 0.65".
  - Year in the gutter (first tab column), e.g. `2015\t`.
  - Title in italics on the same line after the tab.
  - Continuation lines (venue, curator, city) on subsequent paragraphs
    with a 0.65" left indent (hanging-indent effect) — no year, body
    weight, not italic.
  - 6 pt space-after between entries, 0 pt between the title line and
    its continuation lines.

## Content handling rules

Preserved verbatim:

- All years.
- All exhibition/work titles (quote marks preserved).
- All venues, curators, and cities.
- Section groupings and the order of entries within each section.

Normalized:

- Straight quotes → curly quotes (`"` → `"`/`"`, `'` → `'`).
- Double hyphens → em-dashes where appropriate.
- Stray whitespace and mid-sentence line breaks produced by the
  Pages→Word conversion are coalesced so each entry reads as one
  logical unit.

Fixed (approved typo corrections):

- `Comissions` → `Commissions` (section heading).
- `Miller Galler` → `Miller Gallery`.
- `ProSEED/Crosswalk Grant (2015` → `ProSEED/Crosswalk Grant (2015)`
  (missing closing paren).
- Any other obvious OCR-style errors (missing trailing punctuation,
  doubled spaces, broken parentheses). Each correction noted in a
  comment above the data entry that contains it.

Not changed:

- The listed MFA expected graduation year `2016` is preserved as
  written, even though it predates today's date. Content-authoritative
  corrections (updating dates, adding missing shows, reordering) are
  Jesse's call in Word after the script runs.

## Sections (in order)

From the source document, in this order:

1. Contact header (Jesse Kauppila + contact line)
2. Education
3. Commissions | Fellowships | Awards | Residencies
4. Solo | Two-Person Shows
5. Group Exhibitions
6. Reviews and Press
7. Publications

## Build script anatomy

Mirrors `build_lacma_docx_v2.py` to keep the two scripts visually and
structurally consistent:

```
imports + OUTPUT path
────────────────────────────────────────
Style helpers
  configure_document()    — margins, base font, default paragraph style
  add_section_heading()   — small-caps heading + horizontal rule
  add_contact_header()    — name + contact line block at top
  add_entry()             — year-gutter entry with italic title and
                            continuation lines
  add_plain_entry()       — no-title variant for press/publications:
                            year + flat list of lines in the indent column
────────────────────────────────────────
Content
  EDUCATION            : list[tuple[str, list[str]]]
  AWARDS               : list[tuple[str, list[str]]]
  SOLO_SHOWS           : list[tuple[str, str, list[str]]]
  GROUP_SHOWS          : list[tuple[str, str, list[str]]]
  PRESS                : list[tuple[str, list[str]]]
  PUBLICATIONS         : list[tuple[str, list[str]]]
────────────────────────────────────────
build_document()          — assembles the sections in order
main()                    — saves to OUTPUT
```

Data shape for entries with a year + title:

```python
(
    "2015",
    "Games",
    [
        "Hyptique Pop-Up with Hannah Epstein",
        "Pittsburgh, PA",
    ],
)
```

Data shape for entries without a title (press, publications, some
awards) is a flat list of lines passed to a variant helper.

Entries within a year group share a single year string; subsequent
entries in the same year pass an empty string as the year and the
helper renders only the title + continuation lines (keeps the year
gutter visually empty but aligned, per the classic CV convention).

## Running the build

```bash
# from repo root
python3 scripts/build_cv_docx.py
```

Writes to `Supporting Text/output/Kauppila_CV_formatted.docx` directly
(unlike the LACMA script which writes to `output/` at the repo root;
the CV script skips that detour and writes to the final location).

Requirements: `python-docx` (same dep as the LACMA builder).

## Verification

After building, spot-check in Word:

- Contact header renders centered with name in small caps.
- Each section heading has its horizontal rule.
- Year gutter is visually aligned across all entries in a section.
- Italic is applied to titles only, not venues or cities.
- Page count and overall feel match a classic gallery CV.

No automated word-count or arithmetic checks are needed (unlike the
LACMA grant); the CV has no caps or totals to enforce.

## Out of scope / future

- Automated PDF export (would require LibreOffice headless or a docx→pdf
  library; user prefers manual export from Word).
- Coverage of new shows / updated dates — Jesse will add those in Word
  after the script produces the base file, OR edit the script and
  re-run. Either is fine.
- A v2 script. If styling needs to change substantially, copy to
  `build_cv_docx_v2.py` in the same pattern as the LACMA builder.
