import { describe, it, expect } from 'vitest';
//import { render, screen } from "@testing-library/react";
import { subsolarPoint } from './subsolar-location';

describe('Subsolar-location', () => {
  it('results in a location', () => {
    //arrange
    const testDate = new Date('2025-01-01');

    //act
    const result = subsolarPoint(testDate);

    //assert
    expect(result).toHaveProperty('lat');
    expect(result).toHaveProperty('lng');
  });
});
