# <Grant Name> `.docx` Build Notes

How the <Grant Name> grant application `.docx` files are generated, edited,
and formatted.

---

## TL;DR

The application `.docx` is generated from a Python script in
`art-grant-skill/scripts/build_<grant>_docx.py` using the
[`python-docx`](https://python-docx.readthedocs.io/) library. Run:

```bash
python3 art-grant-skill/scripts/build_<grant>_docx.py
```

→ writes the .docx to the OUTPUT path defined at the top of the script
(typically `Supporting Text/output/<grant>_Application.docx`).

To also produce a PDF:

```bash
python3 art-grant-skill/scripts/to_pdf.py "Supporting Text/output/<grant>_Application.docx"
```

→ writes the .pdf next to the .docx.

---

## Why a script, not a Word document?

1. **Diffable** — every revision is a text-file diff in Git.
2. **Reproducible** — script is the source of truth; `.docx` is an
   artifact.
3. **Consistent styling** — fonts, margins, headings, table formatting
   defined in one place.
4. **Word-count honesty** — count words programmatically instead of
   trusting Word's counter on styled tables and bullets.
5. **Parallel drafts** — v2 can exist alongside v1 without destroying
   earlier work.

Trade-off: editing content is one extra step (editing the script) versus
clicking into Word. Worth it for grant work.

---

## File layout

```
art-grant-skill/scripts/
├── _style.py                            # shared python-docx helpers
├── grant_docx_template.py               # starter template
├── build_<grant>_docx_v1.py             # v1 — first clean draft
├── build_<grant>_docx_v2.py             # v2 — <what changed>
└── to_pdf.py                            # docx → pdf (LibreOffice)

<path>/<grant>_application_v<N>.md       # markdown source (working draft)
<grant>_DOCX_BUILD_NOTES.md              # this file

Supporting Text/output/
└── <grant>_Application_v<N>.docx        # built artifact
```

---

## Anatomy of the build script

Each script follows the same shape:

```
┌─────────────────────────────────────────────────────────┐
│  imports + OUTPUT path                                  │
│  (also imports helpers from _style.py)                  │
├─────────────────────────────────────────────────────────┤
│  CONFIGURE — grant name, applicant, deadline, amount    │
├─────────────────────────────────────────────────────────┤
│  CONTENT — BUDGET_ROWS, PLAN_ROWS, section strings      │
├─────────────────────────────────────────────────────────┤
│  Table helpers (budget, plan)                           │
├─────────────────────────────────────────────────────────┤
│  build_document() — the doc, section by section         │
├─────────────────────────────────────────────────────────┤
│  main() — save to OUTPUT                                │
└─────────────────────────────────────────────────────────┘
```

---

## Editing a section

### Editing prose

1. Open the build script.
2. Find the section's heading comment.
3. Edit the string literals inside `add_para(...)` calls.
4. Re-run the script.
5. Verify word counts if the section has a cap.

### Editing the budget

The budget is a list of 4-tuples: `(category, item, cost, is_total)`.

- Rows with the same `category` as the previous row collapse their
  category cell (automatic).
- The row marked `is_total=True` is bolded and shaded.
- Totals must be balanced by hand — no automatic balancer.

### Editing the implementation plan

The plan is a list of 4-tuples: `(phase, timeline, milestones, cost)`.
Phase costs should sum to the grant total.

---

## Verifying word counts

Run after every build to confirm capped sections are under limit:

```bash
python3 - <<'EOF'
from docx import Document
doc = Document('Supporting Text/output/<grant>_Application.docx')
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
for k in ['4', '6', '7', '8']:
    body = ' '.join(sections.get(k, []))
    print(f"§{k}: {len(body.split())} words")
EOF
```

---

## Building a PDF

```bash
python3 art-grant-skill/scripts/to_pdf.py \
    "Supporting Text/output/<grant>_Application.docx"
```

This shells out to LibreOffice. If LibreOffice isn't installed:

```bash
brew install --cask libreoffice   # Mac
apt install libreoffice           # Debian/Ubuntu
```

See `art-grant-skill/scripts/to_pdf.py` for alternative backends
(`docx2pdf`, pandoc).
