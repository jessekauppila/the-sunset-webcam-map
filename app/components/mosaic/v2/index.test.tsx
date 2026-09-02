import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicV2 } from './index';
import { MOSAIC_VERSIONS, MOSAIC_SETTINGS_SCHEMAS, resolveMosaic } from '../registry';

describe('v2 registration', () => {
  it('is selectable by name from the registry', () => {
    expect(MOSAIC_VERSIONS.v2).toBe(MosaicV2);
    expect(resolveMosaic('v2')).toBe(MosaicV2);
  });

  it('exposes a settings schema under the v2 namespace', () => {
    expect(MOSAIC_SETTINGS_SCHEMAS.v2).toBeDefined();
    expect(Array.isArray(MOSAIC_SETTINGS_SCHEMAS.v2)).toBe(true);
  });

  it('renders a feed label at the given panel size', () => {
    render(<MosaicV2 webcams={[]} width={300} height={500} feed="sunset" />);
    expect(screen.getByText('SUNSET')).toBeInTheDocument();
  });
});
