'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  mergeSettings,
  diffKeys,
  sanitizeValues,
  stripDefaults,
  type KnobValue,
  type SettingsSchema,
  type SettingsValues,
} from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';
import type { ProfileSettings } from '@/app/lib/settings/store';

const DEBOUNCE_MS = 400;
const SETTINGS_URL = '/api/kiosk/settings';

interface SettingsResponse {
  studio: ProfileSettings;
  live: ProfileSettings;
  lastPollAt: string | null;
}

export interface StudioSettingsApi {
  loading: boolean;
  studio: ProfileSettings | undefined; // server truth incl. optimistic local edits
  live: ProfileSettings | undefined;
  lastPollAt: string | null;
  liveRevision: number; // 0 while loading
  effective: (namespace: string) => SettingsValues; // mergeSettings over studio deviations
  setKnob: (namespace: string, key: string, value: KnobValue) => void;
  resetSection: (namespace: string, section: string) => void; // clears that section's deviations
  diffByNamespace: Record<string, string[]>; // diffKeys(schema, studio[ns], live[ns]) per known ns
  diffCount: number; // total across namespaces — the badge number
  deploy: () => Promise<void>;
  revert: () => Promise<void>;
  deployedAtMs: number | null; // Date.now() at last successful deploy this session
}

function schemaFor(namespace: string): SettingsSchema | null {
  if (namespace === SHARED_NAMESPACE) return SHARED_SCHEMA;
  return MOSAIC_SETTINGS_SCHEMAS[namespace] ?? null;
}

const KNOWN_NAMESPACES = [SHARED_NAMESPACE, ...Object.keys(MOSAIC_SETTINGS_SCHEMAS)];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Owns all studio settings state for /studio: polls the studio+live profiles,
 * layers an optimistic local overlay on top of the studio profile so dials
 * feel live, debounce-PATCHes each namespace's full deviation set 400ms
 * after the last edit, and exposes deploy/revert against the live profile.
 */
export function useStudioSettings(): StudioSettingsApi {
  const { data, isLoading, mutate } = useSWR<SettingsResponse>(SETTINGS_URL, fetcher, {
    refreshInterval: 30_000,
  });

  // Per-namespace optimistic overlay: full local deviation set for a
  // namespace once it has been touched this session, keyed by namespace.
  // `overlay` (state) drives re-renders; `overlayRef` is the synchronous
  // source of truth setKnob/resetSection/flush read and write from — React
  // batches state updates, so reading the `overlay` *state* value back
  // inside the same synchronous event (e.g. two setKnob calls in one
  // act()/handler) would see a stale snapshot and drop the earlier edit.
  const [overlay, setOverlay] = useState<Record<string, SettingsValues>>({});
  const overlayRef = useRef<Record<string, SettingsValues>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [deployedAtMs, setDeployedAtMs] = useState<number | null>(null);

  const flush = useCallback((namespace: string, schema: SettingsSchema) => {
    const values = overlayRef.current[namespace] ?? {};
    const body = {
      namespace,
      values: stripDefaults(schema, sanitizeValues(schema, values)),
    };
    return fetch(SETTINGS_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, []);

  const scheduleFlush = useCallback(
    (namespace: string, schema: SettingsSchema) => {
      if (timers.current[namespace]) clearTimeout(timers.current[namespace]);
      timers.current[namespace] = setTimeout(() => {
        delete timers.current[namespace];
        void flush(namespace, schema);
      }, DEBOUNCE_MS);
    },
    [flush]
  );

  // Cancel every pending per-namespace debounce timer without sending its
  // PATCH — used by revert(), whose whole point is discarding those edits.
  const cancelPending = useCallback(() => {
    for (const namespace of Object.keys(timers.current)) {
      clearTimeout(timers.current[namespace]);
      delete timers.current[namespace];
    }
  }, []);

  // Unmount cleanup: a pending debounce timer must not fire a PATCH from a
  // stale closure after the component that owns this hook has torn down.
  useEffect(() => {
    return () => {
      for (const namespace of Object.keys(timers.current)) {
        clearTimeout(timers.current[namespace]);
      }
      timers.current = {};
    };
  }, []);

  // Cancel every pending per-namespace debounce timer and PATCH its
  // namespace's full deviation set immediately — used by deploy() so a dial
  // moved less than DEBOUNCE_MS before Deploy is still in the studio row
  // that gets copied to live (copyProfile reads whatever exists at POST
  // time; an un-flushed edit would otherwise be silently dropped from the
  // take).
  const flushPending = useCallback(async () => {
    const namespaces = Object.keys(timers.current);
    const patches = namespaces.map((namespace) => {
      clearTimeout(timers.current[namespace]);
      delete timers.current[namespace];
      const schema = schemaFor(namespace);
      if (!schema) return Promise.resolve();
      return flush(namespace, schema);
    });
    await Promise.all(patches);
  }, [flush]);

  const setKnob = useCallback(
    (namespace: string, key: string, value: KnobValue) => {
      const schema = schemaFor(namespace);
      if (!schema) return;
      const base = overlayRef.current[namespace] ?? data?.studio?.namespaces?.[namespace] ?? {};
      const next = sanitizeValues(schema, { ...base, [key]: value });
      overlayRef.current = { ...overlayRef.current, [namespace]: next };
      setOverlay(overlayRef.current);
      scheduleFlush(namespace, schema);
    },
    [data, scheduleFlush]
  );

  const resetSection = useCallback(
    (namespace: string, section: string) => {
      const schema = schemaFor(namespace);
      if (!schema) return;
      const base = overlayRef.current[namespace] ?? data?.studio?.namespaces?.[namespace] ?? {};
      const next: SettingsValues = { ...base };
      for (const knob of schema) {
        if (knob.section === section) delete next[knob.key];
      }
      overlayRef.current = { ...overlayRef.current, [namespace]: next };
      setOverlay(overlayRef.current);
      scheduleFlush(namespace, schema);
    },
    [data, scheduleFlush]
  );

  const studio = useMemo<ProfileSettings | undefined>(() => {
    if (!data?.studio) return undefined;
    if (Object.keys(overlay).length === 0) return data.studio;
    return {
      ...data.studio,
      namespaces: { ...data.studio.namespaces, ...overlay },
    };
  }, [data, overlay]);

  const live = data?.live;

  const effective = useCallback(
    (namespace: string) => {
      const schema = schemaFor(namespace);
      if (!schema) return {};
      return mergeSettings(schema, studio?.namespaces?.[namespace]);
    },
    [studio]
  );

  const diffByNamespace = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const namespace of KNOWN_NAMESPACES) {
      const schema = schemaFor(namespace);
      if (!schema) continue;
      out[namespace] = diffKeys(
        schema,
        studio?.namespaces?.[namespace],
        live?.namespaces?.[namespace]
      );
    }
    return out;
  }, [studio, live]);

  const diffCount = useMemo(
    () => Object.values(diffByNamespace).reduce((sum, keys) => sum + keys.length, 0),
    [diffByNamespace]
  );

  const deploy = useCallback(async () => {
    await flushPending();
    const res = await fetch('/api/kiosk/settings/deploy', { method: 'POST' });
    const json = (await res.json()) as { live: ProfileSettings };
    await mutate(
      (current) => (current ? { ...current, live: json.live } : current),
      { revalidate: false }
    );
    setDeployedAtMs(Date.now());
  }, [flushPending, mutate]);

  const revert = useCallback(async () => {
    cancelPending();
    const res = await fetch('/api/kiosk/settings/revert', { method: 'POST' });
    const json = (await res.json()) as { studio: ProfileSettings };
    await mutate(
      (current) => (current ? { ...current, studio: json.studio } : current),
      { revalidate: false }
    );
    overlayRef.current = {};
    setOverlay({});
  }, [cancelPending, mutate]);

  return {
    loading: isLoading,
    studio,
    live,
    lastPollAt: data?.lastPollAt ?? null,
    liveRevision: data?.live?.revision ?? 0,
    effective,
    setKnob,
    resetSection,
    diffByNamespace,
    diffCount,
    deploy,
    revert,
    deployedAtMs,
  };
}
