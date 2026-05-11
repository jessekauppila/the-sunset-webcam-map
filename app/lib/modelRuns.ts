// app/lib/modelRuns.ts
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Manifest,
  RunIndex,
  FailureGallery,
} from './modelRuns.types';

let publicDirOverride: string | null = null;

/** Test-only seam — production code never calls this. */
export function __setPublicDirForTesting(dir: string | null): void {
  publicDirOverride = dir;
}

function publicDir(): string {
  return publicDirOverride ?? path.join(process.cwd(), 'public');
}

function runsDir(): string {
  return path.join(publicDir(), 'ml-runs');
}

function readJsonOrNull<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

const EMPTY_MANIFEST: Manifest = {
  schema_version: 1,
  generated_at: '',
  runs: [],
};

export function readManifest(): Manifest {
  return readJsonOrNull<Manifest>(
    path.join(runsDir(), '_manifest.json')
  ) ?? EMPTY_MANIFEST;
}

export function readRunIndex(slug: string): RunIndex | null {
  return readJsonOrNull<RunIndex>(
    path.join(runsDir(), slug, 'index.json')
  );
}

export function readFailureGallery(slug: string): FailureGallery | null {
  return readJsonOrNull<FailureGallery>(
    path.join(runsDir(), slug, 'failure_gallery.json')
  );
}

export function listRunSlugs(): string[] {
  return readManifest().runs.map((r) => r.slug);
}
