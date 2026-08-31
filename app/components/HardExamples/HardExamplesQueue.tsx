'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  Alert,
} from '@mui/material';
import type { Snapshot } from '@/app/lib/types';
import type { Provenance } from '@/app/lib/provenance';

type QueuedSnapshot = Snapshot & {
  provenance: Provenance;
  modelDisagreementKind: string | null;
  aiRegressionScore: number | null;
  /** Which queue this frame was FETCHED from, stamped at fetch time.
   *
   *  Rating used to read the live `queue` state instead, which meant a frame
   *  loaded from the sample could be written with the disagreement origin if
   *  the mode changed in between — and on 2026-08-29 exactly that happened:
   *  120 sample frames were stored as `hard_example`, and 151 disagreement
   *  frames were then appended into the same run and rated as if they were
   *  still the sample. A label's population is a property of the frame, not of
   *  whatever the UI happens to be showing when the key is pressed. */
  queueOrigin: string;
};

type Counts = { archiveTrained: number; archiveNew: number; flickr: number };
type SampleProgress = { name: string; size: number; labeled: number };

// The ACTIVE pre-drawn random sample of ordinary frames — the unbiased eval
// set, quarantined from all training. Bump this to the newest sample loaded by
// `ml/load_label_sample.py --sample-name`; completed samples (v1: 200/200 on
// 2026-08-29, v2: 300/300 on 2026-08-30) stay in label_samples and keep their
// labels' origin stamp. v3 (200 frames, seed 20260831) additionally excludes
// the 3 cameras that entered v6 training after the holdout pool was built.
// Exported so the tests assert against the live value — PR #89 bumped this
// to v3 while two test expectations still hardcoded v2, and main went red.
export const SAMPLE_NAME = 'random_ordinary_v3';

const BATCH = 120;
const SIDE = 2; // thumbs each side (symmetric)
const THUMB_W = 104;

const PROVENANCE: Record<Provenance, { label: string; bg: string }> = {
  flickr: { label: 'Flickr', bg: 'rgba(124,58,237,0.92)' },
  archive_trained: { label: 'Archive · trained', bg: 'rgba(71,85,105,0.95)' },
  archive_new: { label: 'Archive · new', bg: 'rgba(5,150,105,0.95)' },
};

// The server recomputes `counts` only when a batch is fetched (every BATCH
// frames), so the bar would sit frozen while you rate. Adjust it locally per
// label and let the next batch resync it.
const COUNT_KEY: Record<Provenance, keyof Counts> = {
  flickr: 'flickr',
  archive_trained: 'archiveTrained',
  archive_new: 'archiveNew',
};

// The condensed rating rubric, kept on-screen so the scale doesn't drift
// between sessions. Labels normalize to (rating - 1) / 4, and the binary head
// trains on >= 0.75 — so the 3/4 line is the only boundary the model sees.
const RUBRIC: { key: string; text: string; positive?: boolean }[] = [
  { key: 'N', text: 'not a sunset at all — day, night, fully obstructed' },
  { key: '1', text: 'sunset, but zero color — flat gray' },
  { key: '2', text: 'trace of color, washed out' },
  { key: '3', text: 'real color, unremarkable' },
  { key: '4', text: "vivid — you'd stop and look", positive: true },
  { key: '5', text: 'spectacular — keep it rare', positive: true },
];

const WHY: Record<string, string> = {
  model_low_claude_sunset:
    'Model rated this low — Claude calls it a sunset. Likely a miss.',
  model_high_claude_not_sunset:
    'Model rated this high — Claude says it is not a sunset.',
  binary_negative_regression_high:
    'Sunset detector says no — the quality model rated it high.',
  binary_positive_regression_low:
    'Sunset detector says yes — the quality model rated it low.',
};

const labelSource = (s: Snapshot): 'webcam' | 'flickr' =>
  s.source === 'flickr' ? 'flickr' : 'webcam';
const keyOf = (s: Snapshot) => `${labelSource(s)}:${s.snapshot.id}`;

const claudeText = (s: QueuedSnapshot): string => {
  if (s.llmIsSunset == null && s.llmQuality == null) return 'Claude —';
  if (s.llmIsSunset === false) return 'Claude: no';
  const pct = s.llmQuality == null ? '' : ` ${Math.round(Number(s.llmQuality) * 100)}%`;
  return `Claude: yes${pct}`;
};
const modelText = (s: QueuedSnapshot): string =>
  s.aiRegressionScore == null ? 'Model —' : `Model ${(1 + s.aiRegressionScore * 4).toFixed(1)}★`;

// Standardized rating button — neutral with one blue accent on hover.
const stdBtn = {
  color: '#e5e7eb',
  borderColor: 'rgba(255,255,255,0.28)',
  fontWeight: 700,
  '&:hover': { borderColor: '#60a5fa', background: 'rgba(96,165,250,0.15)' },
};

const toggleSx = {
  '& .MuiToggleButton-root': {
    color: '#cbd5e1',
    borderColor: 'rgba(255,255,255,0.28)',
    fontSize: 12,
    px: 1.25,
    py: 0.25,
    textTransform: 'none' as const,
    '&.Mui-selected': {
      color: '#0b1220',
      backgroundColor: '#60a5fa',
      '&:hover': { backgroundColor: '#3b82f6' },
    },
    '&:hover': { backgroundColor: 'rgba(96,165,250,0.15)' },
  },
};

const Badge = ({ p, small }: { p: Provenance; small?: boolean }) => (
  <Box
    sx={{
      position: 'absolute',
      top: 6,
      left: 6,
      zIndex: 3,
      px: 0.75,
      py: 0.25,
      borderRadius: 1,
      fontSize: small ? 9 : 11,
      fontWeight: 700,
      color: 'white',
      backgroundColor: PROVENANCE[p].bg,
    }}
  >
    {PROVENANCE[p].label}
  </Box>
);

export function HardExamplesQueue({
  hotkeysEnabled = true,
  // Page size. Overridable so the paging tests can reach the prefetch boundary
  // in a handful of ratings instead of 118 — at the default they took ~0.5s of
  // real renders each, which flaked against the 5s timeout under suite load.
  batchSize = BATCH,
}: {
  hotkeysEnabled?: boolean;
  batchSize?: number;
}) {
  const [blind, setBlind] = useState(true);
  const [view, setView] = useState<'queue' | 'grid'>('queue');
  const [source, setSource] = useState<'all' | 'webcam' | 'flickr'>('all');
  const [queue, setQueue] = useState<'disagreements' | 'sample'>('disagreements');

  const [snapshots, setSnapshots] = useState<QueuedSnapshot[]>([]);
  const [counts, setCounts] = useState<Counts>({ archiveTrained: 0, archiveNew: 0, flickr: 0 });
  const [sample, setSample] = useState<SampleProgress | null>(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Last write the database confirmed: its own row count and timestamp, never
  // computed here. This is the "yes, it's recording" readout.
  const [saved, setSaved] = useState<{ total: number | null; at: string | null }>({
    total: null,
    at: null,
  });
  // Set when the server hands back a short page (or nothing new), which is the
  // only reliable end-of-queue signal: `total` shrinks as you label, so
  // comparing it against a growing loaded list stops paging halfway through.
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);
  // Frames this session actually wrote a label for — distinguishes a rated
  // frame from a skipped one when stepping backwards.
  const labeledRef = useRef<Set<string>>(new Set());
  // Keys of every frame currently loaded, so an appended page can be deduped
  // without reading `snapshots` inside a state updater.
  const loadedRef = useRef<Set<string>>(new Set());
  // The cursor and the list, mirrored so a keypress reads where the queue
  // actually is rather than where the last render left it. Two keydowns
  // delivered before React commits would otherwise both resolve to the same
  // frame — one row written twice, the frame after it advanced past unrated.
  const idxRef = useRef(0);
  const snapshotsRef = useRef<QueuedSnapshot[]>([]);

  const setCursor = useCallback((next: number) => {
    idxRef.current = next;
    setIdx(next);
  }, []);

  const setFrames = useCallback((next: QueuedSnapshot[]) => {
    snapshotsRef.current = next;
    setSnapshots(next);
  }, []);

  const fetchBatch = useCallback(
    async (offset: number, replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      // Read the mode ONCE, here, and carry it through this whole request. The
      // request, the frames it returns and the origin they are labeled with all
      // come from this single value, so they cannot disagree with each other.
      const fetchOrigin = queue === 'sample' ? SAMPLE_NAME : 'hard_example';
      try {
        const srcParam = source === 'all' ? '' : `&source=${source}`;
        // The sample is a fixed set served in its own frozen order, so it takes
        // the place of the disagreement ranking rather than layering on top.
        const queueParam =
          queue === 'sample'
            ? `&sample=${encodeURIComponent(SAMPLE_NAME)}`
            : '&disagreements_only=true';
        const r = await fetch(
          `/api/snapshots?mode=verification${queueParam}&limit=${batchSize}&offset=${offset}${srcParam}`,
        );
        if (!r.ok)
          throw new Error(
            r.status === 401 || r.status === 403
              ? 'Owner sign-in required'
              : `Failed to load (${r.status})`,
          );
        const d = await r.json();
        // Stamp the population onto every frame as it arrives, from the mode
        // this request was actually issued with — not from state read later.
        const incoming: QueuedSnapshot[] = (d.snapshots ?? []).map(
          (s: QueuedSnapshot) => ({ ...s, queueOrigin: fetchOrigin }),
        );
        if (d.counts) setCounts(d.counts);
        setSample(d.sample ?? null);
        if (replace) {
          // Reset the session refs with the list, not ahead of it — a failed
          // reload would otherwise leave the old frames with an empty label set
          // and throw the offset off.
          labeledRef.current = new Set();
          loadedRef.current = new Set(incoming.map(keyOf));
          setFrames(incoming);
          setExhausted(incoming.length < batchSize);
        } else {
          // Never blend populations into one list. If the mode changed between
          // this page being requested and it arriving, drop the page: the
          // reload effect owns the switch and will replace the list. Appending
          // here is how 151 disagreement frames once got rated as if they were
          // still part of the random sample.
          const loadedOrigin = snapshotsRef.current[0]?.queueOrigin;
          if (loadedOrigin && loadedOrigin !== fetchOrigin) return;
          const fresh = incoming.filter((s) => !loadedRef.current.has(keyOf(s)));
          fresh.forEach((s) => loadedRef.current.add(keyOf(s)));
          if (fresh.length) setFrames([...snapshotsRef.current, ...fresh]);
          // A page that adds nothing new would otherwise re-trip the prefetch
          // effect forever, so treat it as the end of the queue too.
          setExhausted(incoming.length < batchSize || fresh.length === 0);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [source, setFrames, batchSize, queue],
  );

  useEffect(() => {
    setCursor(0);
    setExhausted(false);
    void fetchBatch(0, true);
  }, [fetchBatch, setCursor]);

  useEffect(() => {
    if (exhausted || loadingRef.current) return;
    if (snapshots.length === 0 || idx < snapshots.length - 2) return;
    // The server excludes labeled frames, so paging by `snapshots.length` walks
    // past that many frames we never saw. Only the frames we loaded but didn't
    // label are still in the server's set ahead of the cursor — offset by those.
    void fetchBatch(snapshots.length - labeledRef.current.size, false);
  }, [idx, snapshots.length, exhausted, fetchBatch]);

  const current = snapshots[idx];

  // Confirmed-write bookkeeping. In the disagreement queue the moving number is
  // the remaining-by-provenance bucket; in a fixed sample it's progress through
  // the draw. Both are adjusted locally between batch fetches for the same
  // reason — the server only recomputes them per page.
  const adjustCount = useCallback(
    (p: Provenance, delta: number, origin: string) => {
      if (origin === SAMPLE_NAME) {
        setSample((s) =>
          s ? { ...s, labeled: Math.max(0, Math.min(s.size, s.labeled - delta)) } : s,
        );
        return;
      }
      setCounts((c) => {
        const key = COUNT_KEY[p];
        const next = { ...c };
        next[key] = Math.max(0, next[key] + delta);
        return next;
      });
    },
    [],
  );

  const rate = useCallback(
    async (rating: number, isSunset: boolean) => {
      const i = idxRef.current;
      const s = snapshotsRef.current[i];
      if (!s) return;
      setSaveError(null);
      setCursor(i + 1); // optimistic advance for fast rating
      labeledRef.current.add(keyOf(s));
      try {
        const r = await fetch('/api/manual-labels', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            source: labelSource(s),
            imageId: s.snapshot.id,
            isSunset,
            rating: isSunset ? rating : null,
            // From the FRAME, not from current state: the population is fixed
            // when the frame is fetched and cannot drift before it is rated.
            origin: s.queueOrigin,
          }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!d?.saved?.id) throw new Error('no row returned');
        // The bucket only moves once the row is on record, so a falling count
        // is evidence the label persisted — not just that the click landed.
        adjustCount(s.provenance, -1, s.queueOrigin);
        setSaved({ total: d.labeledTotal ?? null, at: d.saved.labeledAt ?? null });
      } catch (e) {
        // Never fail silently: the frame wasn't saved, so it stays in the queue.
        labeledRef.current.delete(keyOf(s));
        setSaveError(
          `Couldn't save "${s.title || 'frame'}" (${e instanceof Error ? e.message : 'error'}). It's still in the queue — refresh to revisit it.`,
        );
      }
    },
    [adjustCount, setCursor],
  );

  const skip = useCallback(
    () => setCursor(Math.min(idxRef.current + 1, snapshotsRef.current.length)),
    [setCursor],
  );

  const undo = useCallback(async () => {
    const i = idxRef.current;
    const prev = snapshotsRef.current[i - 1];
    if (!prev) return;
    setSaveError(null);
    setCursor(Math.max(0, i - 1));
    // Stepping back over a skipped frame moves the cursor only — there is no
    // label to delete and nothing to add back to the counts.
    if (!labeledRef.current.has(keyOf(prev))) return;
    labeledRef.current.delete(keyOf(prev));
    try {
      const r = await fetch('/api/manual-labels', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: labelSource(prev), imageId: prev.snapshot.id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      // Same rule in reverse: the bucket goes back up only once the row is gone.
      adjustCount(prev.provenance, +1, prev.queueOrigin);
      setSaved({ total: d?.labeledTotal ?? null, at: null });
    } catch (e) {
      labeledRef.current.add(keyOf(prev));
      setSaveError(`Undo failed (${e instanceof Error ? e.message : 'error'}).`);
    }
  }, [adjustCount, setCursor]);

  // Hotkeys: 1-5 = sunset + quality, N/0 = not a sunset, space = skip, z = undo.
  useEffect(() => {
    if (!hotkeysEnabled || view !== 'queue') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); void rate(Number(e.key), true); }
      else if (e.key === '0' || e.key.toLowerCase() === 'n') { e.preventDefault(); void rate(0, false); }
      else if (e.key === ' ') { e.preventDefault(); skip(); }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeysEnabled, view, rate, skip, undo]);

  // A small side thumbnail (rated → reveal judges; upcoming → blind).
  const Thumb = ({ s, rated }: { s: QueuedSnapshot | null; rated: boolean }) => {
    if (!s)
      return (
        <Box
          sx={{
            width: THUMB_W,
            height: 70,
            flexShrink: 0,
            borderRadius: 1,
            border: '1px dashed rgba(255,255,255,0.12)',
          }}
        />
      ); // visible empty slot → symmetric layout even before frames fill in
    return (
      <Box sx={{ width: THUMB_W, flexShrink: 0, opacity: rated ? 0.85 : 0.6 }}>
        <Box sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden', filter: rated ? 'none' : 'grayscale(0.3)' }}>
          <Badge p={s.provenance} small />
          <Box component="img" src={s.snapshot.firebaseUrl} alt=""
            sx={{ width: '100%', height: 70, objectFit: 'cover', display: 'block', background: '#111827' }} />
        </Box>
        {rated && (
          <Typography sx={{ mt: 0.5, fontSize: 10, lineHeight: 1.3, color: '#cbd5e1', textAlign: 'center' }}>
            {modelText(s)}
            <br />
            {claudeText(s)}
          </Typography>
        )}
      </Box>
    );
  };

  const at = (i: number): QueuedSnapshot | null => snapshots[i] ?? null;

  const countsBar = (
    <Box
      sx={{
        display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center',
        px: 2, py: 1.25, mt: 1, borderTop: '1px solid rgba(255,255,255,0.08)',
        background: '#111827', borderRadius: 1,
      }}
    >
      <FormControlLabel
        sx={{ m: 0, color: '#e5e7eb', '& .MuiFormControlLabel-label': { fontSize: 13 } }}
        control={<Switch size="small" checked={blind} onChange={(e) => setBlind(e.target.checked)} />}
        label="Blind"
      />
      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} sx={toggleSx}>
        <ToggleButton value="queue">Queue</ToggleButton>
        <ToggleButton value="grid">Grid</ToggleButton>
      </ToggleButtonGroup>
      <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)} sx={toggleSx}>
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="webcam">Archive</ToggleButton>
        <ToggleButton value="flickr">Flickr</ToggleButton>
      </ToggleButtonGroup>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={queue}
        onChange={(_, v) => v && setQueue(v)}
        sx={toggleSx}
        aria-label="queue source"
      >
        <ToggleButton value="disagreements">Disagreements</ToggleButton>
        <ToggleButton value="sample">Random sample</ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ flex: 1 }} />
      {saved.total != null && (
        <Box
          data-testid="saved-readout"
          sx={{ display: 'flex', gap: 0.75, fontSize: 12, alignItems: 'center', color: '#6ee7b7' }}
        >
          <span>✓ saved</span>
          <b>{saved.total}</b>
          <span style={{ color: '#94a3b8' }}>
            on record{saved.at ? ` · ${new Date(saved.at).toLocaleTimeString()}` : ''}
          </span>
        </Box>
      )}
      {queue === 'sample' ? (
        <Box
          data-testid="sample-progress"
          sx={{ display: 'flex', gap: 0.75, fontSize: 12, alignItems: 'center' }}
        >
          <span style={{ color: '#94a3b8' }}>sample:</span>
          <span style={{ color: '#cbd5e1' }}>
            <b>{sample?.labeled ?? 0}</b> / {sample?.size ?? 0} rated
          </span>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, fontSize: 12, alignItems: 'center' }}>
          <span style={{ color: '#94a3b8' }}>left to rate:</span>
          <span style={{ color: '#cbd5e1' }}>Archive·trained <b>{counts.archiveTrained}</b></span>
          <span style={{ color: '#6ee7b7' }}>Archive·new <b>{counts.archiveNew}</b></span>
          <span style={{ color: '#c4b5fd' }}>Flickr <b>{counts.flickr}</b></span>
        </Box>
      )}
    </Box>
  );

  if (error) {
    return (<Box><Typography sx={{ color: '#f87171', mb: 1 }}>{error}</Typography>{countsBar}</Box>);
  }

  if (view === 'grid') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '46vh' }}>
        <Box sx={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignContent: 'flex-start', overflow: 'auto' }}>
          {snapshots.map((s) => (
            <Box key={keyOf(s)} sx={{ position: 'relative', width: 200 }}>
              <Box component="img" src={s.snapshot.firebaseUrl} alt=""
                sx={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 1, background: '#111827' }} />
              <Badge p={s.provenance} small />
            </Box>
          ))}
        </Box>
        {countsBar}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '46vh' }}>
      {saveError && (
        <Alert severity="error" onClose={() => setSaveError(null)} sx={{ mb: 1 }}>
          {saveError}
        </Alert>
      )}
      {loading && snapshots.length === 0 ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: '36vh' }}>
          <CircularProgress size={22} sx={{ color: 'white' }} />
        </Box>
      ) : !current ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: '36vh' }}>
          <Typography sx={{ color: '#9ca3af' }}>
            {queue === 'sample'
              ? !sample || sample.size === 0
                ? `No frames in sample "${SAMPLE_NAME}" — load it with ml/load_label_sample.py.`
                : sample.labeled >= sample.size
                ? `Sample complete — all ${sample.size} frames rated.`
                : // Running out of LOADED frames is not the same as finishing
                  // the sample. Saying "complete" here once hid 80 unrated
                  // frames behind a green checkmark.
                  `Paused at ${sample.labeled} of ${sample.size} — ${sample.size - sample.labeled} still unrated. Reload to continue.`
              : 'All caught up — no more flagged frames.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          {/* rated, left — nearest the center is the most recent (idx-1) */}
          {Array.from({ length: SIDE }, (_, k) => (
            <Thumb key={`L${k}`} s={at(idx - (SIDE - k))} rated />
          ))}

          {/* active — small DARK card holding the image + one-click rating;
              title/why text lives OUTSIDE the card below it. */}
          <Box sx={{ width: 300, flexShrink: 0 }}>
            <Box
              sx={{
                background: '#0f172a',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 2,
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                overflow: 'hidden',
              }}
            >
              <Box sx={{ position: 'relative' }}>
                <Badge p={current.provenance} />
                <Box
                  component="img"
                  src={current.snapshot.firebaseUrl}
                  alt=""
                  sx={{ display: 'block', width: '100%', height: '22vh', objectFit: 'cover', background: '#111827' }}
                />
              </Box>
              {/* rating on the card — standardized palette (neutral + blue accent) */}
              <Box sx={{ p: 1.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button
                  variant="outlined"
                  size="small"
                  fullWidth
                  onClick={() => void rate(0, false)}
                  sx={{ ...stdBtn, textTransform: 'none' }}
                >
                  Not a sunset (N)
                </Button>
                <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'center' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Button key={n} variant="outlined" size="small" onClick={() => void rate(n, true)} sx={{ ...stdBtn, minWidth: 40 }}>
                      {n}
                    </Button>
                  ))}
                </Box>
              </Box>
            </Box>

            {/* Which population THIS frame belongs to, read off the frame.
                The queue silently swapped populations mid-run once and the
                only way to notice was reading the database afterwards. */}
            <Typography
              data-testid="frame-population"
              sx={{
                textAlign: 'center',
                mt: 1,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: current.queueOrigin === SAMPLE_NAME ? '#6ee7b7' : '#94a3b8',
              }}
            >
              {current.queueOrigin === SAMPLE_NAME
                ? `Random sample${sample ? ` · ${sample.labeled} of ${sample.size}` : ''}`
                : 'Disagreement queue'}
            </Typography>
            <Typography sx={{ textAlign: 'center', mt: 0.25, fontSize: 14, fontWeight: 600, color: '#f3f4f6' }}>
              {current.title || 'Untitled'}
              {current.owner ? ` · ${current.owner}` : ''}
            </Typography>
            <Typography sx={{ textAlign: 'center', fontSize: 12.5, color: '#cbd5e1', minHeight: 16 }}>
              {/* Sample frames carry no disagreement — and saying one exists
                  would prime the rating, which is the one thing this set has
                  to avoid. */}
              {current.queueOrigin === SAMPLE_NAME
                ? 'Random ordinary frame — rate it on its own terms.'
                : current.modelDisagreementKind
                ? WHY[current.modelDisagreementKind] ?? 'Judges disagree on this frame.'
                : 'Judges disagree on this frame.'}
            </Typography>
            {!blind && (
              <Typography sx={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                {modelText(current)} · {claudeText(current)} (inspect)
              </Typography>
            )}
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 0.5 }}>
              <Button size="small" onClick={skip} sx={{ color: '#9ca3af', fontSize: 11 }}>Skip (␣)</Button>
              <Button size="small" onClick={() => void undo()} disabled={idx === 0} sx={{ color: '#9ca3af', fontSize: 11 }}>Undo (z)</Button>
            </Box>

            {/* Rubric legend — the scale lives on-glass so it stays consistent
                across sessions. See docs/ml/rating-rubric.md for the long form. */}
            <Box
              sx={{
                mt: 1,
                p: 1,
                borderRadius: 1,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              {RUBRIC.map((r) => (
                <Box key={r.key} sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}>
                  <Box
                    component="span"
                    sx={{
                      flexShrink: 0,
                      width: 14,
                      textAlign: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: r.positive ? '#60a5fa' : '#94a3b8',
                    }}
                  >
                    {r.key}
                  </Box>
                  <Typography sx={{ fontSize: 9.5, lineHeight: 1.45, color: r.positive ? '#dbeafe' : '#9ca3af' }}>
                    {r.text}
                  </Typography>
                </Box>
              ))}
              <Typography sx={{ mt: 0.75, fontSize: 9, lineHeight: 1.4, color: '#64748b' }}>
                4–5 = positive class for training; judge the sky, not the framing.
              </Typography>
              <Typography sx={{ fontSize: 9, lineHeight: 1.4, color: '#64748b' }}>
                keys: <b>N</b>/<b>1</b>–<b>5</b> rate · <b>␣</b> skip · <b>z</b> undo
              </Typography>
            </Box>
          </Box>

          {/* upcoming, right */}
          {Array.from({ length: SIDE }, (_, k) => (
            <Thumb key={`R${k}`} s={at(idx + 1 + k)} rated={false} />
          ))}
        </Box>
      )}

      {countsBar}
    </Box>
  );
}

export default HardExamplesQueue;
