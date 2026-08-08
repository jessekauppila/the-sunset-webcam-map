import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function mockFetch({ saveOk = true }: { saveOk?: boolean } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/snapshots')) {
      return {
        ok: true,
        json: async () => ({ snapshots: FRAMES, total: FRAMES.length, counts: COUNTS }),
      } as Response;
    }
    if (String(url).startsWith('/api/manual-labels')) {
      return { ok: saveOk, status: saveOk ? 200 : 500, json: async () => ({}) } as Response;
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
});
