import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveSceneButton, instantFromLocalInput } from './SaveSceneButton';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ok = (body: Record<string, unknown>) => ({
  ok: true,
  json: async () => body,
});

async function openAndType(label: string) {
  await userEvent.click(screen.getByTestId('studio-save-scene'));
  await userEvent.type(screen.getByTestId('studio-save-scene-label'), label);
}

describe('SaveSceneButton', () => {
  it('captures under the typed label', async () => {
    fetchMock.mockResolvedValue(ok({ id: 5, source: 'live', pinned: 12, archived: 12 }));
    render(<SaveSceneButton />);

    await openAndType('golden hour, thin cloud');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kiosk/scenes');
    expect(body.label).toBe('golden hour, thin cloud');
  });

  it('records the studio dials, not the deployed ones', async () => {
    fetchMock.mockResolvedValue(ok({ id: 5, source: 'live', pinned: 3, archived: 3 }));
    render(<SaveSceneButton />);

    await openAndType('x');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provenanceProfile).toBe('studio');
  });

  it('reports what actually landed, since a capture that archived none replays empty', async () => {
    fetchMock.mockResolvedValue(ok({ id: 5, source: 'live', pinned: 0, archived: 0 }));
    render(<SaveSceneButton />);

    await openAndType('dud');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('studio-save-scene-result')).toHaveTextContent('0 pinned, 0 archived')
    );
  });

  it('tells the caller so the selector can refresh', async () => {
    fetchMock.mockResolvedValue(ok({ id: 42, source: 'live', pinned: 1, archived: 1 }));
    const onSaved = vi.fn();
    render(<SaveSceneButton onSaved={onSaved} />);

    await openAndType('y');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(42));
  });

  it('surfaces a failed capture instead of claiming success', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    render(<SaveSceneButton />);

    await openAndType('z');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('studio-save-scene-error')).toHaveTextContent('Forbidden')
    );
  });

  it('will not fire on an empty label', async () => {
    render(<SaveSceneButton />);
    await userEvent.click(screen.getByTestId('studio-save-scene'));
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('instantFromLocalInput', () => {
  it('turns a zone-less picker value into a real instant', () => {
    // The API refuses a bare wall-clock string; the browser's own zone is
    // what the operator meant, and toISOString pins it.
    const iso = instantFromLocalInput('2026-03-20T18:30');
    expect(iso).toMatch(/Z$/);
    expect(new Date(iso!).getTime()).toBe(new Date('2026-03-20T18:30').getTime());
  });

  it('returns null for an empty or unusable value', () => {
    expect(instantFromLocalInput('')).toBeNull();
    expect(instantFromLocalInput('nonsense')).toBeNull();
  });
});

describe('SaveSceneButton — reconstructing a past moment', () => {
  it('sends an unambiguous instant and the window', async () => {
    fetchMock.mockResolvedValue(ok({ id: 7, source: 'historical', reconstructed: 31 }));
    render(<SaveSceneButton />);

    await openAndType('equinox dusk');
    await userEvent.click(screen.getByTestId('studio-scene-mode-past'));
    fireEvent.change(screen.getByTestId('studio-save-scene-when'), {
      target: { value: '2026-03-20T18:30' },
    });
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.at).toMatch(/Z$/);
    expect(body.windowMinutes).toBe(45);
  });

  it('reports how many frames the window matched', async () => {
    fetchMock.mockResolvedValue(ok({ id: 7, source: 'historical', reconstructed: 31 }));
    render(<SaveSceneButton />);

    await openAndType('equinox dusk');
    await userEvent.click(screen.getByTestId('studio-scene-mode-past'));
    fireEvent.change(screen.getByTestId('studio-save-scene-when'), {
      target: { value: '2026-03-20T18:30' },
    });
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('studio-save-scene-result')).toHaveTextContent('31 frames in window')
    );
  });

  it('refuses to send a past scene with no moment picked', async () => {
    render(<SaveSceneButton />);

    await openAndType('nowhen');
    await userEvent.click(screen.getByTestId('studio-scene-mode-past'));
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-save-scene-error')).toHaveTextContent('pick a date and time');
  });

  it('sends no timestamp at all in now mode', async () => {
    fetchMock.mockResolvedValue(ok({ id: 8, source: 'live', pinned: 2, archived: 2 }));
    render(<SaveSceneButton />);

    await openAndType('right now');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.at).toBeUndefined();
    expect(body.windowMinutes).toBeUndefined();
  });
});
