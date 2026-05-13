// Stub for 'server-only' in vitest — the real package throws in non-Server-Component
// contexts to prevent accidental client bundling. Vitest's jsdom environment trips
// that guard. This stub is aliased in via vitest.config.ts and never reaches the
// production build (Next.js bundles the real package).
export {};
