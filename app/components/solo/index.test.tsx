import { it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SoloKiosk } from './index';

vi.mock('./useSoloGlass', () => ({
  useSoloGlass: vi.fn(() => ({ current: null, next: null, slot: 1, boundaryMs: 0, error: null, queueLength: 0 })),
}));
import { useSoloGlass } from './useSoloGlass';

it('drives by default on the kiosk and follows in a preview; passes dozing through', () => {
  render(<SoloKiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: true, dozing: false }));
  render(<SoloKiosk webcams={[]} width={100} height={50} feed="sunset" driveSchedule={false} dozing />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: false, dozing: true }));
});
