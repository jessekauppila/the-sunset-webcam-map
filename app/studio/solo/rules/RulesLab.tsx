'use client';

import { useMemo, useState } from 'react';
import type { KnobDescriptor } from '@/app/lib/settings/schema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { formatDetection, formatRating } from '@/app/lib/solo/scores';
import type { BinEntry, Feed } from '@/app/lib/solo/types';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import type { Step } from '@/app/lib/solo2/trace';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { labAt, labelOf, seedPool } from './lab';

/**
 * The rules lab (rules-lab spec §3): one draw of the solo2 engine drawn as a
 * sieve over a textbook pool, with no pictures anywhere. Rules in the order
 * the code applies them — 5, 4, 2, 1 — then rule 3's sort with the head
 * outlined. Above it, the two bins with each chip numbered by its place in
 * the next eight draws.
 */

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const COLOR = { sunset: '#7ee2ac', non_sunset: '#c3cad6' } as const;
const DIM = '#4b5566';
const INK = '#e5e7eb';
const MUTED = '#8b95a7';
const PANEL = '#10141d';
const LINE = '#1d2432';

/** The dials a draw reads, in the order the sieve reads them. Camera runs stay off: one frame per camera here. */
const DIAL_KEYS = ['ratingFloor', 'detectionFloor', 'rest', 'sunsetFloor', 'mix', 'valleys', 'screens', 'promoteNew'] as const;
const KNOBS = DIAL_KEYS.map((k) => SOLO2_SETTINGS_SCHEMA.find((x) => x.key === k)!) as KnobDescriptor[];

/** The rotation-scheduler vocabulary beside ours, with where to read about it (spec §1). */
const COUSINS: { ours: string; theirs: string; href: string; site: string }[] = [
  { ours: 'rules tested in order; the first failure drops the frame', theirs: 'the rule tree, unbreakable rules', href: 'https://musicmaster.com/?p=8886', site: 'MusicMaster: Which Rules are a Top Priority?' },
  { ours: 'floors (rule 5)', theirs: 'eligibility rules, ordered to fail fast', href: 'https://musicmaster.com/?p=8211', site: 'MusicMaster: Setting the Order for Your Rules' },
  { ours: 'rest in draws (rule 2)', theirs: 'minimum / maximum rest, separation', href: 'https://musicmaster.com/?p=8858', site: 'MusicMaster: Maximum Rest vs Absolute Maximum Rest' },
  { ours: 'bins, sunset floor, mix (rule 1)', theirs: 'categories and the clock’s category quota', href: 'https://radioiloveit.com/radio-music-research-music-scheduling-software/music-scheduling-using-song-rotations-for-better-music-logs/', site: 'Radio ILOVEIT: song rotations and the even/odd rule' },
  { ours: 'peak / valley on a beat (rule 3)', theirs: 'the format clock’s hour pattern', href: 'https://radioiloveit.com/radio-music-research-music-scheduling-software/top-40-radio-format-chr-contemporary-hit-radio-music-scheduling-format-clocks-1/', site: 'Radio ILOVEIT: Top 40 format clocks (diagrams)' },
  { ours: 'a picture of the beat (phase 2)', theirs: 'the pie-chart clock editor', href: 'https://musicmaster.com/?p=8408', site: 'MusicMaster: Configuring the Format Clock Display' },
];

const scoreText = (e: BinEntry) => (e.bin === 'sunset' ? formatRating(e.quality ?? 0) : formatDetection(e.detection));

function Chip({ e, sub, dim, head, num }: { e: BinEntry; sub?: string; dim?: boolean; head?: boolean; num?: number }) {
  const color = dim ? DIM : COLOR[e.bin];
  return (
    <div data-testid={`chip-${labelOf(e)}`} data-dim={dim ? '1' : undefined} style={{
      fontFamily: mono, fontSize: 11, lineHeight: 1.25, padding: '4px 6px', marginBottom: 4, borderRadius: 4,
      border: `1px solid ${head ? INK : color}`, boxShadow: head ? `0 0 0 1px ${INK}` : undefined,
      color: dim ? DIM : INK, background: head ? '#1a2130' : 'transparent', position: 'relative',
    }}>
      <span style={{ color, fontWeight: 700 }}>{labelOf(e)}</span>
      <span style={{ color: dim ? DIM : MUTED }}>{` ${scoreText(e)}`}</span>
      {e.tally > 0 && <span style={{ color: dim ? DIM : MUTED }}>{` ×${e.tally}`}</span>}
      {e.isNew && <span style={{ color: dim ? DIM : '#f5a344' }}> new</span>}
      {num != null && (
        <span data-testid={`num-${labelOf(e)}`} style={{
          position: 'absolute', right: 4, top: 3, fontSize: 10, fontWeight: 700, color: '#0b0e14',
          background: color, borderRadius: 3, padding: '0 4px',
        }}>{num}</span>
      )}
      {sub && <div style={{ color: dim ? DIM : MUTED, fontSize: 10 }}>{sub}</div>}
    </div>
  );
}

function Column({ title, detail, children, testId }: { title: string; detail: string; children: React.ReactNode; testId: string }) {
  return (
    <div data-testid={testId} style={{ flex: '1 1 140px', minWidth: 140, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, padding: 8 }}>
      <div style={{ fontFamily: mono, fontSize: 12, color: INK, fontWeight: 700 }}>{title}</div>
      <div style={{ fontFamily: mono, fontSize: 10, color: MUTED, minHeight: 26, marginBottom: 6 }}>{detail}</div>
      {children}
    </div>
  );
}

function stepDetail(s: Step, d: Solo2Dials, onGlass: BinEntry | undefined, streak: number): string {
  switch (s.rule) {
    case 5: return `rating ≥ ${d.ratingFloor.toFixed(1)} · sunset ≥ ${formatDetection(d.detectionFloor)}`;
    case 4: return onGlass ? `on glass: ${labelOf(onGlass)}` : 'nothing on glass';
    case 2: return `rest ${d.rest} draws`;
    case 1: return `floor ${d.sunsetFloor} · mix ${d.mix} · streak ${streak}`;
  }
}

export function RulesLab() {
  const [values, setValues] = useState(() => schemaDefaults(SOLO2_SETTINGS_SCHEMA));
  const [feed, setFeed] = useState<Feed>('sunrise');
  const [slot, setSlot] = useState(1);
  const seed = useMemo(seedPool, []);
  const dials = useMemo<Solo2Dials>(() => ({ ...dialsFrom2(values), cameraRun: false }), [values]);
  const lab = useMemo(() => labAt(seed, dials, feed, slot), [seed, dials, feed, slot]);
  const byId = new Map(lab.entries.map((e) => [e.snapshotId, e]));
  const onGlass = lab.state.lastSnapshotId == null ? undefined : byId.get(lab.state.lastSnapshotId);
  const set = (key: string, v: number | boolean | string) => setValues((prev) => ({ ...prev, [key]: v }));

  const bin = (kind: BinEntry['bin']) => lab.entries.filter((e) => e.bin === kind);

  return (
    <div style={{ minHeight: '100vh', background: '#0b0e14', color: INK, padding: 16, fontFamily: mono }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ fontSize: 15, margin: 0 }}>solo2 rules lab</h1>
        <span style={{ color: MUTED, fontSize: 11 }}>one draw as a sieve · textbook pool · no pictures</span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11, color: MUTED }}>
          feed{' '}
          <select value={feed} onChange={(ev) => setFeed(ev.target.value as Feed)} style={selectStyle}>
            <option value="sunrise">sunrise</option>
            <option value="sunset">sunset</option>
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <button onClick={() => setSlot((s) => Math.max(1, s - 1))} disabled={slot <= 1} style={btn} aria-label="previous draw">◀</button>
          <span data-testid="slot">draw {slot}</span>
          <button onClick={() => setSlot((s) => s + 1)} style={btn} aria-label="next draw">▶</button>
          <button onClick={() => setSlot(1)} style={btn}>reset</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <aside style={{ flex: '0 0 220px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>dials a draw reads</div>
          {KNOBS.map((k) => (
            <label key={k.key} title={k.description} style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: MUTED }}>
                <span>{k.label}</span>
                <span style={{ color: INK }}>{String(values[k.key])}</span>
              </div>
              {k.kind === 'number' && (
                <input type="range" min={k.min} max={k.max} step={k.step} value={values[k.key] as number}
                  aria-label={k.label} onChange={(ev) => set(k.key, Number(ev.target.value))} style={{ width: '100%' }} />
              )}
              {k.kind === 'enum' && (
                <select value={values[k.key] as string} aria-label={k.label} onChange={(ev) => set(k.key, ev.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  {k.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {k.kind === 'boolean' && (
                <input type="checkbox" checked={values[k.key] as boolean} aria-label={k.label} onChange={(ev) => set(k.key, ev.target.checked)} />
              )}
            </label>
          ))}
          <div style={{ fontSize: 10, color: DIM, marginTop: 10 }}>camera runs off: one frame per camera here, so the run and the frame are the same thing.</div>
          {lab.history.length > 0 && (
            <div style={{ fontSize: 10, color: MUTED, marginTop: 10 }}>
              <div>shown so far</div>
              <div data-testid="history" style={{ color: INK }}>{lab.history.join(' ')}</div>
            </div>
          )}
        </aside>

        <main style={{ flex: '1 1 600px', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {(['sunset', 'non_sunset'] as const).map((kind) => (
              <div key={kind} data-testid={`bin-${kind}`} style={{ flex: 1, background: PANEL, border: `1px solid ${COLOR[kind]}44`, borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 11, color: COLOR[kind], marginBottom: 6 }}>
                  {kind === 'sunset' ? 'sunset bin' : 'non-sunset bin'}
                  <span style={{ color: MUTED }}> · number = place in the next 8 draws</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0 6px' }}>
                  {bin(kind).map((e) => (
                    <Chip key={e.snapshotId} e={e} num={lab.upcoming.get(e.snapshotId)}
                      dim={!lab.upcoming.has(e.snapshotId)} head={e.snapshotId === lab.state.lastSnapshotId} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <Column title="pool" detail={`${lab.entries.length} frames`} testId="col-pool">
              {lab.entries.map((e) => <Chip key={e.snapshotId} e={e} />)}
            </Column>
            {lab.trace.steps.map((s) => {
              const kept = new Set(s.kept);
              // Drop order first: what this rule removed sits under what it kept, greyed with its reason.
              const survivors = lab.entries.filter((e) => kept.has(e.snapshotId));
              return (
                <Column key={s.rule} title={s.title} detail={`${stepDetail(s, dials, onGlass, lab.state.sunsetStreak)}${s.note ? ` — ${s.note}` : ''}`} testId={`col-${s.rule}`}>
                  {survivors.map((e) => <Chip key={e.snapshotId} e={e} />)}
                  {s.dropped.map(({ snapshotId, why }) => {
                    const e = byId.get(snapshotId)!;
                    return <Chip key={snapshotId} e={e} dim sub={why} />;
                  })}
                </Column>
              );
            })}
            <Column title="3 · sort" detail={`${lab.trace.role} · valleys ${dials.valleys} · ${dials.screens} · ${feed}`} testId="col-3">
              {lab.trace.sorted.map((r, i) => <Chip key={r.entry.snapshotId} e={r.entry} head={i === 0} sub={r.key} />)}
              {lab.trace.sorted.length === 0 && <div style={{ fontSize: 10, color: DIM }}>nothing eligible</div>}
            </Column>
          </div>

          <section style={{ marginTop: 16, fontSize: 11, color: MUTED }}>
            <div style={{ color: INK, marginBottom: 6 }}>what this is: a rotation scheduler, the kind radio music schedulers run</div>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {COUSINS.map((c) => (
                  <tr key={c.href}>
                    <td style={td}>{c.ours}</td>
                    <td style={{ ...td, color: INK }}>{c.theirs}</td>
                    <td style={td}><a href={c.href} target="_blank" rel="noreferrer" style={{ color: COLOR.sunset }}>{c.site}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { fontFamily: mono, fontSize: 11, background: '#1a2130', color: INK, border: `1px solid ${LINE}`, borderRadius: 4, padding: '2px 8px', cursor: 'pointer' };
const selectStyle: React.CSSProperties = { fontFamily: mono, fontSize: 11, background: '#1a2130', color: INK, border: `1px solid ${LINE}`, borderRadius: 4 };
const td: React.CSSProperties = { padding: '3px 12px 3px 0', verticalAlign: 'top', borderBottom: `1px solid ${LINE}` };
