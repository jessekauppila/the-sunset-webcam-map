---
title: Gate private-studio writes at the API layer, not just the UI
date: 2026-06-02
category: conventions
module: web-studio-auth
problem_type: convention
component: authentication
severity: high
applies_when:
  - Adding rating, verdict, or any write action to the private drawer/studio
  - Splitting the site into a public face and a private studio
  - Adding a new API route that mutates data
tags: [auth, api-security, write-protection, nextjs, studio, drawer]
related_components: [database, service_object]
---

# Gate private-studio writes at the API layer, not just the UI

## Context
The site is splitting into a public face (show-don't-tell live map + leaderboards) and
a private studio (the drawer: rating, archive, model comparison, live dummy-check).
The instinct is to make the drawer "private" by hiding it behind a login.

## Guidance
Hiding the drawer in the UI is **cosmetic** — an attacker calls the API route directly.
Every write endpoint (rating, `is_sunset_verdict`, archive edits, cleanup triggers)
must verify the authenticated session **server-side**, in the route handler/middleware,
independent of whether the UI is shown. Recommended shape: a single allow-listed login
(Auth.js / NextAuth with one permitted Google account for now), Next.js middleware
guarding the private routes, and an explicit session check inside each mutating handler.
Public read endpoints (leaderboards, live map) stay open.

## Why This Matters
The labeling pipeline is the model's source of truth; unauthenticated writes could
poison gold labels or trigger destructive cleanup. UI-only gating gives a false sense
of security. Enforcing at the API layer is the actual protection, and a single
allow-listed login avoids a password to leak/rotate while leaving room to add trusted
raters later.

## When to Apply
- Before shipping any drawer write control.
- Whenever adding an API route under the private/studio surface.

## Examples
- Wrong: render the rating buttons only when logged in, but `POST /api/ratings`
  accepts any caller.
- Right: `POST /api/studio/ratings` returns 401 unless `getServerSession()` matches
  the allow-listed account; the button is hidden too, but the hide is not the control.

## Related
- STRATEGY.md — Track 3 (public hub + private studio); anchored truth on write-layer gating
- Future `/ce-brainstorm`: public/private split
