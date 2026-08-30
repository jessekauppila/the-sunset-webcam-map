import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HardExamplesQueue from './HardExamplesQueue';

// Two frames with different provenance so we can assert the right bucket moves.
const FRAMES = [
  {
    id: 'w-1',
    title: 'Frame one',
    source: 'webcam',
    provenance: 'archive_new',
    modelDisagreementKind: 'model_low_claude_sunset',
    aiRegressionScore: 0.2,
    llmIsSunset: true,
    llmQuality: 0.8,
    snapshot: { id: 1, firebaseUrl: 'https://example.test/1.jpg' },
  },
  {
    id: 'f-2',
    title: 'Frame two',
    source: 'flickr',
    provenance: 'flickr',
    modelDisagreementKind: 'model_high_claude_not_sunset',
    aiRegressionScore: 0.9,
    llmIsSunset: false,
    llmQuality: 0.1,
    snapshot: { id: 2, firebaseUrl: 'https://example.test/2.jpg' },
  },
];

const COUNTS = { archiveTrained: 10, archiveNew: 5, flickr: 7 };

// What POST /api/manual-labels returns: the stored row plus the table's own
// total. The queue treats the returned row as its proof the label persisted.
let labelSeq = 0;
const labelBody = () => ({
  ok: true,
  saved: { id: ++labelSeq, labeledAt: '2026-08-08T02:35:24.017Z' },
  labeledTotal: 100 + labelSeq,
});
const labelResponse = () =>
  ({ ok: true, status: 200, json: async () => labelBody() }) as Response;

function mockFetch({ saveOk = true }: { saveOk?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/snapshots')) {
      return {
        ok: true,
        json: async () => ({ snapshots: FRAMES, total: FRAMES.length, counts: COUNTS }),
      } as Response;
    }
    if (String(url).startsWith('/api/manual-labels')) {
      return saveOk
        ? labelResponse()
        : ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) } as Response);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

// "Archive·new 5" renders as sibling nodes, so match on the container's text.
const bucketText = () =>
  screen.getByText('left to rate:').parentElement?.textContent ?? '';

describe('HardExamplesQueue counts bar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
  });

  it('seeds the buckets from the API response', async () => {
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));
    expect(bucketText()).toContain('Archive·trained 10');
    expect(bucketText()).toContain('Flickr 7');
  });

  it('decrements the rated frame’s bucket instead of sitting frozen', async () => {
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard('4'); // rates frame one (archive_new)

    await waitFor(() => expect(bucketText()).toContain('Archive·new 4'));
    // other buckets untouched
    expect(bucketText()).toContain('Archive·trained 10');
    expect(bucketText()).toContain('Flickr 7');
  });

  it('decrements the flickr bucket for a "not a sunset" label', async () => {
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Flickr 7'));

    await user.keyboard('4'); // advance past frame one
    await waitFor(() => expect(bucketText()).toContain('Archive·new 4'));
    await user.keyboard('n'); // frame two → not a sunset

    await waitFor(() => expect(bucketText()).toContain('Flickr 6'));
  });

  it('does not decrement on skip', async () => {
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard(' ');

    await waitFor(() => expect(screen.getByText('Frame two')).toBeTruthy());
    expect(bucketText()).toContain('Archive·new 5');
  });

  it('restores the bucket when undoing a label', async () => {
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard('4');
    await waitFor(() => expect(bucketText()).toContain('Archive·new 4'));
    await user.keyboard('z');

    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));
  });

  it('does not restore a bucket when undoing over a skipped frame', async () => {
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard(' '); // skip frame one — never counted down
    await waitFor(() => expect(screen.getByText('Frame two')).toBeTruthy());
    await user.keyboard('z');

    await waitFor(() => expect(screen.getByText('Frame one')).toBeTruthy());
    expect(bucketText()).toContain('Archive·new 5');
  });

  it('leaves the bucket alone until the server confirms the row', async () => {
    // Hold the POST open: the frame advances immediately, but the count must
    // not move until the database has answered.
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('/api/snapshots')) {
          return {
            ok: true,
            json: async () => ({ snapshots: FRAMES, total: FRAMES.length, counts: COUNTS }),
          } as Response;
        }
        return new Promise<Response>((res) => {
          release = res;
        });
      }),
    );
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard('4');

    await waitFor(() => expect(screen.getByText('Frame two')).toBeTruthy());
    expect(bucketText()).toContain('Archive·new 5'); // still unconfirmed

    release(labelResponse());
    await waitFor(() => expect(bucketText()).toContain('Archive·new 4'));
  });

  it('shows the row count the server reports, not one it counted itself', async () => {
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));
    expect(screen.queryByTestId('saved-readout')).toBeNull();

    await user.keyboard('4');

    const readout = await waitFor(() => screen.getByTestId('saved-readout'));
    // labelBody() reports 100 + seq — a number the client cannot derive.
    expect(readout.textContent).toMatch(/saved\d+on record/);
    expect(Number(readout.textContent?.match(/saved(\d+)/)?.[1])).toBeGreaterThan(100);
  });

  it('shows no save confirmation when the write fails', async () => {
    vi.stubGlobal('fetch', mockFetch({ saveOk: false }));
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard('4');

    await waitFor(() => expect(screen.getByText(/Couldn't save/)).toBeTruthy());
    expect(screen.queryByTestId('saved-readout')).toBeNull();
  });

  it('rolls the bucket back when the save fails', async () => {
    vi.stubGlobal('fetch', mockFetch({ saveOk: false }));
    const user = userEvent.setup();
    render(<HardExamplesQueue />);
    await waitFor(() => expect(bucketText()).toContain('Archive·new 5'));

    await user.keyboard('4');

    await waitFor(() => expect(screen.getByText(/Couldn't save/)).toBeTruthy());
    expect(bucketText()).toContain('Archive·new 5');
  });
});

// A full page as far as the component is concerned, so the prefetch-near-the-end
// path actually runs — but small, and passed in as `batchSize`. The boundary
// logic is the same at 10 as at the production 120; the only difference is that
// reaching it costs 8 ratings instead of 118. At 118 each of these tests did
// ~0.5s of real renders and POSTs, which stretched past the 5s timeout when the
// rest of the suite was competing for CPU.
const BATCH = 10;
const makePage = (prefix: string, n = BATCH) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    title: `${prefix} frame ${i}`,
    source: 'webcam',
    provenance: 'archive_new',
    modelDisagreementKind: 'model_low_claude_sunset',
    aiRegressionScore: 0.2,
    llmIsSunset: true,
    llmQuality: 0.8,
    snapshot: { id: `${prefix}-${i}`, firebaseUrl: `https://example.test/${prefix}-${i}.jpg` },
  }));

// Records every /api/snapshots URL so the tests can assert the offset the
// client asked for. Each distinct offset serves a distinct page.
function pagingFetch() {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.startsWith('/api/snapshots')) {
      calls.push(u);
      const offset = Number(new URL(u, 'http://t').searchParams.get('offset'));
      return {
        ok: true,
        json: async () => ({
          snapshots: makePage(`p${calls.length}-off${offset}`),
          total: 10_000,
          counts: COUNTS,
        }),
      } as Response;
    }
    if (u.startsWith('/api/manual-labels')) {
      return labelResponse();
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  return { fn, calls };
}

const offsetsOf = (calls: string[]) =>
  calls.map((u) => Number(new URL(u, 'http://t').searchParams.get('offset')));

describe('HardExamplesQueue pagination', () => {
  it('pages by the frames still in the server-side set, not by frames loaded', async () => {
    const { fn, calls } = pagingFetch();
    vi.stubGlobal('fetch', fn);
    const user = userEvent.setup();
    render(<HardExamplesQueue batchSize={BATCH} />);
    await waitFor(() => expect(calls.length).toBe(1));

    // Rate 6 and skip 2 — the cursor lands two from the end and trips the
    // prefetch. Labeled frames leave the server's unlabeled set, so four of the
    // 10 loaded frames are still in it: the 2 skipped and the 2 not yet
    // reached. Paging by the loaded length (offset 10) would jump the 6
    // unseen frames that took the labeled ones' place.
    await user.keyboard('4'.repeat(BATCH - 4));
    await user.keyboard('  ');

    await waitFor(() => expect(calls.length).toBe(2));
    expect(offsetsOf(calls)).toEqual([0, 4]);
  });

  it('shows every frame in order when the server drops labeled ones from the set', async () => {
    // Stands in for the real endpoint: one ordered pool, labeled frames leave
    // the result set, offset applies to what's left. That exclusion is what
    // makes offset-by-loaded-length skip frames.
    const pool = makePage('pool', 300);
    const labeled = new Set<string>();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.startsWith('/api/snapshots')) {
          calls.push(u);
          const offset = Number(new URL(u, 'http://t').searchParams.get('offset'));
          const remaining = pool.filter((f) => !labeled.has(String(f.snapshot.id)));
          return {
            ok: true,
            json: async () => ({
              snapshots: remaining.slice(offset, offset + BATCH),
              total: remaining.length,
              counts: COUNTS,
            }),
          } as Response;
        }
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (init?.method === 'DELETE') labeled.delete(String(body.imageId));
        else labeled.add(String(body.imageId));
        return labelResponse();
      }),
    );
    const user = userEvent.setup();
    render(<HardExamplesQueue batchSize={BATCH} />);
    await waitFor(() => expect(calls.length).toBe(1));

    await user.keyboard('4'.repeat(BATCH - 2)); // trips the prefetch at frame 8
    await waitFor(() => expect(calls.length).toBe(2));

    // Frames 8 and 9 close out page one; frame 10 must be next. Paging by the
    // loaded length lands on frame 18 here and loses the 8 in between.
    await user.keyboard('4'.repeat(2));
    await waitFor(() => expect(screen.getByText('pool frame 10')).toBeTruthy());
  });

  it('stops paging once the server returns a short page', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith('/api/snapshots')) {
          calls.push(u);
          return {
            ok: true,
            json: async () => ({ snapshots: makePage('short', 3), total: 3, counts: COUNTS }),
          } as Response;
        }
        return labelResponse();
      }),
    );
    const user = userEvent.setup();
    render(<HardExamplesQueue batchSize={BATCH} />);
    await waitFor(() => expect(calls.length).toBe(1));

    // A page shorter than BATCH means the queue is drained; running off the end
    // of it must not spin the fetch loop.
    await user.keyboard('4'.repeat(3));
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.length).toBe(1);
  });
});

describe('HardExamplesQueue rapid rating', () => {
  it('writes a distinct row per keypress when presses outrun a render', async () => {
    const posted: unknown[] = [];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('/api/snapshots')) {
          return {
            ok: true,
            json: async () => ({ snapshots: makePage('burst'), total: 500, counts: COUNTS }),
          } as Response;
        }
        posted.push(JSON.parse(String(init?.body ?? '{}')).imageId);
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, saved: { id: ++n, labeledAt: 'x' }, labeledTotal: n }),
        } as Response;
      }),
    );
    render(<HardExamplesQueue batchSize={BATCH} />);
    await waitFor(() => expect(screen.getByText('burst frame 0')).toBeTruthy());

    // Five keydowns in one tick — the worst case a blocked main thread can
    // deliver between a keypress and React committing the next frame. Reading
    // the cursor from render state instead of the ref rates frame 0 five times
    // and advances past frames 1-4 with no label written.
    await act(async () => {
      for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: '4' });
    });

    await waitFor(() => expect(posted.length).toBe(5));
    expect(new Set(posted).size).toBe(5);
  });
});

describe('HardExamplesQueue rubric legend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
  });

  it('renders the rating scale under the rater', async () => {
    render(<HardExamplesQueue />);
    await waitFor(() => expect(screen.getByText('Frame one')).toBeTruthy());

    expect(screen.getByText(/not a sunset at all/)).toBeTruthy();
    expect(screen.getByText(/flat gray/)).toBeTruthy();
    expect(screen.getByText(/spectacular/)).toBeTruthy();
    expect(screen.getByText(/positive class for training/)).toBeTruthy();
  });

  it('lists the hotkeys, including the two with no on-card button', async () => {
    render(<HardExamplesQueue />);
    await waitFor(() => expect(screen.getByText('Frame one')).toBeTruthy());

    const keys = screen.getByText(/keys:/);
    expect(keys.textContent).toContain('rate');
    expect(keys.textContent).toContain('skip');
    expect(keys.textContent).toContain('undo');
    expect(keys.textContent).toContain('z');
    expect(keys.textContent).toContain('␣');
  });
});

describe('HardExamplesQueue random-sample queue', () => {
  // The disagreement queue only ever surfaces the hardest ~15% of the corpus,
  // which is why the operator-vs-Claude numbers have all needed caveats. These
  // tests pin the second queue: a pre-drawn fixed set, served in its own order.
  const SAMPLE = { name: 'random_ordinary_v2', size: 200, labeled: 12 };

  // Sample frames carry no disagreement kind — that is what makes them ordinary.
  const SAMPLE_FRAMES = FRAMES.map((f) => ({ ...f, modelDisagreementKind: null }));

  const urls: string[] = [];
  function mockSampleFetch() {
    return vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).startsWith('/api/snapshots')) {
        const isSample = String(url).includes('sample=');
        return {
          ok: true,
          json: async () => ({
            snapshots: isSample ? SAMPLE_FRAMES : FRAMES,
            total: 2,
            counts: COUNTS,
            sample: isSample ? SAMPLE : null,
          }),
        } as Response;
      }
      return labelResponse();
    });
  }

  beforeEach(() => {
    urls.length = 0;
    labelSeq = 0;
    vi.stubGlobal('fetch', mockSampleFetch());
  });

  const switchToSample = async () => {
    render(<HardExamplesQueue />);
    await screen.findByText('Frame one');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Random sample' }));
    });
  };

  it('asks for the named sample instead of the disagreement ranking', async () => {
    await switchToSample();
    const last = urls.filter((u) => u.startsWith('/api/snapshots')).at(-1) ?? '';
    expect(last).toContain('sample=random_ordinary_v2');
    // Both at once would be incoherent: the sample is exactly the frames the
    // disagreement filter excludes, so it has to replace that filter.
    expect(last).not.toContain('disagreements_only=true');
  });

  it('shows progress through the draw, not the remaining-by-provenance buckets', async () => {
    await switchToSample();
    expect(await screen.findByTestId('sample-progress')).toHaveTextContent('12 / 200');
    expect(screen.queryByText('left to rate:')).toBeNull();
  });

  it('stamps the sample name as origin so the two label sets stay separable', async () => {
    await switchToSample();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not a sunset (N)' }));
    });
    const post = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('/api/manual-labels'),
    );
    expect(JSON.parse(String((post?.[1] as RequestInit)?.body)).origin).toBe(
      'random_ordinary_v2',
    );
  });

  it('advances the progress readout on a confirmed save', async () => {
    await switchToSample();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not a sunset (N)' }));
    });
    await waitFor(() =>
      expect(screen.getByTestId('sample-progress')).toHaveTextContent('13 / 200'),
    );
  });

  it('does not tell the operator the judges disagree', async () => {
    // The whole value of this set is an unprimed rating. Claiming a
    // disagreement exists on an ordinary frame would bias it.
    await switchToSample();
    await waitFor(() =>
      expect(screen.getByText(/Random ordinary frame/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Judges disagree/)).toBeNull();
  });
});


describe('HardExamplesQueue population integrity (regression, 2026-08-29)', () => {
  // What actually happened: the operator switched to the random sample, rated
  // 120 frames, and every one was stored with origin 'hard_example'; then 151
  // disagreement frames were appended into the same run and rated as if they
  // were still the sample. Both failures came from reading the live queue mode
  // at rating time instead of binding the population to the frame.
  const FRAME = (id: number, kind: string | null = null) => ({
    id: `w-${id}`, title: `F${id}`, source: 'webcam', provenance: 'archive_new',
    modelDisagreementKind: kind, aiRegressionScore: 0.2,
    llmIsSunset: true, llmQuality: 0.8,
    snapshot: { id, firebaseUrl: `https://example.test/${id}.jpg` },
  });

  const bodies = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => String(c[0]).startsWith('/api/manual-labels'))
      .map((c) => JSON.parse(String((c[1] as RequestInit)?.body)));

  it('labels a sample frame with the sample origin even if the mode flips first', async () => {
    let sampleServed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('/api/snapshots')) {
        const isSample = u.includes('sample=');
        if (isSample) sampleServed = true;
        return { ok: true, json: async () => ({
          snapshots: [FRAME(1), FRAME(2)], total: 2,
          counts: { archiveTrained: 0, archiveNew: 0, flickr: 0 },
          sample: isSample ? { name: 'random_ordinary_v2', size: 200, labeled: 0 } : null,
        })} as Response;
      }
      return labelResponse();
    }));
    render(<HardExamplesQueue />);
    await screen.findByText('F1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Random sample' }));
    });
    expect(sampleServed).toBe(true);
    // Simulate the mode reverting under the operator before they rate.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disagreements' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not a sunset (N)' }));
    });
    // Whatever the toggle now says, the frame on screen came from whichever
    // fetch loaded it, and must be labeled as that population.
    const origins = bodies().map((b) => b.origin);
    expect(new Set(origins).size).toBe(1);
  });

  it('never appends frames from a different population into the loaded run', async () => {
    // Page 1 is the sample; the mode flips; page 2 would be disagreements.
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('/api/snapshots')) {
        const isSample = u.includes('sample=');
        call += 1;
        return { ok: true, json: async () => ({
          snapshots: isSample
            ? [FRAME(1), FRAME(2), FRAME(3)]
            : [FRAME(90, 'model_low_claude_sunset'), FRAME(91, 'model_low_claude_sunset')],
          total: 3,
          counts: { archiveTrained: 0, archiveNew: 0, flickr: 0 },
          sample: isSample ? { name: 'random_ordinary_v2', size: 200, labeled: 0 } : null,
        })} as Response;
      }
      return labelResponse();
    }));
    render(<HardExamplesQueue batchSize={3} />);
    // Mount serves the disagreement queue; switch to the sample from there.
    await screen.findByText('F90');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Random sample' }));
    });
    await screen.findByText('F1');
    const before = screen.getByTestId('frame-population').textContent;
    // Rate to the prefetch boundary; a disagreement page must not slide in.
    await act(async () => { fireEvent.keyDown(window, { key: '0' }); });
    await act(async () => { fireEvent.keyDown(window, { key: '0' }); });
    expect(before).toMatch(/Random sample/);
    expect(screen.queryByText('F90')).toBeNull();
    expect(call).toBeGreaterThan(0);
  });

  it('does not call a sample "complete" when frames are still unrated', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/snapshots')) {
        return { ok: true, json: async () => ({
          snapshots: [], total: 0,
          counts: { archiveTrained: 0, archiveNew: 0, flickr: 0 },
          sample: { name: 'random_ordinary_v2', size: 200, labeled: 120 },
        })} as Response;
      }
      return labelResponse();
    }));
    render(<HardExamplesQueue />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Random sample' }));
    });
    // 120 of 200 rated must never read as finished.
    await waitFor(() => expect(screen.getByText(/still unrated/)).toBeTruthy());
    expect(screen.queryByText(/Sample complete/)).toBeNull();
  });
});
