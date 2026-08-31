'use client';

import { useState } from 'react';
import { useLoadTerminatorWebcams } from '@/app/store/useLoadTerminatorWebcams';
import { PreviewPane, type FeedView } from './PreviewPane';
import type { PanelSize } from '@/app/kiosk/panelPreview';

/**
 * `/studio` chrome: left rail (dial controls, Task 11) + preview + a bottom
 * status strip (Task 13). This task lays out the grid, keeps `railCollapsed`
 * state and the collapse pill, and wires the preview to the live terminator
 * store — the rail's `<aside>` is a placeholder a later task fills in.
 */

// Hard-coded until Task 10 wires the real studio profile + settings.
const PANEL: PanelSize = { width: 1440, height: 2560 };
const PANEL_PRESET_LABEL = 'ktc · 1440×2560';
const VERSION_NAME = 'v1';

const bg = '#0b0e14';
const railBg = '#10141d';
const railBorder = '#1d2432';
const stripBg = '#0e1119';
const stripBorder = '#1d2432';
const dim = '#8b95a7';
const pillBg = 'rgba(16,20,29,.85)';
const pillBorder = '#232a38';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export function StudioClient() {
  useLoadTerminatorWebcams();

  const [railCollapsed, setRailCollapsed] = useState(false);
  const [view, setView] = useState<FeedView>('both');

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: railCollapsed ? '1fr' : '320px 1fr',
        gridTemplateRows: '1fr 28px',
        height: '100vh',
        width: '100%',
        background: bg,
        color: '#e5e7eb',
        overflow: 'hidden',
      }}
    >
      {!railCollapsed && (
        <aside
          style={{
            gridColumn: '1 / 2',
            gridRow: '1 / 2',
            background: railBg,
            borderRight: `1px solid ${railBorder}`,
            overflow: 'auto',
            padding: 16,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: dim }}>
              dials
            </span>
            <button
              type="button"
              onClick={() => setRailCollapsed(true)}
              aria-label="collapse dials"
              style={{
                background: 'transparent',
                border: `1px solid ${railBorder}`,
                borderRadius: 4,
                color: dim,
                fontSize: 12,
                padding: '2px 8px',
                cursor: 'pointer',
              }}
            >
              «
            </button>
          </div>
          <p style={{ fontSize: 12, color: dim, fontFamily: mono, margin: 0 }}>
            dial controls arrive in a later task
          </p>
        </aside>
      )}

      <main
        style={{
          gridColumn: railCollapsed ? '1 / 2' : '2 / 3',
          gridRow: '1 / 2',
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <PreviewPane
          view={view}
          onViewChange={setView}
          panel={PANEL}
          panelPresetLabel={PANEL_PRESET_LABEL}
          versionName={VERSION_NAME}
          settings={undefined}
        />

        {railCollapsed && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: pillBg,
              border: `1px solid ${pillBorder}`,
              borderRadius: 999,
              padding: '6px 8px',
              backdropFilter: 'blur(4px)',
            }}
          >
            <button
              type="button"
              onClick={() => setRailCollapsed(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#e5e7eb',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              » dials
            </button>
          </div>
        )}
      </main>

      <div
        style={{
          gridColumn: '1 / -1',
          gridRow: '2 / 3',
          background: stripBg,
          borderTop: `1px solid ${stripBorder}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          boxSizing: 'border-box',
        }}
      >
        <span style={{ fontFamily: mono, fontSize: 11, color: dim }}>
          status strip — coming in a later task
        </span>
      </div>
    </div>
  );
}
