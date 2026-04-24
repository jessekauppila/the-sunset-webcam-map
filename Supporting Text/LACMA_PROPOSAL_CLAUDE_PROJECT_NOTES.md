# LACMA Art + Technology Lab 2026 — Proposal Project Notes

**Purpose:** paste this file into a Claude Project (or attach it as
context) so that any future Claude instance can help develop this
proposal with the correct facts, framing, and current draft text.

This is a living reference. If the proposal changes, update this file
so Claude always gets the current state.

---

## 0. How to use this with Claude

- Treat this as the single source of truth for the project.
- When asking Claude to revise a section, copy the relevant section's
  current text from here, paste it into chat, and describe the edit
  you want.
- Claude should NOT invent biographical facts, collaborators, funding
  sources, or technical capabilities that are not in this document.
  If something is missing, Claude should ask before filling it in.

---

## 1. The grant at a glance

| Field | Value |
|---|---|
| Program | LACMA Art + Technology Lab |
| Cycle | 2026 (biennial) |
| Deadline | April 22, 2026 · 11:59 PM Pacific |
| Max request | $50,000 |
| Duration | ~24 months (fall 2026 → 2028) |
| Biennial Symposium | 2027 — mid-term demos, talks |
| Biennial Demo Day | 2028 — completed-project showcase |
| Location | Grantees can be anywhere; Symposium + Demo Day in LA |
| Partners | Hyundai, Snap Inc., Anthropic (+ JPL, MIT Media Lab, etc.) |

**Evaluation criteria (from LACMA's call):**

1. Artist-led with artistic merit
2. Explores emerging technology
3. Produces models, methods, or data of interest to other artists /
   technologists
4. Includes opportunities for public demos, prototypes, or
   collaboration during development

**Preference** given to projects that are (a) publicly accessible,
(b) consistent with LACMA's mission, (c) produce shareable outputs
(code, data, models, prototypes), and (d) include public engagement /
demonstration.

### Word caps

| Section | Cap |
|---|---|
| §4 Full description | **500 words** |
| §6 Artistic / creative merit | **100 words** |
| §7 Dialogue between technology and culture | **100 words** |
| §8 Public engagement plan | **100 words** |

§5 Bio, §9 Other funding, §11 Budget, §12 Implementation plan have
no stated cap.

---

## 2. Applicants (keep these facts accurate — do not invent)

### Jesse Kauppila — Principal Applicant

- **Based in:** Bellingham, WA
- **Role on project:** Artist, engineer, and project lead. Builds the
  web app, edge-computing cameras, installation hardware, and handles
  installation + documentation.
- **Websites:** `jessekauppila.art` · `github.com/jessekauppila`
- **Education:**
  - MFA, Carnegie Mellon University (2013–2016)
  - BA, Reed College (2004–2007)
- **Selected professional experience:**
  - Vetta AI — Full-Stack Developer (2025–present) — customer-facing UI
    for AI talent-matching app
  - Northwest Avalanche Center — Full-Stack Developer (2024–2025) —
    single-page map-based weather/avalanche forecasting app
  - Joby Aviation — Full-Stack Developer + Robot Programmer
    (2019–2024) — real-time dashboards for robotic aerospace
    manufacturing
  - VFX Foam — Robotics Design Engineer (2018–2019)
  - Quarra Stone — Robotic Design Engineer / PM (2017–2018)
  - Performance Structures — Robot Programmer (2017–2018)
- **Selected art / fabrication work:**
  - Worked for photographer Catherine Wagner
  - Worked as a fabricator on projects for Anish Kapoor and Charles Ray
    (NOT at their studios — as a fabricator)
  - Interactive water exhibit for the Pittsburgh Children's Museum
    (with Dakotah Konicek — CNC polycarbonate, Arduino, custom PCBs)
- **Grants:** The North Face / American Alpine Club "Live Your Dream"
  Grant, 2022
- **Volunteer:** Bellingham Mountain Rescue and Bellingham
  Mountaineers (2021–2025)
- **Narrative arc for bio (accurate framing):** Stepped away from art
  for roughly a decade after the MFA. Learned robotic programming at
  CMU, used that skill to build a new career: fabrication for Kapoor
  and Ray → aerospace at Joby → building AI data centers for big tech.
  Now returning to art practice, applying what was learned in the tech
  world. Financial security from that decade has given room to focus
  on work he genuinely believes in.

### Kameron Decker Harris — Co-applicant / Collaborator

- **Based at:** Western Washington University (Bellingham, WA)
- **Role on project:** Co-lead of the machine-learning architecture
  and training strategy; collaborator on interpreting the
  human–machine aesthetic gap the project makes explicit.
- **Website:** `glomerul.us/research.html` (Glomerulus Lab)
- **Position:** Faculty — Computational Neuroscience, WWU
- **Research focus:** Networked dynamical systems, biological and
  artificial neural networks. Sits at the intersection of machine
  learning, dynamical systems, graph theory, and statistical
  inference.
- **Selected prior work:**
  - Brain-network inference collaboration with the Allen Institute
    for Brain Science — whole-brain connectivity from viral-tracing
    experiments (Python package `mcmodels`)
  - Theoretical neural networks — sparsity-driven learning in
    biologically-inspired random-feature networks (including work
    showing V1-like tuning properties improving image recognition)
  - Respiratory rhythms — modeling the pre-Bötzinger complex with
    collaborators at Seattle Children's Research Institute
  - Random graphs, contagion, and spectral techniques
- **Methods he applies:** Statistical inference & machine learning,
  dimensionality reduction, dynamical systems, graph & network
  theory, linear algebra, differential equations, probability.

### Collaboration framing

- The application is framed as a **collaboration between Jesse and
  Kameron.** The narrative voice is Jesse's (first-person singular,
  "I") for personal content, with "we" used for proposal-level
  statements ("we propose to expand…"). Kameron is named explicitly
  as the machine-learning lead in §4 and §5.

---

## 3. Project summary

**Name:** Sunrise / Sunset — A Real-Time Live Stream of Sunrises and
Sunsets as They Travel Around the World.

**Three words:** Sunrise. Sunset. Forever.

**One-sentence:** A perpetual stream of real, current sunrises and
sunsets — pulled from existing webcam APIs and supplemented by custom
edge-computing cameras, archived and ranked by a neural network
learning to see beauty.

**Domain:** `sunrisesunset.studio` (planned final URL during grant
period)

**Repo:** `github.com/jessekauppila/the-sunset-webcam-map`

**What the project actually is, four layers:**

1. **Webcam network** — public webcam APIs + custom-built Raspberry Pi
   Zero 2 W edge-computing cameras.
2. **Web application** — Next.js 15 / React 19 / TypeScript; Mapbox GL
   JS + deck.gl; Neon Postgres; Vercel cron jobs; Firebase Storage for
   snapshots; astronomical calculations (subsolar-point geometry) to
   locate cameras near the terminator.
3. **Neural-network model** — PyTorch + ONNX inference; transfer
   learning on ResNet18 / MobileNetV3; trained on a continuous
   0.0–1.0 aesthetic scale; pipeline combines Jesse's own ratings,
   LLM vision assessments (Gemini / GPT / Claude), and Creative
   Commons sunset imagery scraped from the web.
4. **Gallery installation** — currently a diptych of two portrait
   monitors showing live sunrise / sunset mosaics; target is a
   circular ring of inward-facing monitors placing the viewer at the
   center of the planet's day/night boundary.

**Current physical installation:** Raspberry Pi 4B-driven kiosk
display; two portrait 27" monitors; Tailscale remote access.

---

## 4. Conceptual framing (locked-in moves)

These are the core framing choices the proposal depends on. Don't
dilute or drop them without discussion.

### 4a. Real, not generated

The project is explicitly positioned against AI-generated imagery.
It uses AI to **find** real sunrises and sunsets happening right now
on Earth, rather than asking a machine to generate imaginary ones.
Phrases like "real, current sunrises and sunsets," "actual sunrises
and sunsets currently happening," and "a tool for noticing rather
than inventing" carry this thread through §3, §4, §6, §7.

### 4b. Attention vs. generation

A secondary framing: "the most interesting artistic use of AI may
not be generation but attention — directing machine vision toward
the sublime that already exists." Used in §6 and §7.

### 4c. AI warfare / environmental critique

The proposal names the cultural moment directly: "AI-generated
imagery and AI-waged warfare … machines synthesizing plausible
beauty while killing actual beauty and destroying the natural
environment." Opens §4 and underpins §7.

### 4d. Art-historical inspirations

- **Christian Marclay, *The Clock*** — a sublime whole composed of
  many simultaneous parts.
- **Janet Cardiff, *The Forty-Part Motet*** — viewer at the center
  of a ring, experiencing parts becoming a whole.
- **LACMA's 1967 Art and Technology program** — legacy of light and
  perception at planetary scale.

### 4e. Planetary scale / collective portrait

Not a single sunset, but the idea that "there is always beauty
somewhere in the world." The ring installation is a portrait of
Earth's terminator — the moving day/night boundary — in real time.

### 4f. Human–machine aesthetic gap

A "dating app for sunsets" — public rating site where humans rate
sunsets alongside the AI. Makes visible the many kinds of "beauty"
in sunsets and the gap between human and machine perception. This is
both a public-engagement move and a machine-learning data-collection
move.

### 4g. Distributed sensor network (second life)

The custom edge cameras are designed to be offered later as a
Kickstarter object — funding the project while distributing the
sensor network into the hands of backers (and possibly retailed
through LACMA's gift shop).

### 4h. Artist-led research framing (v5)

The proposal is positioned as an artist-led research project —
not a pure art project, not a pure research project, but a
collaboration in which the research practice IS the artistic
practice. Jesse + Kameron conduct a genuine inquiry into machine
aesthetic perception (with a planetary sensor network as the
instrument and a neural network as the classifier), and the
outputs (dataset, model weights, sensor designs, firmware,
published methodology) are both the artistic medium and the
shareable research output LACMA's criterion #3 asks for. The
installation is the visible form of the research. The punk-rock /
modular display posture (venue-sourced monitors, participant
phone-rings) reinforces this: the *rigorous* investment is in the
instrument and the algorithm; the display is intentionally
contingent, found, and community-sourced.

---

## 5. Current proposal text (v5 — research reframe + budget rebalance)

These are the current strings as of v5, written in
`Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md`.
Previous version v4 is retained for diffing; v2 .docx remains on
disk as the historical submission-ready artifact. Word counts are
under the cap with a small buffer.

### §1 — Name of Project

> Sunrise / Sunset: A Distributed Observatory and Neural Network
> for the Planet's Day/Night Edge

### §2 — Three Words

> Sunrise. Sunset. Observed.

### §3 — One-Sentence Description

> An artist-led research project that builds a planetary network of
> webcams to observe sunrises and sunsets as they travel around the
> world, and trains a neural network to distinguish the beautiful
> from the ordinary.

### §4 — Full Description (499 / 500 words)

> In a cultural moment defined by AI-generated imagery and AI-waged
> warfare, we've become divorced from the beauty of the real world.
> This project inverts that: it uses AI to find real sunrises and
> sunsets happening right now, somewhere on Earth — not to generate
> imaginary ones.
>
> *Sunrise / Sunset* is an artist-led research project — a
> distributed planetary observatory with four layers: a webcam
> network, a web application, a neural-network model, and a modular
> gallery installation. Together they locate webcams currently
> showing sunrises and sunsets, rank them, and display them.
>
> The work takes inspiration from Christian Marclay's *The Clock*
> and Janet Cardiff's *Forty-Part Motet* — sublime wholes composed
> of many simultaneous parts. It gestures at the idea that there is
> always beauty somewhere in the world.
>
> The web application queries webcam APIs and uses subsolar-point
> geometry to locate cameras near the terminator — where day turns
> into night. It is the hub for browsing, rating, and navigating
> the archive.
>
> I'm also building small, custom edge-computing cameras from
> Raspberry Pi Zeros — better sunrise/sunset coverage than
> commercial APIs. They can be tuned remotely, streaming only when
> a good sunset is developing. We're also evaluating ESP32-class
> microcontrollers as a cheaper, lower-power alternative for
> remote solar/cellular deployments.
>
> The machine-perception layer, guided by Prof. Harris, trains
> transfer-learning classifiers (PyTorch, ResNet18 / MobileNetV3,
> exported to ONNX) on a continuous 0.0–1.0 aesthetic scale. The
> pipeline combines our own ratings with structured labels from
> vision-language models (Anthropic Claude, Google Gemini, OpenAI
> GPT) and Creative Commons sunset photography from Flickr; LLM
> labels must clear a Pearson > 0.80 gate against ours before
> entering training. Harris's prior work on random-feature
> networks with V1-like tuning for image recognition informs the
> architecture. The AI's scores shape the installation:
> higher-rated tiles render larger in the mosaic, so machine
> aesthetic judgment becomes visible as form.
>
> The installation is intentionally modular: a ring of screens with
> the viewer at the center of the planet's day/night edge. Venues
> source their own monitors; in informal settings, the ring is
> assembled from volunteers each holding a phone running one feed.
> The research instrument is fixed; the display is found.
>
> This grant closes a specific gap. The system works, but the
> current network only surfaces a few hundred candidates at any
> moment, most from cameras built for other purposes: traffic cams,
> surf cams, parking lots. To reliably show a fantastic sunrise or
> sunset, two things must improve: more cameras placed and tuned
> for this purpose, and a better algorithm for finding the good
> ones in a noisy pool. This grant funds that work.
>
> The project sits at the intersection of landscape art, network
> culture, found photography, and machine-learning research. It
> connects to LACMA's 1967 Art and Technology legacy of light and
> perception at planetary scale.
>
> I also think it would be wonderful to stand at the center of a
> ring of sunrises and sunsets — feeling the turning of the world,
> sunsets changing quickly at the equator and slowly at the poles.
> Who doesn't love a sunset?

### §5 — Bio (283 words, no cap)

> Jesse Kauppila is an artist and engineer based in Bellingham, WA.
> During an MFA at Carnegie Mellon University, I learned to program
> robotic arms for an art project, and I used that skill to begin a
> new career path — one that led to fabricating work for Anish
> Kapoor and Charles Ray, then to aerospace at Joby Aviation (the
> electric air-taxi company), and, more recently, to building AI
> data centers for big tech.
>
> I am now returning to my art practice, applying what I have
> learned in the tech world to projects like this one. Financial
> security has given me the room to clarify my values and focus on
> making work I genuinely believe in. For this project I am
> collaborating with Kameron Decker Harris, a computational
> scientist at Western Washington University, who leads the
> machine-learning architecture.
>
> Outside of studio and professional work, I ski, climb, bike, and
> run in the mountains of the Pacific Northwest. My relationship
> with nature informs my interest in using technology to cultivate a
> deeper connection to the world we all live in.
>
> Kameron Decker Harris is a computational scientist and applied
> mathematician at Western Washington University whose research
> focuses on networked dynamical systems — both biological and
> artificial neural networks. His work sits at the intersection of
> machine learning, dynamical systems, graph theory, and
> statistical inference. Prior collaborations with the Allen
> Institute for Brain Science advanced whole-brain connectivity
> inference from viral-tracing experiments, and he has published on
> sparsity-driven learning in biologically-inspired random-feature
> networks (including work showing V1-like tuning properties
> improving image recognition). For Sunrise / Sunset, Kameron leads
> the machine-learning architecture and training strategy, and
> collaborates on interpreting the human–machine aesthetic gap that
> the project makes explicit.

### §6 — Artistic / Creative Merit (95 / 100 words)

> Sunrise / Sunset points machine perception at actual sunrises and
> sunsets currently happening on Earth — not at machine-generated
> imaginings of them. It amplifies a universally shared aesthetic
> experience by combining dozens of simultaneous real views — drawn
> from public webcams and custom cameras of our own — into a single
> planetary portrait, curated by an AI trained to recognize which
> sunsets to highlight. The work proposes that the most interesting
> artistic use of AI may not be generation but attention: directing
> machine vision toward the sublime that already exists,
> continuously, in the real world.

### §7 — Dialogue Between Technology and Culture (97 / 100 words)

> We are in a cultural moment defined by AI-generated imagery and
> AI that wages war. These algorithms strip the world of its
> beauty, texture, and context. This project seeks to invert that
> relationship. Instead of asking a machine to imagine a sunset, it
> asks a machine to recognize the real ones happening right now,
> somewhere on Earth. It proposes that the most interesting
> artistic use of machine perception may not be generation but
> attention — directing the machine's gaze toward the sublime that
> already exists, continuously, in the literal world. A tool for
> noticing rather than inventing.

### §8 — Public Engagement Plan (96 / 100 words)

> The web app is live (moving to sunrisesunset.studio). Six public
> touchpoints:
>
> - The live web app and a "dating app for sunsets" rating site,
>   where anyone rates sunsets alongside the AI.
> - Pop-up "phone ring" events — participants bring phones, each
>   streams one live feed; a Cardiff-style ring from what's already
>   in pockets.
> - A two-screen exhibit at Canopy Art & Iron (Bow, WA).
> - Mid-term demo at the 2027 LACMA Biennial Symposium.
> - Open-source release of the ML pipeline, model, and archive.
> - A Kickstarter campaign for the edge cameras — funding plus
>   distributed participation.

### §9 — Other Funding Sources and In-Kind Support

> To date, Jesse and Kameron have jointly self-funded this project
> at approximately $1,500 — covering web hosting, installation and
> display hardware, early webcam prototyping, and AI/software
> subscriptions and API tokens.
>
> **Potential partnerships to pursue during the grant period:**
>
> - **Windy.com** — commercial webcam API access; a partnership or
>   sponsored data-access agreement is a stronger fit than a paid
>   subscription.
> - **Other webcam networks** — EarthCam, Skyline Webcams,
>   AlpineWebcams, university and national-park live-feed programs,
>   open-source webcam projects.
> - **Snap Inc. and Anthropic** (LACMA Lab partner companies) —
>   overlaps with their LLM-vision and real-time geospatial-media
>   interests.
>
> **Potential follow-up funding:**
>
> - A Kickstarter campaign for the custom edge-computing cameras.
> - Possible retail sales through LACMA's gift shop or similar
>   cultural-institution channels.
>
> No other funding is currently committed.

### §10 — Total Amount Requested

> $50,000

### §11 — Detailed Project Budget (totals to $50,000)

| Category | Item | Cost |
|---|---|---|
| Principal Fees | Jesse Kauppila — artist + project lead (24 months) | $12,000 |
| Co-applicant Fees | **Kameron Decker Harris — ML co-lead (24 months): ML architecture, training strategy, model evaluation** — at ⅔ of the principal fee | $8,000 |
| Webcam Prototyping (NA pilot) | 30 × Pi Zero 2 W | $750 |
|  | 30 × Camera modules | $600 |
|  | 30 × MicroSD, high-endurance | $360 |
|  | 30 × Power supplies + cables | $300 |
|  | 30 × Weatherproof enclosures | $450 |
|  | Custom PCB design + small run (Pi + ESP32 board variants, 2 iterations) | $2,500 |
|  | Enclosure design, 3D printing | $1,000 |
|  | Cellular / LTE modems (5–10 units) | $500 |
|  | ESP32 experimental units + peripherals | $500 |
|  | Shipping, tools, spare parts | $540 |
|  | *(subtotal: $7,500)* |  |
| Travel (Bellingham → LA, 2 people) | 2027 Symposium trip × 2 people | $4,400 |
|  | 2028 Demo Day trip × 2 people | $6,800 |
|  | Canopy Art & Iron (local drive, Bow WA) | $300 |
|  | *(subtotal: $11,500)* |  |
| Software & Services | Anthropic Claude — Jesse, Max tier ($200/mo × 24, for algorithm-training + Claude-Code pipeline work) | $4,800 |
|  | Anthropic Claude — Kameron, Pro tier ($100/mo × 24) | $2,400 |
|  | Anthropic + OpenAI + Google Gemini vision API calls (LLM labeling pipeline) | $1,000 |
|  | Cursor Pro — Jesse ($20/mo × 24) | $480 |
|  | Cursor Pro — Kameron ($20/mo × 24) | $480 |
|  | Vercel Pro — project deployment ($20/mo × 24) | $480 |
|  | Neon Postgres — project database (24 months) | $600 |
|  | Mapbox GL JS (free tier; overage from contingency) | $0 |
|  | Domain + SSL (sunrisesunset.studio, 2 yrs) | $100 |
|  | *(subtotal: $10,340)* |  |
| Contingency | Replacement hardware, API overages, shipping | $660 |
| **TOTAL** |  | **$50,000** |

**Dollar ordering (for reference):** Jesse $12,000 > Travel
$11,500 > Software $10,340 > Kameron $8,000 > Webcams $7,500 >
Contingency $660. The spirit of the priority ordering (Jesse >
Kameron > Webcams as the primary project investments) is preserved
even though Travel and Software exceed them in dollar terms due to
2-person × 24-month scaling. Removed in v5: GPU workstation,
documentation, fabrication assistance, exhibition display hardware
(monitors / stands / wiring / Pi 4B kiosk).

### §12 — Implementation Plan

| Phase | Timeline | Cost |
|---|---|---|
| **1. Foundation + Webcam v1** — formalize co-lead agreement with Kameron, kick off ML architecture; upgrade ML pipeline to image-based inference; expand training dataset; validate against human ratings (Pearson > 0.80 gate); begin outreach to Windy / EarthCam; build first 5–10 Pi Zero 2 W cameras and first ESP32 prototypes; identify NA deployment partners. | Fall 2026 (Months 1–4) | $11,000 |
| **2. Modular Install Development + NA Webcam Rollout** — refine the modular installation approach (venue-sourced monitor mix + participant phone-ring protocol); develop the public rating app; iterate webcam hardware (custom PCB, weatherproof enclosure, remote-tuning firmware, ESP32 field tests); deploy 8–10 cameras across North American locations; exhibit the two-screen diptych at Canopy Art & Iron's annual rendezvous (Bow, WA). | Winter 2026–27 (Months 4–8) | $13,000 |
| **3. LACMA Symposium Demo** — install and demonstrate at the 2027 Biennial Symposium (venue-sourced monitors + phone-ring demo); present mid-term findings (model evolution, human–machine rating divergence, pilot-webcam data, Canopy exhibit reflections); travel Bellingham → LA (2 people). | Spring 2027 (Months 8–12) | $9,000 |
| **4. Refinement + Kickstarter Prep + Global Network** — incorporate symposium feedback; train second-generation model on expanded dataset (gallery ratings + rating-app data + pilot imagery); finalize Kickstarter-ready camera and campaign; distribute cameras internationally; open-source release of ML pipeline. | Summer–Fall 2027 (Months 12–18) | $8,000 |
| **5. Final Installation + 2028 Demo Day** — full-scale modular installation for 2028 Demo Day (venue-sourced monitor ring + phone-ring public event); published dataset, model weights, camera hardware plans; travel Bellingham → LA (2 people). | Winter–Spring 2028 (Months 18–24) | $9,000 |

---

## 6. Voice and style guide

- **Primary voice:** First-person singular ("I") — this is Jesse's
  application, he is the principal artist.
- **Collaborative voice:** "we" is used for proposal-level
  intentions ("we propose to expand this work in four directions")
  and for the ongoing self-funding ("Jesse and Kameron have
  jointly self-funded").
- **Kameron's role is named explicitly** where his work is being
  described. As of v5, proposal text uses the formal "Prof. Harris"
  (and "Harris" on second reference) in §4's machine-perception
  paragraph, to foreground the academic research character of the
  collaboration. §5 Bio still introduces him as "Kameron Decker
  Harris." Other sections that reference him by first name
  ("collaborating with Kameron Decker Harris") remain fine — the
  formal framing is specific to the ML/research paragraph.
- **Punctuation:** Em-dashes (—, U+2014), curly quotes (" " ' '),
  en-dashes for ranges (–). No straight quotes or double-hyphens.
- **Italicize artwork titles:** *The Clock*, *Forty-Part Motet*.
- **Avoid:** corporate-speak ("stakeholders," "leverage synergies"),
  overly modest hedges ("perhaps," "somewhat"), filler adverbs
  ("really," "very"), and buzzword piles.
- **Keep:** dry earnestness, specificity about hardware and
  software, the "real not generated" drumbeat, the question "Who
  doesn't love a sunset?" in §4's closer.

---

## 7. Fact boundaries — things not to invent

When Claude is asked to expand, condense, or reword the proposal,
it should NOT:

- Invent new funders, collaborators, mentors, or partner
  institutions that aren't named here.
- Fabricate biographical details (exhibitions, residencies, awards,
  press) beyond what's listed in §2 of this file.
- Add specific technical capabilities (models, accuracy metrics,
  camera counts currently deployed, etc.) beyond what this file
  describes.
- Claim committed funding, signed partnerships, or confirmed
  exhibition dates beyond what's in §9, §11, and §12.
- Speak in Kameron's voice without checking — he is a real person
  and his words should be approved by him before appearing.
- Drop the "real vs. generated" framing or the "attention vs.
  generation" framing — they are load-bearing.
- Rename the project without discussion. Current title stays:
  *Sunrise / Sunset*.

If asked to go beyond these boundaries, flag it and ask.

---

## 8. Open decisions / things still under review

- **Name subtitle** — v5 pick: "A Distributed Observatory and
  Neural Network for the Planet's Day/Night Edge." Alt still on
  the table: "A Neural Network Learning to See Beauty at the
  Planet's Day/Night Edge."
- **Anthropic Max tier assignment** — currently Jesse at $200/mo
  (principal dev + Claude Code pipeline), Kameron at $100/mo.
  Swap is a label change, not a dollar change, if Kameron should
  be on Max for ML training work instead.
- **Principal fees are modest in v5** — Jesse ~$500/mo, Kameron
  ~$333/mo across 24 months. Levers to raise: scale back one
  person's travel, drop one Cursor Pro subscription, or remove
  the vision-API $1,000 line and rely on subscription coverage.
- **Budget hierarchy** — user's stated priority was Jesse >
  Kameron > Webcams > Travel > Anthropic. Actual dollar ordering
  ended up Jesse > Travel > Software > Kameron > Webcams.
  Structural (2-person × 24-month) costs drive Travel and
  Software above the fees. Budget notes in §11 frame principals +
  research instrument as the primary investments.
- **§6, §7, §5 Bio** — unchanged from v2. Could be reframed
  toward research ("produces models, methods, data of interest
  to other artists/technologists") in a follow-up pass.
- **§9 Other Funding** — unchanged from v2. Self-funding figure
  (~$1,500) probably needs updating before submission.
- **Project domain** — `sunrisesunset.studio` is the planned
  final URL. Register / confirm before submission.
- **Supporting images** — five JPEGs to embed in the final
  submission:
  1. Screenshot of the live map / globe view with terminator and
     webcam markers.
  2. Screenshot of the sunrise / sunset mosaic diptych.
  3. Rendering or mock-up of the modular installation (with
     phone-ring variant).
  4. Photograph of an early Pi Zero webcam prototype.
  5. Diagram of the ML pipeline architecture, or an example
     mosaic showing tile-size variation driven by AI scores.
- **Canopy Art & Iron exhibit date** — the "annual rendezvous"
  in Bow, WA is the planned early public showing. Confirm date
  and whether a formal commitment is in place.
- **Windy partnership** — currently aspirational. Outreach
  happens in Phase 1.

---

## 9. Related files in the repo

| File | Purpose |
|---|---|
| `Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md` | **Current working draft** — research reframe + budget rebalance (matches this notes file) |
| `Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v4.md` | v4 snapshot — research reframe, before budget rebalance |
| `Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v3.md` | Clean markdown source that matched the v2 .docx (older naming / "Sunrisesunset.ai") |
| `Supporting Text/LACMA_ART_TECH_LAB_APPLICATION_2026_v2.md` | Markdown source with editor notes |
| `scripts/build_lacma_docx_v2.py` | Python script that builds the v2 .docx |
| `Supporting Text/output/LACMA_Art_Tech_Lab_2026_Kauppila_Harris_v2.docx` | Historical submission-ready .docx (v2 content) |
| `Supporting Text/lacma-grant-context.md` | Personal context + framing notes |
| `Supporting Text/lacmaGrantInfo.md` | LACMA's published call information |
| `LACMA_DOCX_BUILD_NOTES.md` | How the .docx is built and edited |
| `ml/OPERATING_GUIDE.md` | ML pipeline documentation |
| `GALLERY_DISPLAY.md` | Installation / kiosk setup |

---

## 10. Prompt starters for Claude

When opening a new Claude session with this file attached, useful
first prompts:

- "Review §4 and suggest three ways to tighten it by 30 words
  without losing the 'real not generated' framing."
- "Propose three alternate one-sentence descriptions that keep
  'real, current sunrises and sunsets' as the core claim."
- "Draft a 150-word cover email to LACMA introducing the proposal."
- "Kameron is reviewing §5 — suggest one sentence he might ask to
  change to better represent his actual research focus."
- "Propose a 60-second elevator pitch for the Symposium demo."
- "List five risks to this project that a reviewer might raise,
  and one-sentence mitigations for each."
- "Critique the budget from a reviewer's point of view — where
  does it look thin, generous, or unjustified?"

---

*Last updated: 2026-04-22 — synced to v5 (research reframe + budget rebalance).*
