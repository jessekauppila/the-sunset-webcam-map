---
title: Smoke-testing a prod endpoint that sits behind Vercel Deployment Protection
date: 2026-06-09
category: docs/solutions/workflow-issues
module: ml-scoring-deploy
problem_type: workflow_issue
component: tooling
symptoms:
  - "curl to the per-deployment `*-<hash>-<scope>.vercel.app` URL returns Vercel's `Authentication Required` SSO HTML page (HTTP 401) instead of your app's response"
  - "The app's own `CRON_SECRET` / device auth never even runs — the SSO wall is in front of it"
  - "Guessing stable aliases (`<project>.vercel.app`) just 404s"
root_cause: deployment_protection
resolution_type: process
severity: medium
tags: [vercel, deployment-protection, sso, smoke-test, cron-secret, prod-verification, onnx]
---

# Smoke-testing a prod endpoint that sits behind Vercel Deployment Protection

## Problem

To confirm a deploy actually loaded the ONNX models (vs. a baseline fallback), you hit `/api/debug/scoring-smoke` with the `CRON_SECRET`. Pointed at the **per-deployment URL** (`https://the-sunset-webcam-<hash>-<scope>.vercel.app/...`), curl came back HTTP 401 with Vercel's `Authentication Required` SSO HTML — not the app's auth, not the JSON.

## Symptoms

- The 401 body is a full HTML page mentioning "Vercel Authentication" / SSO redirect, with a `vercel.com/sso-api?url=...` link.
- Your app-level secret (`?secret=` / `Bearer`) is irrelevant — the request never reaches your handler.
- The per-deployment `*.vercel.app` URL is the one GitHub deployment statuses expose, so it's the easy one to grab — and it's exactly the one that's SSO-walled.

## What Didn't Work

- **The per-deployment URL.** Vercel Deployment Protection ("Vercel Authentication") gates deployment-specific URLs even for production builds.
- **Guessing the stable alias** (`the-sunset-webcam-map.vercel.app`, etc.) — all 404.
- **Putting the secret in the query string.** Worse than useless here: the SSO redirect page echoes the full request URL back (URL-encoded) in its HTML, so the `CRON_SECRET` leaks into the response body / your terminal scrollback / any transcript. Rotate it if that happens.

## Solution

Hit the **stable public production domain** — the custom domain users actually visit — which is *not* deployment-protected:

```bash
S=$(grep -E '^CRON_SECRET=' .env.production.local | head -1 | cut -d= -f2- | tr -d '"')
curl -sS -G "https://www.sunrisesunset.studio/api/debug/scoring-smoke" \
  --data-urlencode "secret=$S" | python3 -m json.tool
```

Deployment Protection's "Standard" setting protects preview + per-deployment URLs but leaves the assigned production domain public. If even that is walled, the documented bypasses are `vercel curl`, a Protection-Bypass-for-Automation token (`x-vercel-protection-bypass` header), or Trusted Sources OIDC.

### Reading the result — the latency signature

The smoke JSON tells you the model genuinely loaded:

| Signal | Real ONNX | Baseline / fallback |
|---|---|---|
| `pathTaken` / `binaryPathTaken` | `onnx` | absent / `unscored` |
| `latencyMs` (cold start) | ~1300–1900 ms (loading two 43 MB sessions) | — |
| `latencyMs` (warm) | ~100–500 ms | ~10–20 ms |
| `binaryModelVersion` | matches the pinned artifact | — |

A first call ~1.4 s that drops to ~140 ms on the second call is the fingerprint of a real, now-cached ONNX session. A flat ~15 ms means the baseline path — the model never loaded.

## Prevention

- **Verify prod against the stable public domain, not the per-deployment URL.** Keep that domain in the runbook (here: `www.sunrisesunset.studio`; the apex 307-redirects and strips auth — use `www.`).
- **Never put a secret in a query string against a protected host** — the SSO redirect reflects the URL. Prefer the `Authorization: Bearer` header, or accept the leak and rotate.
- Pairs with [[vercel-bundles-all-model-versions-near-size-limit]] — the smoke latency is how you confirm the bundle actually shipped the model after pinning.
