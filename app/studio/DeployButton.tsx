'use client';

import { useHoldToFire, DEPLOY_HOLD_MS } from './useHoldToFire';

export { DEPLOY_HOLD_MS };

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

// Armed (has deviations) face — red gradient family per mockup addendum §3.
const ARMED_GRADIENT = 'linear-gradient(180deg, #d4444a, #a92e33)';
const ARMED_GLOW = '0 0 0 1px rgba(212,68,74,.45), 0 4px 16px rgba(212,68,74,.45)';

// In-sync (no deviations) face — dark inert.
const SYNC_BG = '#141a26';
const SYNC_BORDER = '#1e2635';
const SYNC_FG = '#5a6375';

// Compact pill's amber diff chip.
const CHIP_BG = '#3a2a12';
const CHIP_FG = '#f5a344';
const CHIP_BORDER = '#6b4a1a';

const FILL_STYLE = `
.studio-deploy-fill {
  position: absolute;
  inset: 0;
  width: 0%;
  background: rgba(255, 255, 255, .22);
  pointer-events: none;
  transition: width ${DEPLOY_HOLD_MS}ms linear;
}
.studio-deploy-fill--holding {
  width: 100%;
}
@media (prefers-reduced-motion: reduce) {
  .studio-deploy-fill {
    transition: none;
  }
}
`;

function subline(diffCount: number): string {
  const noun = diffCount === 1 ? 'setting' : 'settings';
  const verb = diffCount === 1 ? 'differs' : 'differ';
  return `▲ ${diffCount} ${noun} ${verb}`;
}

export function DeployButton({
  diffCount,
  onDeploy,
  onRevert,
  compact = false,
}: {
  diffCount: number;
  onDeploy: () => Promise<void>;
  onRevert: () => Promise<void>;
  compact?: boolean;
}) {
  const inSync = diffCount === 0;

  const { holding, handlers } = useHoldToFire({
    ms: DEPLOY_HOLD_MS,
    onFire: () => {
      void onDeploy();
    },
    disabled: inSync,
  });

  const fillClassName = `studio-deploy-fill${holding ? ' studio-deploy-fill--holding' : ''}`;

  if (compact) {
    return (
      <>
        <style>{FILL_STYLE}</style>
        <button
          type="button"
          {...handlers}
          disabled={inSync}
          aria-label={inSync ? 'in sync with glass' : `deploy — ${diffCount} differ`}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflow: 'hidden',
            background: inSync ? SYNC_BG : ARMED_GRADIENT,
            border: `1px solid ${inSync ? SYNC_BORDER : 'transparent'}`,
            borderRadius: 999,
            color: inSync ? SYNC_FG : '#fff',
            fontFamily: mono,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            padding: '4px 10px',
            cursor: inSync ? 'default' : 'pointer',
            boxShadow: inSync ? 'none' : ARMED_GLOW,
          }}
        >
          <span className={fillClassName} aria-hidden />
          <span style={{ position: 'relative' }}>DEPLOY</span>
          {diffCount > 0 && (
            <span
              style={{
                position: 'relative',
                background: CHIP_BG,
                color: CHIP_FG,
                border: `1px solid ${CHIP_BORDER}`,
                borderRadius: 999,
                padding: '1px 6px',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {diffCount} differ
            </span>
          )}
        </button>
      </>
    );
  }

  return (
    <div>
      <style>{FILL_STYLE}</style>
      <button
        type="button"
        {...handlers}
        disabled={inSync}
        aria-label={inSync ? 'IN SYNC WITH GLASS ✓' : 'HOLD TO DEPLOY'}
        style={{
          position: 'relative',
          overflow: 'hidden',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          background: inSync ? SYNC_BG : ARMED_GRADIENT,
          border: `1px solid ${inSync ? SYNC_BORDER : 'transparent'}`,
          borderRadius: 8,
          color: inSync ? SYNC_FG : '#fff',
          padding: '12px 8px',
          cursor: inSync ? 'default' : 'pointer',
          boxShadow: inSync ? 'none' : ARMED_GLOW,
        }}
      >
        <span className={fillClassName} aria-hidden />
        <span
          style={{
            position: 'relative',
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
          }}
        >
          {inSync ? 'IN SYNC WITH GLASS ✓' : 'HOLD TO DEPLOY'}
        </span>
        <span
          style={{
            position: 'relative',
            fontFamily: mono,
            fontSize: 11,
            opacity: inSync ? 1 : 0.85,
          }}
        >
          {inSync ? 'dials match the deployed state' : subline(diffCount)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          void onRevert();
        }}
        disabled={inSync}
        style={{
          display: 'block',
          marginTop: 6,
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: '#8b95a7',
          fontFamily: mono,
          fontSize: 11,
          padding: '4px 0',
          cursor: inSync ? 'default' : 'pointer',
          opacity: inSync ? 0.35 : 1,
        }}
      >
        ↩ revert to glass
      </button>
    </div>
  );
}
