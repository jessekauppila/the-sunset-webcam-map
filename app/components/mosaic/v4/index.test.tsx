import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MosaicV4 } from './index';
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

describe('v4 registration', () => {
  it('is reachable under the v4 key', () => {
    expect(MOSAIC_VERSIONS.v4).toBe(MosaicV4);
    expect(resolveMosaic('v4')).toBe(MosaicV4);
  });

  it('ships a settings schema in its own namespace', () => {
    expect(Array.isArray(MOSAIC_SETTINGS_SCHEMAS.v4)).toBe(true);
    expect(MOSAIC_SETTINGS_SCHEMAS.v4.length).toBeGreaterThan(0);
  });

  it('does not disturb the pinned default', () => {
    expect(DEFAULT_MOSAIC_VERSION).toBe('v1');
  });

  it('gives v4 a schema object distinct from v3 so their dials cannot alias', () => {
    expect(MOSAIC_SETTINGS_SCHEMAS.v4).not.toBe(MOSAIC_SETTINGS_SCHEMAS.v3);
  });

  it('renders a feed label at the given panel size', () => {
    render(<MosaicV4 webcams={[]} width={300} height={500} feed="sunset" />);
    expect(screen.getByText('SUNSET')).toBeInTheDocument();
  });
});

describe('MosaicV4 wiring', () => {
  it('honours the showFeedLabel knob', () => {
    const { queryByText, rerender } = render(
      <MosaicV4 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: false }} />
    );
    expect(queryByText('SUNSET')).toBeNull();
    rerender(
      <MosaicV4 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showFeedLabel: true }} />
    );
    expect(queryByText('SUNSET')).toBeInTheDocument();
  });

  it('lets ?models=1 beat the showModelReadout knob', () => {
    const { queryByTestId, rerender } = render(
      <MosaicV4 webcams={[]} width={300} height={500} feed="sunset"
                settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v4-model-overlay')).toBeNull();

    rerender(
      <MosaicV4 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=1" settings={{ showModelReadout: false }} />
    );
    expect(queryByTestId('v4-model-overlay')).toBeInTheDocument();
  });

  it('lets ?models=0 turn the readout off even when the knob is on', () => {
    render(
      <MosaicV4 webcams={[]} width={300} height={500} feed="sunset"
                search="?models=0" settings={{ showModelReadout: true }} />
    );
    expect(screen.queryByTestId('v4-model-overlay')).toBeNull();
  });

  it('renders setup mode without crashing on an empty pool', () => {
    render(
      <MosaicV4 webcams={[]} width={300} height={500} feed="sunrise" setupMode />
    );
    expect(screen.getByTestId('v4-setup-counts')).toBeInTheDocument();
  });
});

describe('v4 hands the engine a history instead of holding state inside it', () => {
  it('passes an admittedSince map and a clock reading on every composition', () => {
    // The engine stays pure (spec §5.4): the map and the clock are arguments,
    // not module state and not a hook reached for inside compose().
    render(<MosaicV4 webcams={[]} width={1080} height={1920} feed="sunset" settings={{}} />);
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
      <MosaicV4
        webcams={[]} width={1080} height={1920} feed="sunset"
        settings={{ showCentreLine: true }}
        allowDebugOverlays={false}
      />
    );
    expect(queryByTestId('v4-centre-line')).toBeNull();
  });

  it('draws it in studio, where the dial is the only gate', () => {
    const { getByTestId } = render(
      <MosaicV4
        webcams={[]} width={1080} height={1920} feed="sunset"
        settings={{ showCentreLine: true }}
      />
    );
    expect(getByTestId('v4-centre-line')).toBeTruthy();
  });

  it('stays off by default even where debug overlays are allowed', () => {
    const { queryByTestId } = render(
      <MosaicV4 webcams={[]} width={1080} height={1920} feed="sunset" settings={{}} />
    );
    expect(queryByTestId('v4-centre-line')).toBeNull();
  });
});

describe('URL dials beat the profile, the way ?models= already does', () => {
  const cfgOfLastCompose = () => vi.mocked(compose).mock.calls.at(-1)?.[2];

  it('applies number and enum dials from the query string', () => {
    render(
      <MosaicV4
        webcams={[]} width={1080} height={1920} feed="sunset"
        search="?bandCount=8&ceilingPx=240&bandGrid=inset"
        settings={{ bandCount: 13 }}
      />
    );
    expect(cfgOfLastCompose()).toMatchObject({ bandCount: 8, ceilingPx: 240, bandGrid: 'inset' });
  });

  it('clamps an out-of-range URL value instead of trusting it', () => {
    render(
      <MosaicV4 webcams={[]} width={1080} height={1920} feed="sunset" search="?bandCount=999" />
    );
    expect(cfgOfLastCompose()?.bandCount).toBe(40);
  });

  it('drops an unknown enum option and keeps the profile value', () => {
    render(
      <MosaicV4
        webcams={[]} width={1080} height={1920} feed="sunset"
        search="?bandGrid=sideways" settings={{ bandGrid: 'inset' }}
      />
    );
    expect(cfgOfLastCompose()?.bandGrid).toBe('inset');
  });

  it('shows the URL geometry in the setup footer so a screenshot records it', () => {
    render(
      <MosaicV4
        webcams={[]} width={1080} height={1920} feed="sunset"
        search="?bandCount=8&bandGrid=inset" setupMode
      />
    );
    expect(screen.getByTestId('v4-setup-counts').textContent).toContain('bands 8 inset');
  });
});
