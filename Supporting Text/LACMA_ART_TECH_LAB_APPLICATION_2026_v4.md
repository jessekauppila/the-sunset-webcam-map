# LACMA Art + Technology Lab — 2026 Grant Application (v4 — Research Reframe)

**Application Deadline:** April 22, 2026, 11:59 PM Pacific
**Principal Applicant:** Jesse Kauppila
**Co-applicant:** Kameron Decker Harris
**Project:** _Sunrise / Sunset_
**Planned URL:** [sunrisesunset.studio](https://sunrisesunset.studio)
**Repository:** [github.com/jessekauppila/the-sunset-webcam-map](https://github.com/jessekauppila/the-sunset-webcam-map)

> **Changelog from v3 (v2 docx):** Research reframe of §1/§2/§3 (name, three words, one-sentence). New "challenge closing" paragraph in §4 reframing the money ask around a specific research gap. ESP32 experimental line added to §4 and §11. Modular/punk-rock display approach added to §4 and §8. Budget rebalanced: monitors, stands, wiring, and Pi 4B kiosk removed entirely (venue-sourced or participant-phone displays); Kameron co-lead fee increased to $11,000 (≈ 2/3 of Jesse). §6 and §7 left intact.

---

## 1. Name of Your Project

**Sunrise / Sunset: A Distributed Observatory and Neural Network for the Planet's Day/Night Edge**

---

## 2. Three Words

**Sunrise. Sunset. Observed.**

---

## 3. One-Sentence Description

An artist-led research project that builds a planetary network of webcams to observe, archive, and analyze sunrises and sunsets as they travel around the world.

---

## 4. Full Description of the Proposed Project

In a cultural moment defined by AI-generated imagery and AI-waged warfare, we've become divorced from reality and the beauty that already exists in the real world. This project inverts that: it uses AI to find real sunrises and sunsets happening right now, somewhere on Earth — not to generate imaginary ones.

_Sunrise / Sunset_ is an artist-led research project — a distributed planetary observatory with four layers: a webcam network, a web application, a neural-network model, and a modular gallery installation. Together they locate webcams currently showing sunrises and sunsets, rank them, and display them.

The work takes inspiration from Christian Marclay's _The Clock_ and Janet Cardiff's _Forty-Part Motet_ — sublime wholes composed of many simultaneous parts. It gestures at something beyond any single sunrise: the idea that there is always beauty somewhere in the world.

The web application queries webcam APIs and uses subsolar-point geometry to locate cameras near the terminator — where day turns into night. It is the hub for browsing, rating, and navigating the archive.

I'm also building small, custom edge-computing cameras from Raspberry Pi Zeros — better sunrise and sunset coverage than commercial APIs. They can be tuned remotely, streaming only when a good sunset is developing. We're also evaluating ESP32-class microcontrollers as a cheaper, lower-power alternative, extending the network into remote locations where solar and cellular are the only options.

The machine-perception layer, led by Kameron, trains models on a continuous 0.0–1.0 aesthetic scale, encoding judgment about light, atmosphere, and landscape. The pipeline combines my own ratings with vision-language-model assessments and Creative Commons sunset photography. The AI's scores shape the installation: higher-rated tiles render larger in the mosaic, so machine aesthetic judgment becomes visible as form.

The installation is intentionally modular: a ring of screens with the viewer at the center of the planet's day/night edge. Venues source their own monitors; in informal settings, the ring is assembled from volunteers each holding a phone running one feed. The research instrument is fixed; the display is found.

This grant closes a specific gap. The system works — the web app is live, the installation runs, the model produces ratings — but the current network only surfaces a few hundred candidates at any moment, most from cameras built for other purposes: traffic cams, surf cams, parking lots. To reliably show a fantastic sunrise or sunset, two things must improve: more cameras placed and tuned for this purpose, and a better algorithm for finding the good ones in a noisy pool. This grant funds that work.

The project sits at the intersection of landscape art, network culture, found photography, and machine-learning research. It connects to LACMA's 1967 Art and Technology legacy of light and perception at planetary scale.

I also think it would be wonderful to stand at the center of a ring of sunrises and sunsets — feeling the turning of the world, sunsets changing quickly at the equator and slowly at the poles. Who doesn't love a sunset?

---

## 5. Biography

_(unchanged from v2/v3 — 283 words, no cap)_

Jesse Kauppila is an artist and engineer based in Bellingham, WA. During an MFA at Carnegie Mellon University, I learned to program robotic arms for an art project, and I used that skill to begin a new career path — one that led to fabricating work for Anish Kapoor and Charles Ray, then to aerospace at Joby Aviation (the electric air-taxi company), and, more recently, to building AI data centers for big tech.

I am now returning to my art practice, applying what I have learned in the tech world to projects like this one. Financial security has given me the room to clarify my values and focus on making work I genuinely believe in. For this project I am collaborating with Kameron Decker Harris, a computational scientist at Western Washington University, who leads the machine-learning architecture.

Outside of studio and professional work, I ski, climb, bike, and run in the mountains of the Pacific Northwest. My relationship with nature informs my interest in using technology to cultivate a deeper connection to the world we all live in.

Kameron Decker Harris is a computational scientist and applied mathematician at Western Washington University whose research focuses on networked dynamical systems — both biological and artificial neural networks. His work sits at the intersection of machine learning, dynamical systems, graph theory, and statistical inference. Prior collaborations with the Allen Institute for Brain Science advanced whole-brain connectivity inference from viral-tracing experiments, and he has published on sparsity-driven learning in biologically-inspired random-feature networks (including work showing V1-like tuning properties improving image recognition). For _Sunrise / Sunset_, Kameron leads the machine-learning architecture and training strategy, and collaborates on interpreting the human–machine aesthetic gap that the project makes explicit.

---

## 6. Artistic / Creative Merit

_(unchanged from v2 — 95 / 100 words)_

_Sunrise / Sunset_ points machine perception at actual sunrises and sunsets currently happening on Earth — not at machine-generated imaginings of them. It amplifies a universally shared aesthetic experience by combining dozens of simultaneous real views — drawn from public webcams and custom cameras of our own — into a single planetary portrait, curated by an AI trained to recognize which sunsets to highlight. The work proposes that the most interesting artistic use of AI may not be generation but attention: directing machine vision toward the sublime that already exists, continuously, in the real world.

---

## 7. Dialogue Between Technology and Culture

_(unchanged from v2 — 97 / 100 words)_

We are in a cultural moment defined by AI-generated imagery and AI that wages war. These algorithms strip the world of its beauty, texture, and context. This project seeks to invert that relationship. Instead of asking a machine to imagine a sunset, it asks a machine to recognize the real ones happening right now, somewhere on Earth. It proposes that the most interesting artistic use of machine perception may not be generation but attention — directing the machine's gaze toward the sublime that already exists, continuously, in the literal world. A tool for noticing rather than inventing.

---

## 8. Public Engagement Plan

_(target: ≤ 100 words — estimated ~88)_

The web app is live (moving to sunrisesunset.studio). Six public touchpoints:

- The live web app and a "dating app for sunsets" rating site, where anyone rates sunsets alongside the AI.
- Any number of possible artworks using the archive, live feeds, and algorithm
- A two-screen exhibit at Canopy Art & Iron (Bow, WA).
- Mid-term demo at the 2027 LACMA Biennial Symposium.
- Open-source release of the ML pipeline, model, and archive.
- A Kickstarter campaign for the edge cameras — funding plus distributed participation.

---

## 9. Other Funding Sources and In-Kind Support

_(unchanged from v2)_

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

| Category                         | Item                                                                                                  | Cost        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| Principal Fees                   | Jesse Kauppila — artist time (24 months)                                                              | $17,000     |
| Webcam Prototyping (NA pilot)    | 30 × Pi Zero 2 W                                                                                      | $750        |
|                                  | 30 × Camera modules                                                                                   | $600        |
|                                  | 30 × MicroSD, high-endurance                                                                          | $360        |
|                                  | 30 × Power supplies + cables                                                                          | $300        |
|                                  | 30 × Weatherproof enclosures                                                                          | $450        |
|                                  | Custom PCB design + small run                                                                         | $1,500      |
|                                  | Enclosure design, 3D printing                                                                         | $1,000      |
|                                  | Cellular / LTE modems (5–10 units)                                                                    | $500        |
|                                  | ESP32 experimental units + peripherals                                                                | $500        |
|                                  | Shipping, tools, spare parts                                                                          | $540        |
|                                  | _(subtotal: $6,500)_                                                                                  |             |
| Installation Hardware            | GPU workstation or cloud GPU credits                                                                  | $1,500      |
| Software & Services              | Anthropic Claude ($100/mo × 24)                                                                       | $2,400      |
|                                  | Vercel Pro ($20/mo × 24)                                                                              | $480        |
|                                  | Cursor Pro ($20/mo × 24)                                                                              | $480        |
|                                  | Neon Postgres (24 months)                                                                             | $600        |
|                                  | Mapbox GL JS (free tier)                                                                              | $0          |
|                                  | OpenAI + Gemini vision API calls                                                                      | $1,000      |
|                                  | Domain + SSL (sunrisesunset.studio, 2 yrs)                                                            | $100        |
| Travel (Bellingham → LA)         | 2027 Symposium trip                                                                                   | $2,400      |
|                                  | 2028 Demo Day trip                                                                                    | $3,400      |
|                                  | Canopy Art & Iron (local drive, Bow WA)                                                               | $300        |
| Co-applicant + Collaborator Fees | **Kameron Decker Harris — co-lead (24 months): ML architecture, training strategy, model evaluation** | $11,000     |
|                                  | Installation / fabrication assistance                                                                 | $1,000      |
| Documentation                    | Video + photo documentation                                                                           | $1,000      |
| Contingency                      | Replacement hardware, API overages, shipping                                                          | $840        |
| **TOTAL**                        |                                                                                                       | **$50,000** |

### Budget notes

**Webcam Prototyping ($6,500) funds a dual track.** The bulk (~30 Raspberry Pi Zero 2 W units, the main deployment platform) is complemented by a smaller ESP32-based experimental run. ESP32 units cost roughly 1/10 of a Pi, which lets us test whether the network can extend cheaply into harder-to-reach locations — particularly where solar power and cellular are the only options. Custom PCB design ($1,500) and enclosure work ($1,000) produce the hardware artifact that could later be offered as a Kickstarter reward.

**Kameron's co-lead fee ($11,000).** At ~65% of the principal fee, this reflects his substantive role across the 24-month grant period: ML architecture, training strategy, and model evaluation. This is a meaningful increase from the v2 figure ($2,000) and brings the co-applicant line in line with the scope of the work.

**What's NOT in the budget: exhibition displays.** We don't buy monitors, stands, wiring, or kiosk machines with grant funds. Venues source their own displays for formal installations. Informal installations use found screens and participant phones — a Cardiff-style ring assembled from what people already carry. The grant funds the research instrument (the webcam network and the algorithm) and the principal artists — not the display surface, which is meant to be contingent, found, and community-sourced. This is an intentional cost discipline that aligns with the project's "real, not generated" ethic: the display is as found as the sunsets.

---

## 12. Implementation Plan

| Phase                                                                                                                                                                                                                                                                                                                                                                                                                                            | Timeline                          | Cost    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------- |
| **1. Foundation + Webcam v1** — formalize co-lead agreement with Kameron, kick off ML architecture; upgrade ML pipeline to image-based inference; expand training dataset; validate against human ratings (Pearson > 0.80 gate); begin outreach to Windy / EarthCam; build first 5–10 Pi Zero 2 W cameras and first ESP32 prototypes; identify NA deployment partners.                                                                           | Fall 2026 (Months 1–4)            | $11,000 |
| **2. Modular Install Development + NA Webcam Rollout** — refine the modular installation approach (venue-sourced monitor mix + participant phone-ring protocol); develop the public rating app; iterate webcam hardware (custom PCB, weatherproof enclosure, remote-tuning firmware, ESP32 field tests); deploy 8–10 cameras across North American locations; exhibit the two-screen diptych at Canopy Art & Iron's annual rendezvous (Bow, WA). | Winter 2026–27 (Months 4–8)       | $13,000 |
| **3. LACMA Symposium Demo** — install and demonstrate at the 2027 Biennial Symposium (venue-sourced monitors + phone-ring demo); present mid-term findings (model evolution, human–machine rating divergence, pilot-webcam data, Canopy exhibit reflections); travel Bellingham → LA.                                                                                                                                                            | Spring 2027 (Months 8–12)         | $9,000  |
| **4. Refinement + Kickstarter Prep + Global Network** — incorporate symposium feedback; train second-generation model on expanded dataset (gallery ratings + rating-app data + pilot imagery); finalize Kickstarter-ready camera and campaign; distribute cameras internationally; open-source release of ML pipeline.                                                                                                                           | Summer–Fall 2027 (Months 12–18)   | $8,000  |
| **5. Final Installation + 2028 Demo Day** — full-scale modular installation for 2028 Demo Day (venue-sourced monitor ring + phone-ring public event); final documentation; published dataset, model weights, camera hardware plans; travel Bellingham → LA.                                                                                                                                                                                      | Winter–Spring 2028 (Months 18–24) | $9,000  |

---

## Word count summary

| Section              | Cap    | v4 count       | Status           |
| -------------------- | ------ | -------------- | ---------------- |
| §4 Full Description  | 500    | 491            | ✅ 9-word buffer |
| §6 Artistic Merit    | 100    | 95 (unchanged) | ✅               |
| §7 Dialogue          | 100    | 97 (unchanged) | ✅               |
| §8 Public Engagement | 100    | 96             | ✅               |
| §5 Bio               | no cap | 283            | —                |

**Open items / things to decide before submission:**

1. **Confirm project name pick** — current: "A Distributed Observatory and Neural Network for the Planet's Day/Night Edge." If this lands as too dry, the alt "A Neural Network Learning to See Beauty at the Planet's Day/Night Edge" keeps the research bones but warms the voice.
2. **§6 and §7 left intact** — if you want those reframed toward research ("produces models, methods, data of interest to other artists/technologists"), flag and I'll pass on them.
3. **§5 Bio** — unchanged. A light research-framing touch (e.g., "this artist-led research practice") could be added to Jesse's paragraph if you want it.
4. **Budget tradeoffs** — contingency is $840 (thin), fabrication assistance halved, GPU cloud-only. If any of these feel wrong, easiest swap: drop Kameron to $10,000 to restore $1,000 elsewhere.
5. **Kameron budget-line word count** — the co-lead line now reads "ML architecture, training strategy, model evaluation." Could grow to name specific deliverables (published dataset, model weights, methodology write-up) to reinforce the "shareable research output" angle.
6. **§9 not updated** — still references self-funding and partnership pipeline. Worth a quick read to see if any wording has shifted since v2.

---

_v4 — research reframe. Generated 2026-04-22._
