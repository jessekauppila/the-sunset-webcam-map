'use client';

import type { ReactNode } from 'react';
import type { SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Solo2Dials } from '@/app/lib/solo2/types';

const box = {
  fontSize: 11.5, color: '#9aa3b2', border: '1px dashed #2a3242', borderRadius: 6,
  padding: '8px 10px', marginTop: 8, lineHeight: 1.5,
} as const;
const B = ({ children }: { children: ReactNode }) => <b style={{ color: '#4fd1c5' }}>{children}</b>;

/** Spec §4, restated with the dial values currently in force. */
export function RulesBox({ dials: d, version }: { dials: SoloDials; version?: SoloVersionSpec }) {
  const d2 = version?.name === 'solo2' ? (d as Solo2Dials) : null;
  const rhythm = d2 && d2.valleys > 0
    ? <> after each peak, <B>{d2.valleys}</B> {d2.valleys === 1 ? 'valley' : 'valleys'} (lowest eligible, unshown first); screens <B>{d2.screens}</B></>
    : null;
  return (
    <div style={box} title="The ordering rules, in the order they apply, with the current dial values substituted.">
      <div><B>1.</B> Bin first: <B>{d.sunsetFloor}</B>+ rested sunsets → sunsets only, else <B>{d.mix}</B> sunsets per non-sunset.</div>
      <div><B>2.</B> A shown frame rests <B>{d.rest}</B> {d.rest === 1 ? 'draw' : 'draws'}{d.rest === 0 ? ' (off)' : ''}.</div>
      <div><B>3.</B> In a bin: least shown first, then best score{d.promoteNew ? ', new frames +0.10' : ''}{rhythm ? <>;{rhythm}</> : null}.</div>
      <div><B>4.</B> Never the same frame twice in a row.</div>
      <div><B>5.</B> Floors: sunsets q ≥ <B>{d.qualityFloor.toFixed(2)}</B>, non-sunsets d ≥ <B>{d.detectionFloor.toFixed(2)}</B>.</div>
    </div>
  );
}
