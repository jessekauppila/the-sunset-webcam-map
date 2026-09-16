'use client';

import { Solo2Screen } from '@/app/components/solo2/Solo2Screen';
import { useGlassFollower } from '@/app/components/solo2/useGlassFollower';
import { PanelFrame } from '@/app/kiosk/PanelFrame';
import { DEFAULT_PANEL_PRESET, PANEL_PRESETS, type PanelSize } from '@/app/kiosk/panelPreview';
import type { Feed } from '@/app/lib/solo/types';

/**
 * The panel the live profile names, or the pinned default when the build
 * does not know that name. Shared by the one-screen mirror and the piece.
 *
 * The fallback matters more here than on the kiosk: the projection's
 * `panelPreset` is a string off a settings row, so a preset added to the
 * glass's profile and not yet to this build would otherwise index to
 * undefined and scale the composition to nothing.
 */
export function panelFor(preset: string | null): PanelSize {
  // `Object.hasOwn`, not a bare index: PANEL_PRESETS is an object literal, so
  // it inherits Object.prototype, and a preset named `constructor` or
  // `toString` would index to a FUNCTION. That is truthy, so `??` would not
  // fall back, and the panel's width would come out undefined — a stage
  // scaled to NaN, drawing nothing, with no error anywhere. Same idiom as
  // resolveSoloVersion.
  return preset != null && Object.hasOwn(PANEL_PRESETS, preset)
    ? PANEL_PRESETS[preset]
    : PANEL_PRESETS[DEFAULT_PANEL_PRESET];
}

/** The black a mirror holds until its first projection lands. */
export function MirrorDark() {
  return <div data-testid="mirror-dark" style={{ width: '100vw', height: '100vh', background: '#000' }} />;
}

/**
 * A public screen that shows what the glass shows (mirror spec §3). It
 * follows the same projection the kiosk does and renders the same
 * composition at the glass's own panel size, scaled into the window: a
 * visitor sees the picture the gallery sees, pillarboxed on a landscape
 * desktop and nearly full-bleed on a portrait phone.
 *
 * It follows and never drives. No advance, no kiosk tick, no query
 * parameters, no overlays, and no doze — doze is the glass going black in
 * the gallery's quiet hours, which is a fact about a room a visitor is not
 * standing in.
 */
export function MirrorPage({ feed }: { feed: Feed }) {
  const glass = useGlassFollower(feed);
  if (!glass.dials) return <MirrorDark />;
  const panel = panelFor(glass.panelPreset);
  return (
    <PanelFrame panel={panel}>
      <Solo2Screen glass={glass} dials={glass.dials} width={panel.width} height={panel.height} feed={feed} debug={false} />
    </PanelFrame>
  );
}
