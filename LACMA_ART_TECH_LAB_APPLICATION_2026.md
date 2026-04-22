# LACMA Art + Technology Lab — 2026 Grant Application

**Application Deadline:** April 22, 2026, 11:59 PM PST
**Applicant:** Jesse Kauppila
**Repository:** [the-sunset-webcam-map](https://github.com/jessekauppila/the-sunset-webcam-map)

> This document contains the full application draft, followed by a detailed
> project analysis and grant-fit assessment. Sections marked **[FILL IN]**
> need your input before submission.

---

## Application Responses

---

### 1. Name of Your Project

**Sunrise/Sunset: A Real-Time Live Stream of Sunrises and Sunsets as They Travel Around The World **

---

### 2. Three Words

**Live, Sunset, Around the World**

---

### 3. One-Sentence Description

A planetary-scale artwork that captures sunrises/sunsets in an archive and displays them in real time as as they occur using existing webcam APIs, my custom webcams, and the software and machine learning algorithms I've been teaching to recognize a beautiful sunset.





---

### 4. Full Description of the Proposed Project (500 words max)

The Sunset Webcam Map is a live, planetary-scale artwork that assembles hundreds of webcam feeds from locations experiencing sunrise and sunset. 

  between day and night as it sweeps continuously around the Earth, and . I've trained an algorithm to identify the best of these sunrises/sunsets. 

The project operates across five interconnected layers: a live web application, a machine learning pipeline, an online archive, bespoke webcams to supplement those available publicly, and a physical gallery installation.

**The live system** queries the Windy webcam API every 60 seconds, using astronomical calculations (subsolar point geometry) to locate webcams near the terminator. These feeds are displayed on an interactive Mapbox map and deck.gl globe, and rendered as two continuously updating mosaic grids — one for sunrise, one for sunset — composed of dozens of simultaneous webcam views arranged by geographic position.

**The machine perception layer** trains computer vision models (ResNet18, MobileNetV3) to evaluate "sunset quality" on a continuous 0.0–1.0 scale — essentially encoding aesthetic judgment about light, atmosphere, and landscape into a neural network. The training pipeline uses a novel hybrid labeling approach: human ratings collected through a participatory swipe-to-rate gallery are combined with structured assessments from vision-language models (Google Gemini, OpenAI GPT), supplemented by Creative Commons sunset photography scraped from Flickr. The machine's quality scores directly shape the visual composition — higher-rated webcam tiles are rendered larger in the mosaic, so the AI's aesthetic judgment becomes visible as form.

**The physical installation** drives two 27-inch portrait-oriented monitors from a Raspberry Pi, displaying the sunrise and sunset mosaics side by side — a diptych of the planet's daily light show that updates in real time. The installation is designed to be portable and gallery-ready, using a thin-client architecture where the Pi simply displays the cloud-hosted application.

With LACMA's support, I propose to expand this work in three directions. First, scaling the installation to a larger multi-screen array, creating an immersive wall of simultaneous sunsets that better captures the planetary scale of the phenomenon. Second, deepening the ML pipeline to move from metadata-based scoring to true image-based inference in production, enabling the system to make real-time aesthetic decisions from pixel data. Third, developing participatory interfaces for gallery visitors — a physical station where people can rate sunsets alongside the AI, with their judgments feeding back into the model in real time, making visible the gap (and convergence) between human and machine perception of beauty.

The project sits at the intersection of landscape art, network culture, and machine learning — asking what happens when we use the planet's accidental visual infrastructure (tourism and surveillance cameras) to construct a collective portrait of a universal daily experience, and then ask a machine to tell us which views are beautiful. It connects to LACMA's 1967 Art and Technology legacy — Robert Irwin and James Turrell explored light and perception through controlled environments; this project explores them through networked cameras and computational aesthetics at planetary scale.

All code, trained models, and datasets are open-source and designed for broad sharing.

---

### 5. Bio / CV

**[FILL IN — Include your bio/CV here. Below is a starter based on what's in the repo; expand with your full background, education, exhibitions, relevant experience, etc.]**

Jesse Kauppila is an artist and technologist based in **[FILL IN: city]** whose practice explores the intersection of networked media, machine learning, and environmental perception. He is the creator of The Sunset Webcam Map, a live planetary-scale artwork that has been in active development since 2025. His work investigates how computational systems interpret and mediate the natural world, with a particular focus on the aesthetics of light and atmosphere as experienced through the lens of networked cameras.

**[FILL IN: education, exhibitions, professional background, other relevant projects, collaborations, etc.]**

---

### 6. Artistic or Creative Merit (100 words max)

The Sunset Webcam Map reframes the sunset — perhaps the most universally shared aesthetic experience — as a networked, computational phenomenon. Instead of a single privileged viewpoint, it presents dozens of simultaneous perspectives from webcams scattered along the terminator line, constructing a collective landscape that paints itself in real time. The machine learning layer adds a provocative dimension: an AI trained to judge "beauty" in sunsets, whose aesthetic decisions visibly shape the composition. The work asks whether machine perception can meaningfully engage with the sublime, and makes that question tangible through an installation where human and algorithmic judgment coexist.

---

### 7. Technology and Culture Dialogue (100 words max)

The project provokes dialogue about machine aesthetics — what does it mean to train an AI to recognize a "good" sunset? It surfaces the hidden labor of networked infrastructure: thousands of webcams, originally deployed for tourism and surveillance, repurposed as a planetary-scale artistic sensor array. The participatory rating system makes visible the feedback loop between human taste and algorithmic training data, asking visitors to consider how their aesthetic preferences become encoded in machine learning systems. As AI increasingly mediates our experience of the natural world — through photo filters, recommendation algorithms, and automated curation — this project makes that mediation legible.

---

### 8. Public Engagement Plan (100 words max)

The web application is already publicly accessible at its Vercel URL, providing global access to the live terminator map and mosaics. The physical installation — dual portrait monitors driven by Raspberry Pi — is designed to be portable and gallery-ready. I envision three public touchpoints during the grant period: (1) an interactive rating station alongside the installation where visitors rate sunsets, feeding the ML model in real time; (2) a mid-term demo at the 2027 Biennial Symposium showing the evolving model's aesthetic decisions; (3) an open-source release of the full ML pipeline, training data, and installation documentation for other artists.

---

### 9. Other Funding Sources

**[FILL IN — List any other sources of funding for this project, including in-kind support. If none, state "No other funding sources at this time."]**

---

### 10. Total Amount Requested

**$50,000**

---

### 11. Detailed Project Budget

| Category | Item | Cost |
|----------|------|------|
| **Artist Fees** | Artist time — research, development, installation, documentation (24 months) | $18,000 |
| **Hardware** | Expanded multi-screen installation: 4–6 additional 27" portrait monitors | $3,000 |
| | Additional Raspberry Pi units, cables, mounting hardware, cases, SD cards | $800 |
| | Dedicated GPU workstation or cloud GPU allocation for ML training | $2,500 |
| **Software & Services** | Windy API commercial license (24 months) | $1,200 |
| | Mapbox, Vercel Pro, Neon Postgres, Firebase hosting (24 months) | $2,400 |
| | LLM API costs — Gemini/OpenAI vision calls for labeling pipeline | $1,000 |
| **Installation Materials** | Monitor stands/mounts for portrait orientation, gallery-grade mounting | $2,000 |
| | Wiring, cable management, power distribution for multi-screen array | $600 |
| **Travel** | Travel to LACMA for installation, 2027 Symposium, 2028 Demo Day (3 trips) | $6,000 |
| | Accommodation for installation periods | $2,500 |
| **Collaborator Fees** | ML/computer vision consultant for image-based inference pipeline | $4,000 |
| | Installation/fabrication assistance | $2,000 |
| **Documentation** | Video documentation of installation and process | $1,500 |
| **Contingency** | Unforeseen costs, replacement hardware, additional API overages | $2,500 |
| | | |
| **TOTAL** | | **$50,000** |

---

### 12. Implementation Plan — Milestones, Dates, and Costs

| Phase | Timeline | Milestones | Cost |
|-------|----------|------------|------|
| **Phase 1: Foundation** | Fall 2026 (Months 1–4) | Upgrade ML pipeline to image-based production inference (currently metadata-only in production). Expand training dataset with additional Flickr scraping and LLM labeling. Validate model performance against human ratings (Pearson > 0.80 gate). Engage ML consultant. | $10,000 |
| **Phase 2: Expanded Installation** | Winter 2026–27 (Months 4–8) | Design and build multi-screen installation array (6–8 portrait monitors). Develop participatory rating station interface. Test installation at studio/local venue. Procure all hardware. | $12,000 |
| **Phase 3: Symposium Demo** | Spring 2027 (Months 8–12) | Install and demonstrate at LACMA 2027 Biennial Symposium. Present mid-term findings: model evolution, human vs. machine rating divergence data, participatory feedback analysis. Travel to LA. | $10,000 |
| **Phase 4: Refinement** | Summer–Fall 2027 (Months 12–18) | Incorporate symposium feedback. Train second-generation model on expanded dataset including gallery visitor ratings. Develop data visualizations showing human/AI rating convergence over time. Open-source ML pipeline release. | $8,000 |
| **Phase 5: Final Installation** | Winter–Spring 2028 (Months 18–24) | Full-scale installation for 2028 Demo Day. Final documentation. Published dataset and model weights. Process documentation for other artists working with ML aesthetics. Travel to LA. | $10,000 |

---

### Supporting Images

**[FILL IN — Include up to 5 images in JPEG format. Suggestions:]**

1. Screenshot of the live map/globe view showing the terminator ring and webcam markers
2. Screenshot of the sunrise and sunset mosaics side by side
3. Photo of the current dual-monitor Raspberry Pi installation (if assembled)
4. Diagram of the ML pipeline architecture (from the OPERATING_GUIDE.md)
5. Example mosaic showing tile-size variation driven by AI quality scores

---

---

## Project Analysis & Grant Fit Assessment

*The following section is a reference analysis of how this project aligns with
the LACMA Art + Technology Lab 2026 grant. It is not part of the formal
application.*

---

### What This Project Is

The Sunset Webcam Map is a planetary-scale, real-time portrait of sunrise and
sunset — the daily terminator line sweeping across Earth — constructed from
hundreds of public webcams. It operates at the intersection of several layers:

**Live Visualization Layer:** A Next.js application renders an interactive
Mapbox map (2D) and deck.gl globe (3D) showing the day/night terminator ring.
It queries the Windy webcam API every minute to find webcams near the
terminator, then displays their live feeds as markers on the map and as
geographically-sorted mosaic grids — one for sunrise, one for sunset —
composed of dozens of simultaneous webcam views arranged by geographic
position.

**Machine Perception Layer:** A full ML pipeline (PyTorch → ONNX) trains
computer vision models to evaluate "sunset quality" — essentially teaching a
machine to have aesthetic judgment about light and atmosphere. This is
augmented by a vision-LLM labeling system (Gemini/OpenAI) that rates webcam
images on quality, cloud formations, and other attributes, creating a feedback
loop between human ratings, AI ratings, and curated external imagery (scraped
from Flickr under CC licenses).

**Physical Installation Layer:** Dual-screen kiosk routes (`/kiosk/sunrise`,
`/kiosk/sunset`) are designed for a Raspberry Pi 4B driving two portrait-
oriented monitors — one showing the sunrise mosaic, one showing the sunset
mosaic. Tile size scales by AI-determined quality, so the machine's aesthetic
judgment literally shapes the visual composition of the installation.

**Archival / Participatory Layer:** A swipe-to-rate gallery lets humans score
archived snapshots, feeding back into the ML training loop. The system
captures and preserves "good" sunsets (gated by AI score thresholds) to
Firebase, building a growing archive of the Earth's daily light show.

---

### How This Maps to LACMA's Evaluation Criteria

#### 1. "Is the project artist-led and does it have artistic merit?"

This is fundamentally an artwork about shared planetary experience mediated
through networked cameras and machine perception. The terminator — the
boundary between day and night — is a universal, continuous phenomenon that
every human on Earth experiences daily but never sees in aggregate. By
assembling low-fidelity webcam feeds into mosaics, the project creates a kind
of collective landscape painting that paints itself — a portrait of the
Earth's daily rhythm as seen through the accidental infrastructure of
surveillance and tourism cameras. The dual-screen installation format (sunrise
and sunset facing each other) gives it a sculptural, contemplative presence.

#### 2. "Does the project explore emerging technology?"

Deeply. The project weaves together:

- **Computer vision / transfer learning** (ResNet18, MobileNetV3) to encode
  aesthetic judgment
- **Large language model vision APIs** (Gemini, GPT) as automated art
  critics / labelers
- **Real-time geospatial computation** (subsolar point calculations,
  terminator geometry)
- **Edge computing for art installations** (Raspberry Pi kiosk systems)
- The conceptual territory of **machines learning to see beauty** — training
  a model to distinguish a "good" sunset from a mediocre one is a
  fundamentally provocative act

#### 3. "Does the project suggest models, methods, and/or data that may be of interest to other artists and technologists?"

Yes — the entire codebase is on GitHub and produces shareable artifacts:

- **Open-source ML pipeline** for aesthetic image scoring
- **Webcam-to-mosaic rendering system** adaptable to other geospatial art
  projects
- **LLM-as-art-critic methodology** — using vision models to generate
  structured aesthetic ratings
- **Dataset of scored sunset/sunrise images** with both human and machine
  labels
- The **ONNX export pipeline** makes trained models portable to any runtime

#### 4. "Does the process include opportunities to present demos, prototypes, or collaborative opportunities for the public?"

The project is inherently public-facing and demo-ready:

- The **web application is live** — anyone can see the real-time terminator
  and webcams
- The **physical installation** (dual portrait monitors) is designed for
  gallery/public spaces
- The **swipe-to-rate gallery** is a participatory element — visitors could
  rate sunsets, directly feeding the ML model, creating a human-in-the-loop
  experience
- The 2027 Biennial Symposium and 2028 Demo Day align perfectly with
  iterating on the installation and ML model

#### 5. Additional Grant-Specific Strengths

- **"Safe-to-fail" prototyping:** The operating guide documents an
  experimental, iterative approach — the system has kill-switches
  (`SNAPSHOTS_ENABLED`), configurable thresholds, and experiment-tracking
  infrastructure. This matches the Lab's ethos exactly.
- **Publicly accessible / shareable:** The web app runs on Vercel, the code
  is on GitHub, models export to ONNX — everything is designed to be open.
- **"Beyond the gallery":** The project unfolds in virtual, online locations
  (the live web map), on physical installations (the Pi kiosk), and
  conceptually across the entire planet (every webcam near the terminator).
- **Anthropic as a sponsor:** The grant specifically names Anthropic as a
  partner organization. The project's use of LLMs for aesthetic judgment is
  directly relevant to their interests in AI perception and evaluation.
- **Historical resonance:** LACMA's original 1967 Art and Technology program
  paired artists like Robert Irwin and James Turrell with technologists —
  artists whose work was fundamentally about light and perception. This
  project is a direct conceptual descendant: Turrell's Roden Crater frames
  the sky; this project frames every sunset on Earth simultaneously through
  the lens of machine vision.

---

### Technical Architecture Reference

```
┌─────────────────────────────────────────────────────────┐
│                    DATA SOURCES                          │
│  Windy API  ·  Flickr (CC)  ·  LLM Vision (Gemini/GPT) │
└──────────────────────┬──────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │  Vercel Cron    │  Every 60 seconds:
              │  (update-windy) │  subsolar geometry → terminator ring
              └────────┬────────┘  → Windy API query → dedupe → DB upsert
                       │
              ┌────────▼────────┐
              │  Neon Postgres  │  webcams · terminator_webcam_state
              │                 │  webcam_snapshots · snapshot_ai_inferences
              └────────┬────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼────┐  ┌─────▼─────┐  ┌───▼────┐
    │ Web App │  │  Kiosk    │  │  ML    │
    │ Map +   │  │  Pi +     │  │ Train  │
    │ Globe + │  │  2x 27"   │  │ Loop   │
    │ Mosaic  │  │  Portrait │  │(PyTorch│
    │ Swipe   │  │  Monitors │  │→ ONNX) │
    └─────────┘  └───────────┘  └────────┘
```

### Key Technologies

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind 4, Zustand, SWR |
| Visualization | Mapbox GL JS, deck.gl (globe), HTML5 Canvas (mosaics) |
| Backend | Next.js Route Handlers, Vercel Cron |
| Database | Neon Postgres |
| Storage | Firebase Storage |
| ML Training | Python 3, PyTorch, torchvision, ONNX |
| ML Labeling | Google Gemini, OpenAI GPT (vision APIs) |
| Installation | Raspberry Pi 4B, Chromium kiosk, Tailscale |
| Astronomy | solar-calculator, suncalc |

---

### About the LACMA Art + Technology Lab

The Art + Technology Lab at LACMA was originally established in 1967, pairing
artists like Robert Irwin, James Turrell, Claes Oldenburg, and Andy Warhol
with major technology corporations. The program was reintroduced in 2013 as a
"safe-to-fail" rapid prototyping environment. The 2026 cycle — presented by
Hyundai Motor Company with support from Snap Inc. and Anthropic — will award
3–5 grants of up to $50,000 each over a two-year period, with a Biennial
Symposium in 2027 and Demo Day in 2028.

[LACMA Art + Tech Lab Grant Page](https://www.lacma.org/art/lab/grants)
