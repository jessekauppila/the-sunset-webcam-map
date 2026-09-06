---
title: Solo caption dials duplicated per version namespace drifted, so the studio previewed a caption the glass never drew
date: 2026-09-05
category: docs/solutions/integration-issues
module: kiosk-solo-settings
problem_type: integration_issue
component: settings-namespaces
symptoms:
  - "On the glass the solo caption overlapped the foot of the picture; the /studio/solo2 caption preview showed it clear"
  - "kiosk_settings had `solo` at pictureHeight 92 (live and studio) while `solo2` sat at the schema default 87; the glass ran `solo`"
  - "A panel-bottom caption at pictureHeight 92 on a 1920×1080 panel started at y≈1000 while the picture ended at 1037"
root_cause: duplicated_state
resolution_type: refactor
severity: medium
tags: [kiosk, solo, solo2, settings, namespaces, caption, studio, shared-schema]
---

# Per-version copies of a shared dial drift

## What happened

`solo` and `solo2` each carried the full caption section in their own
settings namespace (`SOLO2_SETTINGS_SCHEMA` spread solo's caption knobs in).
The glass draws one caption whichever engine picks the frame, so the two
copies described one thing. Jesse dialled `pictureHeight` to 92 in the solo
studio and deployed; the solo2 studio, reading its own namespace, previewed
87. Looking at that preview, the caption looked fine; on the glass, running
`solo` at 92, the panel-bottom caption rose 37 px into the picture.

A second, independent bug made the overlap possible at all:
`captionBox` placed a panel-bottom caption at a fixed distance above the
panel edge with no regard for where the picture ended.

## Fix

1. **One namespace for one thing.** The caption knobs moved to
   `app/lib/solo/captionSchema.ts` and are spread into `SHARED_SCHEMA`
   (section `caption`). Version schemas no longer carry them; a caption key
   left in a version row is unknown to that schema and is dropped on merge.
   Every builder of `SoloDials` goes through `withCaption(versionValues,
   sharedValues)`: the two glass renderers (via a new `shared` prop on
   `MosaicProps`), the state route, and both studio pages.
2. **Clamp the caption.** `captionBox` now takes the panel height and the
   caption's lines, and a panel-bottom caption sits at
   `max(panelBottom − gap − captionHeight, pictureBottom + gap)`. A picture
   too tall for the caption pushes the caption down; past what the panel can
   hold the caption leaves the panel, which the studio preview shows for what
   it is (a picture dial set too tall) instead of hiding it inside the
   picture.

## Lesson

When two versions share a renderer, the dials that renderer reads belong in
the shared namespace, not in each version's. The tell is a schema that
spreads another schema's section into itself. The studio "matches the glass"
only if it reads the same namespace the glass reads; a preview that reads a
sibling copy is not a preview.

After this change the previously deployed `pictureHeight: 92` in the `solo`
rows is inert; the glass falls back to the mockup default 87 until the shared
caption is dialled and deployed from /studio/solo.
