# Concepts

Shared domain vocabulary for this project — entities, named processes, and status
concepts with project-specific meaning. Seeded with core domain vocabulary, then
accretes as ce-compound and ce-compound-refresh process learnings; direct edits
are fine. Glossary only, not a spec or catch-all.

## Relationships

A Feed defines a Pool of candidate webcams. The Gate decides which members of
that Pool are worth showing. A Mosaic arranges the survivors into a Composition
of Tiles, and the Composition is what appears on the Glass. Dials are the
positions that steer every step of that chain, and each Mosaic Version
interprets its own Dials.

## The display chain

### Feed
One of the two halves of the terminator the project renders — the sunrise side
or the sunset side — each with its own webcams, its own screen, and its own
settings.

A Feed is a standing concept, not a time window. Its membership changes
continuously as the terminator moves, so the same Feed names a different set of
cameras minute to minute.

### Pool
The set of webcams currently eligible for a Feed, before any quality judgement
is applied.

Pool membership is defined by fixed geographic and solar-position bounds, not by
the cameras that happen to be present. This distinction is load-bearing: a
display axis derived from the Pool's *definition* stays still, while one derived
from its *present members* moves every time any camera arrives or leaves.

### Gate
The pass/fail judgement that decides whether a single webcam's current frame is
good enough to show.

The Gate is asked per Mosaic Version, because each Version reads a different
quality signal at a different threshold. A frame that one Version gates in,
another gates out, so reporting surfaces must ask the Version on the Glass
rather than assuming one interpretation.

### Mosaic
The renderer that arranges gated frames into the picture the project exists to
show.
*Avoid:* wall

### Mosaic Version
A named, independently frozen implementation of the Mosaic, shipping alongside
the others in a single build.

Versions are never edited in place once frozen — a new idea becomes a new
Version. One is pinned as the default; a surface may select a different one, and
a live setting can override the pin without a redeploy. Each Version owns its
own Dials, so a Dial name means nothing without knowing which Version is
reading it.

### Composition
One particular arrangement of Tiles that a Mosaic produces at a moment in time,
given a Pool and a set of Dial positions.

The Composition is a target, not a drawing. Motion settings determine whether
the picture snaps to each new Composition, travels to it, or chases it
continuously without ever arriving.

### Tile
One webcam's frame as placed in a Composition, with its size and position
carrying meaning rather than being arbitrary layout.

A Tile's size encodes how good its frame is judged to be, and its position
encodes where on Earth the camera sits.

### Glass
The physical display surface a Composition actually reaches — the kiosk
screens, as opposed to a preview, a test, or the deployed code.

The distinction matters because code can be merged and deployed while the Glass
still shows something older, and because settings can be deployed without the
code that reads them. "On the Glass" always means verified at the surface, never
inferred from an upstream step succeeding.

### Dial
A single named, operator-adjustable setting that steers composition or motion,
tunable live without a deploy.

Dials are namespaced per Mosaic Version. A Dial only takes effect once the code
that reads it is on the Glass, so introducing a new Dial requires shipping the
code first and moving the Dial second.

### Kiosk
The always-on installation that renders the Feeds unattended — both the routes
that draw them and the dedicated hardware that displays them.

## Flagged ambiguities

- "Wall" is used informally for the Mosaic and for the Composition it is
  currently showing. Prefer Mosaic for the renderer and Composition for the
  arrangement.
- "Glass" and "Composition" are adjacent but not interchangeable: the
  Composition is what was computed, the Glass is where it was confirmed to have
  landed.
