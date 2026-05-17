# AI Rating — Silhouette-Sunset Blind Spot

Status: Stub — 2026-05-16
Owner: Jesse Kauppila
Loosely connected to: `AI_RATINGS_V2_PLAN.md`, `ml/` training pipeline.

---

## Observation

On 2026-05-16 at ~21:35 PDT, the Tier 0 test camera (Bellingham, WA — lat 48.7519, lng −122.4787) captured a sunset image with:

- Sky filled with sunset colors (orange/red/gradient)
- Dark foreground silhouettes (the typical "great sunset photo" composition)
- The sun itself not in the frame (camera points at the horizon but not directly at the setting sun's azimuth)

The AI rating returned was **0.21** (on whatever the active scoring scale is — regression model from `customBackfill.modelVersion: 20260315_003913_v2_regression_mild_crop`).

By any photographic standard, this is a high-quality sunset image. The scoring model rated it badly anyway.

## What this suggests

The rating model is probably treating "sun visible in frame" as a strong positive signal — likely because most of the training labels for "good sunset" came from images where the sun is visible. Silhouette-and-color compositions, which are widely considered *better* photography (no blown highlights, more atmospheric gradients, more compositional interest), look feature-wise like "non-sunset" to a model trained that way.

This is a **training distribution gap**, not an architecture gap. The model is doing its job for the labels it was given; the labels don't represent how humans actually judge sunset quality.

## Why this matters

The whole point of the AI ranker is to surface the *best* sunsets to the kiosk / mosaic / display. If a substantial fraction of objectively-great sunsets score low (because they happen to lack the sun's disk in frame), they'll be perpetually demoted in the queue and never surface, regardless of how stunning they are.

Worse: this bias is invisible during normal operation — you'd only notice it by spot-checking low-scored images, which nobody is going to do at scale.

## Possible directions (not yet a real spec)

- **Re-label / augment training data** with explicit "silhouette sunset" examples scored highly by humans. Cheapest fix, biggest payoff if it works.
- **Two-headed model:** one for "sunset content present at all" (binary), one for "quality of that sunset" (regression). Decouples detection from quality.
- **Feature-level audit:** generate Grad-CAM or saliency maps for low-scored silhouette images and confirm the model is fixating on the missing sun rather than the sky color.
- **Human-in-the-loop calibration:** when users star a sunset image highly, surface a few similar low-AI-rated images for label correction.

## What this stub doesn't try to do

Decide which of the above to pursue. Decide on a metric. Decide on a dataset. Decide on a model architecture. This is a flagged observation — turns into a real spec only after someone (probably you, when next looking at ML) decides this finding is worth a model iteration.

## Linkage

- [[2026-05-15-custom-cam-visibility-single-source-of-truth-design]] — the visibility fix that surfaced this image to the cron in the first place; without the fix, this image wouldn't have been observable.
- [[2026-05-16-device-diagnostics-clock-and-black-image-stub]] — adjacent device-side concerns; orthogonal to this scoring issue.
- `AI_RATINGS_V2_PLAN.md` — the existing roadmap for the rating model; this finding belongs in its backlog.

## When this becomes a real spec

When someone surveys ~50 low-rated images from the kiosk/mosaic candidate pool, finds that more than a handful are misjudged silhouette/color sunsets, and decides the fix is worth a training cycle.
