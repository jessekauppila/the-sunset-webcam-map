# The source port, and FAA WeatherCams as its first adapter

Status: phase 1 built 2026-09-15, flag seeded OFF
Issue: #204
Register: `docs/image-source-register.md`
Code: `app/api/cron/update-cameras/lib/sources/`

## What this is

Every frame on the glass comes from Windy. The register ranks eighteen other
places frames could come from and asks for them to be layered in one at a
time through one seam. This is that seam, and the first adapter behind it.
It is deliberately not an FAA feature: FAA goes first because it is the
cleanest fit, and the port is the deliverable.

## The port

```ts
interface Source {
  name: string;      // 'faa'; doubles as webcams.source
  flag: string;      // runtime flag, seeded OFF
  listCameras({ now, within }): Promise<SourceListResult>;
}
interface SourceCamera {  // exactly a webcams row + the URL of its current frame
  source, externalId, title, lat, lng, imageUrl, imageAt,
  azimuthDeg, hfovDeg, country, region, city, attribution, operator
}
```

`within` is the swept band as a point test: the same boxes, radius and
clamping the Windy sweep asks for (`band.ts`). A source hands back only the
cameras inside it, so cameras from every source enter and leave the pool on
the same rule.

The registry (`registry.ts`) is a list of sources, each read behind its own
runtime flag. `isFlagEnabled` fails closed, so an unreachable database reads
every source as off. A source that throws is reported as a failed tick and
never touches the Windy path.

## Where it plugs into the tick

`route.ts`, after the Windy sweep and before classification:

1. read every enabled source, cut to the band;
2. per source: read the stored frame URL and id for its cameras, upsert the
   cameras (`upsertSourceCameras`: source, external_id, title, location,
   `images.current.preview`, `urls.provider` for attribution, `azimuth_deg`
   + `azimuth_source` when the source publishes a bearing, never blanking a
   hand-placed value), read the ids back;
3. dress each camera as the `WindyWebcam` the rest of the tick consumes
   (`toWindyShape.ts`) and append to the list Windy produced;
4. classify, score and pool the union exactly as before.

Identity inside the tick is `${source}:${externalId}` (`sourceKey`). The
database and display identity is `webcams.id`, which the client already keys
on (`terminatorPayload.ts` selects `s.webcam_id`). `WindyWebcam.webcamId`
still has to be a number for the few in-tick maps that use it; a numeric
external id is used as-is and anything else hashes (`inTickIdFor`). That is
where the register's "the id is a number" blocker is absorbed.

**Conditional fetch without a request.** Every source we take stamps the
capture time into the image URL. A camera whose URL equals the one stored
last tick stays in the pool and is not downloaded or scored; the tick reports
it as `unchanged`. For FAA that turns ~240 KB × hundreds of cameras × every
minute into one download per camera per ten minutes.

Only the Windy sweep can hold the pool (`assessSweepHold` reads Windy
telemetry alone). Ring attribution for the gate comparison is Windy-only,
because only the sweep has rings.

## What Windy is not

Windy is **not** behind the port in phase 1. Moving it would mean designing
the port from one example. It moves when the second adapter (Finland
Digitraffic or DriveBC per the register) has proved the shape.

## FAA specifics

Verified against the live API 2026-09-15 (numbers in the register):
`GET /api/redistributable/sites` returns all 756 US sites and 2,848 cameras
with each camera's current image URL and bearing in one 2.7 MB response.
Fetched through Next's data cache with a ten-minute revalidate, so a
once-a-minute tick costs at most six calls an hour.

Filters, each counted in `skipped`: inactive or in-maintenance sites,
third-party sites (442 of 756; they carry an `attribution` the FAA displays
and are excluded until the display shows it), cameras out of order or in
maintenance, no current image, frame older than 30 minutes, outside the band.

**Access.** The API's OpenAPI description says use is subject to the Weather
Camera Program's terms and to contact `9-AJO-WCAM-ProgramOffice@faa.gov` for
access; requests carry `Authorization: Bearer <token>` from
`FAA_WEATHERCAMS_TOKEN`. Without the token the adapter reports itself
`unconfigured` and lists nothing. The site's own browser calls pass with a
`Referer` header alone; the adapter does not do that. Getting the token is
the one step between this branch and frames on the glass.

## Observability

- Cron response: `sources.<name>` with cameras, changed, unchanged,
  attempted, failed, failedByStatus, skipped, elapsedMs, error; and
  `sourceFramesUnchanged`.
- Daily digest: "Sources: faa N cameras today · M in the pool now"
  (`getSourceDigestSummary`, non-Windy sources only, null degrades to
  silence like the other summaries).

## Turn-on

1. Jesse sets `FAA_WEATHERCAMS_TOKEN` in Vercel (env add is classifier-blocked
   for Claude) and redeploys; env vars bake in at deploy time.
2. `node scripts/set-runtime-flag.mjs source_faa on --apply`.
3. Next tick: `sources.faa.cameras` > 0 in the cron response; within a day
   `select count(*) from webcams where source = 'faa'` and a row with
   `azimuth_source = 'faa'` in the pool. Windy box count unchanged.
4. Watch a week of digests before the next source.

## Not in phase 1

- The display-side anti-corruption layer: a neutral Snapshot type consumed by
  the Gate and the tile loaders, deleting `app/studio/solo/toWebcam.ts`.
- Showing attribution on the glass, which is what unlocks the 442 third-party
  FAA sites and every tier-2 source with a credit requirement.
- A per-source line in `daily_sunset_stats` (would need a migration); the
  digest line reads live tables instead.
