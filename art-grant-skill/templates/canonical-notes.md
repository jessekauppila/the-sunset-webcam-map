# <GRANT NAME> — Proposal Project Notes

**Purpose:** paste this file into a Claude Project (or attach as context) so
any future LLM session can help develop this proposal with correct facts,
framing, and current draft text. Treat this as the single source of truth.

If the proposal changes, update this file so the LLM always has current
state.

---

## 0. How to use this file with an LLM

- Treat this as the single source of truth for the project.
- When asking for revisions, copy the relevant section's current text from
  here into chat and describe the edit you want.
- The LLM should NOT invent biographical facts, collaborators, funding
  sources, or technical capabilities that are not in this document. If
  something is missing, it should ask before filling in.

---

## 1. The grant at a glance

| Field | Value |
|---|---|
| Program | <e.g., LACMA Art + Technology Lab> |
| Cycle | <year / biennial / annual> |
| Deadline | <Month Day, Year · time zone> |
| Max request | $<amount> |
| Duration | <N months> |
| Key events | <e.g., mid-term symposium, demo day> |
| Location | <where the work can be based / where events are held> |
| Partners | <partner institutions / funder affiliates> |

**Evaluation criteria** (verbatim from the grant call):

1. <criterion 1>
2. <criterion 2>
3. <criterion 3>
4. <criterion 4>

**Preferences** (from the call):

- <preference 1>
- <preference 2>

### Word caps

| Section | Cap |
|---|---|
| §<X> <Section name> | **<N> words** |
| §<Y> <Section name> | **<N> words** |

---

## 2. Applicants (keep these facts accurate — do not invent)

### <Principal Applicant Name>

- **Based in:**
- **Role on project:**
- **Websites / portfolios:**
- **Education:**
- **Selected professional experience:**
- **Selected art / relevant work:**
- **Grants / awards:**
- **Volunteer:**
- **Narrative arc for bio:**

### <Co-applicant Name>

- **Based at:**
- **Role on project:**
- **Website:**
- **Research / practice focus:**
- **Selected prior work:**
- **Methods / tools they apply:**

### Collaboration framing

- <how the collaboration is framed in the proposal; pronoun choices; who
  speaks for what>

---

## 3. Project summary

**Name:** <project name>

**Three words:** <three.words.>

**One-sentence:** <one-sentence description>

**Domain:** <planned URL>

**Repo:** <github URL if any>

**What the project actually is, in layers:**

1. **<Layer 1>** — <description>
2. **<Layer 2>** — <description>
3. **<Layer 3>** — <description>

**Current state of the work:** <what exists, what is prototyped, what is a
plan>

---

## 4. Conceptual framing (locked-in moves)

These are the framings the proposal depends on. Don't dilute or drop
without discussion.

### 4a. <Framing 1>

<Description. Where it appears in the proposal.>

### 4b. <Framing 2>

### 4c. <Framing 3>

---

## 5. Current proposal text

These are the current, as-built strings in the working draft file
(`<path to application_vX.md>`). Word counts are under the cap with a
buffer.

### §1 — Name of Project

> <current text>

### §2 — <Second section>

> <current text>

<etc. — one subsection per proposal section, quoted in blockquote style>

---

## 6. Voice and style guide

- **Primary voice:** <first-person singular / plural / passive>
- **Collaborative voice:** <how "we" vs "I" is used>
- **Punctuation:** <em-dashes? curly quotes? en-dashes for ranges?>
- **Italicize:** <titles of works, foreign terms, etc.>
- **Avoid:** <corporate-speak phrases, hedge words, filler adverbs>
- **Keep:** <signature phrases, dry earnestness, specificity cues>

---

## 7. Fact boundaries — things not to invent

When the LLM is asked to expand, condense, or reword, it should NOT:

- Invent funders, collaborators, mentors, or partner institutions not
  listed in §2.
- Fabricate biographical details (exhibitions, residencies, awards,
  press) beyond §2.
- Add specific technical capabilities (models, metrics, deployed counts)
  beyond §3.
- Claim committed funding, signed partnerships, or confirmed exhibition
  dates beyond §9 / §11 / §12.
- Speak in a co-applicant's voice without checking.
- Drop load-bearing framings from §4 without discussion.
- Rename the project without discussion.

If asked to go beyond these boundaries, flag and ask.

---

## 8. Open decisions / things still under review

- <decision 1 — what the options are, what the tradeoff is>
- <decision 2>
- <supporting images still needed>
- <dates still to confirm>

---

## 9. Related files in the repo

| File | Purpose |
|---|---|
| `<path>/<grant>_application_v<N>.md` | Current working draft |
| `<path>/<grant>_application_v<N-1>.md` | Previous draft |
| `scripts/build_<grant>_docx.py` | Builds the .docx |
| `<grant>_DOCX_BUILD_NOTES.md` | How the .docx is built |

---

## 10. Prompt starters

Useful first prompts when opening a new LLM session with this file
attached:

- "Review §<N> and suggest three ways to tighten it by <M> words without
  losing the <framing> framing."
- "Propose three alternate one-sentence descriptions that keep <anchor
  phrase> as the core claim."
- "Draft a <N>-word cover email to <funder> introducing the proposal."
- "Critique the budget from a reviewer's point of view — where does it
  look thin, generous, or unjustified?"

---

*Last updated: <YYYY-MM-DD>*
