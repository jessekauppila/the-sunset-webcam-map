# Wall label drafts — *Sunrise Sunset*

Drafted in conversation on 2026-09-09 and never written down at the time.
Recovered from the session transcript 2026-09-09. Source material for the
extended texts is `LACMA_ART_TECH_LAB_APPLICATION_2026_v5.md`, sections 4, 6
and 7.

## Tombstone

```
Jesse Kauppila
Sunrise Sunset, 2016–ongoing
Computer monitors, computer, web app,
machine learning algorithms, public webcams
Dimensions variable; continuous
```

## Extended label — option A (written for the wall)

> Somewhere it is always sunset. This work is a machine built to find that
> place and keep looking at it.
>
> Software watches public webcams around the world, the ones aimed at
> highways, harbors, ski hills, and backyards. From the cameras currently in
> twilight, it selects the skies that a model, trained on the artist's own
> judgments, has learned to call beautiful.
>
> The sunset may be the most photographed subject on Earth and the hardest to
> make new. Here the picture is made by no one: a camera nobody aimed, a sky
> nobody arranged, and a taste that was taught rather than held.
>
> Nothing on these screens is recorded. Everything is happening now.

The last pair of sentences is the one thing most visitors will not assume on
their own.

## Extended label — option B (plainer register, shorter)

> At every moment the line between day and night is crossing some part of the
> Earth. *Sunrise Sunset* follows that line. It watches thousands of public
> webcams and shows the ones where the sun is rising or setting right now,
> choosing among them with a model trained on the artist's ratings of
> thousands of skies. The view never repeats and no one has ever seen all of
> it.

## Extended label — option C (built from the LACMA sentences, ~130 words)

> *Sunrise Sunset* finds the public webcams that sit, at this moment, along
> the line where day turns into night, and shows the views a neural network
> has been trained to call beautiful.
>
> We are in a cultural moment defined by AI-generated imagery. Instead of
> asking a machine to imagine a sunset, this work asks a machine to recognize
> the real ones happening right now, somewhere on Earth. It proposes that the
> most interesting artistic use of machine perception may not be generation
> but attention: directing the machine's gaze toward the sublime that already
> exists, continuously, in the literal world. A tool for noticing rather than
> inventing.
>
> Dozens of simultaneous views become a single planetary portrait. Sunsets
> change quickly at the equator and slowly at the poles. There is always
> beauty somewhere in the world.

Long for a wall, fine for a single-work label where the viewer stands still.

## Extended label — option D (Jesse's draft, 2026-09-09, the leading version)

As written:

> Sunrise Sunset displays a sunrise and sunset that's happening or just
> happened somewhere in the world. It pulls these images from public webcams
> and gradually builds timelapses of these events as they happen.

Tightened, same voice:

> *Sunrise Sunset* shows a sunrise or a sunset that is happening right now, or
> just happened, somewhere in the world. The images come from public webcams,
> chosen by a model trained on the artist's own ratings of thousands of skies.
> As new frames arrive, each camera slowly becomes a timelapse of its own
> evening.

Changes and why:

- `a sunrise and sunset that's` takes a singular verb on two nouns. `or` also
  reads truer, since one screen holds one of the two at a time.
- The draft never mentions the model, while the tombstone lists machine
  learning as a medium. One clause closes that gap and states the work's
  actual claim.
- Three forms of "happen" in two sentences. The last one goes.
- "displays" and "pulls" are both mechanical verbs. One is enough.

## Caution on the timelapse sentence

The timelapse is real but lives only in the `solo2` renderer, where a dwell
plays a camera's frames oldest to newest (`app/lib/solo2/run.ts`, the
`cameraRun` dial, default on). The `solo` renderer shows one frame per screen
with no run. If the glass still runs `solo` on opening night, the sentence
describes something the visitor cannot see. Flipping `activeVersion` to
`solo2` in /studio is what makes the label true.

## Extended label — option E (Jesse's second draft, names the two monitors)

As written:

> Sunrise Sunset displays a sunrise on the left monitor and sunset on the right
> that are happening, or just happened, somewhere in the world. The images are
> stills from live webcams chosen by an algorithm developed by the artist and
> trained by rating thousands of images. As a new images arrive the web app
> builds a timelapse of night turning to day or day to night. The web app
> cycles through these timelapses.

Clarified, same structure:

> *Sunrise Sunset* shows a sunrise on the left monitor and a sunset on the
> right. Both are happening right now, or just happened, somewhere in the
> world.
>
> The pictures are stills from public webcams, chosen by a neural network the
> artist trained by rating thousands of skies.
>
> As new ones arrive, each monitor builds a timelapse: night turning to day on
> the left, day turning to night on the right. Then it moves on to another
> place and starts again.

Changes and why:

- The relative clause `that are happening` sat at the far end of a long first
  sentence, where it read as modifying "the right." It becomes its own
  sentence, which is also where the strongest claim in the label belongs.
- `trained by rating thousands of images` has no one doing the rating. Naming
  the artist as the agent fixes the grammar and is the more interesting fact.
- `night turning to day or day to night` throws away the left/right split the
  first sentence just established. Assigning each direction to its monitor is
  the payoff.
- `live webcams` is redundant with "happening right now." `public` is the word
  that carries the idea: nobody aimed these at anything for us.
- `web app` twice in two sentences, and it is tombstone language. The
  tombstone can say "web app"; the wall text does not have to.
- `cycles through` implies a fixed loop. The engine picks the
  least-recently-shown camera in a bin, so "moves on to another place" is both
  plainer and truer.
- Typo: `As a new images arrive`.

## The left/right claim is accurate

Verified in `scripts/pi/kiosk-launch.sh`: the first Chromium window sits at
x=0 and loads `/kiosk/sunrise`, the second sits at the second panel's x and
loads `/kiosk/sunset`. So sunrise is the left monitor as long as the physical
panels are ordered to match, and as long as the glass runs the landscape solo
layout rather than the portrait mosaic. A label that names left and right
commits the installation to that arrangement.

## Extended label — option F (Jesse's third draft, compressed ending)

As written:

> Sunrise Sunset shows a sunrise on the left monitor and a sunset on the right.
> Both are happening right now, or just happened, somewhere in the world.
>
> The pictures are stills from public webcams, chosen by a neural network the
> artist trained by rating thousands of skies. These stills are assembled into
> a series of timelapses that are cycled through.

The first three sentences are settled. The last one is the only open line.

Recommended ending, one sentence, keeps the compression:

> Each monitor assembles them into a timelapse, night turning to day on the
> left and day into night on the right, then moves on to another place.

Minimal ending, if the label has to be shorter:

> Each monitor builds them into a timelapse, then moves on to another place.

Why not `assembled into a series of timelapses that are cycled through`:

- Two passives in a row with no agent, directly after two active sentences.
  The voice goes slack exactly where the work gets interesting.
- It describes the system's structure rather than the visitor's experience. A
  person standing in front of the wall cannot picture "a series of timelapses
  that are cycled through," but they can picture night turning into day.
- It drops the one clause that tells a viewer what will change while they
  stand there. For a work that is continuous and has no beginning, that clause
  is the label's most useful sentence, which is what buys it the words.
- `cycled through` still implies a fixed playlist. The engine picks the
  least-recently-shown camera in a bin, and the set of eligible cameras turns
  over constantly as places enter and leave the swept band. Nothing loops.

What the draft does gain: "a series of" makes the plural explicit, which the
recommended ending carries instead through "moves on to another place."

## Extended label — option G (Jesse's fourth draft, ends on liveness)

As written, last clause only:

> ... then moves on to another sunrise or sunset happening right now.

The instinct is right: liveness belongs in the last position, which is the
strongest spot on a label and the one claim a visitor will not assume. Two
problems with this execution.

- **`happening right now` already appeared in sentence two.** The closing
  clause is built entirely from words the label has used, so the reader hears
  the echo instead of the fact.
- **`another sunrise or sunset` is distributively wrong.** The subject is "each
  monitor," and the left monitor never moves to a sunset. The label has already
  told the reader which side is which, so an attentive one trips here.

Recommended ending:

> ... then moves on to the next one, live from somewhere else on Earth.

`the next one` inherits the right kind per monitor, so the left stays on
sunrises. `live` is a new word carrying the same payload, and "somewhere else
on Earth" escalates the scale instead of repeating "somewhere in the world."

Shorter, if the sentence is running long:

> ... then moves on to the next one, somewhere else on Earth.

## Full label as it stands (2026-09-09)

> *Sunrise Sunset* shows a sunrise on the left monitor and a sunset on the
> right. Both are happening right now, or just happened, somewhere in the
> world.
>
> The pictures are stills from public webcams, chosen by a neural network the
> artist trained by rating thousands of skies. Each monitor assembles them into
> a timelapse, night turning to day on the left and day into night on the
> right, then moves on to the next one, live from somewhere else on Earth.

68 words, two paragraphs.

## Extended label — option H (one timelapse per webcam made explicit)

The fact Jesse wants on the wall: a timelapse is built from a single webcam's
stills, and a monitor plays many of them in succession. His draft carried it
but loaded four jobs into one 45-word sentence.

Recommended second paragraph:

> The pictures are stills from public webcams, chosen by a neural network the
> artist trained by rating thousands of skies. One webcam's stills accumulate
> into a timelapse of its own sky: night turning into day on the left monitor,
> day into night on the right. Each screen plays one, then moves on to another
> webcam, live somewhere else on Earth.

- `One webcam's stills accumulate into a timelapse of its own sky` says
  one-camera-per-timelapse outright, and "accumulate" carries the gradual build
  that "assembles" does not.
- `Each screen plays one, then moves on to another webcam` makes the succession
  explicit. "Another webcam" names exactly what changes, which was the
  ambiguity.
- Both directions now take the same verb, so the second can ellipse it.
- Typos in the draft: `sills`, and `into timelapse`.

## "Night turning into day" is honest, and here is the measurement

The swept band is `TERMINATOR_WIDEN_OFFSETS_DEG = [15.75, -15.75]` in
`app/lib/masterConfig.ts`, so a camera is eligible while its sun sits between
about 15.75° below and 15.75° above the horizon. The sun crosses that 31.5°
span in roughly two to three hours at mid-latitudes, longer toward the poles.

Webcam previews refresh about every ten minutes (see the Windy freshness
finding), so one camera accrues on the order of a dozen or more stills before
it leaves the band. That is a real transition from dark twilight to full day,
not three frames. The claim survives a visitor who stands there and counts.

Frames are removed a set number of cron pulls after a camera leaves the zone,
which is what keeps a timelapse bounded to one crossing.

## Extended label — option I (Jesse's fifth draft, mechanic plain, direction cut)

As written:

> The pictures are stills from public webcams, chosen by a neural network the
> artist trained by rating thousands of skies. Each webcam's stills are gathered
> into timelapses. Each screen plays a webcam's timelapse, then moves on to
> another webcam.

The mechanic is now unmistakable, which was the goal. Four things to fix.

- **`Each webcam's stills ... into timelapses`** says one webcam makes several.
  It makes one. Singular.
- **Sentences two and three restate each other.** "Plays a webcam's timelapse"
  already implies the gathering. They merge into one sentence with no loss.
- **"Webcam" four times in three sentences.** Switching to "camera" on the
  later uses breaks the clank.
- **`another webcam` is the weakest possible last phrase**, and the last words
  of a label are the ones a visitor carries off.

Recommended second paragraph:

> The pictures are stills from public webcams, chosen by a neural network the
> artist trained by rating thousands of skies. Each screen gathers one camera's
> stills into a timelapse, plays it, then moves on to a camera somewhere else
> on Earth.

68 words total, back to the compression of option F.

**What the cut costs.** Dropping "night turning into day on the left, day into
night on the right" removes the only line that tells a viewer what will change
while they stand there. For a continuous work with no beginning, that was the
label's most useful sentence. Jesse has now cut it twice, so it is a settled
choice, recorded here only so the reason is on file. It slots back in after
"into a timelapse" if it is ever wanted.

## FINAL CANDIDATE (2026-09-09, option J)

> *Sunrise Sunset* shows a sunrise on the left monitor and a sunset on the
> right. Both are happening right now, or just happened, somewhere in the world.
>
> The pictures are stills from public webcams, continuously curated by a neural
> network the artist trained by rating thousands of skies. Each screen gathers
> one camera's stills into a timelapse, plays it, then moves on to another
> camera where night is turning to day, or day to night.

75 words, two paragraphs. This is the label to hang.

Jesse's fifth-to-sixth draft change solved the thing two earlier drafts could
not: the direction went back in by attaching itself to the camera rather than
to the monitor, so it costs one clause instead of a whole sentence.

Three edits applied to his draft, all small:

- **Order flipped to `night is turning to day, or day to night`.** Sentence one
  sets sunrise left and sunset right, so the reader's order is already
  night-to-day first. Matching it makes the mapping click with no extra words.
- **`moves to` → `moves on to`.** "On" is the idiom for succession.
- **The paragraph break was lost** in the draft (`somewhere in the world.The
  pictures`). Two paragraphs, not one block.

One word still open: **`curated`**. "Continuously" is a real gain, because it
says the selecting is ongoing rather than done once. "Curated" is the only word
in the label that sounds like an institution rather than the artist, and it
also credits the network with the whole selection when in truth the network
supplies the judgment and the engine does the rotation. The concrete
alternative, if wanted:

> ... stills from public webcams, chosen minute by minute by a neural network
> the artist trained by rating thousands of skies.

Jesse's call. Both are defensible.

## Open questions

- **Title form.** The LACMA application says *Sunrise / Sunset* throughout.
  These labels say *Sunrise Sunset*. Pick one and make both documents agree.
- **Date.** Nothing in the application dates the work earlier than now. If
  2016 was a slip, the line becomes `2026`. If there was a 2016 version,
  `2016–ongoing` is the honest form and reads as a strength.
- **Medium line.** "Machine learning algorithms" is vague for a tombstone.
  "Sunset-rating neural network" is the specific version, and the specificity
  is the point of the work.
- **Credit line.** Add "Courtesy of the artist" as a last line if the venue
  expects one.

## Related decision

The per-frame caption on the glass deliberately does *not* carry the concept
or a countdown to sunset; the wall text does. See the 2026-09-08 caption
checkpoint and PR #186.
