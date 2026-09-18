---
title: The mundane webcam feeds are the art — don't globally filter low-scoring frames away
date: 2026-06-02
category: conventions
module: map-display
problem_type: convention
component: service_object
severity: medium
applies_when:
  - Adding filtering, ranking, or thresholding to the map or kiosk
  - Deciding what frames to show vs. hide
  - Building the quality-scaled kiosk mosaic
tags: [product-principle, art, filtering, display, kiosk, ux]
related_components: [frontend_stimulus]
---

# The mundane webcam feeds are the art — don't globally filter low-scoring frames away

## Context
The ML score makes it easy to "clean up" the map or mosaic by hiding low-scoring
frames so only good sunsets show. That instinct is correct for some surfaces and
actively wrong for the art.

## Guidance
The emotional thesis of the project is **beauty poking through the ordinary**: you see
alleyways, highways, crowded streets — and then an extraordinary sky breaks through.
The mundane feeds are a *feature*, not noise. Do not apply a global "hide everything
below threshold" filter. Instead use the score to **modulate** (e.g. the kiosk scales
tile size by quality so good sunsets get bigger while the ordinary stays visible and
small), and reserve hard filtering for surfaces that explicitly want a "best only"
view (e.g. leaderboards).

## Why This Matters
Strip the ordinary and you delete the contrast that makes the beautiful land — the
kiosk becomes a generic "nice sunsets" screensaver and loses its point. This is a
product/art guardrail that will keep getting re-proposed as a "cleanup," so it's worth
holding explicitly. It also interacts with the silhouette blind spot: aggressive
thresholding hides exactly the frames the model already underrates.

## When to Apply
- Map and especially kiosk display logic.
- Distinguish "modulate by score" (default) from "filter to best" (opt-in surfaces).

## Examples
- Right (kiosk): every visible feed renders; ML score drives tile *size*, big = better.
- Right (leaderboard): explicitly best-only, score *is* the filter.
- Wrong (map default): silently drop all frames under a quality threshold.

## Related
- STRATEGY.md — Vision; anchored truth "the mundane feeds are a feature, not noise"
- `docs/solutions/best-practices/silhouette-sunset-blind-spot.md`
