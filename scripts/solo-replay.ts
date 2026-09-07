// scripts/solo-replay.ts — what the glass showed beside what it would have
// shown under other dials (docs/superpowers/specs/2026-09-06-solo-replay-design.md §5).
//
// Runs the real engine, schemas and store through vite-node, so nothing here
// is a copy that can drift:
//
//   npx vite-node --config vitest.config.ts scripts/solo-replay.ts \
//     --feed sunset --from 2026-09-06T06:51Z --to now \
//     --version solo --deploy 4 --dial ratingFloor=2.5 --dial rest=6 \
//     --json /tmp/replay.json
//
//   --feed     sunrise | sunset (default sunset)
//   --from/--to  ISO time or `now`; default the last hour
//   --deploy   kiosk_deploys id whose dials to start from; default the newest
//   --version  solo | solo2; default the deploy's shared activeVersion when it
//              is a solo version, else solo
//   --dial     key=value on top of the deploy, repeatable; sanitized by the schema
//   --json     also write { actual, replay, summaries } for the studio strip
//
// Read-only. Needs DATABASE_URL in .env.local (read here, before the store
// is imported, because app/lib/db reads it at import).
import { readFileSync, writeFileSync } from 'node:fs';
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { StripFrame } from '@/app/lib/solo/replay';

function loadEnvLocal(): void {
  let text = '';
  try { text = readFileSync('.env.local', 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

interface Args {
  feed: 'sunrise' | 'sunset';
  from: number;
  to: number;
  deploy: number | null;
  version: string | null;
  dials: Record<string, string>;
  json: string | null;
}

function parseTime(s: string | undefined, fallback: number): number {
  if (!s) return fallback;
  if (s === 'now') return Date.now();
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`cannot read time: ${s}`);
  return t;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const val = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    flags.set(key, [...(flags.get(key) ?? []), val]);
  }
  const one = (k: string) => flags.get(k)?.at(-1);
  const feed = one('feed') ?? 'sunset';
  if (feed !== 'sunrise' && feed !== 'sunset') throw new Error('--feed must be sunrise or sunset');
  const to = parseTime(one('to'), Date.now());
  const from = parseTime(one('from'), to - 3_600_000);
  const dials: Record<string, string> = {};
  for (const d of flags.get('dial') ?? []) {
    const m = d.match(/^([A-Za-z0-9]+)=(.*)$/);
    if (!m) throw new Error(`--dial wants key=value, got: ${d}`);
    dials[m[1]] = m[2];
  }
  const deploy = one('deploy');
  return {
    feed, from, to,
    deploy: deploy ? Number(deploy) : null,
    version: one('version') ?? null,
    dials,
    json: one('json') ?? null,
  };
}

/** A dial from the command line, typed the way its knob wants. */
function typed(schema: SettingsSchema, raw: Record<string, string>): SettingsValues {
  const out: SettingsValues = {};
  for (const [k, v] of Object.entries(raw)) {
    const knob = schema.find((s) => s.key === k);
    if (!knob) throw new Error(`no such dial: ${k}`);
    out[k] = knob.kind === 'number' ? Number(v) : knob.kind === 'boolean' ? v === 'true' || v === '1' : v;
  }
  return out;
}

const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const clock = (ms: number) => PT.format(new Date(ms));
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const q3 = (x: number | null) => (x == null ? '  – ' : x.toFixed(2));

function cell(f: StripFrame | undefined): string {
  if (!f) return short('', 40);
  if (f.snapshotId == null) return short('(blank)', 40);
  const bin = f.bin === 'sunset' ? 'S' : 'N';
  const score = f.bin === 'sunset' ? q3(f.quality) : q3(f.detection);
  const title = f.title.replace(/^.*?: /, '').replace(/ › .*?: /, ' ');
  return `${bin} ${score} ${short(title, 28)}${f.repeat ? ' ↺' : '  '}`;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const [{ listDrawsBetween, listEntriesOverlapping }, { listDeploys }, { SOLO_VERSIONS, resolveSoloVersion },
    { mergeSettings, stripDefaults }, { SHARED_SCHEMA }, { replay, actualStrip, summarize, compare }] = await Promise.all([
    import('@/app/lib/solo/store'), import('@/app/lib/settings/deploys'), import('@/app/lib/solo/versions'),
    import('@/app/lib/settings/schema'), import('@/app/lib/settings/sharedSchema'), import('@/app/lib/solo/replay'),
  ]);

  const deploys = await listDeploys(200);
  const deploy = args.deploy == null ? deploys[0] : deploys.find((d) => d.id === args.deploy);
  if (!deploy) throw new Error(args.deploy == null ? 'no deploys recorded' : `deploy #${args.deploy} not found`);
  const shared = mergeSettings(SHARED_SCHEMA, deploy.namespaces.shared);
  const versionName = args.version ?? (resolveSoloVersion(String(shared.activeVersion)) ? String(shared.activeVersion) : 'solo');
  const version = resolveSoloVersion(versionName);
  if (!version) throw new Error(`--version must be one of ${Object.keys(SOLO_VERSIONS).join(', ')}`);
  const overrides = typed(version.schema, args.dials);
  const values = mergeSettings(version.schema, deploy.namespaces[version.namespace], overrides);
  const dials = version.dialsFrom(values);
  const deviations = stripDefaults(version.schema, values);

  // Bins expire at 24 h, so every draw of a frame still in the pool is within a day: the seed is exact from the log.
  const LOOKBACK_MS = 24 * 3_600_000;
  const [draws, entries] = await Promise.all([
    listDrawsBetween(args.feed, args.from - LOOKBACK_MS, args.to),
    listEntriesOverlapping(args.feed, args.from - LOOKBACK_MS, args.to),
  ]);
  const prior = draws.filter((d) => d.shownAt < args.from);
  const window = draws.filter((d) => d.shownAt >= args.from);
  const liveDeploy = deploys.find((d) => d.id === window.at(-1)?.deployId) ?? deploy;
  const liveVersion = resolveSoloVersion(window.at(-1)?.version ?? versionName) ?? version;
  const liveDials = liveVersion.dialsFrom(mergeSettings(liveVersion.schema, liveDeploy.namespaces[liveVersion.namespace]));
  const actual = actualStrip(args.feed, window, { dwellS: liveDials.dwellS }, args.from, args.to);
  const re = replay({ feed: args.feed, version, dials, entries, priorDraws: prior, fromMs: args.from, toMs: args.to });
  const summaries = { actual: summarize(actual), replay: summarize(re) };
  const agreement = compare(actual, re);

  // A row with no deployedAt is a saved take: dialled and kept, never sent to
  // the glass (takes spec, PR #147). Replaying one is legitimate and is the
  // point of a take, so name it rather than pretending it was deployed.
  const deployLabel = (d: typeof deploy) => `#${d.id}${d.label ? ` ${d.label}` : ''} `
    + (d.deployedAt ? `(deployed ${clock(Date.parse(d.deployedAt))} PT)` : `(take, saved ${clock(Date.parse(d.createdAt))} PT)`);
  console.log(`${args.feed} screen, ${clock(args.from)} → ${clock(args.to)} PT`);
  console.log(`pool: ${entries.length} bin rows overlapped the window; ${prior.length} prior draws seed the shown state`);
  console.log(`actual: ${liveVersion.name}, deploy ${deployLabel(liveDeploy)}, dwell ${liveDials.dwellS} s nominal${window.length === 0 ? ' — no draws logged in this window' : ''}`);
  console.log(`replay: ${version.name}, deploy ${deployLabel(deploy)}` +
    (Object.keys(deviations).length ? `, dials ${Object.entries(deviations).map(([k, v]) => `${k}=${v}`).join(' ')}` : ', dials at defaults'));
  console.log('');
  console.log(`${'slot'.padEnd(9)} ${'actual'.padEnd(40)}   ${'replay'.padEnd(40)}`);
  const byActual = new Map(actual.frames.map((f) => [f.slot, f]));
  const byReplay = new Map(re.frames.map((f) => [f.slot, f]));
  const slots = [...new Set([...byActual.keys(), ...byReplay.keys()])].sort((a, b) => a - b);
  for (const slot of slots) {
    const a = byActual.get(slot);
    const r = byReplay.get(slot);
    const mark = a && r && agreement ? (a.snapshotId === r.snapshotId ? ' ' : '≠') : ' ';
    console.log(`${clock((a ?? r)!.shownAt)} ${cell(a)} ${mark} ${cell(r)}`);
  }
  console.log('');
  const rows: [string, string, string][] = [
    ['draws', String(summaries.actual.draws), String(summaries.replay.draws)],
    ['blanks', String(summaries.actual.blanks), String(summaries.replay.blanks)],
    ['distinct frames', String(summaries.actual.distinctFrames), String(summaries.replay.distinctFrames)],
    ['distinct cameras', String(summaries.actual.distinctCameras), String(summaries.replay.distinctCameras)],
    ['repeats', String(summaries.actual.repeats), String(summaries.replay.repeats)],
    ['non-sunset share', pct(summaries.actual.nonSunsetShare), pct(summaries.replay.nonSunsetShare)],
    ['mean quality', q3(summaries.actual.meanQuality), q3(summaries.replay.meanQuality)],
    ['min quality', q3(summaries.actual.minQuality), q3(summaries.replay.minQuality)],
    ['quality deciles', summaries.actual.qualityHistogram.join(' '), summaries.replay.qualityHistogram.join(' ')],
  ];
  for (const [k, a, r] of rows) console.log(`${k.padEnd(18)} ${a.padEnd(22)} ${r}`);
  if (agreement) {
    console.log(`${'same frame'.padEnd(18)} ${agreement.same} of ${agreement.slots} slots`);
    console.log(`${'same order'.padEnd(18)} ${agreement.inOrder} of ${Math.min(actual.frames.length, re.frames.length)} draws (a draw the glass missed shifts the rest)`);
  }
  else console.log(`${'same frame'.padEnd(18)} (different screens; their counters are independent)`);
  console.log('');
  console.log('draws per camera (actual | replay)');
  const cams = new Map<number, { title: string; a: number; r: number }>();
  for (const c of summaries.actual.perCamera) cams.set(c.webcamId, { title: c.title, a: c.draws, r: 0 });
  for (const c of summaries.replay.perCamera) cams.set(c.webcamId, { ...(cams.get(c.webcamId) ?? { title: c.title, a: 0 }), r: c.draws });
  for (const [id, c] of [...cams].sort((x, y) => y[1].a + y[1].r - (x[1].a + x[1].r)))
    console.log(`  ${String(c.a).padStart(3)} | ${String(c.r).padStart(3)}  ${short(c.title.replace(/ › .*?: /, ' '), 60)} (${id})`);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ actual, replay: re, summaries, agreement, dials: deviations }, null, 2));
    console.log(`\nwrote ${args.json}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
