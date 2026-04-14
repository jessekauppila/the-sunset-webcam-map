# Gallery Kiosk Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/kiosk/sunrise` and `/kiosk/sunset` routes to the Next.js app — stripped-down full-screen mosaic pages optimised for portrait 1080×1920 displays — plus the Pi reload script.

**Architecture:** Two new Next.js app-router pages share a kiosk layout that kills all browser chrome (cursor, scrollbars, padding). Each page calls `useLoadTerminatorWebcams` for live SWR data, reads from `useTerminatorStore`, and passes webcams directly to `MosaicCanvas` sized to the full window. Portrait-tuned config constants live in `masterConfig.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Zustand, SWR, Vitest + React Testing Library, Tailwind CSS 4, bash

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `app/lib/masterConfig.ts` | Add kiosk portrait config constants |
| Create | `app/kiosk/layout.tsx` | Shared kiosk wrapper: black bg, no cursor, no scroll |
| Create | `app/kiosk/sunrise/page.tsx` | Sunrise full-screen mosaic page |
| Create | `app/kiosk/sunset/page.tsx` | Sunset full-screen mosaic page |
| Create | `app/lib/masterConfig.test.ts` | Tests for new kiosk constants |
| Create | `app/kiosk/sunrise/page.test.tsx` | Render test for sunrise kiosk page |
| Create | `app/kiosk/sunset/page.test.tsx` | Render test for sunset kiosk page |
| Create | `scripts/pi/reload-kiosk.sh` | xdotool reload script for Pi |

---

## Task 1: Add kiosk portrait constants to masterConfig.ts

**Files:**
- Modify: `app/lib/masterConfig.ts`
- Create: `app/lib/masterConfig.test.ts` *(add to this file — it may already exist)*

These constants are the starting values for portrait 1080×1920. They will be tuned visually later.

- [ ] **Step 1: Write the failing test**

Create `app/lib/masterConfig.test.ts` (or append if it exists):

```typescript
import { describe, it, expect } from 'vitest';
import {
  KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX,
  KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX,
  KIOSK_CANVAS_MAX_IMAGES,
} from './masterConfig';

describe('kiosk portrait config constants', () => {
  it('KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX is a positive number larger than the default 128', () => {
    expect(typeof KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX).toBe('number');
    expect(KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX).toBeGreaterThan(128);
  });

  it('KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX is a positive number', () => {
    expect(typeof KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX).toBe('number');
    expect(KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX).toBeGreaterThan(0);
  });

  it('KIOSK_CANVAS_MAX_IMAGES is a positive integer', () => {
    expect(typeof KIOSK_CANVAS_MAX_IMAGES).toBe('number');
    expect(KIOSK_CANVAS_MAX_IMAGES).toBeGreaterThan(0);
    expect(Number.isInteger(KIOSK_CANVAS_MAX_IMAGES)).toBe(true);
  });

  it('min height is less than max height', () => {
    expect(KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX).toBeLessThan(
      KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/lib/masterConfig.test.ts
```

Expected: FAIL — `KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX is not exported from './masterConfig'`

- [ ] **Step 3: Add constants to masterConfig.ts**

In `app/lib/masterConfig.ts`, add a new section after the existing mosaic section (after line 117):

```typescript
// ---------------------------------------------------------------------------
// Kiosk display settings (portrait 1080×1920, gallery installation)
// ---------------------------------------------------------------------------
// Tile heights are larger than the default mosaic to fill the taller display.
// Tune these visually using Chrome DevTools at 1080×1920.
export const KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX = 180;
export const KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX = 32;
// More images than default (90) to fill the extra vertical height.
export const KIOSK_CANVAS_MAX_IMAGES = 120;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run app/lib/masterConfig.test.ts
```

Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add app/lib/masterConfig.ts app/lib/masterConfig.test.ts
git commit -m "feat: add kiosk portrait config constants to masterConfig"
```

---

## Task 2: Create kiosk layout

**Files:**
- Create: `app/kiosk/layout.tsx`

This is a server component (no `'use client'`) — it can export `metadata` and wrap both kiosk pages.

- [ ] **Step 1: Create `app/kiosk/layout.tsx`**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sunset Webcam — Kiosk Display',
};

export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-black w-screen h-screen overflow-hidden"
      style={{ cursor: 'none' }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds without errors**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/kiosk/layout.tsx
git commit -m "feat: add kiosk layout with black bg and no cursor"
```

---

## Task 3: Create sunrise kiosk page

**Files:**
- Create: `app/kiosk/sunrise/page.tsx`
- Create: `app/kiosk/sunrise/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/kiosk/sunrise/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SunriseKioskPage from './page';

// MosaicCanvas uses HTMLCanvasElement which jsdom doesn't support — mock it
vi.mock('@/app/components/MosaicCanvas', () => ({
  MosaicCanvas: ({ webcams }: { webcams: unknown[] }) => (
    <div data-testid="mosaic-canvas" data-count={webcams.length} />
  ),
}));

// SWR data fetching — prevent real network calls in tests
vi.mock('@/app/store/useLoadTerminatorWebcams', () => ({
  useLoadTerminatorWebcams: vi.fn(),
}));

// Zustand store — return empty webcams by default
vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: vi.fn((selector: (state: { sunrise: unknown[] }) => unknown) =>
    selector({ sunrise: [] })
  ),
}));

describe('SunriseKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders MosaicCanvas', () => {
    render(<SunriseKioskPage />);
    expect(screen.getByTestId('mosaic-canvas')).toBeDefined();
  });

  it('passes sunrise webcams to MosaicCanvas', () => {
    const { useTerminatorStore } = await import(
      '@/app/store/useTerminatorStore'
    );
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunrise: unknown[] }) => unknown) =>
        selector({ sunrise: [{ webcamId: 1 }, { webcamId: 2 }] })
    );

    render(<SunriseKioskPage />);
    const canvas = screen.getByTestId('mosaic-canvas');
    expect(canvas.getAttribute('data-count')).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/kiosk/sunrise/page.test.tsx
```

Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Create `app/kiosk/sunrise/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { MosaicCanvas } from '@/app/components/MosaicCanvas';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import {
  KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX,
  KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX,
  KIOSK_CANVAS_MAX_IMAGES,
} from '@/app/lib/masterConfig';

export default function SunriseKioskPage() {
  useLoadTerminatorWebcams();
  const webcams = useTerminatorStore((t) => t.sunrise);

  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1080,
    height: typeof window !== 'undefined' ? window.innerHeight : 1920,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <MosaicCanvas
      webcams={webcams}
      width={dimensions.width}
      height={dimensions.height}
      maxImages={KIOSK_CANVAS_MAX_IMAGES}
      padding={2}
      ratingSizeEffect={0.75}
      viewSizeEffect={0.1}
      fillScreenHeight={true}
      maxImageHeight={KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX}
      minImageHeight={KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run app/kiosk/sunrise/page.test.tsx
```

Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add app/kiosk/sunrise/page.tsx app/kiosk/sunrise/page.test.tsx
git commit -m "feat: add /kiosk/sunrise full-screen mosaic page"
```

---

## Task 4: Create sunset kiosk page

**Files:**
- Create: `app/kiosk/sunset/page.tsx`
- Create: `app/kiosk/sunset/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/kiosk/sunset/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SunsetKioskPage from './page';

vi.mock('@/app/components/MosaicCanvas', () => ({
  MosaicCanvas: ({ webcams }: { webcams: unknown[] }) => (
    <div data-testid="mosaic-canvas" data-count={webcams.length} />
  ),
}));

vi.mock('@/app/store/useLoadTerminatorWebcams', () => ({
  useLoadTerminatorWebcams: vi.fn(),
}));

vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: vi.fn((selector: (state: { sunset: unknown[] }) => unknown) =>
    selector({ sunset: [] })
  ),
}));

describe('SunsetKioskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders MosaicCanvas', () => {
    render(<SunsetKioskPage />);
    expect(screen.getByTestId('mosaic-canvas')).toBeDefined();
  });

  it('passes sunset webcams to MosaicCanvas', () => {
    const { useTerminatorStore } = await import(
      '@/app/store/useTerminatorStore'
    );
    vi.mocked(useTerminatorStore).mockImplementation(
      (selector: (state: { sunset: unknown[] }) => unknown) =>
        selector({ sunset: [{ webcamId: 3 }, { webcamId: 4 }, { webcamId: 5 }] })
    );

    render(<SunsetKioskPage />);
    const canvas = screen.getByTestId('mosaic-canvas');
    expect(canvas.getAttribute('data-count')).toBe('3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run app/kiosk/sunset/page.test.tsx
```

Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Create `app/kiosk/sunset/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { MosaicCanvas } from '@/app/components/MosaicCanvas';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import {
  KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX,
  KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX,
  KIOSK_CANVAS_MAX_IMAGES,
} from '@/app/lib/masterConfig';

export default function SunsetKioskPage() {
  useLoadTerminatorWebcams();
  const webcams = useTerminatorStore((t) => t.sunset);

  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1080,
    height: typeof window !== 'undefined' ? window.innerHeight : 1920,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <MosaicCanvas
      webcams={webcams}
      width={dimensions.width}
      height={dimensions.height}
      maxImages={KIOSK_CANVAS_MAX_IMAGES}
      padding={2}
      ratingSizeEffect={0.75}
      viewSizeEffect={0.1}
      fillScreenHeight={true}
      maxImageHeight={KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX}
      minImageHeight={KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run app/kiosk/sunset/page.test.tsx
```

Expected: PASS — 2 tests passing

- [ ] **Step 5: Run all tests to check for regressions**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add app/kiosk/sunset/page.tsx app/kiosk/sunset/page.test.tsx
git commit -m "feat: add /kiosk/sunset full-screen mosaic page"
```

---

## Task 5: Create Pi reload script

**Files:**
- Create: `scripts/pi/reload-kiosk.sh`

- [ ] **Step 1: Create the script**

Create `scripts/pi/reload-kiosk.sh`:

```bash
#!/bin/bash
# Reload all Chromium kiosk windows on the Raspberry Pi.
#
# Usage (from your Mac via SSH):
#   ssh pi@sunsetdisplay 'bash ~/reload-kiosk.sh'
#
# Prerequisites on Pi:
#   sudo apt install -y xdotool   (done during Pi setup)
#
# How it works:
#   xdotool finds all Chromium windows by class name and sends Ctrl+R to each.
#   This triggers a standard browser reload — fast, minimal flash (~1 sec).

DISPLAY=:0 xdotool search --class chromium key --clearmodifiers ctrl+r
echo "Reloaded all kiosk windows"
```

- [ ] **Step 2: Make it executable and syntax-check it**

```bash
chmod +x scripts/pi/reload-kiosk.sh
bash -n scripts/pi/reload-kiosk.sh
echo "Exit code: $?"
```

Expected: `Exit code: 0` (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add scripts/pi/reload-kiosk.sh
git commit -m "feat: add Pi kiosk reload script using xdotool"
```

---

## Task 6: Local verification

No code changes — manual visual verification.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000`

- [ ] **Step 2: Open sunrise kiosk route in Chrome**

Navigate to: `http://localhost:3000/kiosk/sunrise`

Expected: black page with mosaic canvas filling the window. No header, no nav, no controls, cursor hidden.

- [ ] **Step 3: Simulate portrait viewport in Chrome DevTools**

Press `Cmd+Shift+M` (or open DevTools → device toolbar icon). Enter custom dimensions: **width 1080, height 1920**.

Expected: mosaic fills the full portrait area. Webcam tiles are visible and laid out in rows.

- [ ] **Step 4: Verify sunset route**

Navigate to: `http://localhost:3000/kiosk/sunset`

Apply same 1080×1920 viewport.

Expected: same full-screen mosaic layout, showing sunset webcams.

- [ ] **Step 5: Note any layout issues for tuning**

If tiles are too small, too sparse, or the mosaic doesn't fill the portrait area well, adjust these constants in `app/lib/masterConfig.ts` and refresh:

- `KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX` — increase to make tiles taller
- `KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX` — increase minimum tile size
- `KIOSK_CANVAS_MAX_IMAGES` — increase to show more tiles

These are expected to need tuning. Commit tuned values when satisfied:

```bash
git add app/lib/masterConfig.ts
git commit -m "chore: tune kiosk portrait mosaic config values"
```

---

## Notes

**Pi-specific setup** is documented in the spec at `docs/superpowers/specs/2026-04-13-gallery-display-pi-setup-design.md`. The steps there (microSD flash, Argon ONE script, LXDE autostart, Tailscale, WiFi) are operational tasks — follow them in order when setting up the Pi hardware.

**The reload script** (`scripts/pi/reload-kiosk.sh`) should be copied to `~/reload-kiosk.sh` on the Pi during setup, or referenced directly from the repo if the Pi has the repo cloned.

**Portrait layout tuning** happens in Task 6 and is expected to be iterative. The kiosk page structure is stable — only the constants in `masterConfig.ts` change between tuning passes.
