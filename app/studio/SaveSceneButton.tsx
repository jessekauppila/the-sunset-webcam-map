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
export function SaveSceneButton({ onSaved }: { onSaved?: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/kiosk/scenes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 'studio': record the dials being tuned, not the deployed ones.
        body: JSON.stringify({
          label: trimmed, tags: [], notes: '', provenanceProfile: 'studio',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `save failed (${res.status})`);
      // Report what actually happened. A capture that pinned nothing is a
      // scene that will replay empty, and finding that out in three months
      // is the whole failure this button exists to prevent.
      const pinned = typeof body.pinned === 'number' ? body.pinned : null;
      setSaved(pinned === null ? 'saved' : `saved · ${pinned} frames pinned`);
      setLabel('');
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
        {busy ? 'capturing…' : 'capture'}
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
