---
title: Prefer read-time synthesis over write-time denormalization for "latest related row" data
date: 2026-06-02
category: design-patterns
module: snapshot-data-model
problem_type: design_pattern
component: database
severity: medium
applies_when:
  - A view needs the latest child row (e.g. newest snapshot for a camera)
  - Tempted to copy a value onto a parent row to avoid a join
  - Building popup/card payloads that mix sources
tags: [database, denormalization, join-lateral, data-modeling, postgres]
related_components: [service_object]
---

# Prefer read-time synthesis over write-time denormalization for "latest related row" data

## Context
The custom-camera popup needs each camera's most recent snapshot image. One option is
to denormalize — copy the latest snapshot URL/score onto the camera row on every
write. The chosen approach instead synthesizes the payload at read time with a
`LEFT JOIN LATERAL` against the latest `webcam_snapshots` row.

## Guidance
For "show me the latest related row" needs, **read-time synthesis beats write-time
denormalization**: query the latest child row when rendering, and assemble an honest
payload (optional fields where data is genuinely optional) rather than maintaining a
copied value. A single synthesis helper (e.g. `customCameraState`) can seed both the
public popup and any future admin/studio view.

## Why This Matters
Denormalized copies drift: every write path must remember to update them, and the one
that forgets ships stale data silently. Read-time synthesis has a single source of
truth and cannot drift. The cost is one well-indexed lateral join, which is cheap for
popup-scale reads. Honest optional fields also keep the wire shape truthful instead of
faking values to fill a denormalized column.

## When to Apply
- Latest-N-per-group / latest-child reads at interactive scale.
- Not for hot aggregate counters where the join cost would dominate (there,
  denormalize deliberately and own the update paths — see `calculated_rating`).

## Examples
- Pattern: `... LEFT JOIN LATERAL (SELECT ... FROM webcam_snapshots ws WHERE
  ws.webcam_id = c.id ORDER BY ws.created_at DESC LIMIT 1) latest ON true`.
- Reuse one synthesis helper across public + studio surfaces to avoid divergence.

## Related
- `docs/superpowers/specs/2026-05-14-custom-camera-popup-image-design.md`
- `SNAPSHOT_SYSTEM_README.md` (where `calculated_rating` is deliberately denormalized)
