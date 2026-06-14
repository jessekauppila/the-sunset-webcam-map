'use client';

import { useEffect, useRef, useState } from 'react';
import { azToX, angDiff, type ArcAnchors } from '@/app/lib/solar';
import { C, InsideOutFrame } from './InsideOutFrame';

const rad = (d: number) => (d * Math.PI) / 180;

/* ANIMATION 1 — place the phone flat on the glass (top-down). */
export function PlacePhoneAnim() {
  const glassY = 52;
  return (
    <>
      <style>{`
        @keyframes wb-place {
          0%   { transform: translate(34px, 52px) rotate(26deg); }
          55%  { transform: translate(0, 0) rotate(0deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        .anim-place { animation: wb-place 3.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .anim-place { animation: none !important; }
        }
      `}</style>
      <InsideOutFrame H={150} glassY={glassY} caption="press the phone flat — screen toward you">
        <g className="anim-place" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <rect x="130" y={glassY + 3} width="100" height="16" rx="4" fill="#0e1622" stroke={C.btn} strokeWidth="1.5" />
          <line x1="138" y1={glassY + 11} x2="158" y2={glassY + 11} stroke={C.link} strokeWidth="2" opacity=".5" />
          <line x1="180" y1={glassY - 2} x2="180" y2="20" stroke={C.amber} strokeWidth="2" strokeDasharray="3 4" />
        </g>
        <path d="M 254 110 q 26 -26 6 -48" fill="none" stroke="#888" strokeWidth="1.5" strokeDasharray="3 3" />
        <path d="M 258 64 l 2 10 -10 -2 z" fill="#888" />
        <text x="262" y="116" fill="#888" fontSize="9">flatten against the glass</text>
        <text x="186" y="32" fill={C.amber2} fontSize="9">back camera looks out → reads the window&apos;s facing</text>
      </InsideOutFrame>
    </>
  );
}

/* ANIMATION 2 — hinge like a door, INTO the room.
   DEMO mode: a rAF tween loops the move, alternating which edge is hinged.
   LIVE mode: as soon as the phone actually moves, the same diagram becomes an
   instrument — the phone graphic tracks the real opening angle, the sun sits at
   the real wedge, and lining them up is the lock. */
export function HingeAnim(
  { wedgeDeg, eventLabel, liveOpenDeg, aligned }:
  { wedgeDeg: number; eventLabel: string; liveOpenDeg: number; aligned: boolean }
) {
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [demo, setDemo] = useState<{ side: 'left' | 'right'; ang: number }>({ side: 'left', ang: 0 });
  const baseline = useRef<number | null>(null);

  // Hand off from demo to live the moment real movement appears.
  useEffect(() => {
    if (baseline.current === null) { baseline.current = liveOpenDeg; return; }
    if (mode === 'demo' && Math.abs(liveOpenDeg - baseline.current) > 3) setMode('live');
  }, [liveOpenDeg, mode]);

  const demoMax = Math.min(38, Math.max(12, Math.abs(wedgeDeg)));
  useEffect(() => {
    if (mode !== 'demo') return;
    const reduce = typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDemo({ side: 'left', ang: demoMax });
      const t = setInterval(() =>
        setDemo((d) => ({ side: d.side === 'left' ? 'right' : 'left', ang: demoMax })), 4400);
      return () => clearInterval(t);
    }
    let raf: number; const t0 = performance.now();
    const ease = (t: number) => t * t * (3 - 2 * t);
    const loop = (t: number) => {
      const P = 4200, el = t - t0, k = (el % P) / P;
      const side: 'left' | 'right' = Math.floor(el / P) % 2 ? 'right' : 'left';
      const f = k < 0.45 ? ease(k / 0.45) : k < 0.6 ? 1 : 1 - ease((k - 0.6) / 0.4);
      setDemo({ side, ang: f * demoMax });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, demoMax]);

  const live = mode === 'live';
  const side = live ? (wedgeDeg >= 0 ? 'left' : 'right') : demo.side;
  const L = side === 'left', sgn = L ? 1 : -1;
  const sunAng = live ? Math.min(45, Math.max(4, Math.abs(wedgeDeg))) : demoMax;
  const rawOpen = wedgeDeg >= 0 ? liveOpenDeg : -liveOpenDeg; // toward the sun = +
  const ang = live ? Math.min(52, Math.max(0, rawOpen)) : demo.ang;
  const wrongWay = live && rawOpen < -3;

  const W = 360, H = 196, glassY = 78;
  const hx = L ? 112 : 248, hy = glassY + 10;
  const sc = Math.cos(rad(sunAng)), ss = Math.sin(rad(sunAng));
  const sun = { x: hx + sgn * (54 * sc + 74 * ss), y: hy + (54 * ss - 74 * sc) };
  const arcEnd = { x: hx + sgn * 46 * Math.cos(rad(ang)), y: hy + 46 * Math.sin(rad(ang)) };
  const lit = live && aligned;

  return (
    <InsideOutFrame
      H={H} glassY={glassY}
      caption={
        live
          ? (lit ? '✓ lined up — lock the angle below'
             : wrongWay ? 'hinging the wrong way — swing toward the sun'
             : `live — opened ${Math.max(0, rawOpen).toFixed(0)}° of ${Math.abs(wedgeDeg).toFixed(0)}°`)
          : (L ? 'sun to the right → hinge the LEFT edge, swing the right edge into the room'
               : 'sun to the left → hinge the RIGHT edge, swing the left edge into the room')}>
      <text x={W / 2} y="14" fill={live ? C.goodFg : '#888'} fontSize="9" textAnchor="middle">
        {live ? 'LIVE — your phone is driving this' : 'demo — move the phone to take over'}
      </text>

      {/* the target: a sun, not a line */}
      <circle cx={sun.x} cy={sun.y} r="11" fill={C.sun}
              stroke={lit ? C.goodFg : 'none'} strokeWidth="3" />
      <text x={sun.x - sgn * 16} y={sun.y + 3} fill={lit ? C.goodFg : C.amber2} fontSize="9"
            textAnchor={L ? 'end' : 'start'}>{eventLabel}{lit ? ' ✓' : ''}</text>

      {/* the phone + its rigid aim arrow, rotating about the hinge */}
      <g transform={`rotate(${sgn * ang} ${hx} ${hy})`}>
        <rect x={L ? hx - 2 : hx - 110} y={glassY + 4} width="112" height="15" rx="4"
              fill="#0e1622" stroke={C.btn} strokeWidth="1.5" />
        <line x1={hx + sgn * 54} y1={glassY + 2} x2={hx + sgn * 54} y2="14"
              stroke={lit ? C.goodFg : C.amber} strokeWidth="2" />
        <path d={`M ${hx + sgn * 54} 8 l 5 11 -10 0 z`} fill={lit ? C.goodFg : C.amber} />
      </g>

      {/* hinge marker + the swept angle */}
      <circle cx={hx} cy={hy} r="4.5" fill="#fff" />
      <text x={hx} y={hy + 22} fill="#ccc" fontSize="9" textAnchor="middle">pivot</text>
      <path d={`M ${hx + sgn * 46} ${hy} A 46 46 0 0 ${L ? 1 : 0} ${arcEnd.x} ${arcEnd.y}`}
            fill="none" stroke="#888" strokeWidth="1" strokeDasharray="2 3" />
      <text x={hx + sgn * 62} y={hy + 30} fill={C.amber} fontSize="11" textAnchor="middle"
            style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(ang)}°</text>
      <text x={W - 8} y="28" fill="#888" fontSize="9" textAnchor="end"
            style={{ fontVariantNumeric: 'tabular-nums' }}>
        {live ? `target: ${Math.abs(wedgeDeg).toFixed(0)}°` : `your swing: ${Math.abs(wedgeDeg).toFixed(0)}°`}
      </text>
    </InsideOutFrame>
  );
}

/* SIGNATURE — top-down wedge: camera INSIDE, looking out through the glass. */
export function WedgeDiagram(
  { normalAz, aimAz, hfov, arc, camFrac }:
  { normalAz: number; aimAz: number; hfov: number; arc: ArcAnchors; camFrac: number }
) {
  const H = 190, glassY = 132;
  const glassL = 50, glassR = 310;
  const cx = glassL + (glassR - glassL) * camFrac, cy = glassY + 14;
  const pt = (relDeg: number, len: number): [number, number] =>
    [cx + len * Math.sin(rad(relDeg)), cy - len * Math.cos(rad(relDeg))];
  const wedge = angDiff(aimAz, normalAz);
  const [nx, ny] = pt(0, 112);
  const [tx, ty] = pt(wedge, 112);
  const [e1x, e1y] = pt(wedge - hfov / 2, 132);
  const [e2x, e2y] = pt(wedge + hfov / 2, 132);
  const [jx, jy] = pt(angDiff(arc.jun, normalAz), 122);
  const [dx2, dy2] = pt(angDiff(arc.dec, normalAz), 122);
  const arcR = 62;
  const a0 = Math.min(0, wedge), a1 = Math.max(0, wedge);
  const arcPath = `M ${pt(a0, arcR)} A ${arcR} ${arcR} 0 0 1 ${pt(a1, arcR)}`;
  return (
    <InsideOutFrame H={H} glassY={glassY}>
      <path d={`M ${cx} ${cy} L ${e1x} ${e1y} L ${e2x} ${e2y} Z`} fill="rgba(255,204,102,.10)" />
      <line x1={cx} y1={cy} x2={jx} y2={jy} stroke={C.amber3} strokeWidth="1" strokeDasharray="4 4" opacity=".6" />
      <line x1={cx} y1={cy} x2={dx2} y2={dy2} stroke={C.amber3} strokeWidth="1" strokeDasharray="4 4" opacity=".6" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#8899aa" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={nx} y={ny - 4} fill="#8899aa" fontSize="9" textAnchor="middle">window normal</text>
      <line x1={cx} y1={cy} x2={tx} y2={ty} stroke={C.amber2} strokeWidth="2.5" />
      <text x={tx} y={ty - 4} fill={C.amber2} fontSize="9" textAnchor="middle">bracket aim</text>
      <path d={arcPath} fill="none" stroke={C.amber} strokeWidth="2" />
      <text x={pt(wedge / 2, arcR + 14)[0]} y={pt(wedge / 2, arcR + 14)[1]} fill={C.amber}
            fontSize="12" textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Math.abs(wedge).toFixed(0)}°
      </text>
      <path d={`M ${cx - 9} ${cy + 9} L ${cx + 9} ${cy + 9} L ${cx + 9 - 14 * Math.sin(rad(wedge))} ${cy - 4} Z`}
            fill="#2a2f3a" stroke="#555" strokeWidth="1" />
      <circle cx={cx} cy={cy} r="4.5" fill={C.sun} />
      <text x={cx} y={cy + 26} fill={C.sun} fontSize="9" textAnchor="middle">case on its wedge, inside the glass</text>
    </InsideOutFrame>
  );
}

/* Bracket placeholder: a wedge (smaller than the box) sits between glass and
   case; the case is rotated off the glass by the wedge angle; the camera peeks
   out one face. Final art comes from the bracket-design chat. */
export function WedgeCaseBracket({ wedge }: { wedge: number }) {
  const W = 360, H = 150;
  // ---- plan view (left): glass, wedge, rotated case ----
  const gx = 40, gTop = 24, gBot = 126;          // glass line (vertical)
  const a = rad(Math.min(42, Math.abs(wedge)));
  const cx = gx + 16, cy = 75;                    // case near-corner pivot-ish
  const bw = 64, bh = 46;                         // box footprint
  // box corners rotated by wedge about the glass-side edge
  const rot = (px: number, py: number): [number, number] => [
    cx + (px) * Math.cos(a) - (py) * Math.sin(a),
    cy + (px) * Math.sin(a) + (py) * Math.cos(a),
  ];
  const c1 = rot(0, -bh / 2), c2 = rot(bw, -bh / 2), c3 = rot(bw, bh / 2), c4 = rot(0, bh / 2);
  const boxPts = [c1, c2, c3, c4].map((p) => p.join(',')).join(' ');
  const lensMid = rot(bw, 0);
  return (
    <div className="rounded-lg p-3 mt-2" style={{ border: '1px dashed #555', background: '#141414' }}>
      <div className="text-xs text-neutral-500 mb-1">
        bracket concept — PLACEHOLDER (final renders from the bracket-design chat)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block">
        {/* plan view */}
        <text x={gx + 4} y="16" fill="#888" fontSize="9">plan view (looking down)</text>
        <line x1={gx} y1={gTop} x2={gx} y2={gBot} stroke={C.glass} strokeWidth="5" />
        <text x={gx - 6} y={gBot + 12} fill="#667" fontSize="9" textAnchor="middle">glass</text>
        {/* wedge: thin against glass, thick where the box swings off */}
        <polygon points={`${gx},${cy - bh / 2} ${gx},${cy + bh / 2} ${c4[0]},${c4[1]} ${c1[0]},${c1[1]}`}
                 fill="#2a2f3a" stroke="#557" strokeWidth="1" />
        <text x={gx + 14} y={cy + 2} fill={C.amber} fontSize="10"
              style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.abs(wedge).toFixed(0)}°</text>
        {/* the case (box), rotated by the wedge */}
        <polygon points={boxPts} fill="#181818" stroke="#667" strokeWidth="1.5" />
        {/* lens peeking out the far face */}
        <circle cx={lensMid[0]} cy={lensMid[1]} r="5" fill="#0e1622" stroke={C.amber3} strokeWidth="2.5" />
        <line x1={lensMid[0]} y1={lensMid[1]}
              x2={lensMid[0] + 30 * Math.cos(a - Math.PI / 2 + Math.PI)}
              y2={lensMid[1] + 30 * Math.sin(a - Math.PI / 2 + Math.PI)}
              stroke={C.amber2} strokeWidth="1.5" strokeDasharray="3 3" opacity=".6" />
        <text x={c2[0] + 6} y={c2[1]} fill="#888" fontSize="9">case (Pi + camera)</text>
        <text x={lensMid[0] + 8} y={lensMid[1] + 14} fill={C.amber3} fontSize="8">lens peeks out</text>

        {/* side view (right): camera fixed level — sunsets are at the horizon */}
        <text x="226" y="16" fill="#888" fontSize="9">side view</text>
        <line x1="222" y1="24" x2="222" y2="120" stroke={C.glass} strokeWidth="5" />
        <text x="216" y="132" fill="#667" fontSize="9" textAnchor="end">glass</text>
        <g>
          <polygon points="226,58 226,90 250,84 250,64" fill="#2a2f3a" stroke="#557" />
          <rect x="250" y="52" width="56" height="44" rx="4" fill="#181818" stroke="#667" strokeWidth="1.5" />
          <circle cx="306" cy="74" r="5" fill="#0e1622" stroke={C.amber3} strokeWidth="2.5" />
        </g>
        <text x="258" y="118" fill="#888" fontSize="8">wedge between glass &amp; case</text>
        <text x="258" y="40" fill={C.amber} fontSize="9">level — no vertical tilt</text>
      </svg>
    </div>
  );
}

/* Final mount picture — side view, hardware unambiguously in the room. */
export function MountDiagram({ wedge }: { wedge: number }) {
  const W = 360, H = 180, glassX = 150, horizon = 86;
  const camX = glassX + 36, camY = horizon;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg block mt-2" style={{ background: '#181818' }}>
      <rect x="0" y="0" width={glassX} height={H} fill={C.outdoors} />
      <rect x="0" y={horizon + 18} width={glassX} height={H - horizon - 18} fill="#141a14" />
      <line x1="0" y1={horizon + 18} x2={glassX} y2={horizon + 18} stroke="#2e3a2e" strokeWidth="1.5" />
      <circle cx="46" cy="40" r="12" fill={C.sun} />
      <rect x={glassX} y="0" width={W - glassX} height={H} fill={C.room} opacity=".6" />
      <line x1={glassX} y1="6" x2={glassX} y2={H - 24} stroke={C.glass} strokeWidth="6" />
      <rect x={glassX - 4} y={H - 24} width={W - glassX + 4} height="10" fill="#3a3025" />
      <text x="8" y="14" fill="#56708a" fontSize="9">OUTSIDE</text>
      <text x={W - 8} y="14" fill="#8a7a56" fontSize="9" textAnchor="end">INSIDE (the room)</text>
      <text x={W - 8} y={H - 6} fill="#665544" fontSize="9" textAnchor="end">window sill</text>
      {/* wedge sits between glass and case; case holds Pi+camera, lens out the front */}
      <path d={`M ${glassX + 3} ${camY + 20} L ${glassX + 22} ${camY + 20} L ${glassX + 3} ${camY - 4} Z`}
            fill="#2a2f3a" stroke="#557" />
      <g>
        <rect x={camX - 4} y={camY - 12} width="46" height="36" rx="4" fill="#181818" stroke="#667" strokeWidth="1.5" />
        <circle cx={camX - 6} cy={camY + 6} r="4" fill="#0e1622" stroke={C.amber3} strokeWidth="2.5" />
      </g>
      <text x={camX + 48} y={camY + 2} fill="#888" fontSize="9">case: Pi + camera</text>
      <text x={camX + 48} y={camY + 16} fill="#666" fontSize="8">wedge {Math.abs(wedge)}° (into the page)</text>
      <line x1={camX - 8} y1={camY + 6} x2={camX - 148} y2={camY + 6}
            stroke={C.amber2} strokeWidth="2" strokeDasharray="6 5" />
      <text x="60" y={horizon - 8} fill={C.amber2} fontSize="9">view through the glass · level at the horizon</text>
    </svg>
  );
}

export function SkyView(
  { centerAz, fov, arc, showToday, highlightLock, label }:
  { centerAz: number; fov: number; arc: ArcAnchors; showToday: boolean; highlightLock?: boolean; label: string }
) {
  const W = 360, H = 190, horizon = 128;
  const items: [string, number, string, string | null][] = [
    ['Jun', arc.jun, C.amber3, '6 5'],
    ['Equinox', arc.equinox, C.amber2, null],
    ['Dec', arc.dec, C.amber3, '6 5'],
    ...(showToday ? ([['today', arc.today, C.sun, '2 4']] as [string, number, string, string][]) : []),
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg block" style={{ background: C.outdoors }}>
      <rect x="0" y={horizon} width={W} height={H - horizon} fill="#141a14" />
      <line x1="0" y1={horizon} x2={W} y2={horizon} stroke="#2e3a2e" strokeWidth="1.5" />
      <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke={highlightLock ? C.goodFg : 'rgba(255,255,255,.3)'}
            strokeWidth={highlightLock ? 2 : 1.5} strokeDasharray="4 5" />
      {items.map(([name, az, color, dash]) => {
        const x = azToX(az, centerAz, fov, W);
        if (x < -20 || x > W + 20) return null;
        return (
          <g key={name}>
            <line x1={x} y1="14" x2={x} y2={H - 8} stroke={color}
                  strokeWidth={name === 'Equinox' ? 2.5 : 1.8} strokeDasharray={dash || 'none'} />
            <text x={x + 4} y="24" fill={color} fontSize="10">{name}</text>
          </g>
        );
      })}
      <text x="6" y={H - 6} fill="rgba(255,255,255,.4)" fontSize="9">{label}</text>
      <text x={W - 6} y={H - 6} fill="rgba(255,255,255,.5)" fontSize="10" textAnchor="end"
            style={{ fontVariantNumeric: 'tabular-nums' }}>heading {Math.round(centerAz)}°</text>
    </svg>
  );
}
