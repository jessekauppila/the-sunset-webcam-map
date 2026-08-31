import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import nextConfig from './next.config';
import {
  AI_ONNX_BINARY_MODEL_PATH_DEFAULT,
  AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT,
} from './app/lib/masterConfig';

/**
 * Guard the Vercel function bundle size. onnxruntime-node + sharp + the
 * Next framework already put us near Vercel's 250 MB function limit (see
 * docs/ml-deploy-runbook.md "Trap 4" and memory/feedback_vercel_nextjs_ml_bundling).
 *
 * Each ResNet-18 ONNX is ~43 MB. Retired versions (v2, v4, non-shipping v5
 * variants) stay committed in git for rollback, but the live serverless
 * functions only ever load the shipping pair — which is defined ONCE, in
 * masterConfig's AI_ONNX_*_MODEL_PATH_DEFAULT. This test derives the
 * expected dirs from those defaults, so bundling and runtime cannot drift
 * apart, and fails the build if anyone re-broadens the globs or bundles a
 * retired model.
 */

const MODEL_ROUTES = [
  '/api/cron/update-cameras',
  '/api/debug/scoring-smoke',
  '/api/kiosk/tick',
];
// One regression (43M) + one binary (43M) = 86M. The threshold sits above
// that but well below the 172M you'd get if a retired model crept back in.
const MAX_BUNDLED_MODEL_BYTES = 120 * 1024 * 1024;

// The shipping pair, from the single source of truth in masterConfig.
const SHIPPING_DIRS = new Set([
  path.dirname(AI_ONNX_BINARY_MODEL_PATH_DEFAULT),
  path.dirname(AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT),
]);

function patternDir(pattern: string): string {
  // Patterns look like './ml/artifacts/models/<type>/<version>/**/*'.
  return pattern.replace(/\/\*\*\/\*$/, '').replace(/^\.\//, '');
}

describe('next.config outputFileTracingIncludes (bundle-size guard)', () => {
  const includes = nextConfig.outputFileTracingIncludes ?? {};

  it('configures model tracing for both ONNX routes', () => {
    for (const route of MODEL_ROUTES) {
      expect(includes[route], `missing tracing includes for ${route}`).toBeDefined();
    }
  });

  it('pins each include to exactly the masterConfig shipping pair (never a whole-type glob)', () => {
    for (const route of MODEL_ROUTES) {
      for (const pattern of includes[route] ?? []) {
        const dir = patternDir(pattern);
        // Must be one of the two dirs the runtime actually loads from.
        expect(
          SHIPPING_DIRS.has(dir),
          `pattern is not a masterConfig shipping-pair dir: ${pattern}`,
        ).toBe(true);
        // The pinned dir + its model.onnx must actually exist on disk.
        expect(fs.existsSync(dir), `pinned dir does not exist: ${dir}`).toBe(true);
        expect(
          fs.existsSync(path.join(dir, 'model.onnx')),
          `no model.onnx under pinned dir: ${dir}`,
        ).toBe(true);
      }
    }
  });

  it('re-includes exactly the shipping pair in .vercelignore (the upload gate tracing depends on)', () => {
    // .vercelignore excludes ml/artifacts/models/<type>/* and re-includes
    // pinned version dirs with `!` lines. outputFileTracingIncludes can only
    // trace files that survived that gate — a stale whitelist ships a bundle
    // with no model and scoring dies at runtime (2026-08-30 deploy).
    const lines = fs
      .readFileSync('.vercelignore', 'utf8')
      .split('\n')
      .map((l) => l.trim());
    const unignored = new Set(
      lines
        .filter((l) => l.startsWith('!ml/artifacts/models/'))
        .map((l) => l.slice(1).replace(/\/$/, '')),
    );
    for (const dir of SHIPPING_DIRS) {
      expect(
        unignored.has(dir),
        `.vercelignore does not re-include shipping dir: !${dir}`,
      ).toBe(true);
    }
    for (const dir of unignored) {
      expect(
        SHIPPING_DIRS.has(dir),
        `.vercelignore re-includes a non-shipping model dir: !${dir}`,
      ).toBe(true);
    }
  });

  it('keeps total bundled model weight under the size budget', () => {
    const seen = new Set<string>();
    let total = 0;
    for (const route of MODEL_ROUTES) {
      for (const pattern of includes[route] ?? []) {
        const file = path.join(patternDir(pattern), 'model.onnx');
        if (seen.has(file)) continue;
        seen.add(file);
        total += fs.statSync(file).size;
      }
    }
    expect(total).toBeLessThan(MAX_BUNDLED_MODEL_BYTES);
  });
});
