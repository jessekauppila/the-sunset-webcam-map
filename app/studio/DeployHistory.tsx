'use client';

import { useEffect, useRef, useState } from 'react';
import type { StudioSettingsApi } from './useStudioSettings';
import type { DeployRow } from '@/app/lib/settings/deploys';
import { profileEquals, summarize } from './deploySummary';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_MAX = 60;

/** How long the duplicate/failure line under the new take stays up. */
const SAVE_NOTE_MS = 4000;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function keyCount(row: DeployRow): number {
  return Object.values(row.namespaces).reduce((n, values) => n + Object.keys(values ?? {}).length, 0);
}

function Badge({ children, color }: { children: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, marginLeft: 4,
      border: `1px solid ${color}`, color, textTransform: 'uppercase', letterSpacing: '.04em',
    }}>{children}</span>
  );
}

/**
 * Every recorded take, newest first, in the rail (spec §4.3). A take is a
 * numbered snapshot of the whole studio profile: some were deployed to the
 * glass, some were only saved. Click a row to put it into the studio; Deploy
 * then sends it to the glass. Nothing here touches live.
 *
 * The badges say which of the four states a row is in:
 * `live` (deployed and equal to what the glass is running) replaces
 * `deployed`; `saved` is a row that was never deployed; `in studio` rides
 * along on whichever row the dials currently match.
 *
 * `saving` is owned by the page, because the button that raises it is in the
 * header and the field it opens is here.
 */
export function DeployHistory({ api, saving, onSavingChange }: {
  api: StudioSettingsApi;
  saving: boolean;
  onSavingChange: (value: boolean) => void;
}) {
  const { deploys, studio, live, loadDeploy, relabelDeploy, saveTake, lastDeployRecorded } = api;
  const [editing, setEditing] = useState<{ id: number; draft: string } | null>(null);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const saveNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (saveNoteTimer.current !== null) clearTimeout(saveNoteTimer.current);
  }, []);

  /** A line at the top of the list that clears itself. */
  const flash = (text: string) => {
    if (saveNoteTimer.current !== null) clearTimeout(saveNoteTimer.current);
    setSaveNote(text);
    saveNoteTimer.current = setTimeout(() => setSaveNote(null), SAVE_NOTE_MS);
  };

  const load = async (row: DeployRow) => {
    setNote(null);
    try {
      const dropped = await loadDeploy(row.id);
      if (dropped.length > 0) {
        const total = keyCount(row);
        setNote({ id: row.id, text: `loaded, ${total - dropped.length} of ${total} keys fit the current schema` });
      }
    } catch (e) {
      setNote({ id: row.id, text: /404/.test(String(e)) ? 'gone' : 'load failed' });
    }
  };

  const saveLabel = async () => {
    if (!editing) return;
    const label = editing.draft.trim().slice(0, LABEL_MAX) || null;
    setEditing(null);
    try {
      await relabelDeploy(editing.id, label);
    } catch {
      setNote({ id: editing.id, text: 'rename failed' });
    }
  };

  /**
   * Saving dials that already equal the newest take is allowed — a label is a
   * reason to save — but the duplicate is named so it is visible.
   */
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const label = draft.trim().slice(0, LABEL_MAX) || null;
    const newest = deploys[0];
    const duplicateOf = newest && profileEquals(newest.namespaces, studio?.namespaces) ? newest.id : null;
    setDraft('');
    setSaveNote(null);
    try {
      const row = await saveTake(label);
      onSavingChange(false);
      if (!row) flash('take not recorded');
      else if (duplicateOf !== null) flash(`same as #${duplicateOf}`);
    } catch {
      onSavingChange(false);
      flash('take not recorded');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const cancelSave = () => {
    setDraft('');
    onSavingChange(false);
  };

  return (
    <section style={{ marginTop: 10, fontFamily: mono, fontSize: 11 }}>
      <h4
        style={{ margin: '0 0 4px', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8b95a7', cursor: 'help' }}
        title="Every take, newest first: saved and deployed snapshots of the dials. Click one to load it into the studio; Deploy then sends it to the glass."
      >
        takes
      </h4>
      {lastDeployRecorded === false && (
        <div style={{ color: '#e5484d', marginBottom: 4 }}>history not recorded (table missing?)</div>
      )}
      {saving && (
        <input
          autoFocus
          value={draft}
          maxLength={LABEL_MAX}
          disabled={busy}
          placeholder="label this take…"
          aria-label="label for the new take"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancelSave();
          }}
          style={{
            width: '100%', marginBottom: 4, background: '#0b0e14', color: '#e5e7eb', border: '1px solid #2a3242',
            borderRadius: 4, fontFamily: mono, fontSize: 11, padding: '2px 4px',
          }}
        />
      )}
      {/* Sits where the new row lands once the list refetches. */}
      {saveNote !== null && <div style={{ color: '#f5a344', marginBottom: 4 }}>{saveNote}</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
        {deploys.map((row, i) => {
          const isSaved = row.deployedAt === null;
          const isLive = !isSaved && profileEquals(row.namespaces, live?.namespaces);
          const inStudio = profileEquals(row.namespaces, studio?.namespaces);
          const isEditing = editing?.id === row.id;
          return (
            <li key={row.id} style={{ borderTop: '1px solid #1d2432', padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => void load(row)}
                  aria-label={`load take #${row.id} into the studio`}
                  title="Load into the studio (undeployed studio edits are discarded)"
                  style={{
                    background: 'transparent', border: 0, padding: 0, color: '#e5e7eb', fontFamily: mono,
                    fontSize: 11, cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0,
                  }}
                >
                  <b style={{ color: '#f5a344' }}>#{row.id}</b>
                  <span style={{ color: '#6b7280', marginLeft: 6 }}>{when(row.deployedAt ?? row.createdAt)}</span>
                  <span style={{ display: 'block', color: '#9aa3b2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {summarize(row, deploys[i + 1])}
                  </span>
                </button>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {isLive && <Badge color="#7ee2ac">live</Badge>}
                  {isSaved
                    ? <Badge color="#c4a7f7">saved</Badge>
                    : !isLive && <Badge color="#8b95a7">deployed</Badge>}
                  {inStudio && <Badge color="#f5a344">in studio</Badge>}
                </span>
              </div>
              {isEditing ? (
                <input
                  autoFocus
                  value={editing.draft}
                  maxLength={LABEL_MAX}
                  aria-label={`label for take #${row.id}`}
                  onChange={(e) => setEditing({ id: row.id, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveLabel();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  style={{
                    width: '100%', marginTop: 2, background: '#0b0e14', color: '#e5e7eb', border: '1px solid #2a3242',
                    borderRadius: 4, fontFamily: mono, fontSize: 11, padding: '2px 4px',
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing({ id: row.id, draft: row.label ?? '' })}
                  aria-label={`label take #${row.id}`}
                  title="Click to rename"
                  style={{
                    background: 'transparent', border: 0, padding: 0, color: row.label ? '#c3cad6' : '#4b5568',
                    fontFamily: mono, fontSize: 11, cursor: 'text', fontStyle: row.label ? 'normal' : 'italic',
                  }}
                >
                  {row.label ?? 'add a label'}
                </button>
              )}
              {note?.id === row.id && <div style={{ color: '#f5a344', marginTop: 2 }}>{note.text}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
