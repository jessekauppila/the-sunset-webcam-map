'use client';

import { useState } from 'react';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const hairline = '#232a38';

/**
 * Captures the live pool as a named scene: pinned frames plus the dial
 * positions that produced them, so a composition can be reopened months
 * later and compared against a new one. The API does the pinning; this is
 * the label prompt and the button that were missing from the rail.
 *
 * Deliberately capture-only. Historical reconstruction is the same endpoint
 * with an `at`, but that wants a date picker and belongs in its own control.
 */
/**
 * A `datetime-local` value is a wall-clock string with no zone. Sending it
 * raw is exactly what the API now refuses, and rightly: the server would read
 * it in ITS zone. Constructing a Date from it parses in the BROWSER's zone —
 * the operator's own clock, which is what they meant — and toISOString then
 * pins the real instant.
 */
export function instantFromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function SaveSceneButton({ onSaved }: { onSaved?: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [past, setPast] = useState(false);
  const [when, setWhen] = useState('');
  const [windowMinutes, setWindowMinutes] = useState(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed || busy) return;

    let at: string | null = null;
    if (past) {
      at = instantFromLocalInput(when);
      if (!at) {
        setError('pick a date and time to reconstruct');
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/kiosk/scenes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 'studio': record the dials being tuned, not the deployed ones.
        body: JSON.stringify({
          label: trimmed, tags: [], notes: notes.trim(), provenanceProfile: 'studio',
          ...(at ? { at, windowMinutes } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `save failed (${res.status})`);
      // Report what actually happened. A capture that pinned nothing is a
      // scene that will replay empty, and finding that out in three months
      // is the whole failure this button exists to prevent.
      // Report what actually landed, per mode. A reconstruction that matched
      // few frames and a capture that archived few are both scenes that will
      // replay thin, and the number is the only warning.
      if (body.source === 'historical') {
        setSaved(`rebuilt · ${body.reconstructed ?? 0} frames in window`);
      } else {
        const parts = [`${body.pinned ?? 0} pinned`, `${body.archived ?? 0} archived`];
        setSaved(`saved · ${parts.join(', ')}`);
      }
      setLabel('');
      setNotes('');
      setWhen('');
      setOpen(false);
      onSaved?.(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          data-testid="studio-save-scene"
          onClick={() => {
            setOpen(true);
            setSaved(null);
            setError(null);
          }}
          style={{
            fontSize: 12,
            fontFamily: mono,
            background: '#0e1119',
            color: '#d7dce6',
            border: `1px solid ${hairline}`,
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          save scene
        </button>
        {saved && (
          <span
            data-testid="studio-save-scene-result"
            style={{ fontFamily: mono, fontSize: 11, color: '#4cc38a' }}
          >
            {saved}
          </span>
        )}
        {error && (
          <span
            data-testid="studio-save-scene-error"
            style={{ fontFamily: mono, fontSize: 11, color: '#e5484d' }}
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        autoFocus
        aria-label="scene label"
        data-testid="studio-save-scene-label"
        value={label}
        disabled={busy}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="what is this scene?"
        style={{
          fontSize: 12,
          fontFamily: mono,
          background: '#0e1119',
          color: '#e5e7eb',
          border: `1px solid ${hairline}`,
          borderRadius: 6,
          padding: '4px 8px',
          width: 200,
        }}
      />
      <input
        aria-label="scene notes"
        data-testid="studio-save-scene-notes"
        value={notes}
        disabled={busy}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="notes — why this one is worth keeping"
        style={{
          fontSize: 12,
          fontFamily: mono,
          background: '#0e1119',
          color: '#e5e7eb',
          border: `1px solid ${hairline}`,
          borderRadius: 6,
          padding: '4px 8px',
          width: 260,
        }}
      />
      <div
        role="group"
        aria-label="scene moment"
        style={{ display: 'flex', border: `1px solid ${hairline}`, borderRadius: 6, overflow: 'hidden' }}
      >
        {([false, true] as const).map((isPast) => (
          <button
            key={String(isPast)}
            type="button"
            aria-pressed={past === isPast}
            data-testid={isPast ? 'studio-scene-mode-past' : 'studio-scene-mode-now'}
            onClick={() => setPast(isPast)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontFamily: mono,
              cursor: 'pointer',
              border: 'none',
              background: past === isPast ? '#1d2432' : 'transparent',
              color: past === isPast ? '#e5e7eb' : dim,
            }}
          >
            {isPast ? 'past' : 'now'}
          </button>
        ))}
      </div>

      {past && (
        <>
          <input
            type="datetime-local"
            aria-label="scene moment"
            data-testid="studio-save-scene-when"
            value={when}
            disabled={busy}
            onChange={(e) => setWhen(e.target.value)}
            style={{
              fontSize: 12,
              fontFamily: mono,
              background: '#0e1119',
              color: '#e5e7eb',
              border: `1px solid ${hairline}`,
              borderRadius: 6,
              padding: '4px 8px',
            }}
          />
          <label style={{ fontSize: 11, fontFamily: mono, color: dim, display: 'flex', gap: 4 }}>
            ±
            <input
              type="number"
              aria-label="window minutes"
              data-testid="studio-save-scene-window"
              min={5}
              max={180}
              step={5}
              value={windowMinutes}
              disabled={busy}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
              style={{
                width: 52,
                fontSize: 12,
                fontFamily: mono,
                background: '#0e1119',
                color: '#e5e7eb',
                border: `1px solid ${hairline}`,
                borderRadius: 6,
                padding: '4px 6px',
              }}
            />
            min
          </label>
        </>
      )}

      <button
        type="button"
        data-testid="studio-save-scene-confirm"
        onClick={() => void save()}
        disabled={busy || label.trim() === ''}
        style={{
          fontSize: 12,
          fontFamily: mono,
          background: label.trim() === '' ? '#141a26' : '#1d3a2a',
          color: label.trim() === '' ? '#5a6375' : '#7ee2ac',
          border: `1px solid ${hairline}`,
          borderRadius: 6,
          padding: '4px 10px',
          cursor: label.trim() === '' ? 'default' : 'pointer',
        }}
      >
        {busy ? (past ? 'rebuilding…' : 'capturing…') : past ? 'rebuild' : 'capture'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{
          fontSize: 12,
          fontFamily: mono,
          background: 'transparent',
          color: dim,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        cancel
      </button>
      {error && (
        <span
          data-testid="studio-save-scene-error"
          style={{ fontFamily: mono, fontSize: 11, color: '#e5484d' }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
