# Camera Hardware Decision — Module 3 Wide + Central Scoring

**Date:** 2026-06-15
**Status:** Decided (revisit trigger noted below)
**Context:** Choosing the camera/compute for the Pi-based fleet node. See the System Design Brief (score-then-escalate architecture) this record accompanies.

## Decision

**Use the Raspberry Pi Camera Module 3 Wide on every Pi node, run sunset-quality
scoring centrally (Path A), and use cheap on-Pi heuristics as the bandwidth/cost
lever — not the Sony IMX500 AI Camera.**

## The fork that was considered

| | A. Module 3 Wide + central scoring (CHOSEN) | B. IMX500 AI Camera + on-sensor inference |
|---|---|---|
| FOV | Wide (~102° horizontal) — all 365 Bellingham sunsets, headroom north | Not offered wide — loses solstice sunsets |
| HDR | Yes (the key sunset feature) | No |
| Model | Existing PyTorch unchanged, server-side | PyTorch → Sony MCT quantize → `.rpk`; sensor geared to detection, not aesthetic regression |
| Bandwidth | Thumbnails to server (~10–20 KB each) | Rank/metadata only |
| Cost | Baseline | ~2× |

## Why A wins

1. **FOV is disqualifying for B.** The Wide lens is what delivers full-year
   coverage in Bellingham (≈48.75°N) and headroom for nodes farther north. The
   AI Camera has no wide variant, so it gives up the exact solstice frames the
   fleet exists to catch.
2. **No HDR on B.** HDR (bright sky over dark foreground) is the core sunset
   capability — losing it degrades both the streamed imagery and the scored
   imagery.
3. **The fleet is heterogeneous.** API-based cameras can't do on-sensor
   inference regardless, so the central scoring path must exist anyway. Adding
   edge inference on some nodes is a *second* scoring system to maintain (plus
   IMX500 model-conversion friction), not a simplification. One central path
   covers Pi nodes and API cameras alike.
4. **The bandwidth win is a non-problem at this scale.** A 320×240 JPEG
   thumbnail is ~10–20 KB; a 20-node fleet at 2 fps is < 1 MB/s aggregate. Edge
   inference only earns its keep on metered/cellular links or much larger scale.

## The valuable part of the edge-ranking idea is kept — without the IMX500

The appeal of B was "decide locally, only move the best image(s), switch the feed
to the current highest rank." That pipeline is achievable on Module 3 + Pi 3A+
with cheap heuristics on the `lores` numpy frames already being pulled (the
512 MB Pi can't run the full PyTorch model, but it can do these trivially):

- **Sunset-window + activity gate** — sky-region brightness/saturation,
  frame-to-frame change. Decides *when* a node is worth listening to.
- **Coarse local pre-rank** — a cheap "is something happening here" scalar, sent
  as a few bytes.
- **Upload-on-candidate** — push a thumbnail only when the local gate says it's
  plausibly interesting; pull full-res only from the promoted winner.

Net pipeline: **local coarse gate → upload candidate thumbnails → central
fine-grained aesthetic rank → promote highest current rank.** Keeps HDR, keeps
wide FOV, keeps the model unchanged, keeps one coherent scoring architecture.
The bandwidth/cost reduction comes from the local gate, not from different
silicon.

## Revisit triggers

Reopen this decision only if:

- **Central scoring cost becomes the real bottleneck.** Next step is a tiny int8
  classifier (tflite/onnxruntime) *on the Module 3 Pi* — risky on 512 MB, adds
  conversion work, but still no camera change. Reach for it only after the
  cheap-heuristic gate proves insufficient.
- **On-sensor inference becomes a hard requirement** (e.g. truly offline nodes
  with no server reachable). Only then does the IMX500's FOV/HDR sacrifice and
  conversion friction become worth paying.
