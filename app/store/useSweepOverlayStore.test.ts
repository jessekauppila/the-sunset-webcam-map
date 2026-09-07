import { describe, it, expect, beforeEach } from 'vitest';
import {
  anyRingShown,
  DEFAULT_TOGGLES,
  SWEEP_OVERLAY_STORAGE_KEY,
  useSweepOverlayStore,
} from './useSweepOverlayStore';

beforeEach(() => {
  window.localStorage.clear();
  useSweepOverlayStore.setState({ ...DEFAULT_TOGGLES, hydrated: false });
});

describe('useSweepOverlayStore', () => {
  it('starts with everything off', () => {
    expect(anyRingShown(useSweepOverlayStore.getState())).toBe(false);
    expect(useSweepOverlayStore.getState().showBoxes).toBe(false);
  });

  it('remembers a toggle in localStorage', () => {
    useSweepOverlayStore.getState().set('showDay', true);
    expect(JSON.parse(window.localStorage.getItem(SWEEP_OVERLAY_STORAGE_KEY)!)).toEqual({
      ...DEFAULT_TOGGLES, showDay: true,
    });
  });

  it('hydrates from what was stored, once', () => {
    window.localStorage.setItem(SWEEP_OVERLAY_STORAGE_KEY, JSON.stringify({ showBase: true, showBoxes: true }));
    useSweepOverlayStore.getState().hydrate();
    expect(useSweepOverlayStore.getState().showBase).toBe(true);
    expect(useSweepOverlayStore.getState().showBoxes).toBe(true);
    useSweepOverlayStore.getState().set('showBase', false);
    window.localStorage.setItem(SWEEP_OVERLAY_STORAGE_KEY, JSON.stringify({ showBase: true }));
    useSweepOverlayStore.getState().hydrate();
    expect(useSweepOverlayStore.getState().showBase).toBe(false);
  });

  it('ignores junk in storage and renders the defaults', () => {
    window.localStorage.setItem(SWEEP_OVERLAY_STORAGE_KEY, '{not json');
    useSweepOverlayStore.getState().hydrate();
    expect(useSweepOverlayStore.getState()).toMatchObject(DEFAULT_TOGGLES);
    window.localStorage.setItem(SWEEP_OVERLAY_STORAGE_KEY, JSON.stringify({ showBase: 'yes' }));
    useSweepOverlayStore.setState({ hydrated: false });
    useSweepOverlayStore.getState().hydrate();
    expect(useSweepOverlayStore.getState().showBase).toBe(false);
  });

  it('boxes alone draw nothing: a ring has to be shown', () => {
    expect(anyRingShown({ ...DEFAULT_TOGGLES, showBoxes: true })).toBe(false);
    expect(anyRingShown({ ...DEFAULT_TOGGLES, showNight: true })).toBe(true);
  });
});
