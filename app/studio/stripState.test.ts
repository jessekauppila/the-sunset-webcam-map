import { describe, it, expect } from 'vitest';
import { stripState, formatPollAge } from './stripState';

const POLL_MS = 60_000;

describe('stripState', () => {
  it('is insync when there is no diff, no deploy in flight, and the last poll is fresh', () => {
    const nowMs = 1_000_000;
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs: nowMs - 5_000,
        deployedAtMs: null,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'insync' });
  });

  it('is drift when diffCount > 0 and nothing else overrides it', () => {
    const nowMs = 1_000_000;
    expect(
      stripState({
        diffCount: 3,
        lastPollAtMs: nowMs - 5_000,
        deployedAtMs: null,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'drift' });
  });

  it('is deploying when deployedAtMs is set and the last poll predates it, with a countdown to the next poll', () => {
    const deployedAtMs = 1_000_000;
    const lastPollAtMs = deployedAtMs - 10_000; // stale poll, predates the deploy
    const nowMs = deployedAtMs + 5_000;
    // next poll lands at lastPollAtMs + pollIntervalMs = 990000 + 60000 = 1050000
    // secondsToGlass = ceil((1050000 - 1005000)/1000) = ceil(45) = 45
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs,
        deployedAtMs,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'deploying', secondsToGlass: 45 });
  });

  it('clamps secondsToGlass to 0 once the countdown has passed', () => {
    const deployedAtMs = 1_000_000;
    const lastPollAtMs = deployedAtMs - 10_000;
    const nowMs = lastPollAtMs + POLL_MS + 30_000; // well past the next poll
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs,
        deployedAtMs,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'deploying', secondsToGlass: 0 });
  });

  it('is stale when lastPollAtMs is null, regardless of other fields', () => {
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs: null,
        deployedAtMs: null,
        nowMs: 1_000_000,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'stale' });
  });

  it('is stale when the last poll is more than 3 poll intervals old', () => {
    const nowMs = 1_000_000;
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs: nowMs - 3 * POLL_MS - 1,
        deployedAtMs: null,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'stale' });
  });

  it('is not yet stale at exactly 3 poll intervals old', () => {
    const nowMs = 1_000_000;
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs: nowMs - 3 * POLL_MS,
        deployedAtMs: null,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'insync' });
  });

  it('stale beats deploying when both conditions hold', () => {
    const deployedAtMs = 1_000_000;
    // lastPollAtMs predates the deploy AND is stale relative to nowMs.
    const lastPollAtMs = deployedAtMs - 10_000;
    const nowMs = lastPollAtMs + 3 * POLL_MS + 1;
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs,
        deployedAtMs,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'stale' });
  });

  it('stale beats drift', () => {
    expect(
      stripState({
        diffCount: 5,
        lastPollAtMs: null,
        deployedAtMs: null,
        nowMs: 1_000_000,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'stale' });
  });

  it('deploying beats drift', () => {
    const deployedAtMs = 1_000_000;
    const lastPollAtMs = deployedAtMs - 10_000;
    const nowMs = deployedAtMs + 5_000;
    expect(
      stripState({
        diffCount: 7,
        lastPollAtMs,
        deployedAtMs,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'deploying', secondsToGlass: 45 });
  });

  it('is not deploying once a fresh poll lands after the deploy', () => {
    const deployedAtMs = 1_000_000;
    const lastPollAtMs = deployedAtMs + 1_000; // poll landed after the deploy
    const nowMs = deployedAtMs + 5_000;
    expect(
      stripState({
        diffCount: 0,
        lastPollAtMs,
        deployedAtMs,
        nowMs,
        pollIntervalMs: POLL_MS,
      })
    ).toEqual({ kind: 'insync' });
  });
});

describe('formatPollAge', () => {
  it('formats sub-minute ages in seconds', () => {
    const nowMs = 1_000_000;
    expect(formatPollAge(nowMs - 32_000, nowMs)).toBe('32s ago');
  });

  it('formats zero age as 0s ago', () => {
    const nowMs = 1_000_000;
    expect(formatPollAge(nowMs, nowMs)).toBe('0s ago');
  });

  it('formats minute-scale ages in minutes', () => {
    const nowMs = 1_000_000;
    expect(formatPollAge(nowMs - 6 * 60_000, nowMs)).toBe('6m ago');
  });

  it('formats a null lastPollAtMs as never', () => {
    expect(formatPollAge(null, 1_000_000)).toBe('never');
  });
});
