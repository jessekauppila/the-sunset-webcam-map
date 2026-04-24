# LACMA Art + Technology Lab — 2026 Grant Application

**Application Deadline:** April 22, 2026, 11:59 PM PST
**Applicant:** Jesse Kauppila
**Project:** *Sunrisesunset.ai*
**Planned URL:** [sunrisesunset.ai](https://sunrisesunset.ai)
**Current Live URL:** [FILL IN: current Vercel URL]
**Repository:** [the-sunset-webcam-map](https://github.com/jessekauppila/the-sunset-webcam-map)

---

## 1. Name of Your Project

**Sunrisesunset.ai**

*(A Live Planetary Portrait of the Golden Hour)*

---

## 2. Three Words

**Sunrise. Sunset. AI.**

---

## 3. One-Sentence Description

A real-time planetary artwork that points machine perception at actual sunrises and sunsets happening right now on Earth — rather than asking a machine to generate imaginary ones — using public webcams, custom edge cameras, and an AI trained to recognize beauty in the literal world.

---

## 4. Full Description of the Proposed Project

In a cultural moment dominated by AI-generated imagery — machines producing plausible sunsets on demand, with no referent in the world — this project inverts the relationship: it uses machine perception to find *real* sunrises and sunsets happening right now, somewhere on Earth.

*Sunrisesunset.ai* operates across five interconnected layers — a live web application, custom webcams, an online archive, a machine learning pipeline, and a gallery installation — that together locate the webcams currently showing a sunrise or sunset (public and custom-built), archive their feeds, and train an AI to find the most beautiful one happening right now.

The project is inspired by Christian Marclay's *The Clock* and Janet Cardiff's *Forty-Part Motet* — overarching, sublime works composed of many simultaneous parts. I hope to touch something beyond any individual sunrise — the idea, corny as it sounds, that there is always beauty somewhere, because a sunrise or sunset is always happening somewhere.

The web application queries webcam APIs every 60 seconds and uses astronomical calculations (subsolar point geometry) to locate cameras near the terminator — the zone where day turns into night. The feeds are rendered as two continuously updating grids of sunrises and sunsets, composed of dozens of simultaneous views arranged by geographic position.

I'm also building small, custom edge-computing cameras from Raspberry Pi Zeros for sunrise/sunset coverage better than commercial APIs offer. They can be tuned remotely — streaming only when a sunset worth capturing is developing. In a second life, these cameras could be offered as a Kickstarter object, funding the project and distributing its sensor network into the hands of participants.

The machine perception layer trains computer vision models on a continuous 0.0–1.0 aesthetic scale — encoding judgment about light, atmosphere, and landscape into a neural network. The pipeline combines my personal ratings with structured assessments from vision-language models, supplemented by Creative Commons sunset photography scraped from the web. The AI's quality scores shape the composition: higher-rated tiles render larger in the mosaic, so machine aesthetic judgment becomes visible as form.

The current installation is a diptych of two portrait monitors displaying live grids of sunrise and sunset mosaics. I'm working toward a circular installation of inward-facing monitors, showing all the current sunrises and sunsets along the terminator — positioning the viewer at the center of the planet's day/night boundary.

With LACMA's support, I propose to expand this work in four directions: (1) scale the installation into the full ring; (2) expand the sensor network through partnerships with commercial, educational, and open-source webcam providers, and by designing and deploying bespoke edge cameras; (3) deepen the ML pipeline toward real-time image-based inference; (4) build a public rating app — a kind of dating app for sunsets — where anyone online can rate them alongside the AI, making visible the gap between human and machine perception of beauty.

The project sits at the intersection of landscape art, network culture, found photography/video, and AI — asking what happens when we use the planet's accidental visual infrastructure (tourism and surveillance cameras) to construct a collective portrait of our daily experience of beauty at dawn and dusk. It connects to LACMA's 1967 Art and Technology legacy of light and perception at planetary scale.

---

## 5. Bio

Jesse Kauppila is an artist based in Bellingham, WA whose practice explores networked media, machine perception, and collective attention to the natural world. He holds an MFA from Carnegie Mellon University (2013–2016) and a BA from Reed College (2004–2007). Early in his artistic career he worked for photographer Catherine Wagner and as a fabricator on projects for Anish Kapoor and Charles Ray — two of the most technically ambitious artists working today. He also co-developed an interactive water exhibit for the Pittsburgh Children's Museum, combining custom electronics, CNC-machined polycarbonate, Arduino control systems, and welded steel — an early foray into public interactive work at scale.

For roughly a decade between that early period and this project, Jesse stepped away from exhibition-making and went inside the technologies now reshaping artistic practice. He worked as a robot programmer and robotic design engineer (Performance Structures, 2017–2018; Quarra Stone, 2017–2018; VFX Foam, 2018–2019), writing simulations and toolpaths for KUKA and ABB industrial robots fabricating stone, foam, and mirror-polished stainless steel. At Joby Aviation (2019–2024) he worked at the intersection of aerospace composites and software, bringing an additive-manufacturing robotic process from R&D into production and building internal web UIs and real-time dashboards used daily by manufacturing teams. More recently he built a map-based weather and avalanche-forecasting platform for the Northwest Avalanche Center (2024–2025) that is used daily by professional forecasters, and he is currently developing customer-facing UI for an AI talent-matching platform at Vetta AI (2025–present).

He thinks of that decade not as a departure from art but as research conducted from the inside — an extended, material encounter with the technologies now shaping the art of this moment. His return to artistic practice is a synthesis. *Sunrisesunset.ai* is buildable precisely because he spent those ten years building the kinds of systems that compose it: industrial robots, networked hardware in the field, production-grade data platforms, and modern web and ML infrastructure. The project is the point at which those years of industry research fold back into the questions that have animated his art practice from the beginning — perception, beauty, collective experience, and what it means to pay attention to the world.

Outside of studio and professional work, Jesse received a North Face / American Alpine Club "Live Your Dream" Grant (2022) and volunteers with Bellingham Mountain Rescue and the Bellingham Mountaineers (2021–2025). That close, embodied relationship with the Pacific Northwest landscape — its light, weather, and atmospheric conditions — directly informs the attention to atmosphere at the heart of this project.

---

## 6. Artistic or Creative Merit

*Sunrisesunset.ai* points machine perception at actual sunrises and sunsets currently happening on Earth — not at generated imaginings of them. It amplifies a universally shared aesthetic experience by combining dozens of simultaneous real views, drawn from public webcams and custom cameras of my own, into a single planetary portrait. An AI trained to judge beauty in sunsets visibly shapes the composition, so the machine's aesthetic decisions become form. The work proposes that the most interesting artistic use of AI may not be generation but attention: directing machine vision toward the sublime that already exists, continuously, in the literal world.

---

## 7. Dialogue Between Technology and Culture

We're in a cultural moment defined by AI-generated imagery — and by AI fighting wars on our behalf. Machines synthesize plausible beauty while destroying the actual beauty of the natural world. This project inverts that relationship. Instead of asking a machine to imagine a sunset, it asks a machine to recognize the real one happening right now, somewhere on Earth. It proposes that the most interesting artistic use of machine perception may not be generation but attention — directing the machine's gaze toward the sublime that already exists, continuously, in the literal world. A tool for noticing rather than inventing.

---

## 8. Public Engagement Plan

The web application is already live (moving to `sunrisesunset.ai` during the grant), offering global access to the terminator map and mosaics. The installation is portable and gallery-ready. I envision five touchpoints: (1) the live web app plus a rating site — a "dating app for sunsets" — where anyone online can rate sunsets alongside the AI, feeding it in real time; (2) an early two-screen exhibit at Canopy Art & Iron (Bow, WA); (3) a mid-term demo at the 2027 LACMA Biennial Symposium; (4) an open-source release of the ML pipeline, model, and archive; (5) a Kickstarter for the custom edge cameras — funding plus distributed participation.

---

## 9. Other Funding Sources and In-Kind Support

To date, I've personally self-funded this project at approximately $1,500 — covering web hosting, installation and display hardware, early webcam prototyping, and AI/software subscriptions and API tokens.

**In-kind consulting support:**

- **Prof. Kam Harris** — advising on neural network architecture and training strategy on an informal, in-kind basis. (A small honorarium may be arranged separately outside this grant.)

**Potential partnerships to pursue during the grant period** *(no formal commitments at time of application):*

- **Windy.com** — commercial webcam API access; a partnership or sponsored data-access agreement is a stronger fit for this project than a paid subscription, and I would pursue one during the grant period.
- **Other webcam networks and providers** — potential partnerships with EarthCam, Skyline Webcams, AlpineWebcams, university and national park live-feed programs, and open-source webcam projects to expand the sensor network beyond any single commercial API.
- **Snap Inc.** and **Anthropic** (LACMA Lab partner companies) — the project's use of LLM vision and real-time geospatial media overlaps with their technical interests; mentorship or in-kind API access are natural collaboration paths.

**Potential follow-on funding:**

- A **Kickstarter campaign** for the custom edge-computing cameras — simultaneously funding continued development and distributing the sensor network into the hands of backers.
- Possible retail sales of the cameras through **LACMA's gift shop** or similar cultural-institution channels.

No other funding is currently committed.

---

## 10. Total Amount Requested

**$50,000**

---

## 11. Detailed Project Budget

| Category | Item | Cost |
|----------|------|------|
| **Artist Fees** | Artist time — research, development, installation, documentation (24 months) | $17,000 |
| **Custom Webcam Prototyping** *(North America pilot — reference model for future global rollout)* | 30× Raspberry Pi Zero 2 W units (~$25 ea) | $750 |
| | 30× Camera modules (wide-angle + standard) (~$20 ea) | $600 |
| | 30× MicroSD cards, high-endurance 16–32 GB (~$12 ea) | $360 |
| | 30× Power supplies and cables (~$10 ea) | $300 |
| | 30× Weatherproof enclosures (~$15 ea) | $450 |
| | Custom PCB design + small-run fabrication (Kickstarter-ready) | $1,500 |
| | Enclosure design, 3D printing, prototyping iterations | $1,000 |
| | Cellular / LTE modems for remote-deployment units (5–10 units) | $500 |
| | Shipping to North American deployment partners, tools, spare parts | $540 |
| | *Webcam subtotal (30 units for NA pilot)* | *$6,000* |
| **Installation Hardware** | 4–6 additional 27" portrait monitors for ring installation | $2,700 |
| | Additional Raspberry Pi 4B units, cases, SD cards, HDMI cables | $800 |
| | Dedicated GPU workstation or equivalent cloud GPU credits (ML training) | $2,500 |
| **Software & Services** | Anthropic Claude subscription ($100/mo × 24 months) | $2,400 |
| | Vercel Pro ($20/mo × 24 months) | $480 |
| | Cursor Pro ($20/mo × 24 months) | $480 |
| | Neon Postgres (24 months, estimated) | $600 |
| | Mapbox GL JS — *free tier covers expected usage (50,000 monthly map loads); overage, if any, from contingency* | $0 |
| | OpenAI + Google Gemini vision API calls (LLM labeling pipeline) | $1,000 |
| | Domain registration + SSL (`sunrisesunset.ai`, 2 years) | $100 |
| **Installation Materials** | Monitor stands/mounts for portrait and ring configuration | $1,500 |
| | Wiring, cable management, power distribution for multi-screen array | $500 |
| **Travel** *(Bellingham, WA → Los Angeles — staying in LA for each event)* | **2027 Biennial Symposium trip** — airfare (BLI/SEA↔LAX), 6 nights LA lodging, ground transport, meals, hardware shipping | $2,700 |
| | **2028 Biennial Demo Day trip** — airfare, 8 nights LA lodging, ground transport, meals, ring-installation hardware shipping | $3,400 |
| | **Canopy Art & Iron** exhibit (Bow, WA — local drive from Bellingham) — fuel, supplies, install day | $300 |
| **Collaborator Fees** | ML / computer vision consultant — image-based inference pipeline | $2,000 |
| | Installation / fabrication assistance | $2,000 |
| **Documentation** | Video + photo documentation of installation and process | $1,500 |
| **Contingency** | Unforeseen costs, replacement hardware, API overages (incl. any Mapbox / Firebase overages), shipping corrections | $2,040 |
| | | |
| **TOTAL** | | **$50,000** |

**Budget notes:**

- Windy API has been moved to Section 9 as a partnership to pursue rather than a paid budget line — commercial API fees at $10K are a weak use of grant funds when a partnership might yield the same access for free.
- The 30 Pi Zero webcams fund a ~10-zone North American pilot (three cameras per zone for redundancy). Success in North America becomes the proof-of-concept for a later globally-distributed rollout funded by Kickstarter or follow-on grants.
- Mapbox is listed at $0 because Mapbox GL JS provides 50,000 free map loads per month — sufficient for expected grant-period traffic. Any overage flows from contingency at $5 per additional 1,000 loads.
- Firebase Storage is not a dedicated line item; the image archive operates within Firebase's free/low tiers, and any overage is covered by contingency.
- If any subscription lines come in lower (e.g., Anthropic offers credits through the LACMA partnership), the surplus flows into artist fees or additional webcam units for the pilot.

---

## 12. Implementation Plan — Milestones, Dates, and Costs

| Phase | Timeline | Milestones | Cost |
|-------|----------|------------|------|
| **Phase 1: Foundation + Webcam v1** | Fall 2026 (Months 1–4) | Upgrade ML pipeline to image-based production inference. Expand training dataset. Validate model performance against human ratings (Pearson > 0.80 gate). Engage ML consultant; formalize in-kind advisory relationship with Prof. Kam Harris. Initiate outreach to Windy, EarthCam, and other webcam providers regarding partnership/data access. Design and build first batch of 5–10 custom Pi Zero 2 W cameras and identify North American deployment partners (universities, parks, independent camera hosts). Register `sunrisesunset.ai` domain and transition the live site. | $11,000 |
| **Phase 2: Ring Development + Canopy Diptych + NA Webcam Rollout** | Winter 2026–27 (Months 4–8) | Design and begin building the ring-monitor installation (6–8 portrait monitors). Develop the public rating app ("dating app for sunsets"). Iterate webcam hardware: custom PCB, weatherproof enclosure, remote-tuning firmware. Deploy remaining pilot webcam units across 8–10 North American locations (coastal, mountain, desert, Pacific Northwest) — this pilot serves as the reference model for a later worldwide rollout. Exhibit the existing two-screen diptych — the sunrise/sunset pair — at [Canopy Art & Iron](https://www.canopyartandiron.com/)'s annual rendezvous (Bow, WA). The diptych is more portable than the ring and is already the current working form of the installation, making Canopy's annual event a natural, local venue for an early public showing before the LACMA symposium. Canopy's "rooted in a sense of place" ethos complements the geographic, terminator-driven nature of the work. Gather audience response and document for LACMA. | $13,000 |
| **Phase 3: LACMA Symposium Demo** | Spring 2027 (Months 8–12) | Install and demonstrate at LACMA 2027 Biennial Symposium. Present mid-term findings: model evolution, human vs. machine rating divergence, pilot-webcam data from deployed North American nodes, and reflections from the Canopy exhibit. Travel from Bellingham to LA. | $9,000 |
| **Phase 4: Refinement + Kickstarter Prep + Global Network** | Summer–Fall 2027 (Months 12–18) | Incorporate symposium feedback. Train second-generation model on expanded dataset (gallery-visitor ratings + rating-app data + pilot-webcam imagery). Finalize Kickstarter-ready camera design and campaign materials, using the NA pilot as a proven reference model. Use Kickstarter to fund/distribute additional cameras internationally. Open-source release of the ML pipeline. | $8,000 |
| **Phase 5: Final Installation + 2028 Demo Day** | Winter–Spring 2028 (Months 18–24) | Full-scale ring-monitor installation for 2028 Demo Day. Final documentation. Published dataset, model weights, and camera hardware plans. Travel from Bellingham to LA. | $9,000 |

---

## Supporting Images

*[To be embedded as JPEGs in the final submission document]*

1. Screenshot of the live map/globe view showing the terminator and webcam markers
2. Screenshot of the sunrise and sunset mosaics side by side (the current two-screen diptych)
3. Rendering or mockup of the ring-monitor installation with a viewer at the center
4. Photograph of an early Raspberry Pi Zero webcam prototype
5. Diagram of the ML pipeline architecture, or an example mosaic showing tile-size variation driven by AI quality scores

---
