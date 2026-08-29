import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PanelFrame } from './PanelFrame';

function setWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, writable: true });
}

describe('PanelFrame', () => {
  beforeEach(() => setWindow(1024, 768));

  it('lays the panel out at its real dimensions, not the window size', () => {
    render(
      <PanelFrame panel={{ width: 1080, height: 1920 }}>
        <div>mosaic</div>
      </PanelFrame>
    );

    const stage = screen.getByTestId('panel-stage');
    expect(stage.style.width).toBe('1080px');
    expect(stage.style.height).toBe('1920px');
  });

  it('scales the panel down to fit the window', () => {
    render(
      <PanelFrame panel={{ width: 1080, height: 1920 }}>
        <div>mosaic</div>
      </PanelFrame>
    );

    // 768/1920 = 0.4 is tighter than 1024/1080
    expect(screen.getByTestId('panel-stage').style.transform).toBe('scale(0.4)');
  });

  it('scales from the top left so the transform is predictable', () => {
    render(
      <PanelFrame panel={{ width: 1080, height: 1920 }}>
        <div>mosaic</div>
      </PanelFrame>
    );

    expect(screen.getByTestId('panel-stage').style.transformOrigin).toBe(
      'top left'
    );
  });

  it('reserves only the scaled footprint so the page does not overflow', () => {
    render(
      <PanelFrame panel={{ width: 1080, height: 1920 }}>
        <div>mosaic</div>
      </PanelFrame>
    );

    const box = screen.getByTestId('panel-box');
    expect(box.style.width).toBe('432px'); // 1080 * 0.4
    expect(box.style.height).toBe('768px'); // 1920 * 0.4
  });

  it('restores the pointer the kiosk layout hides, since a preview is desk-side', () => {
    render(
      <PanelFrame panel={{ width: 1080, height: 1920 }}>
        <div>mosaic</div>
      </PanelFrame>
    );

    expect(screen.getByTestId('panel-box').style.cursor).toBe('auto');
  });

  it('renders its children inside the stage', () => {
    render(
      <PanelFrame panel={{ width: 1080, height: 1920 }}>
        <div>mosaic</div>
      </PanelFrame>
    );

    expect(screen.getByTestId('panel-stage').textContent).toBe('mosaic');
  });
});
