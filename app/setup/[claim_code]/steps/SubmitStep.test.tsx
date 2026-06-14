import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { solveBracket } from '@/app/lib/bracket';
import SubmitStep from './SubmitStep';
import { initialWizardState, type WizardState } from '../types';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function readyState(): WizardState {
  return {
    ...initialWizardState,
    facing: 'west',
    windowMagAz: 262,
    declinationDeg: 15.3,
    solution: solveBracket({ lat: 48.75, year: 2026, facing: 'west', windowMagAz: 262, declinationDeg: 15.3 }),
    lat: 47.6062, lng: -122.3321, elevationM: 30, timezone: 'America/Los_Angeles',
    deviceStatus: 'registered',
    delivery: null,
  };
}

describe('SubmitStep', () => {
  it('POSTs a payload with bracket provenance and mode', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ camera_id: 1, placement_status: 'ready' }) });
    const { getByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={readyState()} onBack={() => {}} isOwner={false} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.placement.azimuth_source).toBe('bracket');
    expect(body.placement.coarse).toBe(true);
    expect(body.placement.tilt_deg).toBe(0);
    expect(body.placement.bracket.lens).toBe('wide_120');
    expect(body.operator_preferences.phase_preference).toBe('sunset');
    expect(body.operator_preferences.delivery).toBeNull();
    // mode is always included
    expect(body.mode).toBe('reaim');
  });

  it('non-owner: does not include publish in POST body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ camera_id: 1, placement_status: 'ready' }) });
    const { getByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={readyState()} onBack={() => {}} isOwner={false} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.publish).toBeUndefined();
  });

  it('owner with publish checked: includes publish:true in POST body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ camera_id: 1, placement_status: 'ready' }) });
    const stateWithPublish = { ...readyState(), publish: true };
    const { getByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={stateWithPublish} onBack={() => {}} isOwner={true} onPublishChange={() => {}} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.publish).toBe(true);
  });

  it('owner with publish unchecked: includes publish:false in POST body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ camera_id: 1, placement_status: 'ready' }) });
    const stateWithPublish = { ...readyState(), publish: false };
    const { getByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={stateWithPublish} onBack={() => {}} isOwner={true} onPublishChange={() => {}} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.publish).toBe(false);
  });

  it('owner: renders the publish checkbox', async () => {
    const { findByRole } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={readyState()} onBack={() => {}} isOwner={true} onPublishChange={() => {}} />
    );
    const checkbox = await findByRole('checkbox', { name: /publish now/i });
    expect(checkbox).toBeTruthy();
  });

  it('non-owner: does not render the publish checkbox', () => {
    const { queryByRole } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={readyState()} onBack={() => {}} isOwner={false} />
    );
    expect(queryByRole('checkbox', { name: /publish now/i })).toBeNull();
  });

  it('surfaces an expired-link message on 410 at submit', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410, json: async () => ({}) });
    const { getByText, findByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={readyState()} onBack={() => {}} isOwner={false} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    expect(await findByText(/expired/i)).toBeTruthy();
  });

  it('blocks submit when the bracket is unsolved', () => {
    const { getByText } = render(
      <SubmitStep claimCode="SUNSET-7K3M-9XQ2" state={initialWizardState} onBack={() => {}} isOwner={false} />
    );
    fireEvent.click(getByText(/Finish setup/i));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
