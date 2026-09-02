# Per-panel normalization makes two screens incomparable

**Date:** 2026-09-02
**Area:** kiosk / mosaic v2 composition

## The trap

The kiosk is two physical panels showing one thing: how good the sunrise is on
the left, the sunset on the right. Both read the same settings namespace, so
`floorPx` and `ceilingPx` were provably identical. Composition still made the
two screens disagree about what a size means, in two independent places.

**Rank-based sizing.** `percentileAmongPassers` ranked each feed's passers
among themselves. The best tile on a panel always landed at exactly the
ceiling and the worst passer at exactly the floor, whatever the scores were.
A panel of mediocre frames still promoted one of them to full size, and a
panel of brilliant frames still floored one. Height meant "rank on my own
screen," which is a fact about the pool, not about the sky.

**Per-panel overflow scale.** `compose` shrank the whole composition to fit
its own viewport, independently per feed. Forty sunset tiles rendered near
0.6 while twelve sunrise tiles stayed at 1.0, so a sunrise *floor* tile came
out physically larger than a sunset *ceiling* tile — the exact inversion of
the thing the size was supposed to communicate.

Neither shows up in a single-panel test, or in any test of one feed. Both are
obvious the moment the two panels sit side by side in `/studio`'s "both" view.

## The rule

**When two surfaces display the same quantity, every step from signal to
pixel must be a function of the signal alone — never of the pool the surface
happens to hold.** Any per-surface normalization (percentile, min-max,
fit-to-container) silently rescales the axis and destroys comparability
between surfaces, even when every configured number is identical.

The two fixes mirror the two breaks:

1. **Absolute sizing.** `linear` and `easeIn` map score onto the
   floor-to-ceiling range through an explicit score window (`scoreFloor`,
   `scoreCeiling` — see `app/components/mosaic/v2/engine/sizing.ts`). Same
   score, same height, on either panel. `percentileAmongPassers` survives as
   an option, and is the one curve that cannot agree across two panels.
2. **One shared overflow scale.** `compose` takes the peer feed's pool and
   adopts the tighter of the two required scales, behind the `sharedScale`
   dial. Each surface hands the other's pool down as `peerWebcams`; the peer
   pool is loaded for measurement and never drawn.

## The tradeoff worth stating

Absolute sizing means a dull night looks dull — nothing reaches the ceiling
when nothing deserves it. That is the honest reading and the reason to want
it. Rank-based sizing hid a dull night by always filling the panel, which is
why it looked good and meant nothing.

The shared scale costs the roomier panel some slack: it shrinks below what it
needs so both panels use one ruler. It also costs each screen a preview fetch
per peer camera, which on the kiosk are frames the twin window is already
loading into the same HTTP cache.
