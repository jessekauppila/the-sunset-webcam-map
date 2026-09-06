import { describe, it, expect } from 'vitest';
import { formatPollAge } from './pollAge';

describe('formatPollAge', () => {
  const now = 1_000_000;
  it('never when there is no poll', () => expect(formatPollAge(null, now)).toBe('never'));
  it('seconds under a minute', () => expect(formatPollAge(now - 32_000, now)).toBe('32s ago'));
  it('minutes from a minute up', () => expect(formatPollAge(now - 6 * 60_000 - 5_000, now)).toBe('6m ago'));
  it('clamps a poll from the future to 0s', () => expect(formatPollAge(now + 5_000, now)).toBe('0s ago'));
});
