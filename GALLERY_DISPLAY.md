# Gallery Display Terminal — Raspberry Pi Setup

## Overview

This document describes a gallery installation that uses a **Raspberry Pi 4B** to drive two vertical monitors displaying live sunrise and sunset webcam mosaics from **The Sunset Webcam Map**.

## The App

**The Sunset Webcam Map** is a Next.js 15 app that tracks the day/night terminator line and displays webcams near sunrise and sunset worldwide. The app has a **mosaic view mode** that renders a canvas grid of live webcam preview images, sorted geographically (north-to-south by latitude, west-to-east within rows). Tile size is driven by AI quality ratings — higher-rated webcams get larger tiles.

The mosaics are view modes on the home page (`app/page.tsx`), not separate routes. They are rendered by the `MosaicCanvas` component (`app/components/MosaicCanvas/`). The two relevant modes are:

- **`sunrise-mosaic`** — displays webcams near the sunrise terminator
- **`sunset-mosaic`** — displays webcams near the sunset terminator

Webcam data is fetched from a Neon Postgres database via `/api/db-terminator-webcams` and refreshed every 60 seconds. The terminator position and webcam list are updated by a cron job (`/api/cron/update-windy`) that queries the Windy API.

## Hardware

- **Raspberry Pi 4B** (the compute unit)
- **2x 27" Dell monitors** — 1080x1920 (vertical/portrait orientation), 100Hz
- One monitor shows the **sunrise mosaic**, the other shows the **sunset mosaic**

## Display Requirements

- Both monitors run in **portrait/vertical orientation** (1080 wide × 1920 tall)
- Each monitor displays a full-screen mosaic — no browser chrome, no OS UI
- The mosaic layout should adapt to the vertical aspect ratio
- Content updates continuously as the terminator moves and new webcams appear

## Architecture & Deployment

### Local Development

- Use **Docker** to run the app locally for development and testing
- Docker Compose should simulate the dual-display setup as closely as possible
- Local changes are tested in Docker before deploying

### Deployment to Raspberry Pi

- The Pi pulls changes via **git**
- The Pi runs the display app (either via Docker on the Pi, or a lightweight kiosk browser pointing at the hosted app)
- Deployment flow: **local dev → git push → Pi git pull → restart**

### Display Options to Evaluate

1. **Self-hosted on the Pi**: Run the Next.js app (or a static export) directly on the Pi, with two browser windows in kiosk mode
2. **Remote-hosted, Pi as thin client**: The app runs on Vercel/cloud, and the Pi just runs two full-screen Chromium windows pointing at the hosted URLs
3. **Hybrid**: Pi fetches data from the hosted API but renders locally

## Tech Stack (Existing App)

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS 4, MUI 7 |
| State | Zustand, SWR |
| Database | Neon Postgres |
| Maps | Mapbox GL, deck.gl |
| Canvas rendering | HTML5 Canvas (MosaicCanvas component) |
| Hosting | Vercel |

## Key Config

`app/lib/masterConfig.ts` is the single source of truth for runtime tuning. Mosaic-relevant settings:

- `MOSAIC_MAX_IMAGE_HEIGHT_PX` (128)
- `MOSAIC_MIN_IMAGE_HEIGHT_PX` (26)
- `MOSAIC_SIZE_SCALE_STRENGTH`
- `MOSAIC_SIZE_SCALE_MODE` (`'linear'`)
- `canvasMaxImages` is set to 90 in `MainViewContainer.tsx`

These may need tuning for the vertical display format.

## What Needs to Be Built

1. **Docker setup** — `Dockerfile` and `docker-compose.yml` for local development
2. **Pi-specific display routes or config** — Dedicated full-screen mosaic views optimized for 1080×1920 vertical displays (no map controls, no mode toggle, no drawer)
3. **Kiosk/autostart configuration** — Scripts to launch two Chromium instances in kiosk mode on the Pi, one per monitor, each pointing at the correct mosaic
4. **Git-based deployment** — A simple pull-and-restart workflow for the Pi
5. **Display tuning** — Adjust mosaic layout parameters for the vertical aspect ratio and 27" screen size

## Environment Variables Required

- `DATABASE_URL` — Neon Postgres connection string
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox API key (may not be needed for mosaic-only views)
- Firebase credentials (if snapshots are re-enabled)
