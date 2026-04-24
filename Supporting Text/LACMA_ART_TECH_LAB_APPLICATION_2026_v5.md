# LACMA Art + Technology Lab — 2026 Grant Application (v5 — Budget Rebalance)

**Application Deadline:** April 22, 2026, 11:59 PM Pacific
**Principal Applicant:** Jesse Kauppila
**Co-applicant:** Kameron Decker Harris
**Project:** *Sunrise / Sunset*
**Planned URL:** [sunrisesunset.studio](https://sunrisesunset.studio)
**Repository:** [github.com/jessekauppila/the-sunset-webcam-map](https://github.com/jessekauppila/the-sunset-webcam-map)

> **Changelog from v4:** Budget rebalance. GPU workstation, documentation, and fabrication assistance lines removed. Software & Services expanded to cover both people (per-user subscriptions where applicable); Jesse's Anthropic Claude subscription bumped to the $200/mo Max tier for algorithm-training and Claude-Code pipeline work, Kameron's at the $100/mo tier. Anthropic Claude added to the vision-API labeling-pipeline line (alongside OpenAI and Google Gemini). Travel doubled to cover both Jesse and Kameron to the 2027 Symposium and 2028 Demo Day. Principal fees reduced (Jesse $17k → $12k; Kameron $11k → $8k, still = 2/3 of Jesse) to fund the webcam network more substantially and absorb the new per-person costs. §1–§10 and §12 unchanged from v4.
>
> **Changelog from v3 (v2 docx):** Research reframe of §1/§2/§3 (name, three words, one-sentence). New "challenge closing" paragraph in §4 reframing the money ask around a specific research gap. ESP32 experimental line added to §4 and §11. Modular/punk-rock display approach added to §4 and §8. Exhibition displays removed entirely (venue-sourced or participant-phone). §6 and §7 left intact.

---

## 1. Name of Your Project

**Sunrise / Sunset: A Distributed Observatory and Neural Network for the Planet's Day/Night Edge**

---

## 2. Three Words

**Sunrise. Sunset. Observed.**

---

## 3. One-Sentence Description

An artist-led research project that builds a planetary network of webcams to observe sunrises and sunsets as they travel around the world, and trains a neural network to distinguish the beautiful from the ordinary.

---

## 4. Full Description of the Proposed Project

In a cultural moment defined by AI-generated imagery and AI-waged warfare, we've become divorced from the beauty of the real world. This project inverts that: it uses AI to find real sunrises and sunsets happening right now, somewhere on Earth — not to generate imaginary ones.

*Sunrise / Sunset* is an artist-led research project — a distributed planetary observatory with four layers: a webcam network, a web application, a neural-network model, and a modular gallery installation. Together they locate webcams currently showing sunrises and sunsets, rank them, and display them.

The work takes inspiration from Christian Marclay's *The Clock* and Janet Cardiff's *Forty-Part Motet* — sublime wholes composed of many simultaneous parts. It gestures at the idea that there is always beauty somewhere in the world.

The web application queries webcam APIs and uses subsolar-point geometry to locate cameras near the terminator — where day turns into night. It is the hub for browsing, rating, and navigating the archive.

I'm also building small, custom edge-computing cameras from Raspberry Pi Zeros — better sunrise/sunset coverage than commercial APIs. They can be tuned remotely, streaming only when a good sunset is developing. We're also evaluating ESP32-class microcontrollers as a cheaper, lower-power alternative for remote solar/cellular deployments.

The machine-perception layer, guided by Prof. Harris, trains transfer-learning classifiers (PyTorch, ResNet18 / MobileNetV3, exported to ONNX) on a continuous 0.0–1.0 aesthetic scale. The pipeline combines our own ratings with structured labels from vision-language models (Anthropic Claude, Google Gemini, OpenAI GPT) and Creative Commons sunset photography from Flickr; LLM labels must clear a Pearson > 0.80 gate against ours before entering training. Harris's prior work on random-feature networks with V1-like tuning for image recognition informs the architecture. The AI's scores shape the installation: higher-rated tiles render larger in the mosaic, so machine aesthetic judgment becomes visible as form.

The installation is intentionally modular: a ring of screens with the viewer at the center of the planet's day/night edge. Venues source their own monitors; in informal settings, the ring is assembled from volunteers each holding a phone running one feed. The research instrument is fixed; the display is found.

This grant closes a specific gap. The system works, but the current network only surfaces a few hundred candidates at any moment, most from cameras built for other purposes: traffic cams, surf cams, parking lots. To reliably show a fantastic sunrise or sunset, two things must improve: more cameras placed and tuned for this purpose, and a better algorithm for finding the good ones in a noisy pool. This grant funds that work.

The project sits at the intersection of landscape art, network culture, found photography, and machine-learning research. It connects to LACMA's 1967 Art and Technology legacy of light and perception at planetary scale.

I also think it would be wonderful to stand at the center of a ring of sunrises and sunsets — feeling the turning of the world, sunsets changing quickly at the equator and slowly at the poles. Who doesn't love a sunset?

---

## 5. Biography

*(unchanged from v2/v3 — 283 words, no cap)*

Jesse Kauppila is an artist and engineer based in Bellingham, WA. During an MFA at Carnegie Mellon University, I learned to program robotic arms for an art project, and I used that skill to begin a new career path — one that led to fabricating work for Anish Kapoor and Charles Ray, then to aerospace at Joby Aviation (the electric air-taxi company), and, more recently, to building AI data centers for big tech.

I am now returning to my art practice, applying what I have learned in the tech world to projects like this one. Financial security has given me the room to clarify my values and focus on making work I genuinely believe in. For this project I am collaborating with Kameron Decker Harris, a computational scientist at Western Washington University, who leads the machine-learning architecture.

Outside of studio and professional work, I ski, climb, bike, and run in the mountains of the Pacific Northwest. My relationship with nature informs my interest in using technology to cultivate a deeper connection to the world we all live in.

Kameron Decker Harris is a computational scientist and applied mathematician at Western Washington University whose research focuses on networked dynamical systems — both biological and artificial neural networks. His work sits at the intersection of machine learning, dynamical systems, graph theory, and statistical inference. Prior collaborations with the Allen Institute for Brain Science advanced whole-brain connectivity inference from viral-tracing experiments, and he has published on sparsity-driven learning in biologically-inspired random-feature networks (including work showing V1-like tuning properties improving image recognition). For *Sunrise / Sunset*, Kameron leads the machine-learning architecture and training strategy, and collaborates on interpreting the human–machine aesthetic gap that the project makes explicit.

---

## 6. Artistic / Creative Merit

*(unchanged from v2 — 95 / 100 words)*

*Sunrise / Sunset* points machine perception at actual sunrises and sunsets currently happening on Earth — not at machine-generated imaginings of them. It amplifies a universally shared aesthetic experience by combining dozens of simultaneous real views — drawn from public webcams and custom cameras of our own — into a single planetary portrait, curated by an AI trained to recognize which sunsets to highlight. The work proposes that the most interesting artistic use of AI may not be generation but attention: directing machine vision toward the sublime that already exists, continuously, in the real world.

---

## 7. Dialogue Between Technology and Culture

*(unchanged from v2 — 97 / 100 words)*

We are in a cultural moment defined by AI-generated imagery and AI that wages war. These algorithms strip the world of its beauty, texture, and context. This project seeks to invert that relationship. Instead of asking a machine to imagine a sunset, it asks a machine to recognize the real ones happening right now, somewhere on Earth. It proposes that the most interesting artistic use of machine perception may not be generation but attention — directing the machine's gaze toward the sublime that already exists, continuously, in the literal world. A tool for noticing rather than inventing.

---

## 8. Public Engagement Plan

*(target: ≤ 100 words — estimated ~88)*

The web app is live (moving to sunrisesunset.studio). Six public touchpoints:

- The live web app and a "dating app for sunsets" rating site, where anyone rates sunsets alongside the AI.
- Pop-up "phone ring" events — participants bring phones, each streams one live feed; a Cardiff-style ring from what's already in pockets.
- A two-screen exhibit at Canopy Art & Iron (Bow, WA).
- Mid-term demo at the 2027 LACMA Biennial Symposium.
- Open-source release of the ML pipeline, model, and archive.
- A Kickstarter campaign for the edge cameras — funding plus distributed participation.

---

## 9. Other Funding Sources and In-Kind Support

*(unchanged from v2)*

To date, Jesse and Kameron have jointly self-funded this project at approximately $1,500 — covering web hosting, installation and display hardware, early webcam prototyping, and AI/software subscriptions and API tokens.

**Potential partnerships to pursue during the grant period:**

- **Windy.com** — commercial webcam API access; a partnership or sponsored data-access agreement is a stronger fit than a paid subscription.
- **Other webcam networks** — EarthCam, Skyline Webcams, AlpineWebcams, university and national-park live-feed programs, open-source webcam projects.
- **Snap Inc. and Anthropic** (LACMA Lab partner companies) — overlaps with their LLM-vision and real-time geospatial-media interests.

**Potential follow-up funding:**

- A Kickstarter campaign for the custom edge-computing cameras.
- Possible retail sales through LACMA's gift shop or similar cultural-institution channels.

No other funding is currently committed.

---

## 10. Total Amount Requested

**$50,000**

---

## 11. Detailed Project Budget

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
|  | Mapbox GL JS (free tier covers expected usage; overage from contingency) | $0 |
|  | Domain + SSL (sunrisesunset.studio, 2 yrs) | $100 |
|  | *(subtotal: $10,340)* |  |
| Contingency | Replacement hardware, API overages, shipping | $660 |
| **TOTAL** |  | **$50,000** |

### Budget notes

**Principal fees structured at a 3:2 ratio.** Jesse at $12,000 and Kameron at $8,000 (exactly ⅔ of the principal fee) reflect the division of labor: Jesse leads the project, builds the cameras, the web app, and the installation; Kameron leads the ML architecture, training strategy, and model evaluation. The fees are modest — roughly $500 and $333 per month respectively across 24 months — because we've deliberately shifted budget toward the research instrument (the webcam network) and toward covering both people's participation across the grant's subscription and travel obligations.

**Webcam Prototyping ($7,500) funds a dual track.** The bulk (~30 Raspberry Pi Zero 2 W units, the main deployment platform) is complemented by a smaller ESP32-based experimental run. ESP32 units cost roughly 1/10 of a Pi, which lets us test whether the network can extend cheaply into harder-to-reach locations — particularly where solar power and cellular are the only options. Custom PCB design ($2,500 for two iterations, one Pi carrier and one ESP32 carrier) and enclosure work ($1,000) produce the hardware artifact that could later be offered as a Kickstarter reward. The webcam line is sized close to Kameron's fee because the network and the algorithm are the two primary research instruments the grant funds.

**Software & Services ($10,340) covers both people.** Per-user subscriptions (Anthropic Claude, Cursor Pro) are budgeted for both Jesse and Kameron. Shared project infrastructure (Vercel, Neon Postgres, Mapbox, domain) is single-license. Jesse's Anthropic Claude subscription is budgeted at the $200/mo Max tier to support algorithm-training and Claude-Code-assisted pipeline development; Kameron's at $100/mo. The vision-API line ($1,000) covers runtime labeling calls to Anthropic Claude, OpenAI, and Google Gemini as part of the LLM-driven data-labeling pipeline — separate from the subscription costs and drawn on programmatically per training batch.

**Travel ($11,500) covers both Jesse and Kameron.** Two round trips each to the 2027 LACMA Biennial Symposium and the 2028 Demo Day, plus a local drive to the Canopy Art & Iron rendezvous in Bow, WA. Having both the principal artist and the ML co-lead present at the Symposium and Demo Day matters: the project's public-facing story is the collaboration between artistic and computational practice, and the Q&A moments at these events are where that collaboration is most legible.

**What's NOT in the budget.** We don't buy monitors, stands, wiring, or kiosk machines — venues source their own displays for formal installations, and informal installations use found screens and participant phones. We also don't budget a GPU workstation — training runs that need a GPU will use cloud credits drawn from the vision-API / Anthropic subscription lines. No documentation line: video and photo documentation will be captured alongside the existing project work rather than as a separate paid deliverable. The grant funds the research instrument (the webcam network and the algorithm), the people doing the research (Jesse and Kameron), and the subscriptions that enable their work — not the display surface, not dedicated compute, not production crews. This cost discipline aligns with the project's "real, not generated" ethic: the display is as found as the sunsets.

---

## 12. Implementation Plan

| Phase | Timeline | Cost |
|---|---|---|
| **1. Foundation + Webcam v1** — formalize co-lead agreement with Kameron, kick off ML architecture; upgrade ML pipeline to image-based inference; expand training dataset; validate against human ratings (Pearson > 0.80 gate); begin outreach to Windy / EarthCam; build first 5–10 Pi Zero 2 W cameras and first ESP32 prototypes; identify NA deployment partners. | Fall 2026 (Months 1–4) | $11,000 |
| **2. Modular Install Development + NA Webcam Rollout** — refine the modular installation approach (venue-sourced monitor mix + participant phone-ring protocol); develop the public rating app; iterate webcam hardware (custom PCB, weatherproof enclosure, remote-tuning firmware, ESP32 field tests); deploy 8–10 cameras across North American locations; exhibit the two-screen diptych at Canopy Art & Iron's annual rendezvous (Bow, WA). | Winter 2026–27 (Months 4–8) | $13,000 |
| **3. LACMA Symposium Demo** — install and demonstrate at the 2027 Biennial Symposium (venue-sourced monitors + phone-ring demo); present mid-term findings (model evolution, human–machine rating divergence, pilot-webcam data, Canopy exhibit reflections); travel Bellingham → LA. | Spring 2027 (Months 8–12) | $9,000 |
| **4. Refinement + Kickstarter Prep + Global Network** — incorporate symposium feedback; train second-generation model on expanded dataset (gallery ratings + rating-app data + pilot imagery); finalize Kickstarter-ready camera and campaign; distribute cameras internationally; open-source release of ML pipeline. | Summer–Fall 2027 (Months 12–18) | $8,000 |
| **5. Final Installation + 2028 Demo Day** — full-scale modular installation for 2028 Demo Day (venue-sourced monitor ring + phone-ring public event); final documentation; published dataset, model weights, camera hardware plans; travel Bellingham → LA. | Winter–Spring 2028 (Months 18–24) | $9,000 |

---

## Word count summary

| Section | Cap | v4 count | Status |
|---|---|---|---|
| §4 Full Description | 500 | 499 | ⚠️ 1-word buffer — tight; re-check if any edits lengthen the section |
| §6 Artistic Merit | 100 | 95 (unchanged) | ✅ |
| §7 Dialogue | 100 | 97 (unchanged) | ✅ |
| §8 Public Engagement | 100 | 96 | ✅ |
| §5 Bio | no cap | 283 | — |

**Open items / things to decide before submission:**

1. **Confirm project name pick** — current: "A Distributed Observatory and Neural Network for the Planet's Day/Night Edge." If this lands as too dry, the alt "A Neural Network Learning to See Beauty at the Planet's Day/Night Edge" keeps the research bones but warms the voice.
2. **§6 and §7 left intact** — if you want those reframed toward research ("produces models, methods, data of interest to other artists/technologists"), flag and I'll pass on them.
3. **§5 Bio** — unchanged. A light research-framing touch (e.g., "this artist-led research practice") could be added to Jesse's paragraph if you want it.
4. **Anthropic Max tier assignment** — currently Jesse at $200/mo, Kameron at $100/mo. If you'd prefer Kameron on the Max tier (since he leads algorithm training), it's a simple label swap — same dollar total.
5. **Principal fees are modest** — Jesse at $500/mo, Kameron at $333/mo across 24 months. This is the consequence of funneling budget into the webcam network, doubled subscriptions, and 2-person travel. If the principal fees feel too low on paper, levers to raise them: (a) scale back one person's travel, (b) drop Cursor Pro for one person, (c) remove the $1,000 vision-API line and rely entirely on subscription coverage for labeling.
6. **Budget hierarchy** — your stated priority ordering was Jesse > Kameron > Webcams > Travel > Anthropic. Actual dollar ordering in v5: Jesse ($12,000) > Travel ($11,500) > Software ($10,340) > Kameron ($8,000) > Webcams ($7,500). Travel and Software exceed Kameron/Webcams in dollar terms because they scale with 2 people × 24 months; the spirit of your hierarchy (principals + research instrument as primary investments) is preserved in the budget-notes framing.
7. **§9 not updated** — still references self-funding and partnership pipeline. Worth a quick read to see if any wording has shifted since v2.
8. **§12 Implementation Plan phase allocations ($11k / $13k / $9k / $8k / $9k)** — these are from v2 and still sum to $50,000. Could be re-derived from the v5 line structure (more heavily loaded toward travel phases, for instance), but the narrative-level split still reads sensibly.

---

*v5 — budget rebalance. Generated 2026-04-22.*
