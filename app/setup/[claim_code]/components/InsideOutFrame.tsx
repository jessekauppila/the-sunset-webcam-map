'use client';

import type { ReactNode } from 'react';

// The bracket prototype's amber visual language. Ported from
// docs/prototypes/2026-06-12-window-bracket-prototype.jsx (UI PIECES block).
export const C = {
  amber: '#ffcc66', amber2: '#ffd088', amber3: '#ffaa55', sun: '#ffd54a',
  goodBg: '#1f4a24', goodFg: '#a5e0aa', badBg: '#5a1f1f', badFg: '#f0b0b0',
  warnBg: '#4a3a1c', btn: '#4a7acc', link: '#9cc4ff',
  glass: '#3a4a60', room: '#1c1812', outdoors: '#0a1420',
} as const;

type Tone = 'info' | 'dark' | 'good' | 'bad' | 'warn';
export function Chip({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const s: Record<Tone, React.CSSProperties> = {
    info: { background: '#181818', border: '1px solid #2a2a2a', color: C.amber2 },
    dark: { background: '#181818', border: '1px solid #2a2a2a', color: '#ddd' },
    good: { background: C.goodBg, color: C.goodFg },
    bad: { background: C.badBg, color: C.badFg },
    warn: { background: C.warnBg, color: C.amber2 },
  };
  return <div className="mt-2 rounded-lg px-3 py-2 text-sm" style={s[tone]}>{children}</div>;
}

export function Btn(
  { children, ghost, ...p }: { children: ReactNode; ghost?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
) {
  return (
    <button {...p}
      className={'mt-3 w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40 ' + (ghost ? 'border' : '')}
      style={ghost ? { color: C.link, borderColor: '#2a3a55', background: 'transparent' }
                   : { background: C.btn, color: '#fff' }}>
      {children}
    </button>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1 mt-4 text-xs uppercase tracking-widest text-neutral-500">{children}</div>;
}

export function Why({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 rounded-lg px-3 py-2.5 text-sm leading-relaxed"
       style={{ background: '#13161c', border: '1px solid #232a36', color: '#99aabb' }}>
      {children}
    </p>
  );
}

// Shared top-down diagram frame: OUTSIDE up, glass line, ROOM down.
export function InsideOutFrame(
  { W = 360, H, glassY, children, caption }:
  { W?: number; H: number; glassY: number; children: ReactNode; caption?: string }
) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block w-full rounded-lg" style={{ background: '#181818' }}>
      <rect x="0" y="0" width={W} height={glassY} fill={C.outdoors} opacity=".55" />
      <rect x="0" y={glassY} width={W} height={H - glassY} fill={C.room} opacity=".5" />
      <line x1="26" y1={glassY} x2={W - 26} y2={glassY} stroke={C.glass} strokeWidth="5" />
      <text x="8" y="14" fill="#56708a" fontSize="9">OUTSIDE</text>
      <text x="8" y={H - 8} fill="#8a7a56" fontSize="9">INSIDE (the room)</text>
      {caption && <text x={W / 2} y={H - 8} fill="#999" fontSize="9" textAnchor="middle">{caption}</text>}
      {children}
    </svg>
  );
}
