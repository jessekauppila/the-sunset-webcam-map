import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicV3 } from './index';
import { compose } from './engine/compose';
import {
  MOSAIC_VERSIONS,
  MOSAIC_SETTINGS_SCHEMAS,
  resolveMosaic,
  DEFAULT_MOSAIC_VERSION,
} from '../registry';

vi.mock('./engine/compose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine/compose')>();
  return { ...actual, compose: vi.fn(actual.compose) };
});

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

describe('v3 hands the engine a history instead of holding state inside it', () => {
  it('passes an admittedSince map and a clock reading on every composition', () => {
    // The engine stays pure (spec §5.4): the map and the clock are arguments,
    // not module state and not a hook reached for inside compose().
    render(<MosaicV3 webcams={[]} width={1080} height={1920} feed="sunset" settings={{}} />);
    const history = vi.mocked(compose).mock.calls.at(-1)?.[5];
    expect(history?.admittedSince).toBeInstanceOf(Map);
    expect(typeof history?.now).toBe('number');
  });
});

describe('the centre line cannot reach the glass through a settings row', () => {
  it('does not draw it on a kiosk route even when the dial is on', () => {
    // Spec §7: Deploy copies settings rows to the kiosk, so a dial left on in
    // studio would follow it to the wall. The route decides, not the dial.
    const { queryByTestId } = render(
      <MosaicV3
        webcams={[]} width={1080} height={1920} feed="sunset"
        settings={{ showCentreLine: true }}
        allowDebugOverlays={false}
      />
    );
    expect(queryByTestId('v3-centre-line')).toBeNull();
  });

  it('draws it in studio, where the dial is the only gate', () => {
    const { getByTestId } = render(
      <MosaicV3
        webcams={[]} width={1080} height={1920} feed="sunset"
        settings={{ showCentreLine: true }}
      />
    );
    expect(getByTestId('v3-centre-line')).toBeTruthy();
  });

  it('stays off by default even where debug overlays are allowed', () => {
    const { queryByTestId } = render(
      <MosaicV3 webcams={[]} width={1080} height={1920} feed="sunset" settings={{}} />
    );
    expect(queryByTestId('v3-centre-line')).toBeNull();
  });
});

describe('URL dials beat the profile, the way ?models= already does', () => {
  const cfgOfLastCompose = () => vi.mocked(compose).mock.calls.at(-1)?.[2];

  it('applies number and enum dials from the query string', () => {
    render(
      <MosaicV3
        webcams={[]} width={1080} height={1920} feed="sunset"
        search="?bandCount=8&ceilingPx=240&bandGrid=inset"
        settings={{ bandCount: 13 }}
      />
    );
    expect(cfgOfLastCompose()).toMatchObject({ bandCount: 8, ceilingPx: 240, bandGrid: 'inset' });
  });

  it('clamps an out-of-range URL value instead of trusting it', () => {
    render(
      <MosaicV3 webcams={[]} width={1080} height={1920} feed="sunset" search="?bandCount=999" />
    );
    expect(cfgOfLastCompose()?.bandCount).toBe(40);
  });

  it('drops an unknown enum option and keeps the profile value', () => {
    render(
      <MosaicV3
        webcams={[]} width={1080} height={1920} feed="sunset"
        search="?bandGrid=sideways" settings={{ bandGrid: 'inset' }}
      />
    );
    expect(cfgOfLastCompose()?.bandGrid).toBe('inset');
  });

  it('shows the URL geometry in the setup footer so a screenshot records it', () => {
    render(
      <MosaicV3
        webcams={[]} width={1080} height={1920} feed="sunset"
        search="?bandCount=8&bandGrid=inset" setupMode
      />
    );
    expect(screen.getByTestId('v3-setup-counts').textContent).toContain('bands 8 inset');
  });
});
