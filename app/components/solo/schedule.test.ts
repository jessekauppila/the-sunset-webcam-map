import { it, expect } from 'vitest';
import { msUntilBoundary } from './schedule';

it('is the gap to the next boundary, never zero', () => {
  expect(msUntilBoundary(0, 'sunrise', 20, 10)).toBe(20_000);
  expect(msUntilBoundary(19_999, 'sunrise', 20, 10)).toBe(1);
  expect(msUntilBoundary(20_000, 'sunrise', 20, 10)).toBe(20_000);
  expect(msUntilBoundary(0, 'sunset', 20, 10)).toBe(10_000);
});
