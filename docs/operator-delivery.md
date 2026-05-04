# Operator Daily Delivery — Design Stub

Status: Stub — 2026-05-03
Owner: Jesse Kauppila
Companion to: `docs/device-protocol.md` §14

A "give-back" feature for the humans who host custom cameras. Each day, the operator gets the best image their camera produced (the window winner) sent to a destination they choose. Encourages adoption — "host a sunset camera on your roof, get a beautiful sunset photo every evening."

## What it does

After window-winner selection runs (see `device-protocol.md` §9.4), if the camera's `delivery_preferences` is set, the server queues a delivery job. The job:

1. Picks the image (default: that day's window winner for the operator's preferred phase).
2. Renders any framing the operator chose (raw image, with timestamp/location overlay, etc — defer to v2).
3. Delivers via the chosen channel.

Triggered server-side; the device never knows about delivery. All the device declares is the preference at registration time.

## Delivery channels

### v1 (cheap, easy)

- **Email** — image attached or inlined, via SendGrid / Postmark / Resend. Per-message cost: free tier covers many cameras.
- **Personal gallery URL** — `sunrisesunset.studio/my/<opaque-token>` — auth-gated by the token, lists the operator's recent winners. Zero external dependencies, zero per-delivery cost. Always available as a fallback.

### v2 (more work)

- **Google Photos** — uploads the image to a shared album the operator owns. Requires OAuth flow + Library API. Best for non-technical users since "the photo just appears in my Google Photos."
- **SMS / MMS** — Twilio. Per-message cost (~$0.01 SMS, ~$0.02 MMS). Nice for "ping me when there's a great sunset."
- **iCloud Shared Album** — possible via CloudKit but complicated.

### v3 (speculative)

- Push notification to a companion mobile app (only worth it if the AR portal becomes a real app).
- Webhook for technical operators who want their own pipeline.

## Cadence options

- **Daily** (default) — one image per day, the better of sunrise/sunset (or whatever phase preference is set).
- **Per-event** — one image per active window. Two emails/day for `phase_preference: "both"`.
- **Quality-gated** — only deliver when AI score exceeds a threshold (avoid spamming people with mediocre sunsets).
- **Weekly digest** — best of the week. Lower frequency, higher hit rate.

## Stored shape (camera-level)

The protocol's `operator_preferences.delivery` field maps to:

```json
{
  "type": "email" | "personal_gallery_url" | "google_photos" | "sms",
  "target": "operator@example.com" | "+15551234567" | "<token>",
  "cadence": "daily" | "per_event" | "quality_gated" | "weekly_digest",
  "image_choice": "window_winner" | "best_of_window" | "all_above_threshold",
  "include_metadata": true
}
```

Stored as JSONB in `cameras.delivery_preferences`. Server reads this when winner-selection completes and routes accordingly.

## Privacy notes

- Operator preferences include personal data (email, phone). Treat as PII; encrypt at rest if the surrounding infra has that capability.
- Personal-gallery URLs are token-gated, not auth-gated. Fine for this scale; rotate-on-request endpoint should exist.
- Operators can opt out at any time via a link in every delivery email/text.

## Out of scope for this stub

Everything beyond the above shape. Full design when the work starts.
