'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { MOSAIC_VERSIONS, resolveMosaicName } from '@/app/components/mosaic/registry';
import { PANEL_PRESETS } from '@/app/kiosk/panelPreview';
import { SHARED_SCHEMA, SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import { MapMosaicModeToggle } from '@/app/components/MapMosaicModeToggle';
import { DeployButton } from './DeployButton';
import { formatPollAge } from './pollAge';
import { nextCronMs, formatCountdown } from './solo/countdown';
import { LabeledControl } from './Rail';
import type { StudioSettingsApi } from './useStudioSettings';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const red = '#e5484d';

/** What discard does, said plainly: it is destructive to unsaved work. */
const DISCARD_TITLE =
  "Copy the glass's dials back into the studio, discarding undeployed edits";

/** What a dropped key means, in the one place that now reports them. */
const DROPPED_TITLE =
  'The server stored every other value but discarded these. An ' +
  '"unknown" key means this build has no such dial, so deploy the ' +
  'code before setting it; "invalid" means the value itself was ' +
  'rejected.';

const selectStyle: CSSProperties = {
  background: '#141a26',
  border: '1px solid #1e2635',
  borderRadius: 6,
  color: '#d7dce5',
  fontFamily: mono,
  fontSize: 11,
  padding: '3px 6px',
};

/** A dial that deviates from the glass names itself in bold. */
function labelStyle(deviates: boolean): CSSProperties {
  return {
    color: deviates ? '#d7dce5' : dim,
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: '0.08em',
    fontWeight: deviates ? 700 : 400,
  };
}

/**
 * The header's own second-hand. The status line counts down to the next cron
 * pull, so it needs a clock — but it is the only thing on the mosaic surface
 * that does, and a clock hoisted into `StudioClient` re-rendered the mosaic
 * preview once a second, restarting its motion. Tests pin `nowMs` and get no
 * interval at all.
 */
function useNow(fixed: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fixed]);
  return fixed ?? now;
}

/**
 * The one-studio page's top row: what the glass is running, what the dials
 * say, and the two ways out (deploy, navigate).
 *
 * The status line reads the LIVE profile's version, never the studio one —
 * "glass" means the picture the kiosk is drawing right now, which is exactly
 * what an undeployed studio edit has not changed yet.
 *
 * Everything but the status line is `flex: none`; the status line is the only
 * member allowed to shrink, so a long line ellipsizes instead of pushing
 * Deploy and the nav toggle off the row.
 */
export function Header({
  api,
  nowMs: fixedNowMs,
  extra,
}: {
  api: StudioSettingsApi;
  /** Tests pin the clock; in the app the header runs its own (see `useNow`). */
  nowMs?: number;
  /** Phase B puts the save-take button here, left of Deploy. */
  extra?: ReactNode;
}) {
  const nowMs = useNow(fixedNowMs);
  const shared = api.effective(SHARED_NAMESPACE);
  const sharedDiff = api.diffByNamespace[SHARED_NAMESPACE] ?? [];

  const liveVersion = resolveMosaicName(
    mergeSettings(SHARED_SCHEMA, api.live?.namespaces?.shared).activeVersion as string
  );

  const describe = (key: string) => SHARED_SCHEMA.find((k) => k.key === key)?.description ?? '';
  const versionHint = describe('activeVersion');
  const panelHint = describe('panelPreset');

  const parts = [
    `glass ${liveVersion}`,
    `rev ${api.liveRevision}`,
    api.diffCount > 0 ? `${api.diffCount} differ` : 'dials match glass',
    `next pull ${formatCountdown(nextCronMs(nowMs) - nowMs)}`,
    `polled ${formatPollAge(api.lastPollAt ? Date.parse(api.lastPollAt) : null, nowMs)}`,
  ];

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 10px',
        height: '100%',
        background: '#0e1119',
        borderBottom: '1px solid #1d2432',
      }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: dim,
          flex: 'none',
        }}
      >
        STUDIO
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
        <LabeledControl id="studio-header-version" description={versionHint} style={labelStyle(sharedDiff.includes('activeVersion'))}>
          version
        </LabeledControl>
        <select
          id="studio-header-version"
          aria-label="version"
          value={String(shared.activeVersion ?? '')}
          onChange={(e) => api.setKnob(SHARED_NAMESPACE, 'activeVersion', e.target.value)}
          style={selectStyle}
        >
          {Object.keys(MOSAIC_VERSIONS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
        <LabeledControl id="studio-header-panel" description={panelHint} style={labelStyle(sharedDiff.includes('panelPreset'))}>
          panel
        </LabeledControl>
        <select
          id="studio-header-panel"
          aria-label="panel"
          value={String(shared.panelPreset ?? '')}
          onChange={(e) => api.setKnob(SHARED_NAMESPACE, 'panelPreset', e.target.value)}
          style={selectStyle}
        >
          {/* The old mosaic preview carried a `dell-l · 1920×1080` chip; the
              geometry lives on the option itself now, so the row that picks
              the panel is also the row that says how big it is. */}
          {Object.entries(PANEL_PRESETS).map(([name, size]) => (
            <option key={name} value={name}>
              {`${name} · ${size.width}×${size.height}`}
            </option>
          ))}
        </select>
      </span>

      <span
        data-testid="status-line"
        style={{
          fontFamily: mono,
          fontSize: 11,
          color: dim,
          // '0px', not 0: React emits a bare "0" for the number, which some CSS
          // parsers (jsdom's included) drop, leaving the line unshrinkable.
          minWidth: '0px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginLeft: 'auto',
        }}
      >
        {parts.join(' · ')}
        {api.droppedKeys.length > 0 && (
          <>
            {' · '}
            <span data-testid="status-dropped" style={{ color: red }} title={DROPPED_TITLE}>
              ⚠ {api.droppedKeys.length} dropped
            </span>
          </>
        )}
      </span>

      {extra !== undefined && <span style={{ flex: 'none' }}>{extra}</span>}

      {/* Deploy's compact form has no revert secondary, so the way back from a
          set of edits you don't want lives here instead of inside it. */}
      <button
        type="button"
        data-testid="discard-changes"
        title={DISCARD_TITLE}
        disabled={api.diffCount === 0}
        onClick={() => void api.revert()}
        style={{
          flex: 'none',
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontFamily: mono,
          fontSize: 11,
          color: api.diffCount === 0 ? '#4b5568' : dim,
          cursor: api.diffCount === 0 ? 'default' : 'pointer',
        }}
      >
        ↩ discard
      </button>

      <span style={{ flex: 'none' }}>
        <DeployButton
          compact
          diffCount={api.diffCount}
          onDeploy={api.deploy}
          onRevert={api.revert}
        />
      </span>

      <div
        data-testid="nav-slot"
        style={{
          flex: 'none',
          borderLeft: '1px solid #2a3242',
          paddingLeft: 12,
          marginLeft: 4,
        }}
      >
        <MapMosaicModeToggle mode="studio" />
      </div>
    </header>
  );
}
