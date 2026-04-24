# Worked Example: LACMA Art + Technology Lab 2026

This is the first grant built with the `art-grant-skill` process. Read
through these files (in roughly this order) to see the skill patterns in
practice on a real application.

## Canonical notes + working drafts

| File | What it is |
|---|---|
| [`../../../Supporting Text/LACMA_PROPOSAL_CLAUDE_PROJECT_NOTES.md`](../../../Supporting%20Text/LACMA_PROPOSAL_CLAUDE_PROJECT_NOTES.md) | **Canonical notes** — the single source of truth for the LACMA proposal. Read this first; it embodies the template in `art-grant-skill/templates/canonical-notes.md`. |
| [`../../../Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md`](../../../Supporting%20Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md) | **Current working draft** — research reframe + budget rebalance. The clean markdown source that matches the v5 docx. |
| [`../../../Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v4.md`](../../../Supporting%20Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v4.md) | v4 snapshot — research reframe, before budget rebalance. |
| [`../../../Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v3.md`](../../../Supporting%20Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v3.md) | v3 — clean markdown that matched the v2 docx. |
| [`../../../Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v2.md`](../../../Supporting%20Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v2.md) | v2 — first collaboration-framed draft (editor notes inline). |

## Build scripts (in `art-grant-skill/scripts/`)

| Script | What it produces |
|---|---|
| [`../../scripts/build_lacma_docx.py`](../../scripts/build_lacma_docx.py) | v1 .docx — first clean solo draft |
| [`../../scripts/build_lacma_docx_v2.py`](../../scripts/build_lacma_docx_v2.py) | v2 .docx — full collaboration version |
| [`../../scripts/build_lacma_docx_v5_part2.py`](../../scripts/build_lacma_docx_v5_part2.py) | v5 §11 + §12 only — partial builder so §1–§10 can be hand-entered into LACMA's web form |

## Built artifacts (in `Supporting Text/output/`)

| File | Source |
|---|---|
| `LACMA_Art_Tech_Lab_2026_Kauppila.docx` | built by `build_lacma_docx.py` |
| `LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx` | built by `build_lacma_docx_v2.py` |
| `LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v5_part2.docx` | built by `build_lacma_docx_v5_part2.py` |
| `LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v5_part2.pdf` | built by `to_pdf.py` from the v5 part2 docx |

## Per-grant docs

| File | Purpose |
|---|---|
| [`../../../LACMA_DOCX_BUILD_NOTES.md`](../../../LACMA_DOCX_BUILD_NOTES.md) | Per-grant docx build doc — template for `art-grant-skill/templates/docx-build-notes.md` |

## Editing log (outside the repo)

The cross-session editing log lives in the user's personal notes folder:
`~/Notes/ongoing/lacma-proposal-editing.md`. This is separate from the
repo — it's not source, it's a diary.

## Patterns demonstrated in this example

1. **Three-file structure** — canonical notes + versioned drafts +
   session log.
2. **Research reframe** (v3 → v4) — "artist-led research project" move
   that updated name, three-words, one-sentence, and §4 opening.
3. **Budget rebalance** (v4 → v5) — removed monitors / GPU /
   documentation; doubled software and travel for two people; bumped
   co-applicant fee to ⅔ of principal. Budget-note paragraphs frame the
   rhetorical shape rather than hiding dollar inversions.
4. **Milestone splitting** (5 → 10 → 16 rows) — preserved phase-level
   envelopes while generating LACMA's required 16-row format.
5. **Co-applicant availability** — ML-heavy training milestones
   scheduled in the co-applicant's academic summer windows.
6. **Partial docx builder** — v5 part2 generates just §11 + §12 (the
   tables) because LACMA's web form accepts prose sections directly.
7. **Voice preservation** — first-person singular for Jesse, "we" for
   proposal-level statements, formal "Prof. Harris" only in the §4
   machine-perception paragraph.
