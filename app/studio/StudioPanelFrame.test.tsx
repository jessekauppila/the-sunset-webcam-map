import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StudioPanelFrame } from './StudioPanelFrame';

/**
 * jsdom has no ResizeObserver. Stub one that reports a fixed content box the
 * instant `observe` is called, so the component's effect resolves
 * synchronously within the test's render.
 */
function stubResizeObserver(size: { width: number; height: number }) {
  class StubResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: {
              width: size.width,
              height: size.height,
            } as DOMRectReadOnly,
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }

    unobserve() {}
    disconnect() {}
  }

  global.ResizeObserver = StubResizeObserver;
}

describe('StudioPanelFrame', () => {
  it('scales a 1440x2560 panel to fit a 700x900 box by the narrower ratio', () => {
    stubResizeObserver({ width: 700, height: 900 });

    render(
      <StudioPanelFrame panel={{ width: 1440, height: 2560 }}>
        <div>content</div>
      </StudioPanelFrame>
    );

    const stage = screen.getByTestId('studio-panel-stage');
    // 700/1440 = 0.4861..., 900/2560 = 0.3515625 — the narrower ratio wins.
    expect(stage.style.transform).toBe('scale(0.3515625)');
    expect(stage.style.width).toBe('1440px');
    expect(stage.style.height).toBe('2560px');
    expect(stage.style.transformOrigin).toBe('top left');
    expect(stage.style.background).toBe('rgb(0, 0, 0)');
  });

  it('caps the scale at 1 when the measured box is larger than the panel', () => {
    stubResizeObserver({ width: 5000, height: 8000 });

    render(
      <StudioPanelFrame panel={{ width: 1440, height: 2560 }}>
        <div>content</div>
      </StudioPanelFrame>
    );

    const stage = screen.getByTestId('studio-panel-stage');
    expect(stage.style.transform).toBe('scale(1)');
  });
});
