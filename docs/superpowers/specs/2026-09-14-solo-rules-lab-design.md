# Solo rules lab — the sieve, on a synthetic pool

Phase 1 of a picture of the solo2 ordering rules that has no images in it.
Predecessors: the solo kiosk spec (§4, the five rules), the solo2 rhythm spec
(§3, rule 3 on a beat), the stages spec (why a row is where it is).

## 1. What this is

The rules have become hard to hold in the head because the studio shows their
OUTPUT (a queue of pictures, a tape of dwells) and never their WORK. An
operator sees that Stromness is draw 3 and cannot see which rule put it there.

The lab is a page, `/studio/solo/rules`, that draws one draw of the engine as
a **sieve**: the whole pool enters on the left, each rule removes some of it,
and what survives is sorted and the head is circled. No thumbnails, no
captions, no DB. A textbook pool of a dozen labelled chips, dials for the
rules that decide a draw, and a slot scrubber.

### What this algorithm is

A rotation scheduler, the kind radio music schedulers run. Each of our rules
has a name there, and the page says so beside the sieve with links:

| ours | theirs |
| --- | --- |
| bins, sunset floor, mix | categories and a format clock's category quota |
| rest (draws) | separation, "minimum rest" |
| never shown, then longest since shown | rotation by last play |
| floors | eligibility rules |
| peak / valley on a beat | the format clock's hour pattern |
| rules tested in order, first failure drops the frame | the rule tree, unbreakable rules |

Links for the page (all public):

- MusicMaster, "Which Rules are a Top Priority?" — the rule tree tested in order, stopping at the first unbreakable failure: https://musicmaster.com/?p=8886
- MusicMaster, "Almost Perfect – Setting the Order for Your Rules": https://musicmaster.com/?p=8211
- MusicMaster, "Maximum Rest vs Absolute Maximum Rest": https://musicmaster.com/?p=8858
- MusicMaster, "Configuring the Format Clock Display" — the pie-chart clock editor: https://musicmaster.com/?p=8408
- Radio ILOVEIT, Top 40 format clocks (category sequence diagrams): https://radioiloveit.com/radio-music-research-music-scheduling-software/top-40-radio-format-chr-contemporary-hit-radio-music-scheduling-format-clocks-1/
- Radio ILOVEIT, song rotations and the even/odd rule: https://radioiloveit.com/radio-music-research-music-scheduling-software/music-scheduling-using-song-rotations-for-better-music-logs/

## 2. The trace (pure)

`app/lib/solo2/trace.ts` exports `traceDraw(entries, d, state, slot, feed)`.
It reproduces `choosePool` and `next2` step by step and returns:

```ts
interface Trace {
  role: 'peak' | 'valley';
  steps: Step[];          // in the order the code applies them
  sorted: Ranked[];       // the final pool in rule-3 order, head first
  pick: BinEntry | null;
}
interface Step {
  rule: 5 | 4 | 2 | 1;
  title: string;          // "5 · floors", "4 · not on glass", "2 · rest", "1 · one bin"
  kept: number[];         // snapshotIds that survive
  dropped: { snapshotId: number; why: string }[];
  note?: string;          // a waiver: "everything resting — rest waived", "only frame on offer — repeats"
}
interface Ranked { entry: BinEntry; key: string }  // "never shown" | "since slot 3" | ...
```

The `why` and `key` strings are the page's copy and are tested as such.

**Agreement is the contract.** For every fixture and for random pools,
`traceDraw(...).pick` is `next2(...)`'s pick and the last step's `kept` equals
`choosePool(...)`. The engine is not touched; the trace is a second reading of
it that a test keeps honest.

Rule 1's step records the bin decision as its note: "6 sunsets ≥ floor 6 →
sunsets", "streak 2 ≥ mix 2 → non-sunsets", "no sunsets left → non-sunsets".

Rule 3 is not a step: nothing is dropped. It is the `sorted` column, and each
row's `key` names the FIRST comparator that separated it from the row above:
never shown, then since-slot, then score (with "+0.1 new" when the bonus
applies), then earliest, then id. The head's key is the role: "peak · best
first" or "valley · worst first".

Camera runs are off in the lab (`cameraRun: false`). With one frame per camera
the representative is the frame itself, so nothing is lost, and the sieve
stays about frames.

## 3. The page

`/studio/solo/rules`, a client component, no fetch.

**Pool.** Twelve chips: eight sunsets `S1…S8` with ratings 4.8 down to 2.0,
four non-sunsets `N1…N4` with detections 0.9 down to 0.2. A chip is its label
in its bin colour (the studio's `#7ee2ac` / `#c3cad6`), with its score
underneath. Each chip has a tally and a last-shown slot the scrubber writes.
Phase 1 does not edit chips; it edits dials.

**Bins.** Two boxes, sunset and non-sunset, holding the chips, each chip
numbered with its position in the next eight draws (`project2`), blank when it
is not drawn in that window. This is the "empty bins with the ordering on
them" view.

**Dials.** Only the ones a draw reads: rating floor, detection floor, sunset
floor, mix, rest, valleys, screens, promote new. Feed: sunrise | sunset (the
beat's phase). Defaults from the solo2 schema.

**Scrubber.** Slot `n`, starting at 1. Forward applies the draw the sieve
shows exactly as `project2` does (tally, isNew, lastShownAt, lastShownSlot,
screen state). Backward rebuilds from the seed pool, which is deterministic.
Reset returns to slot 1 and the seed.

**Sieve.** Five columns, left to right: *pool*, *5 floors*, *4 not on glass*,
*2 rest*, *1 one bin*, then a sixth, *3 sort*, which is the ranked list. A chip
dropped by a rule stays in that column greyed with its `why` under it; in
later columns it is absent. Each column head shows the dial values that rule
read. The sort column shows the role ("peak", "valley") and each chip's key.
The head is outlined.

**Links.** A short block under the sieve: the table in §1 and the six links.

## 4. Testing

- `trace.test.ts`: agreement with `next2` and `choosePool` over the engine
  tests' fixtures and 200 seeded random pools × slots; each waiver note; each
  `why`; each `key`; rule 1's three notes.
- `RulesLab.test.tsx`: renders twelve chips, the six column heads, dropped
  chips carry their reason, stepping forward changes the head, back restores it.

## 5. Out of scope (phase 2+)

The format clock, the live-pool toggle, editable chips, camera runs in the
sieve, a link from a queue row into its draw's sieve.
