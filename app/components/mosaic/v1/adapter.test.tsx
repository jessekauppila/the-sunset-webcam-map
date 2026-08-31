import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicV1 } from './index';
import { COMPOSITION_CONFIG } from './config';

// GeoMosaic draws to a canvas jsdom can't provide — stub it and inspect the
// props the adapter hands down.
vi.mock('./GeoMosaic', () => ({
  GeoMosaic: (props: Record<string, unknown>) => (
    <div data-testid="geo-mosaic" data-props={JSON.stringify(props)} />
  ),
}));

function renderedProps() {
  const el = screen.getByTestId('geo-mosaic');
  return JSON.parse(el.getAttribute('data-props') as string);
}

const base = {
  webcams: [],
  width: 1080,
  height: 1920,
  feed: 'sunset' as const,
};

describe('MosaicV1 adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  // Since Task 8, the adapter always merges settings (profile-or-default)
  // into config, so "no tuning params" means the resolved config equals the
  // schema defaults (which mirror COMPOSITION_CONFIG) rather than {}.
  const defaultSettingsConfig = {
    floorPx: COMPOSITION_CONFIG.floorPx,
    ceilPx: COMPOSITION_CONFIG.ceilPx,
    upscaleMax: COMPOSITION_CONFIG.upscaleMax,
    maxGrowth: COMPOSITION_CONFIG.maxGrowth,
    padding: COMPOSITION_CONFIG.padding,
    cullOverflow: COMPOSITION_CONFIG.cullOverflow,
  };

  it('passes settings-schema-default overrides when the query string has no tuning params', () => {
    render(<MosaicV1 {...base} search="setup=1&v=v1" />);
    expect(renderedProps().config).toEqual(defaultSettingsConfig);
  });

  it('parses v1 composition overrides out of the query string', () => {
    render(<MosaicV1 {...base} search="floor=120&cull=0" />);
    expect(renderedProps().config).toEqual({
      ...defaultSettingsConfig,
      floorPx: 120,
      cullOverflow: false,
    });
  });

  it('defaults to settings-schema defaults when search is omitted', () => {
    render(<MosaicV1 {...base} />);
    expect(renderedProps().config).toEqual(defaultSettingsConfig);
  });

  it('enables modelsMode with ?models=1', () => {
    render(<MosaicV1 {...base} search="models=1" />);
    expect(renderedProps().modelsMode).toBe(true);
  });

  it('leaves modelsMode off by default and for other values', () => {
    render(<MosaicV1 {...base} search="models=0" />);
    expect(renderedProps().modelsMode).toBe(false);
  });

  it('forwards the core mosaic props untouched', () => {
    render(<MosaicV1 {...base} setupMode search="" />);
    const props = renderedProps();
    expect(props.feed).toBe('sunset');
    expect(props.width).toBe(1080);
    expect(props.height).toBe(1920);
    expect(props.setupMode).toBe(true);
  });

  it('committed config is untouched by the adapter (overrides merge in GeoMosaic)', () => {
    // Guards the frozen-v1 contract: the adapter only parses URL overrides,
    // never rewrites the committed constants.
    expect(COMPOSITION_CONFIG.floorPx).toBe(100);
  });
});
