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

  it('passes empty overrides when the query string has no tuning params', () => {
    render(<MosaicV1 {...base} search="setup=1&v=v1" />);
    expect(renderedProps().config).toEqual({});
  });

  it('parses v1 composition overrides out of the query string', () => {
    render(<MosaicV1 {...base} search="floor=120&cull=0" />);
    expect(renderedProps().config).toEqual({
      floorPx: 120,
      cullOverflow: false,
    });
  });

  it('defaults to no overrides when search is omitted', () => {
    render(<MosaicV1 {...base} />);
    expect(renderedProps().config).toEqual({});
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
