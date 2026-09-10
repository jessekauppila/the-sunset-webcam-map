# Wall label — *Sunrise Sunset*

The text to hang. Settled 2026-09-09 for the show opening 2026-09-12. The
drafting history, the alternates, and the measurements that back the claims are
in `WALL_LABEL_DRAFTS.md` beside this file.

## Tombstone

```
Jesse Kauppila
Sunrise Sunset, 2016–ongoing
Computer monitors, computer, web app,
machine learning algorithms, public webcams
Dimensions variable; continuous
```

## Extended label

> *Sunrise Sunset* shows a sunrise on the left monitor and a sunset on the
> right. Both are happening right now, or just happened, somewhere in the world.
>
> The pictures are stills from public webcams, continuously curated by a neural
> network the artist trained by rating thousands of skies. Each screen gathers
> one camera's stills into a timelapse, plays it, then moves on to another
> camera where night is turning to day, or day to night.

75 words, two paragraphs.

## Still to settle before printing

- **Title form.** This label says *Sunrise Sunset*. The LACMA Art + Technology
  Lab application says *Sunrise / Sunset* throughout. Pick one and make both
  documents agree.
- **Date.** Nothing in the application dates the work earlier than the present.
  If 2016 was a slip the line is simply `2026`. If there was a 2016 version,
  `2016–ongoing` is honest and reads as a strength.
- **Medium line.** "Machine learning algorithms" is vague for a tombstone, and
  the extended label is more specific than the tombstone it sits under.
  "Sunset-rating neural network" matches the label and the specificity is the
  point of the work.
- **`curated` vs `chosen minute by minute`.** "Continuously curated" is the
  current reading. "Curated" is the only word here that sounds institutional
  rather than authored, and it credits the network with the whole selection when
  in fact the network supplies the judgment and the display engine does the
  rotation. The concrete alternative: "stills from public webcams, chosen minute
  by minute by a neural network the artist trained by rating thousands of
  skies."
- **Credit line.** Add "Courtesy of the artist" as a last tombstone line if the
  venue expects one.

## What the label commits the installation to

- **Left is sunrise, right is sunset.** `scripts/pi/kiosk-launch.sh` puts the
  first Chromium window at x=0 on `/kiosk/sunrise` and the second on
  `/kiosk/sunset`, so this holds as long as the physical panels are ordered to
  match. Naming left and right on a wall means the arrangement stops being a
  day-of dial.
- **Landscape, not the portrait mosaic.** The two-monitor sunrise/sunset split
  is the solo layout. `ORIENTATION=landscape` in `/home/pi/kiosk.env`, panel
  `dell-l` or `ktc-l` in /studio.
- **The active version must be `solo2`.** It is the only renderer that plays a
  camera's frames in sequence, and "timelapse" appears twice in the label. The
  plain `solo` renderer shows one frame per screen with no run, which would make
  the sentence false on the wall.
- **No repeat for a patient viewer.** The label says each screen moves on. The
  engine picks the least-recently-shown camera in a bin and the eligible set
  turns over as places enter and leave the swept band, so nothing loops.

## Why the caption on the glass stays minimal

The per-frame caption carries place and recency only. No concept, and no
countdown to sunset: an obstruction can only take the sun away earlier than the
almanac says, never later, so a countdown gets contradicted by the picture it
captions while an elapsed time never does. The wall text is what carries the
concept, which is why this file exists.
