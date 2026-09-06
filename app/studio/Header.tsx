'use client';

import type { CSSProperties, ReactNode } from 'react';
import { MOSAIC_VERSIONS, resolveMosaicName } from '@/app/components/mosaic/registry';
import { PANEL_PRESETS } from '@/app/kiosk/panelPreview';
import { SHARED_SCHEMA, SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import { MapMosaicModeToggle } from '@/app/components/MapMosaicModeToggle';
import { DeployButton } from './DeployButton';
import { formatPollAge } from './pollAge';
import { nextCronMs, formatCountdown } from './solo/countdown';
import type { StudioSettingsApi } from './useStudioSettings';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const dim = '#8b95a7';
const red = '#e5484d';

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
  nowMs,
  extra,
}: {
  api: StudioSettingsApi;
  nowMs: number;
  /** Phase B puts the save-take button here, left of Deploy. */
  extra?: ReactNode;
}) {
  const shared = api.effective(SHARED_NAMESPACE);
  const sharedDiff = api.diffByNamespace[SHARED_NAMESPACE] ?? [];

  const liveVersion = resolveMosaicName(
    mergeSettings(SHARED_SCHEMA, api.live?.namespaces?.shared).activeVersion as string
  );

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
        <label htmlFor="studio-header-version" style={labelStyle(sharedDiff.includes('activeVersion'))}>
          version
        </label>
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
        <label htmlFor="studio-header-panel" style={labelStyle(sharedDiff.includes('panelPreset'))}>
          panel
        </label>
        <select
          id="studio-header-panel"
          aria-label="panel"
          value={String(shared.panelPreset ?? '')}
          onChange={(e) => api.setKnob(SHARED_NAMESPACE, 'panelPreset', e.target.value)}
          style={selectStyle}
        >
          {Object.keys(PANEL_PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
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
