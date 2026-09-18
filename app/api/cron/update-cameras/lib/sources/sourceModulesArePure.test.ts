import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * A source adapter must be importable by plain tooling (issue #245).
 *
 * `scripts/cap-cost-sweep.ts` calls `parseDigitrafficStations` — a pure GeoJSON
 * parser — and could not, because the adapter imported a flag *key* from
 * `app/lib/runtimeFlags.ts`, which is `import 'server-only'` plus the Neon
 * client. The keys are plain strings; only reading a flag needs the database.
 *
 * This walks the real import graph rather than importing the modules, because
 * vitest aliases `server-only` to a stub (vitest.config.ts) and so cannot
 * observe the failure by importing.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // a package, not our code

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        if (readFileSync(candidate, 'utf8')) return candidate;
      } catch {
        // a directory; keep looking
      }
    }
  }
  return null;
}

/** Every local module reachable from `entry`, including `entry`. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveSpecifier(match[1], file);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen];
}

function declaresServerOnly(file: string): boolean {
  return /^\s*import\s+['"]server-only['"]/m.test(readFileSync(file, 'utf8'));
}

describe('source adapters are importable without a server runtime', () => {
  for (const adapter of ['digitraffic.ts', 'faa.ts']) {
    test(`${adapter} reaches no server-only module`, () => {
      const entry = path.join(__dirname, adapter);

      const offenders = importGraph(entry)
        .filter(declaresServerOnly)
        .map((f) => path.relative(REPO_ROOT, f));

      expect(offenders).toEqual([]);
    });
  }

  test('the flag keys a source declares carry no database dependency', () => {
    const keys = path.join(REPO_ROOT, 'app/lib/runtimeFlagKeys.ts');

    expect(existsSync(keys)).toBe(true);
    expect(importGraph(keys).filter(declaresServerOnly)).toEqual([]);
  });
});
