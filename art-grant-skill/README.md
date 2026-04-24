# art-grant-skill

A portable process for filling out art / art-and-technology grant
applications with an LLM collaborator, plus python-docx builders for
generating the final submission `.docx` and `.pdf`.

**Start here:** read `SKILL.md` for the full process.
**Worked example:** `examples/lacma-2026/README.md` points at a real,
complete grant application built with this skill (LACMA Art + Technology
Lab 2026).

## What's in here

```
SKILL.md                  # the process, top to bottom
README.md                 # you are here
scripts/                  # python-docx builders (shared + LACMA examples)
  _style.py               # shared helpers
  grant_docx_template.py  # starter grant builder
  cv_docx_template.py     # starter CV builder
  to_pdf.py               # docx → pdf via LibreOffice
  build_*.py              # worked examples (LACMA grant + Jesse's CV)
templates/                # starter .md files to copy per new grant
examples/                 # worked examples (pointers to real files)
```

## Quickstart — new grant

```bash
# 1. Copy templates into your project
cp art-grant-skill/templates/canonical-notes.md \
   "Supporting Text/<GRANT>_PROPOSAL_CLAUDE_PROJECT_NOTES.md"
cp art-grant-skill/templates/application-draft.md \
   "Supporting Text/<GRANT>_APPLICATION_<YEAR>_v1.md"
cp art-grant-skill/templates/docx-build-notes.md \
   "<GRANT>_DOCX_BUILD_NOTES.md"
cp art-grant-skill/scripts/grant_docx_template.py \
   art-grant-skill/scripts/build_<grant>_docx_v1.py

# 2. Fill in §1 of the canonical notes from the grant call.
# 3. Fill in §2 from the applicant's CV.
# 4. Open an LLM session, attach the canonical notes, tell it to follow SKILL.md.

# ...time passes. Editing happens. Then:

# 5. Build the docx
python3 art-grant-skill/scripts/build_<grant>_docx_v1.py

# 6. Convert to PDF
python3 art-grant-skill/scripts/to_pdf.py \
    "Supporting Text/output/<grant>_Application.docx"
```

## Dependencies

- Python 3.10+
- `python-docx` (`pip install python-docx`)
- LibreOffice for PDF conversion (`brew install --cask libreoffice` on Mac)

## License

Personal skill; no formal license. Copy freely.
