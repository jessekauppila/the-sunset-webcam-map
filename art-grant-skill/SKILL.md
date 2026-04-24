# Art Grant Application Skill

A portable, repeatable process for filling out art / art-and-technology
grant applications by collaborating with an LLM. Extracted from the LACMA
Art + Technology Lab 2026 cycle — see `examples/lacma-2026/README.md` for
the worked example.

This document is written for two audiences at once:
- **A human** planning their next grant. Read top to bottom.
- **An LLM** spawned to help with a grant. You can be told "follow the
  `art-grant-skill`" and work through it section by section.

---

## TL;DR

A grant application goes well when four things exist for the life of the
project:

1. **A canonical notes file** — single source of truth for applicant
   facts, framing, and current proposal text. Template:
   `templates/canonical-notes.md`.
2. **A versioned working draft** (`_v1.md`, `_v2.md`, ...) — the clean
   text of the current proposal. Template: `templates/application-draft.md`.
3. **An ongoing session log** — short record of what decisions got made
   and what is still open. Template: `templates/session-log.md`.
4. **A python-docx builder script** — generates the final `.docx`.
   Starter: `scripts/grant_docx_template.py`. See `templates/docx-build-notes.md`
   for per-grant doc.

After the `.docx` is built, `scripts/to_pdf.py` converts it to PDF via
LibreOffice for submission to funders that want PDFs.

A matching CV (`scripts/cv_docx_template.py`) uses the same python-docx
patterns with a different content shape.

---

## When to use this skill

Use it when:
- The grant has structured sections with word or character caps.
- You (or a small team) will spend 10+ hours on the proposal.
- You want to reuse framing across multiple grants (bio, project
  description, CV) without rewriting each time.
- You want to hand parts of the work — tightening a paragraph,
  rebalancing a budget, generating alternate names — to an LLM
  without losing control of your voice or inventing facts.

Probably don't use it for:
- Single-prompt grants where you can write the whole thing in one
  sitting.
- Pure form-fill grants (name, phone, amount).

---

## Folder layout

```
art-grant-skill/
├── SKILL.md                         # this file
├── README.md                        # 30-second quickstart
│
├── scripts/
│   ├── _style.py                    # shared python-docx helpers
│   ├── grant_docx_template.py       # starter grant builder
│   ├── cv_docx_template.py          # starter CV builder
│   ├── to_pdf.py                    # docx → pdf (LibreOffice)
│   ├── build_cv_docx.py             # worked example: Jesse's CV
│   ├── build_lacma_docx.py          # worked example: LACMA v1
│   ├── build_lacma_docx_v2.py       # worked example: LACMA v2
│   └── build_lacma_docx_v5_part2.py # worked example: LACMA §11+§12 only
│
├── templates/
│   ├── canonical-notes.md           # canonical-notes file template
│   ├── application-draft.md         # proposal draft template
│   ├── session-log.md               # session log template
│   └── docx-build-notes.md          # per-grant docx-build-notes template
│
└── examples/
    └── lacma-2026/
        └── README.md                # pointer to the LACMA files elsewhere
                                     # in this repo; "this is the pattern in practice"
```

Sibling files in the grant's own project (outside `art-grant-skill/`):

```
<repo>/
├── Supporting Text/
│   ├── <GRANT>_PROPOSAL_CLAUDE_PROJECT_NOTES.md   # canonical notes
│   ├── <GRANT>_APPLICATION_<YEAR>_v<N>.md         # versioned draft
│   └── output/
│       ├── <GRANT>_Application_v<N>.docx          # built artifact
│       └── <GRANT>_Application_v<N>.pdf           # converted via to_pdf.py
└── <GRANT>_DOCX_BUILD_NOTES.md                    # per-grant build doc
```

And in the user's personal notes folder (outside the repo):

```
~/Notes/ongoing/
└── <grant>-proposal-editing.md                    # session log
```

---

## Why this shape

### Why four files (notes + draft + log + script), not one

- **Canonical notes** stay structurally stable across sessions. Same
  sections, same framing, same fact boundaries. Attach to any LLM
  conversation as project context.
- **Versioned drafts** evolve. v2 captures what worked; v3 is a reframe;
  v5 is submission-ready. Parallel drafts exist without destroying each
  other.
- **Session log** captures *what changed and why*. Keeps the canonical
  notes clean while preserving decision history.
- **Build script** produces the final artifact. Diffable, reproducible,
  consistent styling, parallel versions don't fight.

### Why a python-docx script, not a hand-edited Word file

See `templates/docx-build-notes.md` for the full rationale. Short form:
diffable, reproducible, one place for styling, programmatic word-count
verification, parallel drafts don't fight.

---

## The canonical notes file — contents

The template (`templates/canonical-notes.md`) has 11 sections:

1. **How to use this file with an LLM** — directive: "treat as source of
   truth; do not invent facts not in this file."
2. **The grant at a glance** — program, cycle, deadline, max request,
   duration, evaluation criteria, word caps.
3. **Applicants** — full bio facts (based in, role, education,
   experience, grants, narrative arc). *Do not invent anything here.*
4. **Project summary** — name, tagline, one-sentence, domain, repo,
   project in layered form.
5. **Conceptual framing (locked-in moves)** — framings the proposal
   depends on. Label each (e.g., "4a. Real, not generated"). An LLM
   should flag, not silently drop, these.
6. **Current proposal text** — §1 through §N as-built, with word counts.
   Mirrors the versioned draft.
7. **Voice and style guide** — primary voice, collaborative voice,
   punctuation rules, what to avoid, what to keep.
8. **Fact boundaries — things not to invent** — explicit list.
9. **Open decisions / things still under review** — live list. Refresh
   per session.
10. **Related files in the repo** — pointers to drafts, scripts, build
    notes, ML pipeline docs, installation docs.
11. **Prompt starters** — specific prompts to drop into a new session.

---

## Process — the passes that worked

Working through an application is passes, not sequence. Often looping
back.

### Pass 1 — Ingest the grant call

Read the call. Extract:
- Evaluation criteria (number them — reviewers score against these).
- Word caps per section. Note precisely.
- Preference language ("preference given to projects that...").
- Output format (Word doc? PDF? web form? submission portal?).

Put this verbatim into §1 of the canonical notes.

### Pass 2 — Seed the canonical notes

Populate applicants (§2) and project summary (§3) from the CV and
existing project documentation *before* drafting proposal prose.
Fact-checking is easier when facts live in one place.

### Pass 3 — First draft §-by-§

Write §1 / §2 / §3 first (name, three-words, one-sentence). These
compress the project's identity and every other section leans on them.
Then §4 (full description), §6/§7/§8 (short capped sections). §5 (bio)
is largely a rewrite of CV content. §9/§10/§11 (funding, request,
budget) can be drafted in one sitting once you have a cost model. §12
(implementation plan) last — depends on §11.

### Pass 4 — Reframe (if needed)

After a first full draft, ask: *is this the framing that best answers
the grant's evaluation criteria?* For LACMA, the strongest reframe was
"artist-led research project" instead of "art project" — because
LACMA's criterion #3 is about research outputs useful to other
artists/technologists. One reframe can shift the title, three-words,
one-sentence, and opening paragraph of §4 simultaneously. Capture as a
"locked-in move" in the canonical notes.

### Pass 5 — Word-count compliance

Use `wc -w` or a short python snippet per section. Trim deliberately:
- Remove em-dash asides that restate what's already implied.
- Cut hedges ("somewhat," "perhaps," "really," "very").
- Drop "which" clauses when a punchier construction works.
- Combine two short sentences when combined reads cleaner.
- Preserve signature phrases (document them in §6 of notes).

Aim for 5+ word buffer under the cap. 1-word buffer is dangerous —
different counters (Word's vs `wc` vs the funder's form) disagree on
hyphenated words and em-dashes.

### Pass 6 — Budget rebalancing

When the user changes priorities, do the arithmetic. Don't estimate.
1. List every change the user asked for.
2. Compute line-by-line deltas.
3. Sum. If non-zero, say so, propose where the difference goes.
4. Verify the total with a short python snippet.
5. Write a "budget notes" paragraph that explains the *rhetorical*
   shape of the budget (what it funds, what it doesn't, why).
6. Be honest about hierarchy tradeoffs. If the user wants
   Jesse > Kameron > Webcams > Travel but the math says
   Jesse > Travel > Kameron, say so, and frame the notes around
   *spirit* rather than pretending ordering matches.

### Pass 7 — Implementation plan / discrete milestones

Grant forms often want N rows of milestones with dates and dollars:
- **Pull hardware spend into early months** so early-cycle progress is
  visible. Component orders, PCB commissions (multi-week lead times),
  bench prototypes can start in Month 1.
- **Respect the co-applicant's calendar.** Academic collaborators have
  summers off. Industry collaborators may have blackout periods.
- **Replace vague milestones with concrete deliverables.** "Project
  infrastructure setup" is weak. "ML architecture review &
  loss-function design" is strong.
- **Split phases into more rows** when the form wants 10 or 16 rows.
  Preserve phase-level dollar envelopes; split only within each phase.

### Pass 8 — Build the docx

When the versioned draft is stable, build the docx:
- **Full builder** — one script produces the whole application.
- **Partial builder** — generates just parts the user can't hand-edit
  easily (big tables). Useful when the funder's web form accepts prose
  directly.

Follow style helpers in `scripts/_style.py`: Calibri 11, 1" margins,
light-gray table borders, shaded header rows, bold TOTAL row.

### Pass 9 — Convert to PDF (if the funder wants PDF)

```bash
python3 art-grant-skill/scripts/to_pdf.py "Supporting Text/output/<grant>.docx"
```

Writes the PDF next to the docx. See "Converting to PDF" section below.

---

## Building a CV with the same pattern

CVs use the same python-docx infrastructure but a different content
shape. Starter: `scripts/cv_docx_template.py`. Worked example:
`scripts/build_cv_docx.py` (Jesse Kauppila's CV).

### CV content shape

- **Contact header** — centered name + italic contact line
- **Education** — year, degree, institution
- **Professional Experience** — year range, title, organization
- **Selected Work / Exhibitions** — year, description
- **Grants & Awards** — year, award name
- **Volunteer** — year range, role + organization

### CV styling differs from the grant app

| | Grant application | CV |
|---|---|---|
| Default font | Calibri 11 | Garamond 11 (or Times, Didot) |
| Heading style | Heading 1/2/3 | Small-caps rule |
| Layout | Left-aligned prose + tables | Two-column "year / entry" rows |
| Length | Strict caps per section | 1–2 pages usually |

Both use `_style.py` helpers, but the CV uses Garamond + small-caps
section headings; the grant app uses Calibri + heading styles. The
`_style.configure_document` function takes `font_name` as an argument
so one file doesn't force a look.

### CV and grant app share facts

The CV's Education, Professional Experience, and Selected Work sections
are the same source material that feeds the grant's §2 Applicants and
§5 Bio. Update the CV's entries → copy facts into the canonical notes
→ summarize into §5 Bio. One direction. Never work from the bio
backward to the CV (that's how fabrications creep in).

### CV anti-fabrication rules (same spirit as grants)

Do not invent:
- Exhibitions, residencies, or awards not in the applicant's records.
- Degrees, dates, or institutions beyond what they attended.
- Published works or press coverage.
- Collaborators or clients.

The CV is the most fact-sensitive artifact in a grant package.

---

## Converting to PDF

The `to_pdf.py` script shells out to LibreOffice headless. Usage:

```bash
python3 art-grant-skill/scripts/to_pdf.py path/to/file.docx
python3 art-grant-skill/scripts/to_pdf.py path/to/file.docx --outdir path/to/output
```

If no `--outdir` is given, the PDF is written next to the `.docx`.

### Requirements

LibreOffice must be installed:

```bash
brew install --cask libreoffice   # Mac
apt install libreoffice           # Debian/Ubuntu
```

The script searches for LibreOffice in these locations:
1. `soffice` on PATH
2. `libreoffice` on PATH
3. `/Applications/LibreOffice.app/Contents/MacOS/soffice` (Mac default)
4. `/usr/bin/libreoffice` and `/usr/local/bin/soffice` (Linux paths)

### Why LibreOffice and not `docx2pdf`?

`docx2pdf` on Mac shells out to MS Word, which means it doesn't work if
you have Pages (or nothing) instead of Word. LibreOffice works on any
platform without Word. If you do have Word installed, `docx2pdf` is a
one-liner — see the comment at the top of `to_pdf.py` for how to swap.

### Why not pandoc?

`pandoc` can write PDFs via LaTeX, but layout differs from Word's
renderer. Grant applications were designed to look like a Word doc, so
LibreOffice (which mimics Word's rendering closely) is preferred.

---

## Editing patterns worth naming

### Naming alternatives across a spectrum

Offer 5–8 options arranged from *safer refinement of the current*
through *bolder reframe*. One-line rationale per option. Make a pick.
Name a second pick for "if the first feels too dry / too poetic."

### Trimming under a cap

Work paragraph by paragraph. Count after each change. If a trim would
touch a signature phrase from §6 of the notes, ask first. Prefer
trimming filler from several small spots over gutting one paragraph.

### Budget hierarchy honesty

The user may state priorities the math can't deliver inside a fixed
total. Say so. Present the actual dollar ordering. Write the budget
notes so the *spirit* of the user's ordering (primary investments vs.
structural overhead) is preserved in the rhetorical frame.

### Milestone splitting with envelope preservation

When going from N to M milestones (e.g., 5 → 10 → 16), preserve
phase-level dollar envelopes. Each old phase becomes a "pot" that
splits across 1–3 new rows. Document the mapping at the bottom.

### Respecting co-applicant availability

Ask early. Academic collaborators have summers off. Industry
collaborators have release-freeze periods. Build around real
availability and call it out in a scheduling note — reviewer-friendly.

---

## Anti-fabrication rules

Put these in the canonical notes (§7). When the LLM is asked to expand,
condense, or reword, it **must not**:

- Invent funders, collaborators, mentors, or partner institutions.
- Fabricate biographical details (exhibitions, residencies, awards,
  press, degrees, dates of employment).
- Add specific technical capabilities (model accuracies, camera counts,
  user metrics) beyond the notes.
- Claim committed funding, signed partnerships, or confirmed exhibition
  dates beyond §9 / §11 / §12.
- Speak in a co-applicant's voice without checking.
- Drop load-bearing conceptual framings without discussion.
- Rename the project without discussion.

If asked to go beyond these, flag and ask.

---

## Voice preservation

Preserve:
- Primary voice (first-person singular / plural / passive).
- Signature phrases the applicant likes.
- Dry earnestness, or whatever register the applicant writes in.
- Specificity about hardware, software, collaborators, numbers.

Avoid:
- Corporate-speak ("stakeholders," "leverage synergies").
- Hedge words when the applicant is making a genuine claim.
- Filler adverbs ("really," "very," "quite").
- Buzzword piles.

Put this in §6 of the canonical notes.

---

## Prompt library

Prompts that produced good output during the LACMA cycle.

### Starting a new session

> I'm working on a grant application using the `art-grant-skill`. The
> canonical notes for the project are in `<path>`. Read that file first;
> treat it as the single source of truth for applicant facts, project
> framing, and current proposal text. Do not invent anything not in
> that file. The current working draft is `<path>`. The session log is
> `<path>`. We last left off [summary]. Today I want to work on
> [topic].

### Reframing

> I'm considering reframing the proposal from "X" to "Y." The evaluation
> criteria are [list]. Before I commit, walk me through: (1) what
> changes in §1/§2/§3, (2) what changes in §4, (3) which locked-in
> framings in §4 of the canonical notes survive and which need
> updating, (4) is this reframe helped or hurt by the grant's
> evaluation criteria.

### Naming alternatives

> Brainstorm 5–8 subtitle options for the project, arranged from safer
> refinements of the current to bolder reframes. One-line rationale per
> option. Make a pick. Name a second pick if the first feels too
> [dry / poetic / long]. Keep "<Project Name>:" as the anchor.

### Trimming to word count

> §N is currently [M] words, cap is [K]. Trim to at most [K-5]. Don't
> touch the signature phrases in §6 of the canonical notes. Show the
> paragraphs you changed and what specifically came out. Report the
> final word count.

### Budget rebalancing

> I want to [change]. Work out the arithmetic: compute line-by-line
> deltas, sum, tell me where the remainder goes or comes from, verify
> the total is [$N]. Then write updated budget notes that explain the
> rhetorical shape. Flag any priority ordering the math can't honor.

### Implementation plan / milestone splitting

> The grant form has N rows for "Key Milestones / Start Date / Funds
> Needed." Split the current [M]-phase plan into N discrete milestones.
> Preserve phase-level dollar envelopes. Use specific start dates —
> grant starts [Month Year]. Pull hardware spend early. Respect
> [co-applicant]'s availability: they are [academic / industry] and
> [specific constraint].

### Sanity check before submission

> Read the current working draft start to finish. Report: (1) fact
> claims not grounded in the canonical notes, (2) sections exceeding
> word caps, (3) dropped signature phrases from §6 of the notes,
> (4) budget arithmetic that doesn't sum, (5) milestones with
> unspecified dates or amounts. Don't fix — just flag.

### Building the docx

> The working draft in `<path>` is stable. Update (or create) the
> build script at `art-grant-skill/scripts/build_<grant>_docx.py` to
> match the latest prose, budget, and plan. Run it. Run the word-count
> verifier on the output. Run `to_pdf.py` on the output docx.

---

## Starting a new grant — quick checklist

1. Copy `templates/canonical-notes.md` to
   `Supporting Text/<GRANT>_PROPOSAL_CLAUDE_PROJECT_NOTES.md`. Fill in §1 from
   the grant call. Fill in §2 from the applicant's CV.
2. Copy `templates/application-draft.md` to
   `Supporting Text/<GRANT>_APPLICATION_<YEAR>_v1.md`. Fill in section
   headings and word-cap targets to match the grant.
3. Copy `templates/session-log.md` to
   `~/Notes/ongoing/<grant>-proposal-editing.md` (or wherever your
   cross-session notes live). Point it at the canonical notes.
4. Copy `scripts/grant_docx_template.py` to
   `scripts/build_<grant>_docx_v1.py`. Update OUTPUT, BUDGET_ROWS,
   PLAN_ROWS, and the body prose.
5. Copy `templates/docx-build-notes.md` to
   `<GRANT>_DOCX_BUILD_NOTES.md` at the repo root.
6. Start drafting with the Pass 1 / Pass 2 prompts above.

---

## What this skill doesn't cover (yet)

- Grants where the main artifact is video or a live demo.
- Multi-institution collaborations with separate admin / contracting.
- Grants with matching-funds requirements.
- Long-form narrative grants (> 5,000 words) — the word-count passes
  scale, but long narratives benefit from outlines and section-ordering
  work this doc doesn't describe.
- Residency applications — overlap heavily with grant applications but
  have their own forms and timelines.

Candidates for future revisions.

---

## Worked example

See `examples/lacma-2026/README.md` for a pointer-tour of a full
application built with this skill.

Key files to read in order:
1. `Supporting Text/LACMA_PROPOSAL_CLAUDE_PROJECT_NOTES.md` (canonical
   notes — the template in action)
2. `Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md` (working
   draft)
3. `scripts/build_lacma_docx_v2.py` (full docx builder)
4. `scripts/build_lacma_docx_v5_part2.py` (partial docx builder)
5. `Supporting Text/output/LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v5_part2.docx`
   and `.pdf` (built artifacts)

---

## Changelog

- **v0.2 — 2026-04-23.** Consolidated into `art-grant-skill/` folder.
  Added CV-building section and PDF-conversion section.
  `scripts/build_*.py` moved from repo root `scripts/` into
  `art-grant-skill/scripts/`. Templates added in `templates/`.
- **v0.1 — 2026-04-23.** First draft at `GRANT_APPLICATION_SKILL.md`
  at repo root. Extracted from the LACMA 2026 cycle.
