# CV Formatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a well-typeset `.docx` of Jesse Kauppila's artist
exhibition CV via a reproducible Python build script, modeled on the
existing `build_lacma_docx_v2.py` pipeline.

**Architecture:** One self-contained script
(`scripts/build_cv_docx.py`) that hard-codes the CV content as Python
data structures, applies a classic gallery-CV style baseline (Garamond
11 pt, small-caps headings, year gutter, italic titles), and writes a
single `.docx` artifact. No tests directory or pytest harness — each
section of the CV has an inline Python assertion check after it renders,
mirroring the LACMA pipeline's verification style.

**Tech Stack:** Python 3, `python-docx` (already installed via the
LACMA builder). No git commits in this plan (user requested).

**Spec:** `docs/superpowers/specs/2026-04-22-cv-formatter-design.md`

---

## File structure

- **Create:** `scripts/build_cv_docx.py` — the build script.
- **Output (not committed):** `Supporting Text/output/Kauppila_CV_formatted.docx`.
- **No new test files.** Verification is inline Python one-liners after
  each build, using `docx.Document` to read back the output and assert
  that expected text is present. This matches the LACMA verification
  convention and avoids standing up a pytest harness for a one-off
  utility.

All commands assume the current working directory is the repository
root: `/Users/jessekauppila/Documents/GitHub/the-sunset-webcam-map`.

---

## Task 1: Scaffold script and style helpers

**Files:**
- Create: `scripts/build_cv_docx.py`

This task produces a runnable script that writes an empty-but-valid
`.docx` to the output path. All the style helpers are defined here so
the content tasks that follow are pure data entry.

- [ ] **Step 1: Write the failing check**

Before creating the script, confirm the output file does not yet exist.

Run:
```bash
test ! -e "Supporting Text/output/Kauppila_CV_formatted.docx" && echo ABSENT || echo EXISTS
```
Expected: `ABSENT`

- [ ] **Step 2: Create the script with helpers and a no-op `build_document()`**

Create `scripts/build_cv_docx.py` with this exact content:

```python
"""Build a formatted artist-exhibition CV as a .docx.

Modeled on scripts/build_lacma_docx_v2.py. Run:

    python3 scripts/build_cv_docx.py

Writes to Supporting Text/output/Kauppila_CV_formatted.docx.
"""

from pathlib import Path

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Pt, Inches, RGBColor


REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = REPO_ROOT / "Supporting Text" / "output" / "Kauppila_CV_formatted.docx"

BASE_FONT = "Garamond"
BODY_SIZE = Pt(11)
YEAR_TAB = Inches(0.65)


def configure_document(doc: Document) -> None:
    """Set page margins and the default paragraph style."""
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
    """Attach a bottom border to the paragraph — a thin gray rule."""
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")  # 0.5 pt
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "555555")
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def add_contact_header(doc: Document) -> None:
    """Render the name and contact line at the top of the document."""
    name_p = doc.add_paragraph()
    name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    name_p.paragraph_format.space_before = Pt(0)
    name_p.paragraph_format.space_after = Pt(2)
    name_run = name_p.add_run("JESSE KAUPPILA")
    name_run.font.name = BASE_FONT
    name_run.font.size = Pt(22)
    name_run.font.bold = True

    contact_p = doc.add_paragraph()
    contact_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    contact_p.paragraph_format.space_after = Pt(18)
    contact_run = contact_p.add_run(
        "jessekauppila.art  ·  github.com/jessekauppila"
    )
    contact_run.font.name = BASE_FONT
    contact_run.font.size = Pt(10)
    contact_run.italic = True


def add_section_heading(doc: Document, text: str) -> None:
    """Small-caps heading with a thin gray rule beneath."""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    run = p.add_run(text.upper())
    run.font.name = BASE_FONT
    run.font.size = Pt(12)
    run.font.bold = True
    _add_horizontal_rule(p)


def _set_year_tab(paragraph) -> None:
    """Attach a single left tab stop at YEAR_TAB."""
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
    """Render one entry with year in the gutter and an italic title.

    If `year` is empty, the gutter is left blank but alignment is preserved
    (classic CV convention for stacking multiple entries under one year).

    `extra_lines` become continuation paragraphs with a hanging indent at
    YEAR_TAB.
    """
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
    title_run.italic = bool(italic_title)

    for line in extra_lines or []:
        cont = doc.add_paragraph()
        cont.paragraph_format.left_indent = YEAR_TAB
        cont.paragraph_format.space_after = Pt(0)
        cont_run = cont.add_run(line)
        cont_run.font.name = BASE_FONT
        cont_run.font.size = BODY_SIZE

    trailer = doc.add_paragraph()
    trailer.paragraph_format.space_after = Pt(0)
    trailer.paragraph_format.space_before = Pt(0)
    trailer_run = trailer.add_run("")
    trailer_run.font.size = Pt(6)


def add_plain_entry(doc: Document, lines: list[str]) -> None:
    """Multi-line entry with no title and no year (press / publications).

    First line gets no indent; subsequent lines are indented to YEAR_TAB
    so the block reads as a unit.
    """
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

    trailer = doc.add_paragraph()
    trailer.paragraph_format.space_after = Pt(0)
    trailer.paragraph_format.space_before = Pt(0)
    trailer_run = trailer.add_run("")
    trailer_run.font.size = Pt(6)


def build_document() -> Document:
    doc = Document()
    configure_document(doc)
    add_contact_header(doc)
    # Sections will be added in later tasks.
    return doc


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = build_document()
    doc.save(OUTPUT)
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the script and verify it writes a file**

Run:
```bash
python3 scripts/build_cv_docx.py
```
Expected output:
```
Wrote /Users/jessekauppila/Documents/GitHub/the-sunset-webcam-map/Supporting Text/output/Kauppila_CV_formatted.docx
```

- [ ] **Step 4: Assert the contact header is in the output**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
assert "JESSE KAUPPILA" in text, "name missing"
assert "jessekauppila.art" in text, "website missing"
assert "github.com/jessekauppila" in text, "github missing"
print("OK: contact header present")
EOF
```
Expected: `OK: contact header present`

---

## Task 2: Education section

**Files:**
- Modify: `scripts/build_cv_docx.py` (add `EDUCATION` data, wire into `build_document()`)

Source rows 000-008 of the input `.docx`. Preserved verbatim; city/state
preserved as the venue line.

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
try:
    assert "EDUCATION" in text
    assert "Carnegie Mellon University" in text
    assert "Reed College" in text
    assert "Hampshire College" in text
    assert "Il Bisonte" in text
    assert "St. Coleman" in text
    print("UNEXPECTED PASS")
except AssertionError as e:
    print("EXPECTED FAIL")
EOF
```
Expected: `EXPECTED FAIL`

- [ ] **Step 2: Add EDUCATION data and render call**

Insert immediately above `def build_document()`:

```python
EDUCATION: list[tuple[str, list[str]]] = [
    ("Carnegie Mellon University (MFA, expected 2016)", ["Pittsburgh, PA"]),
    ("Reed College (BA)", ["Portland, OR"]),
    ("Hampshire College", ["Amherst, MA"]),
    ("Il Bisonte: Foundation for the Study of Printmaking",
     ["Florence, Italy"]),
    ("St. Johnsbury Academy", ["St. Johnsbury, VT"]),
    ("St. Coleman’s College", ["Co. Cork, Ireland"]),
]
```

Replace the comment `# Sections will be added in later tasks.` in
`build_document()` with:

```python
    add_section_heading(doc, "Education")
    for title, extras in EDUCATION:
        add_entry(doc, year="", title=title, extra_lines=extras,
                  italic_title=False)
```

Note: education entries get `italic_title=False` — the institution name
is not a work title and should not be italicized.

- [ ] **Step 3: Rebuild and verify**

Run:
```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
assert "EDUCATION" in text
assert "Carnegie Mellon University" in text
assert "Reed College" in text
assert "Hampshire College" in text
assert "Il Bisonte" in text
assert "St. Coleman" in text
print("OK: education section present")
EOF
```
Expected: `OK: education section present`

---

## Task 3: Commissions | Fellowships | Awards | Residencies

**Files:**
- Modify: `scripts/build_cv_docx.py` (add `AWARDS` data, wire in)

Source rows 009-042. Preserves the order of the source document even
where years appear non-chronological. Two typo fixes applied here, each
annotated with a comment in the data.

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
try:
    assert "COMMISSIONS | FELLOWSHIPS | AWARDS | RESIDENCIES" in text
    assert "Comissions" not in text, "unfixed typo"
    assert "Fallow Grounds for Sculpture" in text
    assert "ProSEED/Crosswalk Grant (2015)" in text, "missing closing paren"
    assert "Kala Art Institute" in text
    assert "Andy Warhol Foundation" in text
    print("UNEXPECTED PASS")
except AssertionError:
    print("EXPECTED FAIL")
EOF
```
Expected: `EXPECTED FAIL`

- [ ] **Step 2: Add AWARDS data and render call**

Insert after the `EDUCATION` block:

```python
# Tuples are (year, title, extra_lines). Years repeat in source order;
# where source lists two entries under one year, we pass an empty year
# on the follow-up entry so the gutter shows blank but alignment stays.
AWARDS: list[tuple[str, str, list[str]]] = [
    ("2015", "Public Art Commission: Fallow Grounds for Sculpture (2015)",
     ["Neu Kirche Contemporary Art Center"]),
    ("", "Neighbor to Neighbor Grant (2015)", ["Sprout Fund"]),
    ("", "Corrigan “Wrong Way” Travel Grant (2015)",
     ["Carnegie Mellon Department of Fine Art"]),
    # Typo fix: source missing closing paren on "(2015".
    ("", "ProSEED/Crosswalk Grant (2015)",
     ["Carnegie Mellon Fellowships and Awards"]),
    ("", "Graduate Student Research Grant (2015)",
     ["Carnegie Mellon Graduate Student Assembly"]),
    ("2014", "Tough Art Residency (2014)",
     ["The Children’s Museum of Pittsburgh"]),
    ("", "Fellowship (2014)", ["Mildred’s Lane"]),
    ("2013", "Frank-Ratchye Fund for Art @ the Frontier Microgrant (2013)",
     ["Carnegie Mellon University"]),
    ("", "Graduate Student Research Grant (2013)",
     ["Carnegie Mellon Graduate Student Assembly"]),
    ("", "Graduate Student Travel Grant (2013)",
     ["Carnegie Mellon Graduate Student Assembly"]),
    ("", "Artist in Residence (2013)", ["Rayko Photo Center"]),
    # Source lists this Frank-Ratchye microgrant twice (rows 023 and
    # 029). User asked us not to edit content, so it stays duplicated.
    ("", "Frank-Ratchye Fund for Art @ the Frontier Microgrant (2013)",
     ["Carnegie Mellon University"]),
    ("2012", "Artist in Residence (2009–2012)", ["Kala Art Institute"]),
    ("", "Alternative Exposure Grant for “Art for a Democratic "
     "Society” (2012)",
     ["The Andy Warhol Foundation, Southern Exposure"]),
    ("2007", "Undergraduate Research Grant (2007)", ["Reed College"]),
]
```

Append to `build_document()` (after the Education loop):

```python
    # Typo fix: "Comissions" -> "Commissions" in section heading.
    add_section_heading(
        doc, "Commissions | Fellowships | Awards | Residencies"
    )
    for year, title, extras in AWARDS:
        add_entry(doc, year=year, title=title, extra_lines=extras,
                  italic_title=False)
```

Note: awards are not italicized — only work titles get italics. The
grant/residency names are institutional titles.

- [ ] **Step 3: Rebuild and verify**

Run:
```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
assert "COMMISSIONS | FELLOWSHIPS | AWARDS | RESIDENCIES" in text
assert "Comissions" not in text
assert "Fallow Grounds for Sculpture" in text
assert "ProSEED/Crosswalk Grant (2015)" in text
assert "Kala Art Institute" in text
assert "Andy Warhol Foundation" in text
print("OK: awards section present, typos fixed")
EOF
```
Expected: `OK: awards section present, typos fixed`

---

## Task 4: Solo | Two-Person Shows

**Files:**
- Modify: `scripts/build_cv_docx.py` (add `SOLO_SHOWS` data, wire in)

Source rows 044-068. One typo fix: "Miller Galler" → "Miller Gallery".

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
try:
    assert "SOLO | TWO-PERSON SHOWS" in text
    assert "Miller Galler " not in text, "unfixed 'Galler' typo"
    assert "Games" in text
    assert "Inside Out Printer" in text
    assert "Remastering the Anthology" in text
    print("UNEXPECTED PASS")
except AssertionError:
    print("EXPECTED FAIL")
EOF
```
Expected: `EXPECTED FAIL`

- [ ] **Step 2: Add SOLO_SHOWS data and render call**

Insert after `AWARDS`:

```python
# (year, title, extra_lines). Titles quoted with curly double quotes.
SOLO_SHOWS: list[tuple[str, str, list[str]]] = [
    ("2015", "“Games”",
     ["Hyptique Pop-Up with Hannah Epstein",
      "Pittsburgh, PA"]),
    ("", "“Webs and Reticulations: Structuring Metaphors and "
     "Materials”",
     ["Posner Center, Carnegie Mellon University",
      "Curatorial project with Mary Kay Johnsen",
      "Pittsburgh, PA"]),
    ("2014", "“Screens”",
     ["Red Door Gallery, Carnegie Mellon University",
      "Pittsburgh, PA"]),
    ("2013", "“Inside Out Printer, Improvised Explosive Device "
     "(I.O.P. I.E.D.)”",
     ["Rayko Photo Center, curated by Ann Jastrab",
      "San Francisco, CA"]),
    ("2010", "“Remastering the Anthology of American Folk Music”",
     ["PLAySPACE, California College of the Arts, "
      "curated by Amanda Hunt",
      "San Francisco, CA"]),
]
```

Append to `build_document()`:

```python
    add_section_heading(doc, "Solo | Two-Person Shows")
    for year, title, extras in SOLO_SHOWS:
        add_entry(doc, year=year, title=title, extra_lines=extras,
                  italic_title=True)
```

- [ ] **Step 3: Rebuild and verify**

Run:
```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
assert "SOLO | TWO-PERSON SHOWS" in text
assert "Miller Galler " not in text
assert "Games" in text
assert "Inside Out Printer" in text
assert "Remastering the Anthology" in text
print("OK: solo shows present")
EOF
```
Expected: `OK: solo shows present`

---

## Task 5: Group Exhibitions

**Files:**
- Modify: `scripts/build_cv_docx.py` (add `GROUP_SHOWS` data, wire in)

Source rows 069-170. This is the largest section. One typo fix:
"Miller Galler" → "Miller Gallery" (inside a 2016 entry). The source
entries are heavily fragmented by mid-sentence line breaks — coalesced
here per the spec's content-handling rules.

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
try:
    assert "GROUP EXHIBITIONS" in text
    assert "Blanchard Mountain Rendezvous" in text
    assert "Mind Control" in text
    assert "Self-Driving Car" in text
    assert "Miller Gallery" in text, "typo not fixed"
    assert "Humanufactory(ng) Workstyles" in text
    assert "MassMOCA" in text
    assert "Il Bisonte Agli Uffizi" in text
    print("UNEXPECTED PASS")
except AssertionError:
    print("EXPECTED FAIL")
EOF
```
Expected: `EXPECTED FAIL`

- [ ] **Step 2: Add GROUP_SHOWS data and render call**

Insert after `SOLO_SHOWS`:

```python
GROUP_SHOWS: list[tuple[str, str, list[str]]] = [
    ("2025", "“Blanchard Mountain Rendezvous / Canopy”",
     ["Canopy Art & Iron, Bow, WA"]),
    ("", "“Fly”", ["Terramor, Bow, WA"]),

    ("2017", "“Mind Control”",
     ["AlterSpace, San Francisco, CA"]),

    ("2016", "“Corte Madera Centennial Art Exhibition”",
     ["Corte Madera Community Center, Corte Madera, CA"]),
    # Typo fix: "Miller Galler " -> "Miller Gallery" in source.
    ("", "“Self-Driving Car”",
     ["Carnegie Mellon Miller Gallery",
      "Bolinas, CA"]),
    ("", "“Process Photography / Witchy Shit”",
     ["Gospel Flats, Bolinas, CA"]),

    ("2015", "“Performance Hour”",
     ["Neu Kirche Contemporary Art Center, Pittsburgh, PA"]),
    ("", "“The Labor Portraits of Mildred’s Lane”",
     ["The Mildred Complexity, Narrowsburg, NY"]),
    ("", "“Fallow Grounds for Sculpture”",
     ["Neu Kirche Contemporary Art Center, curated by Oreen Cohen",
      "Pittsburgh, PA"]),
    ("", "“10 Minute Play Festival”",
     ["Boom Concepts, Pittsburgh, PA"]),
    ("", "“PhAb Now!”",
     ["Pittsburgh Filmmakers, curated by Adam Welch",
      "Pittsburgh, PA"]),

    ("2014", "“Humanufactory(ng) Workstyles”",
     ["School of the Art Institute of Chicago, "
      "curated by Mary Jane Jacobs and Kate Zeller",
      "Chicago, IL"]),
    ("", "“Subterraneans”",
     ["Leeds College of Art and Design, curated by Terence Jones",
      "Leeds, United Kingdom"]),
    ("", "“Tough Art”",
     ["Children’s Museum of Pittsburgh, Pittsburgh, PA"]),
    ("", "“Encountering the Unseen: Puppet Activated Lecture on "
     "the Microbiome”",
     ["Phipps Conservatory, Pittsburgh, PA"]),
    ("", "“LunarmagmaoceanLove”",
     ["NURTUREart Gallery, curated by Jaewook Lee",
      "Brooklyn, NY"]),
    ("", "“GDP”", ["The Mine Factory, Pittsburgh, PA"]),

    ("2013", "“The Making is a Re-Making”",
     ["Kala Art Institute, curated by Mayumi Hamanaka",
      "Berkeley, CA"]),

    ("2012", "“Edicola”",
     ["Colpa Press, San Francisco, CA"]),
    ("", "“Monthly Programming”",
     ["with the collective Art for a Democratic Society",
      "Art Murmur, Oakland, CA"]),
    ("", "“In Formation”",
     ["Berkeley Central Arts, curated by Amanda Curreri",
      "Berkeley, CA"]),

    ("2011", "“Books, Prints, and Things”",
     ["Wire + Nail, San Francisco, CA"]),
    ("", "“Artist Annual”",
     ["Kala Art Institute, Berkeley, CA"]),
    ("", "“Art Science Fair”",
     ["The Lab, San Francisco, CA"]),
    ("", "“Cashing Out”",
     ["Kala Art Institute, curated by Julio Cesar Morales",
      "Berkeley, CA"]),
    ("", "“Proof”",
     ["Southern Exposure, San Francisco, CA"]),
    ("", "“Experimental Notation”",
     ["MacArthur b Arthur, Oakland, CA"]),
    ("", "“Night Market”",
     ["MassMOCA, curated by James Voorhies",
      "North Adams, MA"]),
    ("", "“Artcards Presents: Performance”",
     ["The Invisible Dog, curated by Helen Homan Wu",
      "Brooklyn, NY"]),
    ("", "“Cries of San Francisco”",
     ["Southern Exposure, curated by Allison Smith and Courtney Fink",
      "San Francisco, CA"]),
    ("", "“Moonlight, Mai Tais, and Magic”",
     ["Allegra LaViola Gallery, New York, NY"]),
    ("", "“Vermont Printmakers”",
     ["Gato Nero Gallery, St. Johnsbury, VT"]),

    ("2010", "“Fresh Work”",
     ["Kala Art Institute, Berkeley, CA"]),
    ("", "“Sights + Sounds”",
     ["Noma Gallery, San Francisco, CA"]),
    ("", "“The Wassaic Festival”",
     ["The Wassaic Project, Wassaic, NY"]),
    ("", "“New Music Series”",
     ["The Luggage Store, San Francisco, CA"]),

    ("2009", "“The Living Archive”",
     ["Swell Gallery, SFAI, San Francisco, CA"]),
    ("", "“Vermont Printmakers”",
     ["Gato Nero Gallery, St. Johnsbury, VT"]),

    ("2008", "“Annual Exhibition”",
     ["Studio for Color Etching, Barga, Italy"]),
    ("", "“Aquatint Explosions”",
     ["Alt.Space Presents, Malmo, Sweden"]),
    ("", "“Bunker: Towards a Free School in the New Dark Age”",
     ["collaboration with the alt.Space Network of Artist Research "
      "Groups",
      "Hats Plus Gallery, London, UK"]),

    ("2007", "“Annual Exhibition”",
     ["Studio for Color Etching, Barga, Italy"]),
    ("", "“Learning is Fun and Dangerous”",
     ["collaboration with Red76",
      "Reed College, Portland, OR"]),

    ("2006", "“The Second Annual”",
     ["Bonnie Kahn Gallery, Portland, OR"]),
    ("", "“Tracing the Y Chromosome”",
     ["collaboration with Gerri Ondrizek",
      "Hoffman Gallery, Oregon College of Art and Craft, Portland, OR",
      "Sheehan Gallery, Whitman College, Walla Walla, WA"]),
    ("", "“Icons”",
     ["Saffron and Turmeric, Portland, OR"]),
    ("", "“Secular Confessional”",
     ["Reed Arts Week, Portland, OR"]),

    ("2005", "“Behind the Masks: Art, Culture, and History”",
     ["Southern Illinois University Museum, Carbondale, IL"]),

    ("2003", "“Il Bisonte Agli Uffizi: Vent’anni della Scuola "
     "Internazionale di Grafica d’Arte”",
     ["Galleria degli Uffizi, Florence, Italy"]),
    ("", "“Il Fino di Anno”",
     ["La Galleria di Il Bisonte, Florence, Italy"]),
]
```

Append to `build_document()`:

```python
    add_section_heading(doc, "Group Exhibitions")
    for year, title, extras in GROUP_SHOWS:
        add_entry(doc, year=year, title=title, extra_lines=extras,
                  italic_title=True)
```

- [ ] **Step 3: Rebuild and verify**

Run:
```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
assert "GROUP EXHIBITIONS" in text
assert "Blanchard Mountain Rendezvous" in text
assert "Mind Control" in text
assert "Self-Driving Car" in text
assert "Miller Gallery" in text
assert "Humanufactory(ng) Workstyles" in text
assert "MassMOCA" in text
assert "Il Bisonte Agli Uffizi" in text
print("OK: group shows present")
EOF
```
Expected: `OK: group shows present`

---

## Task 6: Reviews and Press

**Files:**
- Modify: `scripts/build_cv_docx.py` (add `PRESS` data, wire in)

Source rows 179-196. Each press entry is an article title, then the
publication/author line. Using `add_plain_entry` since there's no year
gutter.

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
try:
    assert "REVIEWS AND PRESS" in text
    assert "Pittsburgh Post-Gazette" in text
    assert "East Bay Express" in text
    assert "San Francisco Chronicle" in text
    print("UNEXPECTED PASS")
except AssertionError:
    print("EXPECTED FAIL")
EOF
```
Expected: `EXPECTED FAIL`

- [ ] **Step 2: Add PRESS data and render call**

Insert after `GROUP_SHOWS`:

```python
# Each inner list is one press citation: article title then byline.
PRESS: list[list[str]] = [
    ["“Neu Kirche Contemporary Art Center.”  Mary Thomas",
     "Pittsburgh Post-Gazette, August 2015"],
    ["“‘PhAb Now’ at Pittsburgh Filmmakers Galleries.”  "
     "Kurt Shaw",
     "TribLive, July 1, 2015"],
    ["“Berkeley Central Arts Passage Unveils Its First Show.”  "
     "Alex Bigman",
     "The East Bay Express, January 2013"],
    ["“Jesse Boardman Kauppila: Italian Tartan.”  Emily Walsh",
     "Armfuls Blog, July 2012"],
    ["“‘Cries of San Francisco’: Marketplace as Art.”  "
     "Nirmala Nataraj",
     "The San Francisco Chronicle, July 2011"],
    ["“Artists Transform Downtown San Francisco into Conceptual "
     "Marketplace.”  Andy Wright",
     "The Bay Citizen"],
    ["“Jesse Kauppila at Little Paper Planes.”  R.L. Tilman",
     "Print Interesting"],
    ["“Jesse Boardman Kauppila Interview.”  Bora Mici",
     "Art Speak"],
]
```

Append to `build_document()`:

```python
    add_section_heading(doc, "Reviews and Press")
    for citation in PRESS:
        add_plain_entry(doc, citation)
```

- [ ] **Step 3: Rebuild and verify**

Run:
```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
assert "REVIEWS AND PRESS" in text
assert "Pittsburgh Post-Gazette" in text
assert "East Bay Express" in text
assert "San Francisco Chronicle" in text
print("OK: press section present")
EOF
```
Expected: `OK: press section present`

---

## Task 7: Publications + final verification

**Files:**
- Modify: `scripts/build_cv_docx.py` (add `PUBLICATIONS` data, wire in)

Source rows 198-213.

- [ ] **Step 1: Write the failing assertion**

Run:
```bash
python3 - <<'EOF'
from docx import Document
doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)
try:
    assert "PUBLICATIONS" in text
    assert "Pittsburgh Articulate" in text
    assert "Caterwaul Quarterly" in text
    assert "Composite Arts Magazine" in text
    print("UNEXPECTED PASS")
except AssertionError:
    print("EXPECTED FAIL")
EOF
```
Expected: `EXPECTED FAIL`

- [ ] **Step 2: Add PUBLICATIONS data and render call**

Insert after `PRESS`:

```python
PUBLICATIONS: list[list[str]] = [
    ["“Reticulations: The Evolution of the Tree Metaphor.”",
     "Pittsburgh Articulate (2015)"],
    ["“The Subterraneans.”",
     "Leeds College of Art and Design (2015)"],
    ["“Allison Smith’s Cries of San Francisco.”",
     "Southern Exposure (2013)"],
    ["“Jesse Kauppila on Remastering the Anthology of American "
     "Folk Music.”",
     "University of East Anglia, London, Conference on Harry Smith "
     "(August 2012)"],
    ["“Remastering the Anthology of American Folk Music.”",
     "Composite Arts Magazine, Issue No. 6 (January 2012)"],
    ["“Remastering, Sights + Sounds: Volume 1.”",
     "Little Paper Planes (November 2010)"],
    ["“Aquatint Explosions.”",
     "Caterwaul Quarterly (2008)"],
]
```

Append to `build_document()`:

```python
    add_section_heading(doc, "Publications")
    for citation in PUBLICATIONS:
        add_plain_entry(doc, citation)
```

- [ ] **Step 3: Rebuild and run the full verification sweep**

Run:
```bash
python3 scripts/build_cv_docx.py && python3 - <<'EOF'
from docx import Document

doc = Document("Supporting Text/output/Kauppila_CV_formatted.docx")
text = "\n".join(p.text for p in doc.paragraphs)

# Contact header
assert "JESSE KAUPPILA" in text
assert "jessekauppila.art" in text
assert "github.com/jessekauppila" in text

# All seven headings present, in order
headings = [
    "EDUCATION",
    "COMMISSIONS | FELLOWSHIPS | AWARDS | RESIDENCIES",
    "SOLO | TWO-PERSON SHOWS",
    "GROUP EXHIBITIONS",
    "REVIEWS AND PRESS",
    "PUBLICATIONS",
]
pos = -1
for h in headings:
    new = text.find(h)
    assert new != -1, f"missing heading: {h}"
    assert new > pos, f"heading out of order: {h}"
    pos = new

# Typo fixes all applied
assert "Comissions" not in text
assert "Miller Galler " not in text  # trailing space avoids matching "Gallery"
assert "(2015\n" not in text          # missing-paren source artifact
assert "Grant (2015" in text          # but the grant with the paren is in

# No straight double quotes in the body (all normalized to curly)
assert '"' not in text, "straight quotes still present"

# A handful of specific content markers across sections
markers = [
    "Carnegie Mellon University",
    "Fallow Grounds for Sculpture",
    "Games",
    "Self-Driving Car",
    "MassMOCA",
    "Pittsburgh Post-Gazette",
    "Caterwaul Quarterly",
]
for m in markers:
    assert m in text, f"missing content marker: {m}"

print("OK: full CV verification passed")
EOF
```
Expected: `OK: full CV verification passed`

- [ ] **Step 4: Visual spot-check (manual)**

Open the file in Word, Pages, or Google Docs:

```bash
open "Supporting Text/output/Kauppila_CV_formatted.docx"
```

Confirm by eye:
1. Contact header renders centered, with "JESSE KAUPPILA" in 22 pt
   small caps and the contact line in 10 pt italic beneath it.
2. Each of the six section headings has a thin gray horizontal rule
   directly beneath the text.
3. The year gutter lines up vertically across entries within a section
   (tab stop at 0.65"). Year appears once per year group; follow-up
   entries in the same year have a blank gutter.
4. Titles are italicized in Solo and Group sections; institution names
   in Education and award names in the Commissions section are NOT
   italicized.
5. Page count is reasonable (expected: ~3–4 pages).
6. No orphan title lines stuck at the bottom of a page while their
   venue wraps to the next page. If this happens, adjust the offending
   entry's continuation-line content slightly or accept it — this is
   the kind of polish done in Word before exporting PDF.

If any of the above is off, adjust the relevant style helper in
`scripts/build_cv_docx.py`, re-run the build, re-verify.

---

## Done criteria

- `scripts/build_cv_docx.py` exists and runs end-to-end without errors.
- `Supporting Text/output/Kauppila_CV_formatted.docx` exists.
- All assertions in Task 7 Step 3 pass.
- Visual spot-check in Word confirms the six typographic items above.
- No git commits have been made (per user request).
