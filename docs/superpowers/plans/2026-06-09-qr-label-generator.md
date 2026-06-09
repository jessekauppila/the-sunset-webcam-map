# QR Label Generator (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a print-ready PNG label for a camera — a scannable QR to `…/setup/{claim_code}` plus human-readable name/URL/claim-code — sized for Nelko P21 14×75mm tape, from a claim code + camera name.

**Architecture:** A pure-ish generation module in the Next.js app (`app/lib/labelGenerator.ts`) using the existing `sharp` + a new `qrcode` dep, driven by a thin CLI (`scripts/generate-label.mjs`). Pure helpers (URL, mm→px) are unit-tested; the compositor is tested for output format/size. A later follow-on (slice 1b) wraps the same module in an owner-gated admin page for live preview — this plan ships the testable core first.

**Tech Stack:** TypeScript, `sharp` (already a dep), `qrcode` (add), `vitest` (`// @vitest-environment node`).

## Scope

Slice 1 of `docs/superpowers/specs/2026-06-08-qr-label-and-shippable-unit-hardening-design.md` §4.1 — the label-generation core + CLI. **Not here:** the admin-page live preview (slice 1b, follow-on — thin wrapper over this module); read-only root (slice 2); cloud log-shipping (slice 3). Each is its own plan.

## Working location

`the-sunset-webcam-map` on branch `feat/qr-label-generator` off `origin/main`. Worktree, `npm install` (or symlink `node_modules`) so `sharp`/`vitest` run. Confirm the branch before each commit. Tests: `npx vitest run <path>`.

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `app/lib/labelGenerator.ts` | `buildSetupUrl`, `labelDimensionsPx`, `generateLabelPng` | Create |
| `app/lib/labelGenerator.test.ts` | unit tests | Create |
| `scripts/generate-label.mjs` | CLI entrypoint | Create |
| `package.json` | add `qrcode` (+ `@types/qrcode` dev) | Modify |

---

### Task 1: `buildSetupUrl` + `labelDimensionsPx` (pure)

**Files:** Create `app/lib/labelGenerator.ts` + `app/lib/labelGenerator.test.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSetupUrl, labelDimensionsPx } from './labelGenerator';

describe('buildSetupUrl', () => {
  it('builds the www setup URL with the claim code', () => {
    expect(buildSetupUrl('SUNSET-7K3M-9XQ2'))
      .toBe('https://www.sunrisesunset.studio/setup/SUNSET-7K3M-9XQ2');
  });
});

describe('labelDimensionsPx', () => {
  it('converts 14x75mm at 300dpi to landscape px (length x width)', () => {
    // 75mm/25.4*300 ≈ 886 ; 14mm/25.4*300 ≈ 165
    const d = labelDimensionsPx({ widthMm: 14, lengthMm: 75 }, 300);
    expect(d.width).toBe(886);
    expect(d.height).toBe(165);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run app/lib/labelGenerator.test.ts` → import error.

- [ ] **Step 3: Implement** (start `app/lib/labelGenerator.ts`):

```typescript
import sharp from 'sharp';
import QRCode from 'qrcode';

const SETUP_BASE = 'https://www.sunrisesunset.studio/setup';

export function buildSetupUrl(claimCode: string): string {
  return `${SETUP_BASE}/${claimCode}`;
}

export type TapeMm = { widthMm: number; lengthMm: number };
export type Dimensions = { width: number; height: number };

export function labelDimensionsPx(tape: TapeMm, dpi: number): Dimensions {
  const mmToPx = (mm: number) => Math.round((mm / 25.4) * dpi);
  // The tape's printable height is its width (14mm); the label length is the image width.
  return { width: mmToPx(tape.lengthMm), height: mmToPx(tape.widthMm) };
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # MUST be feat/qr-label-generator
git add app/lib/labelGenerator.ts app/lib/labelGenerator.test.ts
git commit -m "feat(label): buildSetupUrl + labelDimensionsPx (pure helpers)"
```

---

### Task 2: add `qrcode` dependency

**Files:** Modify `package.json`.

- [ ] **Step 1:** `npm install qrcode && npm install -D @types/qrcode`
- [ ] **Step 2:** Verify it resolves: `node -e "require('qrcode'); console.log('qrcode ok')"` → `qrcode ok`.
- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add qrcode dependency for label generation"
```

---

### Task 3: `generateLabelPng` — composite QR + text via sharp

**Files:** Modify `app/lib/labelGenerator.ts`; modify `app/lib/labelGenerator.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// @vitest-environment node  (add to the existing test file)
import sharp from 'sharp';
import { generateLabelPng } from './labelGenerator';

describe('generateLabelPng', () => {
  it('produces a PNG of the tape dimensions', async () => {
    const png = await generateLabelPng({
      claimCode: 'SUNSET-7K3M-9XQ2',
      name: 'Backyard West',
      tape: { widthMm: 14, lengthMm: 75 },
      dpi: 300,
    });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(886);
    expect(meta.height).toBe(165);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `generateLabelPng` undefined.

- [ ] **Step 3: Implement** (append to `app/lib/labelGenerator.ts`):

```typescript
export type LabelInput = {
  claimCode: string;
  name: string;
  tape: TapeMm;
  dpi?: number;
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function generateLabelPng(input: LabelInput): Promise<Buffer> {
  const dpi = input.dpi ?? 300;
  const { width, height } = labelDimensionsPx(input.tape, dpi);

  // QR fills the label height (minus a small margin); placed on the left.
  const margin = Math.round(height * 0.08);
  const qrSize = height - margin * 2;
  const qrPng = await QRCode.toBuffer(buildSetupUrl(input.claimCode), {
    type: 'png',
    width: qrSize,
    margin: 0,
    errorCorrectionLevel: 'M',
  });

  // Text column to the right of the QR: name (bold), URL, claim code.
  const textX = qrSize + margin * 2;
  const textW = width - textX - margin;
  const fontPx = (px: number) => Math.max(8, Math.round(px));
  const nameSize = fontPx(height * 0.26);
  const lineSize = fontPx(height * 0.2);
  const svg = `<svg width="${textW}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="${fontPx(height * 0.3)}" font-family="sans-serif" font-weight="bold" font-size="${nameSize}">${escapeXml(input.name)}</text>
    <text x="0" y="${fontPx(height * 0.58)}" font-family="sans-serif" font-size="${lineSize}">sunrisesunset.studio/setup</text>
    <text x="0" y="${fontPx(height * 0.85)}" font-family="monospace" font-size="${lineSize}">${escapeXml(input.claimCode)}</text>
  </svg>`;
  const textPng = await sharp(Buffer.from(svg)).png().toBuffer();

  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([
      { input: qrPng, top: margin, left: margin },
      { input: textPng, top: 0, left: textX },
    ])
    .png()
    .toBuffer();
}
```
(If sharp's SVG text rendering needs fonts not present in CI/the Pi-free build env, the test only asserts PNG format + dimensions, which holds regardless of glyph rendering; the visual text is verified in Task 4's manual print.)

- [ ] **Step 4: Run, verify pass.** Then `npx vitest run` (full suite) — no regressions.

- [ ] **Step 5: Commit**

```bash
git add app/lib/labelGenerator.ts app/lib/labelGenerator.test.ts
git commit -m "feat(label): generateLabelPng composites QR + name/URL/claim-code via sharp"
```

---

### Task 4: CLI entrypoint

**Files:** Create `scripts/generate-label.mjs`.

- [ ] **Step 1: Implement** (no unit test — a thin arg-parser over the tested module; verified by printing a real label):

```javascript
#!/usr/bin/env node
// Generate a Nelko-P21 label PNG. Example:
//   node scripts/generate-label.mjs --claim SUNSET-7K3M-9XQ2 --name "Backyard West" --tape 14x75 --out label.png
import { writeFile } from 'node:fs/promises';
import { generateLabelPng } from '../app/lib/labelGenerator.ts';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const claimCode = arg('claim');
const name = arg('name', 'Sunset Camera');
const [widthMm, lengthMm] = arg('tape', '14x75').split('x').map(Number);
const out = arg('out', 'label.png');
if (!claimCode) { console.error('--claim is required'); process.exit(2); }

const png = await generateLabelPng({ claimCode, name, tape: { widthMm, lengthMm } });
await writeFile(out, png);
console.log(`wrote ${out} (${name} / ${claimCode})`);
```
NOTE: importing a `.ts` from `.mjs` needs a loader. If the repo can't run TS directly via node, the implementer should either (a) run it through the repo's existing TS runner (e.g. `tsx scripts/generate-label.mjs` if `tsx` is available — check `package.json`), or (b) make the script `.ts` and run via the repo's TS exec. Confirm which by checking how other `scripts/*.ts` are run (e.g. `scripts/backfill-flickr-scores.ts` exists — match its invocation).

- [ ] **Step 2: Manual verify** — run the CLI with a real claim code, open the PNG, confirm: QR scans to the setup URL, the name/URL/claim-code are legible, dimensions match the tape. Print one on the Nelko to confirm physical legibility at 14×75mm.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-label.mjs
git commit -m "feat(label): generate-label CLI over the label module"
```

---

## Self-Review

- **Spec coverage:** §4.1 label content (QR → setup URL, name/URL/claim-code, no secrets) → Tasks 1+3; 14×75mm sizing → Task 1 `labelDimensionsPx`; parameterized tape → `TapeMm` input; generator → Tasks 3+4. The admin-page live preview (§4.1's recommended UI) is deliberately deferred to slice 1b — this plan ships the tested core it will wrap.
- **Placeholder scan:** none — complete code in every step. (Task 4 names two acceptable invocation options for the `.ts`-from-script question, both pointing at the existing `scripts/*.ts` convention to match — a verify-and-match instruction, not a placeholder.)
- **Type consistency:** `TapeMm`/`Dimensions` and `buildSetupUrl`/`labelDimensionsPx`/`generateLabelPng` signatures are consistent across Tasks 1/3/4 and the CLI.

## Follow-on
- **Slice 1b:** owner-gated admin page (`/admin/label`) that calls `generateLabelPng` for a live preview + Export PNG. The first admin page in the app, so it establishes the page-level owner-gating pattern (build on `app/lib/owner.ts` / `useIsOperator`).
- **Slice 2/3:** read-only root, cloud log-shipping (separate plans).
