import { describe, it, expect } from 'vitest';
import { creditText } from './credit';

describe('creditText', () => {
  it('is null for Windy and custom rows, which carry no provider', () => {
    expect(creditText(null)).toBeNull();
    expect(creditText(undefined)).toBeNull();
    expect(creditText('')).toBeNull();
    expect(creditText('  \n ')).toBeNull();
  });

  it('keeps a plain credit line as it is', () => {
    expect(creditText('Source: Fintraffic / digitraffic.fi, license CC 4.0 BY'))
      .toBe('Source: Fintraffic / digitraffic.fi, license CC 4.0 BY');
  });

  it('strips the tags an FAA third-party attribution carries and keeps its words', () => {
    expect(creditText('<a href="https://www.alertwest.org/" target="_blank">ALERTWest</a>\n'))
      .toBe('ALERTWest');
    expect(creditText(
      'Colorado Division of Aeronautics <a href="http://www.colorado-aeronautics.org/" target="_blank">(CDOT Aero)</a>',
    )).toBe('Colorado Division of Aeronautics (CDOT Aero)');
  });

  it('turns block breaks into spaces and decodes the entities that appear', () => {
    expect(creditText(
      'NAV CANADA Aviation Weather Web Site <a href="x">(NAV CANADA)</a><p>These cameras are not maintained by the FAA.&#10;Thank You</p>',
    )).toBe('NAV CANADA Aviation Weather Web Site (NAV CANADA) These cameras are not maintained by the FAA. Thank You');
    expect(creditText('Parks &amp; Wildlife')).toBe('Parks & Wildlife');
  });
});
