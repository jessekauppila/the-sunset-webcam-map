import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveSceneButton } from './SaveSceneButton';

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
    fetchMock.mockResolvedValue(ok({ id: 5, pinned: 12 }));
    render(<SaveSceneButton />);

    await openAndType('golden hour, thin cloud');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/kiosk/scenes');
    expect(body.label).toBe('golden hour, thin cloud');
  });

  it('records the studio dials, not the deployed ones', async () => {
    fetchMock.mockResolvedValue(ok({ id: 5, pinned: 3 }));
    render(<SaveSceneButton />);

    await openAndType('x');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provenanceProfile).toBe('studio');
  });

  it('reports how many frames were pinned, since a scene that pinned none replays empty', async () => {
    fetchMock.mockResolvedValue(ok({ id: 5, pinned: 0 }));
    render(<SaveSceneButton />);

    await openAndType('dud');
    await userEvent.click(screen.getByTestId('studio-save-scene-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('studio-save-scene-result')).toHaveTextContent('0 frames pinned')
    );
  });

  it('tells the caller so the selector can refresh', async () => {
    fetchMock.mockResolvedValue(ok({ id: 42, pinned: 1 }));
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
