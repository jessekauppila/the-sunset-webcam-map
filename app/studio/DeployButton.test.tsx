import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DeployButton, DEPLOY_HOLD_MS } from './DeployButton';

describe('DeployButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('armed face shows the diff count and HOLD TO DEPLOY', () => {
    render(<DeployButton diffCount={3} onDeploy={vi.fn()} onRevert={vi.fn()} />);

    expect(screen.getByText('HOLD TO DEPLOY')).toBeInTheDocument();
    expect(screen.getByText('▲ 3 settings differ')).toBeInTheDocument();
  });

  it('shows singular copy for a single differing setting', () => {
    render(<DeployButton diffCount={1} onDeploy={vi.fn()} onRevert={vi.fn()} />);

    expect(screen.getByText('▲ 1 setting differs')).toBeInTheDocument();
  });

  it('completing a hold calls onDeploy exactly once', async () => {
    const onDeploy = vi.fn().mockResolvedValue(undefined);
    render(<DeployButton diffCount={2} onDeploy={onDeploy} onRevert={vi.fn()} />);

    const button = screen.getByRole('button', { name: /hold to deploy/i });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });

    expect(onDeploy).toHaveBeenCalledTimes(1);
  });

  it('early release does not call onDeploy', async () => {
    const onDeploy = vi.fn().mockResolvedValue(undefined);
    render(<DeployButton diffCount={2} onDeploy={onDeploy} onRevert={vi.fn()} />);

    const button = screen.getByRole('button', { name: /hold to deploy/i });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS - 1);
    });
    fireEvent.pointerUp(button);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(onDeploy).not.toHaveBeenCalled();
  });

  it('diffCount 0 shows the in-sync face', () => {
    render(<DeployButton diffCount={0} onDeploy={vi.fn()} onRevert={vi.fn()} />);

    expect(screen.getByText('IN SYNC WITH GLASS ✓')).toBeInTheDocument();
    expect(screen.getByText('dials match the deployed state')).toBeInTheDocument();
  });

  it('a completed hold on the in-sync face does not call onDeploy', async () => {
    const onDeploy = vi.fn().mockResolvedValue(undefined);
    render(<DeployButton diffCount={0} onDeploy={onDeploy} onRevert={vi.fn()} />);

    const button = screen.getByRole('button', { name: /in sync with glass/i });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });

    expect(onDeploy).not.toHaveBeenCalled();
  });

  it('revert button is disabled when in sync', () => {
    render(<DeployButton diffCount={0} onDeploy={vi.fn()} onRevert={vi.fn()} />);

    const revertButton = screen.getByRole('button', { name: /revert to glass/i });
    expect(revertButton).toBeDisabled();
  });

  it('revert button is enabled and calls onRevert when armed', () => {
    const onRevert = vi.fn().mockResolvedValue(undefined);
    render(<DeployButton diffCount={1} onDeploy={vi.fn()} onRevert={onRevert} />);

    const revertButton = screen.getByRole('button', { name: /revert to glass/i });
    expect(revertButton).not.toBeDisabled();

    fireEvent.click(revertButton);
    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it('compact variant renders DEPLOY and an N differ chip', () => {
    render(<DeployButton diffCount={4} onDeploy={vi.fn()} onRevert={vi.fn()} compact />);

    expect(screen.getByText('DEPLOY')).toBeInTheDocument();
    expect(screen.getByText('4 differ')).toBeInTheDocument();
  });

  it('compact variant still fires onDeploy on a completed hold', async () => {
    const onDeploy = vi.fn().mockResolvedValue(undefined);
    render(<DeployButton diffCount={2} onDeploy={onDeploy} onRevert={vi.fn()} compact />);

    const button = screen.getByRole('button', { name: /deploy/i });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });

    expect(onDeploy).toHaveBeenCalledTimes(1);
  });
});
