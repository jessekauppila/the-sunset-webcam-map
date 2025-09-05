import { describe, it, expect } from 'vitest';
import { splitTerminatorSunriseSunset } from './terminatorRing';

describe('Terminator ring', () => {
  it('creates a list of sunset and sunrise points', () => {
    //arrange
    const testDate = new Date('2025-01-01');

    //act
    const terminatorRing = splitTerminatorSunriseSunset(testDate);
  });
});
