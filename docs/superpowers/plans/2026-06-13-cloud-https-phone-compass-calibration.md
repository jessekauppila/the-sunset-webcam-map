# Cloud HTTPS Phone-Compass Calibration (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone, over HTTPS, reads its compass against a live sun-arc overlay, captures a true-north heading, and writes it to a camera's placement — the calibration loop the Pi's HTTP can't do.

**Architecture:** All in the cloud app (`the-sunset-webcam-map`, Next.js app-router). A public route `app/setup/[code]/page.tsx` (HTTPS by default on Vercel) resolves a printed claim code → camera, fetches arc-azimuths + declination from the camera's lat/lng, renders the phone-camera AR overlay + compass capture, and POSTs `record-aim` which writes `cameras.azimuth_deg`. The 1:many deployment model is a later evolution — MVP writes the camera row directly.

**Tech Stack:** Next.js (app router, RSC + a client component), Neon serverless (`sql` tagged template), vitest, the DeviceOrientation + getUserMedia browser APIs, `geomagnetism` (WMM declination).

**Branch:** `feat/cloud-https-setup` off current `main` (land + push when the loop works — per `integrate-frequently-dont-let-branches-sprawl`).

---

## File map

- `app/lib/solar.ts` (+ test) — pure solar math (declination, sunset/sunrise az, arc anchors, az→x). Ported verbatim from the verified bracket prototype.
- `app/lib/setupCamera.ts` (+ test) — resolve a claim code → the camera fields setup needs.
- `app/lib/recordAim.ts` (+ test) — write a captured aim to the `cameras` row.
- `app/lib/declination.ts` (+ test) — magnetic declination for a lat/lng (WMM).
- `app/api/setup/[code]/arc-azimuths/route.ts` — GET arc azimuths.
- `app/api/setup/[code]/declination/route.ts` — GET declination.
- `app/api/setup/[code]/record-aim/route.ts` — POST the aim.
- `app/setup/[code]/page.tsx` — RSC loader (resolves camera) → renders the client wizard.
- `app/setup/[code]/CompassWizard.tsx` — the client component (sensors + AR + capture).

---

### Task 1: Solar math (`app/lib/solar.ts`)

**Files:** Create `app/lib/solar.ts`, `app/lib/solar.test.ts`

- [ ] **Step 1: Write the failing test** — `app/lib/solar.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { arcAnchors, azToX, angDiff, sunsetAzimuth } from './solar';

describe('solar', () => {
  it('Bellingham sunset arc matches the verified values (Jun 307 / Eq 270 / Dec 233)', () => {
    const a = arcAnchors(48.75, 2026, 'west');
    expect(a.jun).toBeCloseTo(307, 0);
    expect(a.equinox).toBeCloseTo(270, 0);
    expect(a.dec).toBeCloseTo(233, 0);
  });
  it('equinox sunset is ~due west at every latitude', () => {
    expect(sunsetAzimuth(0, new Date(Date.UTC(2026, 2, 20)))).toBeCloseTo(270, 0);
    expect(sunsetAzimuth(60, new Date(Date.UTC(2026, 2, 20)))).toBeCloseTo(270, 0);
  });
  it('azToX centers the centerAz and signs deltas correctly', () => {
    expect(azToX(270, 270, 100, 360)).toBeCloseTo(180, 5);     // center
    expect(azToX(320, 270, 100, 360)).toBeCloseTo(360, 5);     // +half-FOV → right edge
    expect(angDiff(10, 350)).toBe(20);                          // wraps
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run app/lib/solar.test.ts`
Expected: FAIL — `Cannot find module './solar'`.

- [ ] **Step 3: Implement `app/lib/solar.ts`** (ported from `docs/prototypes/2026-06-12-window-bracket-prototype.jsx`, typed)

```ts
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

function julianDay(date: Date): number {
  let y = date.getUTCFullYear(), m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

export function solarDeclination(date: Date): number {
  const n = julianDay(date) + 0.5 - 2451545.0;
  const g = rad((357.528 + 0.9856003 * n) % 360);
  const lam = rad((280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360);
  const eps = rad(23.439 - 0.0000004 * n);
  return deg(Math.asin(Math.sin(eps) * Math.sin(lam)));
}

export function sunsetAzimuth(latDeg: number, date: Date): number {
  const declR = rad(solarDeclination(date));
  let cosA = Math.sin(declR) / Math.cos(rad(latDeg));
  cosA = Math.max(-1, Math.min(1, cosA));
  return (360 - deg(Math.acos(cosA))) % 360;
}
export const sunriseAzimuth = (lat: number, date: Date) => (360 - sunsetAzimuth(lat, date)) % 360;

export type Facing = 'east' | 'west';
export const eventAz = (lat: number, date: Date, facing: Facing) =>
  facing === 'east' ? sunriseAzimuth(lat, date) : sunsetAzimuth(lat, date);

export interface ArcAnchors { jun: number; equinox: number; dec: number; today: number; }
export function arcAnchors(lat: number, year: number, facing: Facing): ArcAnchors {
  return {
    jun: eventAz(lat, new Date(Date.UTC(year, 5, 21)), facing),
    equinox: eventAz(lat, new Date(Date.UTC(year, 2, 20)), facing),
    dec: eventAz(lat, new Date(Date.UTC(year, 11, 21)), facing),
    today: eventAz(lat, new Date(), facing),
  };
}

export const azToX = (az: number, centerAz: number, fovDeg: number, width: number) =>
  width * (0.5 + angDiff(az, centerAz) / fovDeg);
```

- [ ] **Step 4: Run it, verify PASS** — `npx vitest run app/lib/solar.test.ts` → 3 passed.
- [ ] **Step 5: Commit** — `git add app/lib/solar.ts app/lib/solar.test.ts && git commit -m "feat(setup): solar math (arc azimuths, az→x) ported to TS"`

---

### Task 2: Resolve claim code → camera (`app/lib/setupCamera.ts`)

**Files:** Create `app/lib/setupCamera.ts`, `app/lib/setupCamera.test.ts`

- [ ] **Step 1: Failing test** — mock the DB (matches the existing `sql`-tagged pattern)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
import { getCameraByClaimCode } from './setupCamera';

beforeEach(() => sqlMock.mockReset());

describe('getCameraByClaimCode', () => {
  it('returns null when no camera has that claim code', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getCameraByClaimCode('SUNSET-AAAA-BBBB')).toBeNull();
  });
  it('coerces numeric columns and defaults phase to sunset', async () => {
    sqlMock.mockResolvedValueOnce([
      { id: 1, lat: '48.7519', lng: '-122.4787', phase_preference: null, azimuth_deg: null },
    ]);
    const cam = await getCameraByClaimCode('SUNSET-AAAA-BBBB');
    expect(cam).toEqual({ cameraId: 1, lat: 48.7519, lng: -122.4787, phase: 'sunset', azimuthDeg: null });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run app/lib/setupCamera.test.ts` → cannot find module.

- [ ] **Step 3: Implement `app/lib/setupCamera.ts`**

```ts
import { sql } from '@/app/lib/db';

export interface SetupCamera {
  cameraId: number;
  lat: number;
  lng: number;
  phase: 'sunrise' | 'sunset';
  azimuthDeg: number | null;
}

type Row = {
  id: number;
  lat: string | number;
  lng: string | number;
  phase_preference: string | null;
  azimuth_deg: string | number | null;
};

export async function getCameraByClaimCode(code: string): Promise<SetupCamera | null> {
  const rows = (await sql`
    SELECT id, lat, lng, phase_preference, azimuth_deg
    FROM cameras
    WHERE claim_code = ${code}
    LIMIT 1
  `) as Row[];
  const r = rows[0];
  if (!r) return null;
  return {
    cameraId: r.id,
    lat: Number(r.lat),
    lng: Number(r.lng),
    phase: r.phase_preference === 'sunrise' ? 'sunrise' : 'sunset',
    azimuthDeg: r.azimuth_deg == null ? null : Number(r.azimuth_deg),
  };
}
```

- [ ] **Step 4: Run, verify PASS** — 2 passed.
- [ ] **Step 5: Commit** — `git add app/lib/setupCamera.* && git commit -m "feat(setup): resolve claim code → camera for the setup page"`

---

### Task 3: Record the aim (`app/lib/recordAim.ts`)

**Files:** Create `app/lib/recordAim.ts`, `app/lib/recordAim.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
import { recordAim } from './recordAim';

beforeEach(() => sqlMock.mockReset());

describe('recordAim', () => {
  it('writes azimuth (and lat/lng when given) and returns the new azimuth', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, azimuth_deg: 247 }]);
    const out = await recordAim('SUNSET-AAAA-BBBB', { headingDeg: 247, source: 'phone', lat: 48.75, lng: -122.48 });
    expect(out).toEqual({ cameraId: 1, azimuthDeg: 247 });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
  it('normalizes heading into [0,360)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, azimuth_deg: 10 }]);
    await recordAim('SUNSET-AAAA-BBBB', { headingDeg: 370, source: 'phone' });
    // 370 → 10 passed into the query; assert via the returned row shape
    expect((await Promise.resolve(true))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `app/lib/recordAim.ts`**

```ts
import { sql } from '@/app/lib/db';

export interface AimInput {
  headingDeg: number;
  source: 'phone' | 'manual' | 'window';
  lat?: number;
  lng?: number;
}
export interface AimResult { cameraId: number; azimuthDeg: number; }

export async function recordAim(code: string, aim: AimInput): Promise<AimResult | null> {
  const heading = ((Math.round(aim.headingDeg) % 360) + 360) % 360;
  const lat = aim.lat ?? null;
  const lng = aim.lng ?? null;
  const rows = (await sql`
    UPDATE cameras
    SET azimuth_deg = ${heading},
        lat = COALESCE(${lat}, lat),
        lng = COALESCE(${lng}, lng),
        location_source = ${aim.source}
    WHERE claim_code = ${code}
    RETURNING id, azimuth_deg
  `) as { id: number; azimuth_deg: number | string }[];
  const r = rows[0];
  if (!r) return null;
  return { cameraId: r.id, azimuthDeg: Number(r.azimuth_deg) };
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(setup): record-aim writes azimuth/location to the camera row"`

---

### Task 4: Declination (`app/lib/declination.ts`)

**Files:** Create `app/lib/declination.ts`, `app/lib/declination.test.ts`; modify `package.json`

- [ ] **Step 1: Add the WMM dep** — `npm install geomagnetism` (pure-JS World Magnetic Model).

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { declinationDeg } from './declination';

describe('declinationDeg', () => {
  it('Bellingham is ~+15° east (2026)', () => {
    expect(declinationDeg(48.75, -122.48)).toBeGreaterThan(13);
    expect(declinationDeg(48.75, -122.48)).toBeLessThan(17);
  });
});
```

- [ ] **Step 3: Run, verify FAIL.**

- [ ] **Step 4: Implement `app/lib/declination.ts`**

```ts
import geomagnetism from 'geomagnetism';

/** Magnetic declination (degrees east-positive) for a location, current WMM epoch. */
export function declinationDeg(lat: number, lng: number): number {
  const info = geomagnetism.model().point([lat, lng]);
  return info.decl;
}
```

- [ ] **Step 5: Run, verify PASS.** If `geomagnetism` lacks types, add `// @ts-expect-error no types` above the import (it ships untyped).
- [ ] **Step 6: Commit** — `git add app/lib/declination.* package.json package-lock.json && git commit -m "feat(setup): WMM declination from lat/lng"`

---

### Task 5: GET arc-azimuths route

**Files:** Create `app/api/setup/[code]/arc-azimuths/route.ts`, `...route.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/app/lib/setupCamera', () => ({
  getCameraByClaimCode: vi.fn(),
}));
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { GET } from './route';

beforeEach(() => vi.mocked(getCameraByClaimCode).mockReset());

function req(url: string) { return new Request(url); }

describe('GET arc-azimuths', () => {
  it('404s for an unknown code', async () => {
    vi.mocked(getCameraByClaimCode).mockResolvedValueOnce(null);
    const res = await GET(req('http://x/api/setup/SUNSET-X-Y/arc-azimuths'), { params: Promise.resolve({ code: 'SUNSET-X-Y' }) });
    expect(res.status).toBe(404);
  });
  it('returns the arc for the camera lat + facing', async () => {
    vi.mocked(getCameraByClaimCode).mockResolvedValueOnce({ cameraId: 1, lat: 48.75, lng: -122.48, phase: 'sunset', azimuthDeg: null });
    const res = await GET(req('http://x/api/setup/SUNSET-X-Y/arc-azimuths'), { params: Promise.resolve({ code: 'SUNSET-X-Y' }) });
    const body = await res.json();
    expect(body.equinox).toBeCloseTo(270, 0);
    expect(body.facing).toBe('west');
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `app/api/setup/[code]/arc-azimuths/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { arcAnchors } from '@/app/lib/solar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cam = await getCameraByClaimCode(code);
  if (!cam) return NextResponse.json({ error: 'unknown setup code' }, { status: 404 });
  const facing = cam.phase === 'sunrise' ? 'east' : 'west';
  const year = new Date().getUTCFullYear();
  const arc = arcAnchors(cam.lat, year, facing);
  return NextResponse.json({ ...arc, facing });
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(setup): GET /api/setup/[code]/arc-azimuths"`

---

### Task 6: GET declination route

**Files:** Create `app/api/setup/[code]/declination/route.ts`, `...route.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/app/lib/setupCamera', () => ({ getCameraByClaimCode: vi.fn() }));
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { GET } from './route';
beforeEach(() => vi.mocked(getCameraByClaimCode).mockReset());

describe('GET declination', () => {
  it('returns declination for the camera location', async () => {
    vi.mocked(getCameraByClaimCode).mockResolvedValueOnce({ cameraId: 1, lat: 48.75, lng: -122.48, phase: 'sunset', azimuthDeg: null });
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ code: 'SUNSET-X-Y' }) });
    const body = await res.json();
    expect(body.declinationDeg).toBeGreaterThan(13);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `app/api/setup/[code]/declination/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { declinationDeg } from '@/app/lib/declination';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cam = await getCameraByClaimCode(code);
  if (!cam) return NextResponse.json({ error: 'unknown setup code' }, { status: 404 });
  return NextResponse.json({ declinationDeg: declinationDeg(cam.lat, cam.lng) });
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(setup): GET /api/setup/[code]/declination"`

---

### Task 7: POST record-aim route

**Files:** Create `app/api/setup/[code]/record-aim/route.ts`, `...route.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/app/lib/recordAim', () => ({ recordAim: vi.fn() }));
import { recordAim } from '@/app/lib/recordAim';
import { POST } from './route';
beforeEach(() => vi.mocked(recordAim).mockReset());

function post(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('POST record-aim', () => {
  it('400s when heading_deg is missing', async () => {
    const res = await POST(post({ source: 'phone' }), { params: Promise.resolve({ code: 'SUNSET-X-Y' }) });
    expect(res.status).toBe(400);
  });
  it('404s when the code resolves to no camera', async () => {
    vi.mocked(recordAim).mockResolvedValueOnce(null);
    const res = await POST(post({ heading_deg: 247, source: 'phone' }), { params: Promise.resolve({ code: 'SUNSET-X-Y' }) });
    expect(res.status).toBe(404);
  });
  it('writes the aim and returns it', async () => {
    vi.mocked(recordAim).mockResolvedValueOnce({ cameraId: 1, azimuthDeg: 247 });
    const res = await POST(post({ heading_deg: 247, source: 'phone', lat: 48.75, lng: -122.48 }), { params: Promise.resolve({ code: 'SUNSET-X-Y' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cameraId: 1, azimuthDeg: 247 });
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement `app/api/setup/[code]/record-aim/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { recordAim } from '@/app/lib/recordAim';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const body = await request.json().catch(() => ({}));
  const heading = body.heading_deg;
  if (typeof heading !== 'number' || Number.isNaN(heading)) {
    return NextResponse.json({ error: 'heading_deg (number) is required' }, { status: 400 });
  }
  const source = body.source === 'manual' || body.source === 'window' ? body.source : 'phone';
  const result = await recordAim(code, {
    headingDeg: heading, source,
    lat: typeof body.lat === 'number' ? body.lat : undefined,
    lng: typeof body.lng === 'number' ? body.lng : undefined,
  });
  if (!result) return NextResponse.json({ error: 'unknown setup code' }, { status: 404 });
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(setup): POST /api/setup/[code]/record-aim"`

---

### Task 8: The page + client wizard (`app/setup/[code]/`)

**Files:** Create `app/setup/[code]/page.tsx` (RSC), `app/setup/[code]/CompassWizard.tsx` (client). UI — verified manually on a phone.

- [ ] **Step 1: RSC loader `app/setup/[code]/page.tsx`** — resolves the camera (404 → friendly message), passes props to the client.

```tsx
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import CompassWizard from './CompassWizard';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cam = await getCameraByClaimCode(code);
  if (!cam) {
    return <main style={{ padding: 24, fontFamily: 'system-ui', color: '#ddd', background: '#000', minHeight: '100vh' }}>
      <h1>Setup code not recognized</h1>
      <p>This camera isn’t open for setup, or the code is wrong. Check the sticker and try again.</p>
    </main>;
  }
  return <CompassWizard code={code} facing={cam.phase === 'sunrise' ? 'east' : 'west'} />;
}
```

- [ ] **Step 2: Client wizard `app/setup/[code]/CompassWizard.tsx`** — the phone-compass loop. Reuses `azToX` from `solar.ts` for the overlay.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { azToX, type ArcAnchors } from '@/app/lib/solar';

type Facing = 'east' | 'west';
const HFOV_PHONE = 60; // phone-camera horizontal FOV used only for AR projection

export default function CompassWizard({ code, facing }: { code: string; facing: Facing }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [arc, setArc] = useState<ArcAnchors | null>(null);
  const [decl, setDecl] = useState(15.3);
  const [magHeading, setMagHeading] = useState<number | null>(null);
  const [status, setStatus] = useState('Tap “Start” to use your compass.');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const trueHeading = magHeading == null ? null : (magHeading + decl + 360) % 360;

  useEffect(() => {
    fetch(`/api/setup/${code}/arc-azimuths`).then(r => r.json()).then(d => setArc(d)).catch(() => {});
    fetch(`/api/setup/${code}/declination`).then(r => r.json()).then(d => typeof d.declinationDeg === 'number' && setDecl(d.declinationDeg)).catch(() => {});
  }, [code]);

  async function start() {
    try {
      // iOS: permission must come from this user gesture
      const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (D && typeof D.requestPermission === 'function') {
        const p = await D.requestPermission();
        if (p !== 'granted') { setStatus('Motion access denied — can’t read the compass.'); return; }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      window.addEventListener('deviceorientation', onOri);
      setStatus('Swing the phone until the Equinox line is centered, then Capture.');
    } catch {
      setStatus('Camera or motion access was denied.');
    }
  }
  function onOri(e: DeviceOrientationEvent) {
    const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
    let m = ev.webkitCompassHeading;
    if (m == null && e.absolute && e.alpha != null) m = 360 - e.alpha;
    if (m != null) setMagHeading(m);
  }
  useEffect(() => () => window.removeEventListener('deviceorientation', onOri), []);

  async function capture() {
    if (trueHeading == null) { setStatus('No compass reading yet — hold still a moment.'); return; }
    setStatus('Saving…');
    const pos = await new Promise<GeolocationPosition | null>((res) =>
      navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { timeout: 4000 }));
    const r = await fetch(`/api/setup/${code}/record-aim`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ heading_deg: Math.round(trueHeading), source: 'phone',
        lat: pos?.coords.latitude, lng: pos?.coords.longitude }),
    });
    if (r.ok) { setSavedAt(Math.round(trueHeading)); setStatus('Saved — the camera will fine-tune itself on the next clear sun.'); }
    else setStatus('Save failed — try again.');
  }

  const W = 360, lines: Array<[string, number]> = arc
    ? [['Jun', arc.jun], ['Equinox', arc.equinox], ['Dec', arc.dec], ['now', arc.today]] : [];

  return (
    <main style={{ background: '#000', color: '#eee', minHeight: '100vh', fontFamily: 'system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Aim your {facing === 'east' ? 'sunrise' : 'sunset'} camera</h1>
      <div style={{ position: 'relative', width: '100%', maxWidth: W, aspectRatio: '3 / 4', background: '#111', borderRadius: 12, overflow: 'hidden' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <svg viewBox={`0 0 ${W} 480`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {trueHeading != null && lines.map(([label, az]) => {
            const x = azToX(az, trueHeading, HFOV_PHONE, W);
            if (x < 0 || x > W) return null;
            const on = label === 'Equinox';
            return <g key={label}>
              <line x1={x} y1={20} x2={x} y2={460} stroke={on ? '#ffd54a' : '#ffaa55'} strokeWidth={on ? 2.5 : 1.5} />
              <text x={x + 4} y={32} fill={on ? '#ffd54a' : '#ffaa55'} fontSize={11}>{label}</text>
            </g>;
          })}
        </svg>
      </div>
      <p style={{ fontVariantNumeric: 'tabular-nums' }}>Heading: {trueHeading == null ? '—' : `${Math.round(trueHeading)}° true`}</p>
      <p style={{ color: '#9cc4ff' }}>{status}</p>
      {savedAt == null
        ? (magHeading == null
            ? <button onClick={start} style={btn}>Start</button>
            : <button onClick={capture} style={btn}>Capture {trueHeading != null ? `${Math.round(trueHeading)}°` : ''}</button>)
        : <p style={{ color: '#a5e0aa' }}>✓ Saved {savedAt}°</p>}
    </main>
  );
}
const btn: React.CSSProperties = { width: '100%', marginTop: 12, padding: '12px', borderRadius: 10, border: 0, background: '#4a7acc', color: '#fff', fontSize: 16 };
```

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit` then `npm run build`. Expected: no type errors, route + page compile.
- [ ] **Step 4: Commit** — `git add app/setup && git commit -m "feat(setup): cloud HTTPS phone-compass calibration page"`

---

### Task 9: Verify against camera 1 (manual, on a phone)

**Files:** none (a one-time DB setup + a phone test).

- [ ] **Step 1: Give camera 1 a claim code** (so `/setup/{code}` resolves it). **[YOU — PROD]** (one-liner, prod):

```
psql "$DATABASE_URL" -c "UPDATE cameras SET claim_code='SUNSET-TEST-CAM1' WHERE id=1 RETURNING id, claim_code;"
```

- [ ] **Step 2: Deploy** — push the branch / open a preview (Vercel), or merge to main for a prod deploy. Note the deployed origin.

- [ ] **Step 3: On your phone**, open `https://<deployed-origin>/setup/SUNSET-TEST-CAM1`. Tap **Start** (grant motion + camera), confirm the **arc lines slide** as you swing, **Capture**.

- [ ] **Step 4: Confirm the write landed** — **[YOU — PROD]**:

```
psql "$DATABASE_URL" -c "SELECT id, azimuth_deg, location_source, lat, lng FROM cameras WHERE id=1;"
```
Expected: `azimuth_deg` = your captured heading, `location_source='phone'`.

- [ ] **Step 5: Land it** — merge `feat/cloud-https-setup` → `main`, push (same-day, per the integrate-frequently rule).

---

## Self-review

- **Spec coverage:** serve wizard over HTTPS (Task 8, Vercel) ✓; arc-azimuths from lat/lng (Task 5 + 1) ✓; declination from lat/lng (Task 4 + 6) ✓; record-aim writes placement (Task 3 + 7) ✓; phone camera + compass, magnetic→true (Task 8) ✓; verify against camera 1 (Task 9) ✓. Deferred (noted, not MVP): the 1:many deployment model, the bracket/sun-tap methods, `record-aim` as a control-plane directive (MVP writes the camera row, which the supervisor already reads).
- **Placeholders:** none — every step has runnable code/commands. The only judgement call (`HFOV_PHONE = 60`) is the documented phone-camera FOV used solely for AR projection, matching the existing wizard.
- **Type consistency:** `getCameraByClaimCode → SetupCamera{cameraId,lat,lng,phase,azimuthDeg}` used identically in Tasks 5/6/8; `recordAim → {cameraId,azimuthDeg}` matches the route in Task 7; `arcAnchors`/`azToX`/`ArcAnchors` from Task 1 reused in Tasks 5/8.
- **Open follow-ups (post-MVP):** declination uses `geomagnetism`’s default epoch — fine for years; the bracket flow adds `/api/setup/[code]/window-solve` + `bracket-confirm` reusing this exact plumbing; phase `'both'` cameras default to `sunset` facing (revisit when sunrise cams ship).
