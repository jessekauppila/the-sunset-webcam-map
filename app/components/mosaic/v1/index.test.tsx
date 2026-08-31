import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { CompositionConfig } from './engine/types';

let capturedProps: { config?: Partial<CompositionConfig>; modelsMode?: boolean } = {};

vi.mock('./GeoMosaic', () => ({
  GeoMosaic: (props: { config?: Partial<CompositionConfig>; modelsMode?: boolean }) => {
    capturedProps = props;
    return null;
  },
}));

import { MosaicV1 } from './index';

describe('MosaicV1', () => {
  const baseProps = {
    webcams: [],
    width: 1080,
    height: 1920,
    feed: 'sunset' as const,
  };

  it('lets profile settings reach the composition config', () => {
    render(<MosaicV1 {...baseProps} settings={{ floorPx: 140 }} />);
    expect(capturedProps.config?.floorPx).toBe(140);
  });

  it('lets a URL override win over a profile setting', () => {
    render(
      <MosaicV1 {...baseProps} settings={{ floorPx: 140 }} search="floor=60" />
    );
    expect(capturedProps.config?.floorPx).toBe(60);
  });

  it('turns modelsMode on when the profile sets showModelReadout', () => {
    render(<MosaicV1 {...baseProps} settings={{ showModelReadout: true }} />);
    expect(capturedProps.modelsMode).toBe(true);
  });

  it('lets an explicit ?models=0 beat a profile showModelReadout: true', () => {
    render(
      <MosaicV1
        {...baseProps}
        settings={{ showModelReadout: true }}
        search="models=0"
      />
    );
    expect(capturedProps.modelsMode).toBe(false);
  });
});
