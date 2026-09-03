import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicV3 } from './index';
import {
  MOSAIC_VERSIONS,
  MOSAIC_SETTINGS_SCHEMAS,
  resolveMosaic,
  DEFAULT_MOSAIC_VERSION,
} from '../registry';

describe('v3 registration', () => {
  it('is reachable under the v3 key', () => {
    expect(MOSAIC_VERSIONS.v3).toBe(MosaicV3);
    expect(resolveMosaic('v3')).toBe(MosaicV3);
  });

  it('ships a settings schema in its own namespace', () => {
    expect(Array.isArray(MOSAIC_SETTINGS_SCHEMAS.v3)).toBe(true);
    expect(MOSAIC_SETTINGS_SCHEMAS.v3.length).toBeGreaterThan(0);
  });

  it('does not disturb the pinned default', () => {
    expect(DEFAULT_MOSAIC_VERSION).toBe('v1');
  });

  it('gives v3 a schema object distinct from v2 so their dials cannot alias', () => {
    expect(MOSAIC_SETTINGS_SCHEMAS.v3).not.toBe(MOSAIC_SETTINGS_SCHEMAS.v2);
  });

  it('renders a feed label at the given panel size', () => {
    render(<MosaicV3 webcams={[]} width={300} height={500} feed="sunset" />);
    expect(screen.getByText('SUNSET')).toBeInTheDocument();
  });
});

describe('MosaicV3 wiring', () => {
  it('honours the showFeedLabel knob', () => {
    const { queryByText, rerender } = render(
      <MosaicV3 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: false }} />
    );
    expect(queryByText('SUNSET')).toBeNull();
    rerender(
      <MosaicV3 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: true }} />
    );
    expect(queryByText('SUNSET')).toBeInTheDocument();
  });

  it('lets ?models=1 beat the showModelReadout knob', () => {
    const { queryByTestId, rerender } = render(
      <MosaicV3 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v3-model-overlay')).toBeNull();

    rerender(
      <MosaicV3 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=1" settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v3-model-overlay')).toBeInTheDocument();
  });

  it('lets ?models=0 turn the readout off even when the knob is on', () => {
    render(
      <MosaicV3 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=0" settings={{ showModelReadout: true }} />
    );
    expect(screen.queryByTestId('v3-model-overlay')).toBeNull();
  });

  it('renders setup mode without crashing on an empty pool', () => {
    render(
      <MosaicV3 webcams={[]} width={300} height={500} feed="sunrise" setupMode />
    );
    expect(screen.getByTestId('v3-setup-counts')).toBeInTheDocument();
  });
});
