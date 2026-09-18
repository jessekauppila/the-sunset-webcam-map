---
title: A Vercel edge cache that works can look switched off
date: 2026-09-17
category: docs/solutions/integration-issues
module: mirror-state
problem_type: integration_issue
component: vercel-cdn
symptoms:
  - "A route sets `Cache-Control: s-maxage=N`, and the response a client sees says `public, max-age=0, must-revalidate` or just `public`"
  - "`x-vercel-cache: MISS` on a single curl, read as proof that the CDN never caches the route"
root_cause: misread_measurement
resolution_type: process
severity: medium
tags: [vercel, cdn, cache-control, s-maxage, x-vercel-cache, measurement, mirror, leaderboards]
---

# A Vercel edge cache that works can look switched off

## What happened

Issue #238 reported that the edge cache never applies on
`/api/mirror/state` or `/api/leaderboards`, blamed `export const dynamic =
'force-dynamic'`, and cited one `curl -sI` per route: the served
`cache-control` did not contain the `s-maxage` the code sets, and
`x-vercel-cache` said `MISS`.

Both routes were being cached the whole time. Three requests two seconds
apart, 2026-09-17:

```
/api/leaderboards        MISS (age 0) → HIT (age 2) → HIT (age 4)
/api/mirror/state?feed=  MISS (age 0) → HIT (age 0) → STALE (age 1)
```

## Why it looked off

- **Vercel consumes `s-maxage` and rewrites what the browser sees.** A
  function that sends `s-maxage=60, stale-while-revalidate=120` is cached at
  the edge for 60 s, and the client receives `public, max-age=0,
  must-revalidate` (or `public`). The directive is gone from the response
  *because it was used*, not because it was stripped before use.
- **One request can only ever say MISS.** The first request after a TTL runs
  out is always a miss. With a 1 s TTL, requests spaced more than a second or
  two apart miss every time, so polling it by hand looks like "never cached".
- `force-dynamic` was not the cause. It stops Next from prerendering the route;
  it does not stop Vercel's CDN from caching the function's response.

## How to measure it

Send at least three requests to the **same URL** inside the TTL and read
`x-vercel-cache` and `age` together:

```bash
for i in 1 2 3; do \
  curl -s -D - -o /dev/null "https://www.sunrisesunset.studio/api/leaderboards" \
  | grep -iE "x-vercel-cache|^age"; sleep 2; done
```

`HIT` or `STALE` with a rising `age` means the edge is serving it. Only
`MISS` on every request *inside* the TTL means it is not.

A preview deploy is behind Deployment Protection. `vercel curl <path>
--deployment <url> -- -s -D - -o /dev/null` gets through it and still goes via
the CDN, so the same test works there.

## Why it mattered

The cost fix and the glass-timing risk in #238 both rested on the idea that
the mirror was uncached. It was cached, so the question became whether the
cache is safe for the glass, which the mirror follows, and not how to switch
one on.
