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

  it('shows a failure line when onRevert rejects (no unhandled rejection), and a subsequent successful revert clears it', async () => {
    const onRevert = vi
      .fn()
      .mockRejectedValueOnce(new Error('revert failed: 500'))
      .mockResolvedValueOnce(undefined);
    render(<DeployButton diffCount={2} onDeploy={vi.fn()} onRevert={onRevert} />);

    const revertButton = screen.getByRole('button', { name: /revert to glass/i });

    fireEvent.click(revertButton);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(screen.getByText('revert failed — try again')).toBeInTheDocument();

    // A subsequent click (now labeled "revert failed — try again") retries
    // and, on success, clears the failure line.
    fireEvent.click(screen.getByRole('button', { name: /revert failed/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRevert).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('revert failed — try again')).not.toBeInTheDocument();
    expect(screen.getByText('↩ revert to glass')).toBeInTheDocument();
  });

  it('compact variant renders DEPLOY and an N differ chip', () => {
    render(<DeployButton diffCount={4} onDeploy={vi.fn()} onRevert={vi.fn()} compact />);

    expect(screen.getByText('DEPLOY')).toBeInTheDocument();
    expect(screen.getByText('4 differ')).toBeInTheDocument();
  });

  it('does not call onDeploy a second time from a completed hold while the first deploy is in flight, and allows a new hold once it resolves', async () => {
    let resolveDeploy: () => void = () => {};
    const onDeploy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDeploy = resolve;
        })
    );
    render(<DeployButton diffCount={2} onDeploy={onDeploy} onRevert={vi.fn()} />);

    const button = screen.getByRole('button', { name: /hold to deploy/i });

    // First hold completes and kicks off the (still-pending) deploy.
    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onDeploy).toHaveBeenCalledTimes(1);

    // A second completed hold while the promise is still pending must not
    // call onDeploy again.
    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onDeploy).toHaveBeenCalledTimes(1);

    // Resolve the in-flight deploy — a fresh hold should now work again.
    await act(async () => {
      resolveDeploy();
      await Promise.resolve();
    });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
    });
    expect(onDeploy).toHaveBeenCalledTimes(2);
  });

  it('shows a failure line when onDeploy rejects, and it clears on the next successful hold', async () => {
    const onDeploy = vi
      .fn()
      .mockRejectedValueOnce(new Error('deploy failed: 500'))
      .mockResolvedValueOnce(undefined);
    render(<DeployButton diffCount={2} onDeploy={onDeploy} onRevert={vi.fn()} />);

    const button = screen.getByRole('button', { name: /hold to deploy/i });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('deploy failed — try again')).toBeInTheDocument();

    // A fresh hold clears the failure line and (this time) succeeds.
    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('deploy failed — try again')).not.toBeInTheDocument();
    expect(onDeploy).toHaveBeenCalledTimes(2);
  });

  it('clears the failure line when diffCount changes', async () => {
    const onDeploy = vi.fn().mockRejectedValueOnce(new Error('deploy failed: 500'));
    const { rerender } = render(
      <DeployButton diffCount={2} onDeploy={onDeploy} onRevert={vi.fn()} />
    );

    const button = screen.getByRole('button', { name: /hold to deploy/i });

    fireEvent.pointerDown(button);
    await act(async () => {
      vi.advanceTimersByTime(DEPLOY_HOLD_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('deploy failed — try again')).toBeInTheDocument();

    rerender(<DeployButton diffCount={3} onDeploy={onDeploy} onRevert={vi.fn()} />);

    expect(screen.queryByText('deploy failed — try again')).not.toBeInTheDocument();
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
