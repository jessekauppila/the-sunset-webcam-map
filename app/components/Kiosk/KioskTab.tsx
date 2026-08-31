'use client';

import { Box, Typography, Link as MuiLink } from '@mui/material';

/**
 * Operator-facing launcher and reference for kiosk composition tuning.
 *
 * The panel previews are the thing worth one click: composing at a panel's real
 * dimensions is not something a resized browser window can approximate, so the
 * links carry the right `panel=` rather than leaving it to be remembered.
 *
 * Kept in sync with `docs/ops/kiosk-composition-tuning.md`.
 */

const FEEDS = ['sunrise', 'sunset'] as const;
const PANELS = [
  { key: 'dell', label: 'Dell', detail: '1080 × 1920' },
  { key: 'ktc', label: 'KTC', detail: '1440 × 2560' },
] as const;

const PARAMS: { param: string; effect: string; range: string }[] = [
  { param: 'floor', effect: 'smallest tile', range: '10–1000 (default 100)' },
  { param: 'ceil', effect: 'largest tile', range: '10–2000 (default 300)' },
  { param: 'upscale', effect: 'max stretch past native', range: '1–5 (default 1.5)' },
  { param: 'growth', effect: 'sparse-fill search limit', range: '1–10 (default 2)' },
  { param: 'pad', effect: 'gap between tiles', range: '0–64 (default 2)' },
  { param: 'cull', effect: 'drop overflow vs compress it', range: '0 or 1 (default 1)' },
  { param: 'lat', effect: 'latitude window', range: 'north,south (default 70,-60)' },
  { param: 'panel', effect: 'compose for a panel, scaled to fit', range: 'dell, ktc, or WxH' },
  { param: 'quiet', effect: 'nightly doze hours', range: 'H-H or off (default 1-8)' },
  { param: 'setup', effect: 'per-tile lat/lng + percentile overlay', range: '1 to show' },
];

const previewHref = (feed: string, panel: string) =>
  `/kiosk/${feed}?panel=${panel}&setup=1`;

const dim = '#9ca3af';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export function KioskTab() {
  return (
    <Box sx={{ color: '#e5e7eb', maxWidth: 760 }}>
      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Panel previews</Typography>
      <Typography sx={{ color: dim, fontSize: 13, mb: 2 }}>
        Composes at the panel&apos;s real size, then scales to fit this screen —
        so what you judge here is what the glass shows.
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
        {PANELS.map((panel) =>
          FEEDS.map((feed) => (
            <MuiLink
              key={`${feed}-${panel.key}`}
              href={previewHref(feed, panel.key)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${feed} on ${panel.key}`}
              sx={{
                display: 'block',
                px: 2,
                py: 1.25,
                minWidth: 150,
                borderRadius: 1,
                border: '1px solid #374151',
                background: '#111827',
                textDecoration: 'none',
                '&:hover': { borderColor: '#6b7280', background: '#1f2937' },
              }}
            >
              <Typography sx={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>
                {feed === 'sunrise' ? '🌄' : '🌇'} {feed} · {panel.label}
              </Typography>
              <Typography sx={{ color: dim, fontSize: 12, fontFamily: mono }}>
                {panel.detail}
              </Typography>
            </MuiLink>
          ))
        )}
        <MuiLink
          href="/studio"
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 2,
            py: 1.25,
            minWidth: 150,
            borderRadius: 1,
            border: '1px solid #374151',
            background: '#111827',
            textDecoration: 'none',
            color: '#e5e7eb',
            fontWeight: 600,
            fontSize: 14,
            '&:hover': { borderColor: '#6b7280', background: '#1f2937' },
          }}
        >
          🎛 Studio
        </MuiLink>
      </Box>

      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Tuning</Typography>
      <Typography sx={{ color: dim, fontSize: 13, mb: 1.5 }}>
        Append params to any preview URL, reload, judge. When a value looks
        right, promote it into <code>masterConfig.ts</code> and commit — the
        constants stay the source of truth. Anything malformed is ignored, so a
        typo falls back to the committed value rather than blanking a panel.
      </Typography>

      <Box
        component="pre"
        sx={{
          fontFamily: mono,
          fontSize: 12,
          color: '#a7f3d0',
          background: '#0b1220',
          border: '1px solid #374151',
          borderRadius: 1,
          p: 1.25,
          mb: 2,
          overflowX: 'auto',
        }}
      >
        /kiosk/sunset?panel=dell&setup=1&floor=120&ceil=340&growth=2.5
      </Box>

      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          mb: 3,
          '& td, & th': {
            textAlign: 'left',
            borderBottom: '1px solid #1f2937',
            padding: '6px 8px',
            verticalAlign: 'top',
          },
        }}
      >
        <thead>
          <tr>
            <th>Param</th>
            <th>Effect</th>
            <th>Range</th>
          </tr>
        </thead>
        <tbody>
          {PARAMS.map((p) => (
            <tr key={p.param}>
              <td style={{ fontFamily: mono, color: '#a7f3d0' }}>{p.param}</td>
              <td style={{ color: '#e5e7eb' }}>{p.effect}</td>
              <td style={{ color: dim, fontFamily: mono }}>{p.range}</td>
            </tr>
          ))}
        </tbody>
      </Box>

      <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Two gotchas</Typography>
      <Typography component="div" sx={{ color: dim, fontSize: 13 }}>
        <p style={{ margin: '0 0 8px' }}>
          <strong style={{ color: '#e5e7eb' }}>
            Do not just shrink the window.
          </strong>{' '}
          The engine lays out against whatever viewport it is handed, so a
          smaller window yields a different composition rather than a smaller
          view of the real one. That is what <code>panel=</code> is for.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: '#e5e7eb' }}>Preview went black?</strong> That
          is the nightly doze (1am–8am), or a stray <code>d</code> keypress. Add{' '}
          <code>quiet=off</code>.
        </p>
      </Typography>
    </Box>
  );
}
