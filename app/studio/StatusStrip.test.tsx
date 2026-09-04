import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { StatusStrip } from './StatusStrip';

describe('StatusStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders glass version, revision, poll age, gate counts, and the in-sync state', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    vi.setSystemTime(now);
    const lastPollAt = new Date(now.getTime() - 32_000).toISOString();

    render(
      <StatusStrip
        glassVersion="v1"
        liveRevision={14}
        lastPollAt={lastPollAt}
        deployedAtMs={null}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
      />
    );

    expect(screen.getByText('glass v1')).toBeInTheDocument();
    expect(screen.getByText('rev 14')).toBeInTheDocument();
    expect(screen.getByText('polled 32s ago')).toBeInTheDocument();
    expect(screen.getByText('↑1/39 ↓3/42 pass')).toBeInTheDocument();
    expect(screen.getByText('dials match glass')).toBeInTheDocument();
  });

  it('shows the deploying state with a countdown to the next poll', () => {
    const deployedAtMs = new Date('2026-08-30T12:00:00Z').getTime();
    const lastPollAtMs = deployedAtMs - 10_000;
    vi.setSystemTime(deployedAtMs + 5_000);

    render(
      <StatusStrip
        glassVersion="v1"
        liveRevision={14}
        lastPollAt={new Date(lastPollAtMs).toISOString()}
        deployedAtMs={deployedAtMs}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
      />
    );

    // next poll lands at lastPollAtMs + 60000 = deployedAtMs + 50000;
    // secondsToGlass = ceil((deployedAtMs+50000 - (deployedAtMs+5000))/1000) = 45
    expect(screen.getByText('deploying · on glass within 45s')).toBeInTheDocument();
  });

  it('shows the drift state with the differing count', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    vi.setSystemTime(now);

    render(
      <StatusStrip
        glassVersion="v1"
        liveRevision={14}
        lastPollAt={new Date(now.getTime() - 5_000).toISOString()}
        deployedAtMs={null}
        diffCount={7}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
      />
    );

    expect(screen.getByText('7 dials differ')).toBeInTheDocument();
  });

  // "in sync" used to be the whole state word, and it was read as "the glass
  // shows this picture". It never meant that: the strip compares settings
  // rows, and a scene preview is a different pool at a different moment.
  it('says the preview is a scene when one is selected, so matching dials is not read as a matching picture', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    vi.setSystemTime(now);

    render(
      <StatusStrip
        glassVersion="v4"
        liveRevision={14}
        lastPollAt={new Date(now.getTime() - 5_000).toISOString()}
        deployedAtMs={null}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
        previewing="scene"
      />
    );

    expect(screen.getByText(/dials match glass/)).toBeInTheDocument();
    expect(screen.getByText(/previewing a scene · glass is live/)).toBeInTheDocument();
  });

  it('shows the stale state with a red kiosk-unreachable poll label when there has been no poll', () => {
    vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));

    render(
      <StatusStrip
        glassVersion="v1"
        liveRevision={14}
        lastPollAt={null}
        deployedAtMs={null}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
      />
    );

    expect(screen.getByText('polled never — kiosk unreachable?')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('ticks the poll age forward once a second, and stops after unmount', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    vi.setSystemTime(now);
    const lastPollAt = new Date(now.getTime() - 1_000).toISOString();

    const { unmount } = render(
      <StatusStrip
        glassVersion="v1"
        liveRevision={14}
        lastPollAt={lastPollAt}
        deployedAtMs={null}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
      />
    );

    expect(screen.getByText('polled 1s ago')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText('polled 6s ago')).toBeInTheDocument();

    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('names the keys a write could not store, so an undeployed dial is not silent', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    vi.setSystemTime(now);

    render(
      <StatusStrip
        glassVersion="v2"
        liveRevision={14}
        lastPollAt={new Date(now.getTime() - 5_000).toISOString()}
        deployedAtMs={null}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
        droppedKeys={[{ key: 'motionMode', reason: 'unknown' }]}
      />
    );

    expect(screen.getByText(/motionMode/)).toBeInTheDocument();
  });

  it('says nothing about dropped keys when the last write stored everything', () => {
    const now = new Date('2026-08-30T12:00:00Z');
    vi.setSystemTime(now);

    render(
      <StatusStrip
        glassVersion="v2"
        liveRevision={14}
        lastPollAt={new Date(now.getTime() - 5_000).toISOString()}
        deployedAtMs={null}
        diffCount={0}
        sunrisePass={{ pass: 1, total: 39 }}
        sunsetPass={{ pass: 3, total: 42 }}
        droppedKeys={[]}
      />
    );

    expect(screen.queryByTestId('status-strip-dropped')).toBeNull();
  });

});
