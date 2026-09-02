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

describe('MosaicV2 wiring', () => {
  it('honours the showFeedLabel knob', () => {
    const { queryByText, rerender } = render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: false }} />
    );
    expect(queryByText('SUNSET')).toBeNull();
    rerender(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: true }} />
    );
    expect(queryByText('SUNSET')).toBeInTheDocument();
  });

  it('lets ?models=1 beat the showModelReadout knob', () => {
    const { queryByTestId, rerender } = render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v2-model-overlay')).toBeNull();

    rerender(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=1" settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v2-model-overlay')).toBeInTheDocument();
  });

  it('lets ?models=0 turn the readout off even when the knob is on', () => {
    render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=0" settings={{ showModelReadout: true }} />
    );
    expect(screen.queryByTestId('v2-model-overlay')).toBeNull();
  });

  it('renders setup mode without crashing on an empty pool', () => {
    render(
      <MosaicV2 webcams={[]} width={300} height={500} feed="sunrise" setupMode />
    );
    expect(screen.getByTestId('v2-setup-counts')).toBeInTheDocument();
  });
});
