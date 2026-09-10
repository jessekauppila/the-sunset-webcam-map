# Image Source Register — where the pictures could come from

Status: Register — opened 2026-09-09
Owner: Jesse Kauppila
Companion to: `app/api/cron/update-cameras/lib/windyApi.ts`, `docs/superpowers/plans/2026-09-03-pool-retention.md`

Every frame on the glass today comes from one vendor. This is the list of the
other places frames could come from, ranked, so sources can be layered in one
at a time instead of researched again from scratch each time the pool feels
thin.

**Nothing here is urgent.** The pool is adequate. This is a slow-accretion
list: add one source, watch it for a week, add the next.

---

## The two decisions this register was built on

**1. The 10-minute cadence stays.** Windy publishes a new preview every 10.1
minutes (measured 2026-09-02, see `reference_windy_image_freshness`). Faster
sources exist — US state transportation cameras refresh every 30 seconds,
ALERTCalifornia every 15 — and we are deliberately not taking that. Reasons:
it matches what the display already assumes, it bounds storage and scoring
cost, and it keeps one cadence across every source instead of a per-source
special case.

Consequence: **refresh rate is not a ranking axis.** A 30-second source and a
10-minute source are worth the same to us, and we sample the fast one down.

**2. Published aim is the ranking axis instead.** Windy tells us where a
camera *is* and nothing about where it *points*. `webcams.azimuth_deg` and
`azimuth_source` exist for exactly this and are NULL for every Windy row. A
source that publishes each camera's direction fills that column from the
source rather than from a human at the AR placement portal, which is the
single biggest per-camera cost we have.

So the ranking below is: does it point at a horizon, does it tell us which
horizon, is the license clean, and does it fill a geographic hole.

---

## The seam a new source plugs into

Already in place, no migration needed:

- `webcams.source` is free text with `UNIQUE (source, external_id)`. Only
  `windy`, `custom`, and `flickr` are in use. A new source is a new value.
- `webcams.azimuth_deg` / `azimuth_source` / `tilt_deg` / `elevation_m` are
  nullable and were built for custom cameras. A source that publishes
  direction writes `azimuth_source` naming itself.
- The scoring pipeline, the terminator pool, retention grace, and the sweep
  hold are all source-agnostic. They key off lat/lng and `last_seen_at`.

What a new source actually costs: a fetch adapter beside `windyApi.ts`, a
mapping into the `WindyWebcam`-shaped record the tick already consumes, and a
sweep entry. Roughly the shape of `externalBackfill.ts`.

Two things to get right per source:

- **Conditional fetch.** Digitraffic documents ETag support explicitly; most
  static JPEG endpoints support it. A 304 costs nothing. Use it or the bill
  scales with camera count.
- **PTZ.** Some cameras rotate between presets, so one camera id shows
  unrelated scenes. Already true of Windy (id 379, Göhren Pier) and true of
  every wildfire camera. Not a bug, but it breaks any per-camera assumption
  about framing, aim, or scene continuity.

---

## Tier 1 — take these first

### 1. FAA WeatherCams

| | |
|---|---|
| Scale | 299 sites across 32 states, 2 to 4 cameras per site |
| Cadence | 10 minutes, native |
| Aim | **Published per camera**, referenced to a sectional chart |
| License | US federal, public domain |
| Access | `https://weathercams.faa.gov/` — free, no key, no login |
| Extras | Clear-day comparison image and a 6-hour loop per view |
| Verified | Documented, endpoints not called |

The best match on this list and the one to build first. Native 10-minute
cadence means no resampling. Published direction means `azimuth_source` comes
free. Public domain means no permission step. No key means no secret to
rotate or bake into a deploy.

Alaska sites are the prize: the longest civil twilight on Earth, and the
program is concentrated there. A site with four cameras contributes one
guaranteed sunset-facing view regardless of season.

The 6-hour loop is also a training-data source with known aim, which nothing
else here offers.

### 2. ALERTCalifornia / AlertWildfire

| | |
|---|---|
| Scale | 1,200+ HD pan-tilt-zoom cameras |
| Cadence | 15 seconds (sample down) |
| Aim | Viewshed published, but the camera moves |
| License | Public, distributed via ArcGIS Living Atlas |
| Access | `cameras.alertcalifornia.org`, plus an ArcGIS feature service |
| Verified | Documented, endpoints not called |

Mountaintop and ridgeline siting, above the haze layer, which is the best
sunset geometry of anything on this list. Distributed through the ArcGIS
Living Atlas, so there is a real feature-service query path rather than
scraping.

The catch is PTZ. Every camera swings between presets, so a camera id is not a
scene. Treat each fetch as an independent frame and never assume continuity.

### 3. foto-webcam.eu — the alpine pick

| | |
|---|---|
| Scale | Alps, Bavaria, Austria, Switzerland, Italy, plus Greenland |
| Cadence | Not confirmed |
| Aim | Not published |
| License | **Unknown — must ask** |
| Access | No API; predictable image URL patterns |
| Verified | Site read, terms not read |

The one alpine network worth a real email. It is enthusiast-run rather than a
tourism vendor, and its stated engineering goal is image quality *at night*,
which is precisely the window this project lives in and which nothing else on
this list claims.

Permission has a lead time, so send the email early even if the adapter is
months out.

### 4. Panomax

Large alpine network, panoramas up to 230 megapixels, operated for tourism
destinations and ski resorts. No API. Same permission question as above.

### 5. Roundshot

Swiss (Seitz) panorama hardware and hosting, global placements, very high end.
Note that many "ski resort webcams" resolve to Roundshot or Panomax, so ask
the platform, not the resort.

---

## Tier 2 — clean open data, road framing, fills geography

### 6. DriveBC

| | |
|---|---|
| Scale | British Columbia coast and mountains |
| License | **Open Government Licence — BC, commercial use permitted** |
| Access | Open511 spec, XML or JSON; `github.com/bcgov/drivebc-webcam-api` |
| Verified | Documented, endpoints not called |

The cleanest license in the register, and the only one that states commercial
use outright. There is a dedicated webcam API repository, not just a traffic
event feed.

### 7. NZTA (New Zealand)

Open data, **no account required**, GeoJSON and ArcGIS. Images refresh every
minute. Fixes a real hole: the terminator pool is northern-hemisphere heavy,
and New Zealand runs the opposite season, so it changes what the band looks
like in our winter.

### 8. Live Traffic NSW (Australia)

GeoJSON carrying image URL, coordinates, **and a view description field** —
partial aim, unstructured but parseable. Sydney metro plus statewide.

### 9. Finland Digitraffic

470+ road weather cameras, **no key at all**, 10-minute native cadence,
documented ETag conditional requests, thumbnail parameter available. Nordic
latitudes mean long twilight. The zero-friction option if FAA turns out
harder than expected.

### 10. US state 511 systems

Washington (WSDOT), New York, Arizona, Georgia, California. Thousands of
cameras, free developer keys, JSON with image URLs, 30-second refresh.
Georgia's shape is a JSON array with `ImageUrl`. Dense coverage, road framing,
no aim. Take these for count, not for quality.

### 11. Norway, Sweden, Iceland road cameras

Statens vegvesen, Trafikverket, and road.is. Expected to be the same shape as
Digitraffic. **Unverified — I did not confirm these exist as open APIs.**

---

## Tier 3 — small networks, exceptional framing

### 12. NPS air quality webcams

20 national parks, 15-minute updates, US public domain, and genuine scenic
vistas rather than asphalt: Bryce Canyon, Olympic, Mount Rainier, Grand Teton,
Acadia, Point Reyes, Yosemite, Grand Canyon, Denali, Hawai'i Volcanoes and
more. A downloadable historical archive at `nps.gov/airwebcams/` doubles as a
labeling corpus.

Small count, best framing per camera in the register.

### 13. USGS volcano observatory cameras

Hawaiian Volcano Observatory (Kīlauea, Mauna Loa), Cascades Volcano
Observatory (Mount St. Helens / Johnston Ridge), Alaska Volcano Observatory.
Public domain, dramatic, few. International siblings: INGV Osservatorio Etneo
for Etna, and JMA for Japanese volcanoes.

### 14. Observatory cameras

ESO Paranal and La Silla, plus La Palma and Mauna Kea. The driest, clearest
air on the planet, above the cloud deck. Two caveats: the Paranal panoramic
webcam updates hourly, which is *slower* than our floor, and these are
facility cameras pointed at telescopes as often as at horizons.

The genuinely interesting one is ApiCam-3 at Paranal: a 4k × 4k science CCD
behind a 12 mm fisheye giving a 180-degree all-sky field, archived since March
2018 in the ESO Science Archive. That is an archive play, not a live source.

### 15. All-sky camera networks

The AllskyTeam Raspberry Pi allsky project, the AllSkyCams network, AllSky7,
NASA-sponsored CAMS (15 networks worldwide), and the Kiruna all-sky camera
(archived since 2001). Whole-sky fisheye rather than horizon framing, roughly
30-second cadence, hobbyist-operated.

AllSky7 claims its upgraded sensors make twilight read like daylight. Worth a
look purely as a different *kind* of picture.

Note also: the AllskyTeam project is a community already building and sharing
Raspberry Pi sky cameras. Relevant to the custom-camera program, not just to
the pool.

---

## Tier 4 — real, but costly or off-framing

### 16. PhenoCam and NEON towers

Roughly 700 standardized research cameras, US public domain, years of
archive. Framing is forest canopy and sky. A training-set asset rather than a
display source.

### 17. YouTube 24/7 webcam livestreams

Real-time, high definition, global, and enormous. Costs: frame-grab
infrastructure, and a licensing position that is at best gray. Park it until
there is a specific picture we cannot get any other way.

### 18. Ski resort feeds

Usually resolve to Roundshot or Panomax underneath. Go to the platform.

---

## Do not use

| Source | Why |
|---|---|
| EarthCam | No API, terms forbid programmatic use |
| SkylineWebcams, WorldCam | No API, terms forbid it |
| **Insecam** | Unsecured cameras exposed without their owners' knowledge. Off limits, not a licensing question. |
| Surfline | Paid, terms forbid redistribution |
| webcams.travel | Folded into Windy. Same data we already have. |

---

## Recommended order

1. **FAA WeatherCams adapter.** No key, no permission, no cadence work, and it
   fills `azimuth_deg` from the source. Highest value per unit of effort in
   the register.
2. **Email foto-webcam.eu** in parallel, because permission has lead time and
   this is the set most likely to look extraordinary on the glass.
3. **DriveBC**, for the cleanest license and the BC coast.
4. **NZTA**, for the southern hemisphere.
5. Everything else on demand, when a specific hole shows up.

---

## Gaps in this register

- **Asia is missing.** Taiwan publishes freeway CCTV openly, and Japan (JARTIC
  / MLIT), Korea (ITS), and Hong Kong all run camera networks. I could not
  confirm the API shapes. This is the largest unexplored region and it sits
  under a lot of the terminator band.
- **South America and Africa are absent** beyond the ESO sites in Chile.
- **No endpoint in this document has been called.** Everything is from
  published documentation as of 2026-09-09. Treat every cadence, count, and
  license line as unverified until an adapter runs against it.

## Sources

FAA: <https://weathercams.faa.gov/> ·
<https://www.faa.gov/about/office_org/headquarters_offices/ato/service_units/systemops/fs/alaskan/weather_cams>
ALERTCalifornia: <https://alertcalifornia.org/images-and-video/> ·
<https://gis.data.ca.gov/documents/California::alertcalifornia-fire-cameras/explore>
Alpine: <https://www.foto-webcam.eu/> · <https://www.panomax.com/en> ·
<https://www.roundshot.com/en/webcams.html/12>
Road: <https://api.open511.gov.bc.ca/help> ·
<https://github.com/bcgov/drivebc-webcam-api> ·
<https://nzta.govt.nz/traffic-and-travel-information/use-our-data> ·
<https://data.nsw.gov.au/data/dataset/2-live-traffic-cameras> ·
<https://www.digitraffic.fi/en/road-traffic/> ·
<https://www.digitraffic.fi/en/news/2021/07/26/conditional-requests-en.html> ·
<https://wsdot.wa.gov/traffic/api/Documentation/class_highway_cameras.html> ·
<https://511ny.org/developers/help> · <https://511ga.org/developers/doc> ·
<https://www.az511.com/developers/doc> ·
<https://github.com/graphhopper/open-traffic-collection>
Parks and science: <https://www.nps.gov/subjects/air/web-cameras.htm> ·
<https://www.nps.gov/airwebcams/> ·
<https://volcanoes.usgs.gov/images/webcams.php> ·
<https://www.eso.org/public/outreach/webcams/> ·
<https://archive.eso.org/cms/eso-archive-news/APICAM-all-sky-images-from-Paranal-available-in-the-Archive.html>
All-sky: <https://github.com/AllskyTeam/allsky/> ·
<https://www.allskycams.com/network/> · <https://www.allsky7.net/index.html> ·
<https://www.irf.se/allsky/>
Windy, for comparison: <https://api.windy.com/webcams/docs> ·
<https://api.windy.com/webcams/pricing>
