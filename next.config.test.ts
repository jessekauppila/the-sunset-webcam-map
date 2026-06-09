import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import nextConfig from './next.config';

/**
 * Guard the Vercel function bundle size. onnxruntime-node + sharp + the
 * Next framework already put us near Vercel's 250 MB function limit (see
 * docs/ml-deploy-runbook.md "Trap 4" and memory/feedback_vercel_nextjs_ml_bundling).
 *
 * Each ResNet-18 ONNX is ~43 MB. We keep BOTH v2 and v4 versions committed in
 * git for rollback-via-re-export, but the live serverless functions only ever
 * load the v4 pair. So `outputFileTracingIncludes` must pin to the specific v4
 * version dirs — a recursive glob over `regression_resnet18`/`binary_resnet18`
 * sweeps the v2 files in too (+86 MB) and pushes the bundle over the limit when
 * the binary head is enabled.
 *
 * This test fails the build if anyone re-broadens the globs or bundles v2.
 */

const MODEL_ROUTES = ['/api/cron/update-cameras', '/api/debug/scoring-smoke'];
// v4 regression (43M) + v4 binary (43M) = 86M. The threshold sits above that
// but well below the 172M you'd get if a v2 model crept back in.
const MAX_BUNDLED_MODEL_BYTES = 120 * 1024 * 1024;

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

  it('pins each include to a real v4 version dir (never v2, never a whole-type glob)', () => {
    for (const route of MODEL_ROUTES) {
      for (const pattern of includes[route] ?? []) {
        const dir = patternDir(pattern);
        // Must point at a specific version dir, not the model-type parent.
        expect(/v4/.test(dir), `pattern is not pinned to a v4 dir: ${pattern}`).toBe(true);
        expect(/v2/.test(dir), `pattern bundles a v2 model: ${pattern}`).toBe(false);
        // The pinned dir + its model.onnx must actually exist on disk.
        expect(fs.existsSync(dir), `pinned dir does not exist: ${dir}`).toBe(true);
        expect(
          fs.existsSync(path.join(dir, 'model.onnx')),
          `no model.onnx under pinned dir: ${dir}`,
        ).toBe(true);
      }
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
